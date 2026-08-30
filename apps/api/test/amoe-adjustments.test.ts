/**
 * HO-031: lo que la via gratuita y el panel necesitan de la API y no recibian.
 *
 * ---------------------------------------------------------------------------
 * QUE SE PRUEBA AQUI Y POR QUE ASI
 * ---------------------------------------------------------------------------
 *
 * Estos tests recorren el handler REAL y la serializacion REAL: se inyecta una
 * peticion en la aplicacion y se lee el JSON que sale por el cable. Es la unica
 * forma de comprobar lo que de verdad importa de DEC-014 -que el serializador
 * no deja salir lo que el esquema no declara- porque esa propiedad no se
 * observa llamando al servicio: se observa mirando la respuesta.
 *
 * Lo que se sustituye son los SERVICIOS DE DOMINIO, por sus adaptadores en
 * memoria. `domainServicesFor` construye adaptadores Drizzle sobre una conexion
 * viva, y estos tests no tienen ninguna. DEC-018 ya dice donde esta la linea:
 * lo que vive en el motor -triggers, indices unicos, exclusion GiST- se prueba
 * contra PostgreSQL en `packages/database/test/integration`, no aqui. Lo que se
 * prueba aqui es la FORMA de la respuesta y quien puede pedirla.
 *
 * `requireStaff` tambien se sustituye, y por el mismo motivo: consulta
 * `admin_users` en la base de datos. Que la sesion de personal sea de verdad lo
 * comprueba `session-authorizer.test.ts`; lo que falta comprobar es que estas
 * rutas la exigen, y eso se hace con el autorizador por defecto puesto.
 *
 * NINGUN VALOR DE ESTE ARCHIVO ES UN REQUISITO LEGAL. La configuracion AMOE de
 * abajo es una fixture: la modalidad, la ventana, el limite y cuanto vale un
 * envio los decide el abogado del cliente y siguen en `TBD`.
 */

import {
  AdjustmentService,
  AmoeService,
  ENTRY_CALCULATION_ENGINE_VERSION,
  ENTRY_REASON_KEYS,
  FixedClock,
  InMemoryAdjustmentRepository,
  InMemoryAmoeSubmissionRepository,
  InMemoryLedgerRepository,
  InMemoryPromotionContextPort,
  InMemoryUnitOfWork,
  RecordingAuditSink,
  SequentialIdGenerator,
  DEFAULT_SWEEPSTAKES_FLAGS,
  type IanaTimeZone,
  type Principal,
  type PromotionContext,
  type SweepstakesFlags,
} from "@lsw/sweepstakes";
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import {
  createFakeRepositories,
  PARTICIPANT_ID,
  PROMOTION_ID,
  RULES_VERSION_ID,
} from "./support/in-memory-repositories.js";

const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
/** El segundo administrador. Quien teclea una ficha postal no la aprueba (DEC-054 punto 4). */
const OTHER_ADMIN_ID = "45454545-4545-4545-8454-454545454545";
const OTHER_PARTICIPANT_ID = "34343434-3434-4343-8343-343434343434";
const PROMOTION_SLUG = "fixture-promotion";
const NOW = new Date("2026-09-15T12:00:00.000Z");

/**
 * Portador mutable de lo que ven los mocks.
 *
 * `vi.hoisted` porque las fabricas de `vi.mock` se elevan por encima de los
 * imports: una `const` normal declarada arriba todavia no existe cuando la
 * fabrica corre.
 */
const shared: { domain: unknown; staff: unknown } = vi.hoisted(() => ({
  domain: null,
  staff: null,
}));

vi.mock("../src/services/domain-registry.js", () => ({
  domainServicesFor: () => shared.domain,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaff: () => {
    if (shared.staff === null) {
      throw new Error("El test no ha declarado principal de personal.");
    }
    return Promise.resolve(shared.staff);
  },
}));

// ---------------------------------------------------------------------------
// Fixtures. Ninguna es una regla del cliente.
// ---------------------------------------------------------------------------

/**
 * Configuracion AMOE de PRUEBA, con los tres bloques nuevos poblados.
 *
 * `identity_fields` solo declara descriptor para `email`: asi el mismo test
 * comprueba el camino con descriptor y el camino sin el, que es el que cae en
 * los valores por defecto honestos.
 */
function amoeConfigFixture(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    mode: "ONLINE_FORM",
    submission_window: {
      starts_at: "2026-08-01T05:00:00.000Z",
      ends_at: "2026-12-01T06:00:00.000Z",
    },
    entries_per_approved_submission: 5,
    requires_review: true,
    limit: { max_per_participant_per_period: 3, period: "DAY" },
    duplicate_policy: "REJECT",
    identity_requirements: ["full_name", "email"],
    identity_fields: { email: { type: "EMAIL", label_key: "email", max_length: 120 } },
    instructions: {
      "en-US": "FIXTURE ONLY. Not legal text.",
      "es-US": "SOLO FIXTURE. No es texto legal.",
    },
    external_url: "https://example.test/free-entry",
    ...overrides,
  };
}

function rulesConfigFixture(
  amoe: unknown,
  perParticipantMax: number | null = null,
): Record<string, unknown> {
  return {
    product_eligibility: { mode: "ALL_PRODUCTS" },
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT",
      amount_unit_minor: "100",
      entries_per_amount_unit: { numerator: 1, denominator: 1 },
      rounding_policy: "FLOOR",
    },
    entry_limits: { per_order_max: null, per_participant_max: perParticipantMax },
    partial_refund_rounding_policy: "FLOOR",
    order_qualification: { qualifying_payment_state: "PAID" },
    ...(amoe === undefined ? {} : { amoe }),
  };
}

interface DomainHarness {
  readonly ledger: InMemoryLedgerRepository;
  readonly submissions: InMemoryAmoeSubmissionRepository;
  readonly amoe: AmoeService;
  readonly adjustments: AdjustmentService;
  /** Deja saldo previo en el ledger, para que las proyecciones no sean sobre cero. */
  grant(participantId: string, quantity: number, ref: string): Promise<void>;
}

interface HarnessOptions {
  readonly flags?: Partial<SweepstakesFlags>;
  readonly amoe?: unknown;
  /**
   * `entry_limits.per_participant_max` de la version de reglas. NO es una cifra
   * legal: el tope real lo fija el abogado y el motor lo ejecuta. Aqui existe
   * para poder provocar un recorte y comprobar que `applied_cap` lo explica.
   */
  readonly perParticipantMax?: number | null;
}

function buildDomain(options: HarnessOptions = {}): DomainHarness {
  const ledger = new InMemoryLedgerRepository();
  const submissions = new InMemoryAmoeSubmissionRepository();
  const adjustmentRows = new InMemoryAdjustmentRepository();
  const promotions = new InMemoryPromotionContextPort();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator();
  const audit = new RecordingAuditSink();
  const unitOfWork = new InMemoryUnitOfWork();

  const context: PromotionContext = {
    promotionId: PROMOTION_ID,
    status: "ACTIVE",
    legalTimeZone: "America/Chicago" as IanaTimeZone,
    startsAt: new Date("2026-08-01T05:00:00.000Z"),
    endsAt: new Date("2026-12-01T06:00:00.000Z"),
    currency: "USD",
    rulesVersionId: RULES_VERSION_ID,
    rulesConfig: rulesConfigFixture(options.amoe, options.perParticipantMax ?? null),
    flags: { ...DEFAULT_SWEEPSTAKES_FLAGS, ...options.flags },
    amoeMode: null,
  };
  promotions.register(context);

  const ports = { ledger, promotions, clock, ids, audit, unitOfWork };

  const harness: DomainHarness = {
    ledger,
    submissions,
    amoe: new AmoeService({ ...ports, submissions }),
    adjustments: new AdjustmentService({ ...ports, adjustments: adjustmentRows }),
    grant: async (participantId, quantity, ref) => {
      await ledger.append({
        id: ids.next(),
        promotionId: PROMOTION_ID,
        participantId,
        type: "PURCHASE_EARNED",
        sourceType: "PURCHASE",
        sourceRef: ref,
        quantityDelta: quantity,
        status: "POSTED",
        effectiveAt: new Date("2026-09-01T05:00:00.000Z"),
        expiresAt: null,
        recordedAt: new Date("2026-09-01T05:00:00.000Z"),
        rulesVersionId: RULES_VERSION_ID,
        engineVersion: ENTRY_CALCULATION_ENGINE_VERSION,
        calculationSnapshotId: null,
        reversesTransactionId: null,
        actorType: "SYSTEM",
        actorAdminUserId: null,
        actorParticipantId: null,
        reasonKey: ENTRY_REASON_KEYS.purchaseQualified,
        reasonDetail: null,
        metadata: {},
      });
    },
  };

  // Los modulos de ruta leen `domain.repositories.<x>` en tiempo de
  // construccion (`orders`, `exportSnapshots`). Se declaran las que este
  // archivo usa; las demas quedan ausentes a proposito, porque un handler que
  // las tocara debe romperse ruidosamente en vez de operar sobre un doble
  // silencioso que nadie preparo.
  shared.domain = {
    repositories: { ledger, amoe: submissions, adjustments: adjustmentRows, unitOfWork },
    clock,
    ids,
    // La cola de revision etiqueta cada fila con el correo ENMASCARADO del
    // participante (`amoe.review.read` declara `touchesPii`). El doble devuelve
    // un perfil con correo para que la ruta ejerza el enmascarado de verdad;
    // `null` significaria "expediente sin correo", que es otro caso.
    participants: {
      findProfile: (participantId: string) =>
        Promise.resolve({
          id: participantId,
          email: "fixture@example.com",
          display_name: null,
          email_verified: false,
          language_preference: "es-US",
          created_at: NOW.toISOString(),
        }),
    },
    amoe: harness.amoe,
    adjustments: harness.adjustments,
  };

  return harness;
}

function staffWith(capabilities: readonly string[], adminUserId: string = ADMIN_ID): Principal {
  return {
    actor: { type: "ADMIN", adminUserId },
    scope: "STAFF",
    capabilities: [...capabilities],
  };
}

function buildDependencies(): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies;
}

/** App con el autorizador ABIERTO. La postura por defecto se prueba aparte. */
async function appAllowingPermissions(): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies());
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

beforeEach(() => {
  shared.domain = null;
  shared.staff = null;
});

// ---------------------------------------------------------------------------
// 1. amoe-config: lo que la via gratuita necesita para pintarse
// ---------------------------------------------------------------------------

describe("GET /promotions/:slug/amoe-config", () => {
  it("publica los campos del formulario, las instrucciones y el destino externo", async () => {
    buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    const app = await createApp(buildDependencies());

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/promotions/${PROMOTION_SLUG}/amoe-config`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();

    expect(body.enabled).toBe(true);
    // Sin este campo, quien pregunta por `slug` no sabe a que identificador
    // enviar: el POST de envio se dirige por `promotion_id`.
    expect(body.promotion_id).toBe(PROMOTION_ID);
    expect(body.external_url).toBe("https://example.test/free-entry");
    expect(body.instructions).toEqual({
      "en-US": "FIXTURE ONLY. Not legal text.",
      "es-US": "SOLO FIXTURE. No es texto legal.",
    });

    // El ORDEN es el de `identity_requirements`, no el del mapa de
    // descriptores: el orden en que se piden los datos es parte de como se
    // presenta la via gratuita.
    expect(body.required_fields).toEqual([
      {
        key: "full_name",
        type: "TEXT",
        required: true,
        label_key: "full_name",
        max_length: 500,
      },
      { key: "email", type: "EMAIL", required: true, label_key: "email", max_length: 120 },
    ]);

    // La lista legal en crudo sigue viajando: es lo que el dominio exige, y no
    // se sustituye por su proyeccion.
    expect(body.identity_requirements).toEqual(["full_name", "email"]);
  });

  it("sin instrucciones ni destino configurados responde null, no texto de relleno", async () => {
    // El sistema NO redacta instrucciones. Es texto legal y lo escribe el
    // abogado; un hueco relleno por el backend seria una afirmacion sobre las
    // condiciones de participacion que nadie aprobo.
    buildDomain({
      flags: { amoe_enabled: true },
      amoe: amoeConfigFixture({
        mode: "MAIL_IN_REVIEW",
        instructions: undefined,
        external_url: undefined,
        identity_fields: undefined,
      }),
    });
    const app = await createApp(buildDependencies());

    const body = (
      await app.inject({
        method: "GET",
        url: `/api/v1/promotions/${PROMOTION_SLUG}/amoe-config`,
      })
    ).json<Record<string, unknown>>();

    expect(body.instructions).toBeNull();
    expect(body.external_url).toBeNull();
    // Los campos SI se publican: el dominio los exige en cualquier envio que
    // entre por la API, tambien en las modalidades sin formulario en pantalla.
    expect(body.required_fields).toHaveLength(2);
  });

  it("con la via apagada, todo es null salvo la promocion por la que se pregunto", async () => {
    buildDomain({ flags: { amoe_enabled: false }, amoe: amoeConfigFixture() });
    const app = await createApp(buildDependencies());

    const body = (
      await app.inject({
        method: "GET",
        url: `/api/v1/promotions/${PROMOTION_SLUG}/amoe-config`,
      })
    ).json<Record<string, unknown>>();

    expect(body.enabled).toBe(false);
    expect(body.promotion_id).toBe(PROMOTION_ID);
    expect(body.mode).toBeNull();
    expect(body.required_fields).toBeNull();
    expect(body.instructions).toBeNull();
    expect(body.external_url).toBeNull();
    expect(body.entries_per_approved_submission).toBeNull();
    // Si la via no existe, sus parametros tampoco son asunto de nadie.
    expect(body.identity_requirements).toEqual([]);
  });

  it("un destino externo que no es https rompe la configuracion en vez de llegar al navegador", async () => {
    buildDomain({
      flags: { amoe_enabled: true },
      // Partido en dos para que el literal no dispare a los escaneres que
      // buscan este esquema en el codigo: aqui es el dato bajo prueba, no un
      // destino que la aplicacion vaya a usar.
      amoe: amoeConfigFixture({ external_url: `${"java"}script:alert(1)` }),
    });
    const app = await createApp(buildDependencies());

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/promotions/${PROMOTION_SLUG}/amoe-config`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("AMOE_CONFIG_INVALID");
  });

  it("el serializador no deja salir la politica de duplicados (DEC-014)", async () => {
    // Publicarla seria regalar el mapa de los controles antifraude. No se filtra
    // porque para filtrarse habria que declararla en el esquema.
    buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    const app = await createApp(buildDependencies());

    const body = (
      await app.inject({
        method: "GET",
        url: `/api/v1/promotions/${PROMOTION_SLUG}/amoe-config`,
      })
    ).json<Record<string, unknown>>();

    expect(body).not.toHaveProperty("duplicate_policy");
    expect(body).not.toHaveProperty("identity_fields");
  });
});

// ---------------------------------------------------------------------------
// 2. Cola de revision: antes, cambio y despues, calculados por el motor
// ---------------------------------------------------------------------------

describe("GET /admin/amoe-submissions", () => {
  it("proyecta el saldo antes y despues de aprobar, sin que el panel sume nada", async () => {
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.grant(PARTICIPANT_ID, 12, "order:fixture-1");
    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
    });

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const [item] = response.json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.entries_before).toBe(12);
    expect(item?.entries_if_approved).toBe(5);
    expect(item?.entries_after_if_approved).toBe(17);
    // Todavia no ha otorgado nada: la aprobacion no ha ocurrido. `null` y no
    // `0`, porque "aun no" y "cero" no son la misma afirmacion.
    expect(item?.entries_awarded).toBeNull();
  });

  it("un participante sin ninguna fila tiene saldo previo CERO, no nulo", async () => {
    // La ausencia de filas es un saldo conocido, no un saldo desconocido: es la
    // misma decision que toma `lsw_entry_balance_at` con su `coalesce`.
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: OTHER_PARTICIPANT_ID,
      payload: { full_name: "Grace Hopper", email: "grace@example.test" },
    });

    const app = await appAllowingPermissions();
    const [item] = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.entries_before).toBe(0);
    expect(item?.entries_after_if_approved).toBe(5);
  });

  it("dos envios del mismo participante NO acumulan el saldo previo entre filas", async () => {
    // Cada proyeccion contesta "si apruebo ESTE", no "si los apruebo todos".
    // Acumular haria que la segunda fila prometiera un saldo que solo existiria
    // si la primera se hubiera aprobado ya.
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.grant(PARTICIPANT_ID, 12, "order:fixture-1");
    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
    });
    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada+2@example.test" },
    });

    const app = await appAllowingPermissions();
    const { items } = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: Record<string, unknown>[] }>();

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.entries_before)).toEqual([12, 12]);
    expect(items.map((item) => item.entries_after_if_approved)).toEqual([17, 17]);
  });

  it("sigue sin publicar el payload del envio", async () => {
    // Contiene datos personales y la cola no los necesita para decidir.
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
    });

    const app = await appAllowingPermissions();
    const [item] = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: Record<string, unknown>[] }>().items;

    expect(item).not.toHaveProperty("payload");
    expect(JSON.stringify(item)).not.toContain("ada@example.test");
  });

  /**
   * El correo del participante SI sale, y ENMASCARADO.
   *
   * `amoe.review.read` declara `touchesPii` en el catalogo de `@lsw/security`:
   * la cola de revision mira expedientes de personas por definicion. Lo que no
   * sale es el dato completo -eso es `pii.view.full`, otra capacidad y con
   * motivo-: el revisor necesita DISTINGUIR filas y reconocer un dominio
   * desechable, no leer la direccion.
   */
  it("etiqueta la fila con el correo ENMASCARADO, nunca con el entero", async () => {
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    // El correo exige `pii.view.masked` ADEMAS de `amoe.review.read` (S-10).
    shared.staff = staffWith(["amoe.review.read", "pii.view.masked"]);

    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
    });

    const app = await appAllowingPermissions();
    const [item] = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: { participant_email: string | null; transcribed_by_me: boolean }[] }>().items;

    // Dominio entero e inicial de la parte local: es lo que `http/pii.ts`
    // describe para `pii.view.masked`.
    expect(item?.participant_email).toContain("@example.com");
    expect(item?.participant_email).not.toBe("fixture@example.com");
    // Un envio propio del participante no lo tecleo nadie del equipo.
    expect(item?.transcribed_by_me).toBe(false);
  });

  /**
   * S-10: sin `pii.view.masked` no se publica el correo, y ni siquiera se lee.
   *
   * Que hoy todos los roles con `amoe.review.read` tengan tambien esa
   * capacidad es una coincidencia del reparto, no una garantia: manana entra
   * un rol de solo-cola y se llevaria el correo sin que nadie lo decidiera.
   */
  it("sin pii.view.masked, la cola no publica el correo del participante", async () => {
    const domain = buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.amoe.submit({
      promotionId: PROMOTION_ID,
      participantId: PARTICIPANT_ID,
      payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
    });

    const app = await appAllowingPermissions();
    const [item] = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: Record<string, unknown>[] }>().items;

    expect(item?.participant_email).toBeNull();
    // Y el identificador crudo del transcriptor no viaja para NADIE.
    expect(item).not.toHaveProperty("transcribed_by_admin_user_id");
  });

  /**
   * EL FILTRO `?status=` ES LO QUE HACE AUDITABLE UN ENVIO YA DECIDIDO.
   *
   * Sin el, una aprobacion sacaba la ficha de la unica lectura administrativa
   * que existia y con ella se iban `granted_entries` y `applied_cap`: la cifra
   * que se concedio DE VERDAD -leida del ledger- y el recorte que explica por
   * que fue menor que la anunciada. Un registro promocional que no se puede
   * volver a mirar no es auditable, y estos lo son por definicion.
   *
   * El recorrido es el de la via postal entera: se transcribe una ficha, la
   * aprueba OTRA persona -la separacion de funciones de DEC-054 punto 4- y el
   * tope por participante recorta la concesion.
   */
  it("un envio aprobado sale de la cola de trabajo y se recupera con ?status=APPROVED", async () => {
    // Tope de 10 y 5 por ficha son FIXTURES: el tope real lo fija el abogado.
    // Con 8 ya en el ledger, la aprobacion concede 2 y anota el recorte.
    const domain = buildDomain({
      flags: { amoe_enabled: true, entry_caps_enabled: true },
      amoe: amoeConfigFixture({ mode: "MAIL_IN_REVIEW" }),
      perParticipantMax: 10,
    });
    shared.staff = staffWith(["amoe.review.read"]);

    await domain.grant(PARTICIPANT_ID, 8, "order:fixture-cap");

    const transcribed = await domain.amoe.submitOnBehalf(
      {
        promotionId: PROMOTION_ID,
        participantId: PARTICIPANT_ID,
        payload: { full_name: "Ada Lovelace", email: "ada@example.test" },
        envelopeReference: "SOBRE-1",
        cardsInEnvelope: 1,
      },
      staffWith(["amoe.submission.transcribe"], ADMIN_ID),
    );
    const submissionId = transcribed.submission.id;

    // Mientras espera decision, la cola SIN parametro la trae.
    const app = await appAllowingPermissions();
    const pending = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: { submission_id: string }[] }>().items;
    expect(pending.map((row) => row.submission_id)).toContain(submissionId);

    // La aprueba OTRO administrador: quien teclea no decide (409
    // SEPARATION_OF_DUTIES si fuera el mismo).
    await domain.amoe.approve(submissionId, staffWith(["amoe.review.approve"], OTHER_ADMIN_ID));

    // La cola de trabajo ya no la trae: no espera nada.
    const stillPending = (
      await app.inject({
        method: "GET",
        url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}`,
      })
    ).json<{ items: { submission_id: string }[] }>().items;
    expect(stillPending.map((row) => row.submission_id)).not.toContain(submissionId);

    // Y con el filtro vuelve, con lo que la aprobacion hizo de verdad.
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}&status=APPROVED`,
    });

    expect(response.statusCode).toBe(200);
    const approved = response
      .json<{
        items: {
          submission_id: string;
          status: string;
          granted_entries: number | null;
          applied_cap: Record<string, unknown> | null;
        }[];
      }>()
      .items.find((row) => row.submission_id === submissionId);

    expect(approved?.status).toBe("APPROVED");
    // 2, no 5: el tope recorto. La cifra sale del LEDGER, no de la
    // configuracion, que es justo la diferencia que hace falta poder auditar.
    expect(approved?.granted_entries).toBe(2);
    expect(approved?.applied_cap).toEqual({
      kind: "PER_PARTICIPANT",
      limit: 10,
      requested: 5,
      granted: 2,
    });
  });

  it("un estado que el contrato no declara lo rechaza el esquema, no el dominio", async () => {
    // El enum es cerrado a proposito: un `status` libre convertiria la cola en
    // un filtro sobre una columna, y cualquier cadena devolveria una lista
    // vacia -indistinguible de "no hay envios en ese estado"-.
    buildDomain({ flags: { amoe_enabled: true }, amoe: amoeConfigFixture() });
    shared.staff = staffWith(["amoe.review.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/amoe-submissions?promotion_id=${PROMOTION_ID}&status=TODOS`,
    });

    expect(response.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// 3. Previsualizacion de ajuste
// ---------------------------------------------------------------------------

describe("POST /admin/entry-adjustments/preview", () => {
  const url = "/api/v1/admin/entry-adjustments/preview";

  it("devuelve antes, cambio y despues sin tocar el ledger", async () => {
    const domain = buildDomain({
      flags: { manual_adjustments_enabled: true },
    });
    shared.staff = staffWith(["entry.adjust.create"]);
    await domain.grant(PARTICIPANT_ID, 40, "order:fixture-1");

    const app = await appAllowingPermissions();
    const before = domain.ledger.all().length;

    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        promotion_id: PROMOTION_ID,
        participant_id: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 7,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Record<string, unknown>>()).toEqual({
      before: 40,
      proposed_delta: 7,
      after: 47,
      would_make_balance_negative: false,
      // Arranca ENCENDIDO. Es el unico flag que lo hace (DEC-032).
      requires_second_approval: true,
      as_of: NOW.toISOString(),
    });

    // Una lectura no escribe. Si escribiera, previsualizar un ajuste seria
    // aplicarlo a medias.
    expect(domain.ledger.all()).toHaveLength(before);
  });

  it("un debito lleva signo negativo y baja el saldo", async () => {
    const domain = buildDomain({ flags: { manual_adjustments_enabled: true } });
    shared.staff = staffWith(["entry.adjust.create"]);
    await domain.grant(PARTICIPANT_ID, 40, "order:fixture-1");

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({
        method: "POST",
        url,
        payload: {
          promotion_id: PROMOTION_ID,
          participant_id: PARTICIPANT_ID,
          direction: "DEBIT",
          quantity: 15,
        },
      })
    ).json<Record<string, unknown>>();

    expect(body.proposed_delta).toBe(-15);
    expect(body.after).toBe(25);
    expect(body.would_make_balance_negative).toBe(false);
  });

  it("avisa del saldo negativo con el MISMO predicado que rechaza el ajuste", async () => {
    // Si fueran dos expresiones distintas podrian discrepar, y discreparian de
    // la peor forma: previsualizacion en verde y rechazo despues.
    const domain = buildDomain({ flags: { manual_adjustments_enabled: true } });
    shared.staff = staffWith(["entry.adjust.create"]);
    await domain.grant(PARTICIPANT_ID, 10, "order:fixture-1");

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({
        method: "POST",
        url,
        payload: {
          promotion_id: PROMOTION_ID,
          participant_id: PARTICIPANT_ID,
          direction: "DEBIT",
          quantity: 11,
        },
      })
    ).json<Record<string, unknown>>();

    expect(body.would_make_balance_negative).toBe(true);
    expect(body.after).toBe(-1);

    // Y el ajuste real, con esos mismos numeros, efectivamente se rechaza.
    await expect(
      domain.adjustments.preview(
        {
          promotionId: PROMOTION_ID,
          participantId: PARTICIPANT_ID,
          direction: "DEBIT",
          quantity: 11,
        },
        staffWith(["entry.adjust.create"]),
      ),
    ).resolves.toMatchObject({ wouldMakeBalanceNegative: true });
  });

  it("refleja el flag de doble aprobacion, no el rol de quien pregunta", async () => {
    buildDomain({
      flags: {
        manual_adjustments_enabled: true,
        dual_approval_for_sensitive_actions_enabled: false,
      },
    });
    shared.staff = staffWith(["entry.adjust.create"]);

    const app = await appAllowingPermissions();
    const body = (
      await app.inject({
        method: "POST",
        url,
        payload: {
          promotion_id: PROMOTION_ID,
          participant_id: PARTICIPANT_ID,
          direction: "CREDIT",
          quantity: 1,
        },
      })
    ).json<Record<string, unknown>>();

    expect(body.requires_second_approval).toBe(false);
  });

  it("con los ajustes manuales apagados responde 404, no 403", async () => {
    // La funcion no existe para nadie mientras el flag este apagado. Un 403
    // sugeriria que existe y que a este operador no se le deja usarla.
    buildDomain({ flags: { manual_adjustments_enabled: false } });
    shared.staff = staffWith(["entry.adjust.create"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        promotion_id: PROMOTION_ID,
        participant_id: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 1,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("sin la capacidad de CREAR ajustes responde 403 aunque la sesion sea de personal", async () => {
    // Es la capacidad de crear y no la de leer el ledger: quien no puede pedir
    // un ajuste no tiene por que poder simularlo sobre un participante concreto.
    buildDomain({ flags: { manual_adjustments_enabled: true } });
    shared.staff = staffWith(["entry.ledger.read"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        promotion_id: PROMOTION_ID,
        participant_id: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 1,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it("una cantidad de cero no llega al dominio: la rechaza el esquema", async () => {
    buildDomain({ flags: { manual_adjustments_enabled: true } });
    shared.staff = staffWith(["entry.adjust.create"]);

    const app = await appAllowingPermissions();
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        promotion_id: PROMOTION_ID,
        participant_id: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 0,
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it("con el autorizador por defecto la ruta no es alcanzable (DEC-015)", async () => {
    // Sin sustituir `lswAuthorizer`: es la postura real de la aplicacion.
    buildDomain({ flags: { manual_adjustments_enabled: true } });
    shared.staff = staffWith(["entry.adjust.create"]);

    const app = await createApp(buildDependencies());
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        promotion_id: PROMOTION_ID,
        participant_id: PARTICIPANT_ID,
        direction: "CREDIT",
        quantity: 1,
      },
    });

    expect(response.statusCode).not.toBe(200);
    expect([401, 403]).toContain(response.statusCode);
  });
});
