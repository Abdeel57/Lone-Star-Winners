#!/usr/bin/env node
/**
 * Escenario del e2e.
 *
 * QUE SIEMBRA, Y POR QUE NO PUEDE HACERLO `db:seed`
 * -------------------------------------------------
 * `packages/database/src/seed/dev-seed.ts` se detiene a proposito antes de dos
 * cosas, y las dos hacen falta aqui:
 *
 *   1. No crea ninguna promocion ACTIVE, porque DEC-012 lo impide mientras las
 *      claves legales esten en `TBD`, y rellenarlas seria inventar requisitos
 *      legales (principio 2).
 *   2. No crea credenciales de participante, porque el alta la haria la API...
 *      que todavia no tiene endpoint de registro.
 *
 * Este fichero sigue respetando el principio 2, y la diferencia es importante:
 * NO decide que dice la ley. Escribe valores de RELLENO, marcados en el propio
 * dato como provisionales y sin valor legal, para que la promocion pueda
 * existir en estado ACTIVE dentro de una base de datos efimera y el recorrido
 * pueda probarse. Ningun valor de aqui debe copiarse a ningun otro entorno.
 *
 * Las claves las declara `lsw_unresolved_required_keys()` en
 * `packages/database/drizzle/0002_promotions.sql`. Este fichero las RESUELVE
 * con texto de relleno; el abogado del cliente las resolvera con derecho.
 * `docs/LEGAL_PENDING.md` sigue siendo el sitio donde vive la pregunta.
 *
 * DONDE SE EJECUTA
 * ----------------
 * Contra la base de datos del job de CI, con el rol `app` (DEC-003). Con `app`
 * y no con `migrator` a proposito, por el mismo motivo que `dev-seed`: si la
 * semilla necesitara DDL para funcionar, seria que los GRANT estan mal
 * repartidos, y esto lo detecta antes que un incidente.
 *
 * Se niega a correr con `NODE_ENV=production`.
 *
 * SALIDA
 * ------
 * Un JSON en `E2E_FIXTURE_FILE` (por defecto, el temporal del sistema) con los
 * identificadores generados y el secreto TOTP del personal. FUERA del arbol del
 * repositorio: un secreto de test escrito en `tests/` acabaria versionado el dia
 * que alguien haga `git add -A`.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { decodeSecretBoxKey, encryptSecret, generateTotpSecret, hashPassword } from "@lsw/security";
import pg from "pg";

import {
  AMOE_CARDS_PER_ENVELOPE,
  AMOE_ENTRIES_PER_CARD,
  AMOE_FIELD_KEYS,
  AMOE_MAX_CARDS_PER_PARTICIPANT,
  CAP_PARTICIPANT_EMAIL,
  CAP_SEEDED_ENTRIES,
  COMPLIANCE_OFFICER_EMAIL,
  FAKE_PARTICIPANT_PASSWORD,
  FAKE_STAFF_PASSWORD,
  FIXTURE_FILE,
  PACKAGE_CATEGORY_KEY,
  PACKAGE_NAME,
  PACKAGE_PRICE_MINOR,
  PACKAGE_SKU,
  PACKAGE_SLUG,
  PARTICIPANT_EMAIL,
  PER_PARTICIPANT_MAX,
  PRODUCT_CURRENCY,
  PRODUCT_NAME,
  PRODUCT_PRICE_MINOR,
  PRODUCT_SKU,
  PRODUCT_SLUG,
  PROMOTION_MANAGER_EMAIL,
  PROMOTION_SLUG,
  PROMOTION_TITLE,
} from "../lib/fixture.mjs";

/**
 * Texto que acompana a cada valor de relleno.
 *
 * Va DENTRO del dato, no en un comentario, para que quien mire la fila en la
 * base de datos -o el JSON de la version de reglas- vea que no es una decision
 * legal. Un valor de relleno que parece definitivo es peor que un hueco.
 */
const FILLER = "E2E FIXTURE - PROVISIONAL, SIN VALOR LEGAL. Ver docs/LEGAL_PENDING.md.";

/**
 * El mismo relleno, ETIQUETADO POR IDIOMA.
 *
 * Los textos que se sirven en los dos idiomas no pueden empezar igual. Las
 * instrucciones de la via gratuita son el caso: `06-amoe` comprueba que la
 * pagina inglesa NO trae el texto castellano, y con el mismo `FILLER` delante
 * de los dos, cualquier comparacion por prefijo encuentra el "castellano"
 * dentro del parrafo ingles. La afirmacion de ausencia se cumpliria sola y la
 * prueba pasaria sin comprobar nada.
 *
 * La etiqueta va al PRINCIPIO, no al final: dos textos tienen que distinguirse
 * por como empiezan, no por su longitud. Y sale de `FILLER` en vez de
 * reescribir el literal, para que el aviso de "sin valor legal" siga teniendo
 * una sola fuente.
 */
function fillerFor(languageTag) {
  return FILLER.replace("E2E FIXTURE", `E2E FIXTURE (${languageTag})`);
}

/** Zona legal del escenario. Una zona real, para que el calculo de periodos AMOE sea real. */
const LEGAL_TIMEZONE = "America/Chicago";

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    console.error(`[e2e-seed] Falta ${name}.`);
    process.exit(1);
  }
  return value;
}

/**
 * Ventana de la promocion: abierta ahora y con holgura por los dos lados.
 *
 * Se calcula al sembrar y no se escribe fija en el fichero porque una fecha
 * literal caduca: la suite pasaria hoy y fallaria dentro de un ano por una
 * razon que no tiene nada que ver con lo que prueba.
 */
function promotionWindow(now) {
  const startsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}

/**
 * Configuracion de la version de reglas, con la FORMA de la seccion 13.2
 * (borrador v2, HO-041).
 *
 * Las doce claves de DEC-012, mas `multipliers`, `bonus_rules` y la seccion
 * `amoe` que exige `amoeConfigSchema` de `packages/sweepstakes`.
 *
 * QUE CAMBIA RESPECTO A LA VERSION ANTERIOR DE ESTE FICHERO, Y POR QUE
 * -------------------------------------------------------------------
 * Antes habia UNA tasa ("2 por cada $5.00") y ningun tope. Ahora hay una tasa
 * POR TIPO DE PRODUCTO y un tope por participante, porque eso es lo que el
 * contrato publica y lo que la suite tiene que poder comprobar:
 *
 *   - un paquete de $10 da 20 participaciones (2 por dolar) y una camiseta de
 *     $25 da 25 (1 por dolar): dos tasas distintas en el mismo carrito, con UN
 *     solo redondeo al final;
 *   - `entry_limits.per_participant_max` existe y vale 10,000, para que el
 *     recorte de DEC-052 punto 5 tenga contra que recortar;
 *   - la via gratuita es POSTAL, con 2,000 por ficha y 5 fichas por persona.
 *
 * SIGUE SIN DECIDIR NADA LEGAL. Las claves que el abogado no ha resuelto
 * llevan `FILLER`, marcado en el propio dato. Las que SI llevan forma valida
 * son las que el motor parsea -sin ellas el recorrido no arranca- y sus valores
 * reproducen la FORMA del borrador v2, no una decision: quien fija la tasa real
 * es el abogado (ver `docs/LEGAL_PENDING.md`).
 */
function buildRulesConfig(window) {
  return {
    eligibility: FILLER,
    allowed_jurisdictions: FILLER,
    minimum_age: FILLER,
    promotion_start_end_rules: FILLER,

    /*
     * TOPE POR PARTICIPANTE, no universo total (DEC-052 punto 6).
     *
     * `per_order_max: null` significa "sin tope por pedido declarado", que es
     * distinto de cero y distinto de "sin decidir": el borrador v2 no declara
     * ninguno.
     */
    entry_limits: { per_order_max: null, per_participant_max: PER_PARTICIPANT_MAX },
    product_eligibility: { mode: "ALL_PRODUCTS" },

    /*
     * Tasa POR TIPO (DEC-052 punto 2). Las dos claves son obligatorias y
     * nullable; aqui las dos llevan tasa porque el escenario compra de los dos
     * tipos. `amount_unit_minor: "100"` es un dolar; el redondeo es uno solo,
     * al final, sobre la fraccion exacta del pedido.
     */
    purchase_entry_formula: {
      mode: "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND",
      rates: {
        MERCHANDISE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 1, denominator: 1 },
        },
        ENTRY_PACKAGE: {
          amount_unit_minor: "100",
          entries_per_amount_unit: { numerator: 2, denominator: 1 },
        },
      },
      rounding_policy: "FLOOR",
    },

    official_rules_document: FILLER,
    controlling_language: FILLER,
    winner_drawing_method: FILLER,
    partial_refund_rounding_policy: "FLOOR",
    entry_expiration: FILLER,

    /*
     * Multiplicadores: la ESTRATEGIA declarada y NINGUN periodo.
     *
     * Los periodos los crea el panel durante la suite (seccion 13.8), que es
     * justo lo que hay que probar. Sembrar uno aqui haria que la prueba del
     * atajo bonus empezara con el trabajo ya hecho.
     *
     * `conflict_strategy` NO se puede omitir: el atajo de la seccion 13.8 exige
     * que la version activa la declare o que el cuerpo la aporte, y no se
     * asume ninguna (`HIGHEST_WINS` es la respuesta provisional del borrador
     * v2, ver docs/LEGAL_PENDING.md pregunta 10).
     */
    multipliers: { conflict_strategy: "HIGHEST_WINS", periods: [] },

    /*
     * Techo legal de los bonus. NO es un valor del motor: es lo que la
     * superficie de escritura comprueba antes de dejar crear un periodo. Con
     * `applies_to_amoe: false`, un bonus nunca multiplica una ficha postal.
     */
    bonus_rules: {
      max_multiplier: { numerator: 10, denominator: 1 },
      applies_to_product_kinds: ["MERCHANDISE", "ENTRY_PACKAGE"],
      applies_to_amoe: false,
    },

    /*
     * Seccion AMOE, modalidad POSTAL. La lee `readAmoeConfig()` y la valida
     * `amoeConfigSchema`: si falta un campo, la ruta responde 409
     * AMOE_CONFIG_INVALID en vez de inventarse un valor por defecto.
     *
     * `identity_requirements` declara QUE datos pide la ficha; `identity_fields`
     * solo dice como se pintan. Las `label_key` salen de la lista cerrada de
     * `apps/web/src/i18n/amoe-labels.ts`: una clave desconocida se pinta con el
     * texto generico y la comprobacion perderia sentido.
     *
     * `limit.period` es `PROMOTION` y no `DAY`: el borrador v2 dice cinco
     * fichas EN TODO EL PERIODO. Con `DAY`, una persona podria mandar cinco
     * cada dia y el tope de 10,000 se alcanzaria por la via gratuita en dos
     * jornadas.
     */
    amoe: {
      mode: "MAIL_IN_REVIEW",
      submission_window: {
        starts_at: window.startsAt.toISOString(),
        ends_at: window.endsAt.toISOString(),
      },
      entries_per_approved_submission: AMOE_ENTRIES_PER_CARD,
      // `true` obligatorio en esta modalidad: alguien tiene que leer el sobre.
      // `amoeConfigSchema` lo impone con un `superRefine`.
      requires_review: true,
      limit: {
        max_per_participant_per_period: AMOE_MAX_CARDS_PER_PARTICIPANT,
        period: "PROMOTION",
      },
      duplicate_policy: "FLAG_FOR_REVIEW",
      identity_requirements: AMOE_FIELD_KEYS,
      identity_fields: {
        full_name: { type: "TEXT", label_key: "fullName", max_length: 120 },
        mailing_address: { type: "TEXTAREA", label_key: "mailingAddress", max_length: 400 },
        email: { type: "EMAIL", label_key: "email", max_length: 254 },
        phone: { type: "TEL", label_key: "phone", max_length: 40 },
        date_of_birth: { type: "DATE", label_key: "dateOfBirth", max_length: 10 },
        signature_present: { type: "TEXT", label_key: "signaturePresent", max_length: 3 },
        postmark_date: { type: "DATE", label_key: "postmarkDate", max_length: 10 },
      },
      /*
       * Plazos del sobre. Informativos: el sistema no cuenta sobres ni lee
       * matasellos. Sirven para publicarlos y para que el revisor tenga contra
       * que comparar lo que el operador teclea.
       */
      mail_in: {
        max_cards_per_envelope: AMOE_CARDS_PER_ENVELOPE,
        postmark_by: window.endsAt.toISOString(),
        received_by: new Date(window.endsAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      instructions: {
        "en-US": `${fillerFor("EN")} Free entry instructions -including the mailing address- are attorney-supplied text.`,
        "es-US": `${fillerFor("ES")} Las instrucciones de la via gratuita -incluida la direccion postal- las redacta el abogado.`,
      },
    },
  };
}

async function insertIdentity(client, { email, password }) {
  const identity = await client.query(
    `INSERT INTO identities (email, status, email_verified_at)
     VALUES ($1, 'ACTIVE', now())
     RETURNING id`,
    [email],
  );

  const identityId = identity.rows[0].id;

  await client.query(
    `INSERT INTO identity_credentials (identity_id, password_hash) VALUES ($1, $2)`,
    [identityId, await hashPassword(password)],
  );

  return identityId;
}

/**
 * Cuenta de personal con segundo factor YA ACTIVO.
 *
 * El alta real es la de `db:create-admin`, en dos pasos, y el segundo exige un
 * codigo del autenticador. Aqui se hace en uno porque el "autenticador" es la
 * propia suite: genera el secreto, lo cifra igual que lo cifraria la API, y
 * despues deriva de el los codigos con `otpauth`. Es el mismo secreto, el mismo
 * cifrado y el mismo algoritmo; lo unico que se salta es la comprobacion
 * interactiva, que no tiene a nadie delante.
 */
async function insertStaffAccount(client, { email, fullName, roleKey, password, encryptionKey }) {
  const identityId = await insertIdentity(client, { email, password });

  const secretBase32 = generateTotpSecret();

  await client.query(
    `INSERT INTO identity_mfa_factors
       (identity_id, factor_type, status, secret_ciphertext, label, confirmed_at)
     VALUES ($1, 'TOTP', 'ACTIVE', $2, $3, now())`,
    [identityId, encryptSecret(secretBase32, encryptionKey), "e2e fixture authenticator"],
  );

  const admin = await client.query(
    `INSERT INTO admin_users (identity_id, full_name, status, mfa_enrolled_at)
     VALUES ($1, $2, 'ACTIVE', now())
     RETURNING id`,
    [identityId, fullName],
  );

  const adminUserId = admin.rows[0].id;

  /*
   * UN SOLO ROL POR CUENTA, y dos cuentas distintas.
   *
   * No es comodidad: `entry.adjust.create` (PROMOTION_MANAGER) y
   * `entry.adjust.approve` (COMPLIANCE_OFFICER) estan en el par de separacion
   * de funciones `propose-vs-approve-adjustment` de
   * `packages/security/src/permissions.ts`. Una cuenta con los dos roles se
   * queda sin NINGUNA de las dos capacidades: `authorize()` deniega con
   * SEPARATION_OF_DUTIES antes de mirar nada mas. El escenario tiene que
   * reflejar eso, porque es lo que el sistema exige de verdad.
   */
  await client.query(
    `INSERT INTO admin_user_roles (admin_user_id, role_key, grant_reason)
     VALUES ($1, $2, $3)`,
    [adminUserId, roleKey, "Escenario de e2e. Esta cuenta no existe fuera de una base efimera."],
  );

  return { identityId, adminUserId, secretBase32 };
}

async function seed(client) {
  const encryptionKey = decodeSecretBoxKey(requireEnv("MFA_SECRET_ENCRYPTION_KEY"));
  const now = new Date();
  const window = promotionWindow(now);

  // -------------------------------------------------------------------------
  // 1. Participante
  // -------------------------------------------------------------------------
  const participantIdentityId = await insertIdentity(client, {
    email: PARTICIPANT_EMAIL,
    password: FAKE_PARTICIPANT_PASSWORD,
  });

  const participant = await client.query(
    `INSERT INTO participants (identity_id, display_name, preferred_locale, status)
     VALUES ($1, $2, 'es-US', 'ACTIVE')
     RETURNING id`,
    [participantIdentityId, "Participante E2E"],
  );

  const participantId = participant.rows[0].id;

  // -------------------------------------------------------------------------
  // 2. Personal: dos cuentas, un rol cada una
  // -------------------------------------------------------------------------
  const promotionManager = await insertStaffAccount(client, {
    email: PROMOTION_MANAGER_EMAIL,
    fullName: "E2E Promotion Manager",
    roleKey: "PROMOTION_MANAGER",
    password: FAKE_STAFF_PASSWORD,
    encryptionKey,
  });

  const complianceOfficer = await insertStaffAccount(client, {
    email: COMPLIANCE_OFFICER_EMAIL,
    fullName: "E2E Compliance Officer",
    roleKey: "COMPLIANCE_OFFICER",
    password: FAKE_STAFF_PASSWORD,
    encryptionKey,
  });

  // -------------------------------------------------------------------------
  // 3. Catalogo: una MERCANCIA y un PAQUETE DE PARTICIPACIONES
  //
  // El copy describe mercancia y paquetes, en los dos idiomas. Ni "boletos" ni
  // "oportunidades de ganar" (CLAUDE.md seccion 1).
  //
  // `products.kind` llega con la migracion `0026` (DEC-052). Ninguna columna
  // del producto dice cuantas participaciones da: el paquete se distingue por
  // el TIPO, y cuanto vale ese tipo lo dice la version de reglas. Si esta
  // semilla fallara con "column kind does not exist", lo que falta es la
  // migracion, no el escenario.
  // -------------------------------------------------------------------------
  const product = await client.query(
    `INSERT INTO products (sku, slug, status, currency, kind, category_key)
     VALUES ($1, $2, 'ACTIVE', $3, 'MERCHANDISE', NULL)
     RETURNING id`,
    [PRODUCT_SKU, PRODUCT_SLUG, PRODUCT_CURRENCY],
  );

  const productId = product.rows[0].id;

  await client.query(
    `INSERT INTO product_translations (product_id, locale, name, description)
     VALUES ($1, 'en-US', $2, $3), ($1, 'es-US', $4, $5)`,
    [
      productId,
      PRODUCT_NAME["en-US"],
      "Fictitious merchandise used only by the end-to-end suite.",
      PRODUCT_NAME["es-US"],
      "Mercancia ficticia, usada solo por la suite de punta a punta.",
    ],
  );

  const variant = await client.query(
    `INSERT INTO product_variants
       (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
     VALUES ($1, $2, 'ACTIVE', $3, $4, 500, 0)
     RETURNING id`,
    [productId, `${PRODUCT_SKU}-STD`, PRODUCT_PRICE_MINOR.toString(), PRODUCT_CURRENCY],
  );

  const variantId = variant.rows[0].id;

  /*
   * Paquete de $10. La categoria `entry-packages` la SIEMBRA la migracion
   * `0026` como dato del negocio (DEC-053), asi que aqui solo se referencia.
   */
  const packageProduct = await client.query(
    `INSERT INTO products (sku, slug, status, currency, kind, category_key)
     VALUES ($1, $2, 'ACTIVE', $3, 'ENTRY_PACKAGE', $4)
     RETURNING id`,
    [PACKAGE_SKU, PACKAGE_SLUG, PRODUCT_CURRENCY, PACKAGE_CATEGORY_KEY],
  );

  const packageProductId = packageProduct.rows[0].id;

  await client.query(
    `INSERT INTO product_translations (product_id, locale, name, description)
     VALUES ($1, 'en-US', $2, $3), ($1, 'es-US', $4, $5)`,
    [
      packageProductId,
      PACKAGE_NAME["en-US"],
      "Fictitious entry package used only by the end-to-end suite. The number of entries comes from the rules version, never from this row.",
      PACKAGE_NAME["es-US"],
      "Paquete de participaciones ficticio, usado solo por la suite de punta a punta. El numero de participaciones sale de la version de reglas, nunca de esta fila.",
    ],
  );

  const packageVariant = await client.query(
    `INSERT INTO product_variants
       (product_id, sku, status, price_amount_minor, currency, stock_quantity, position)
     VALUES ($1, $2, 'ACTIVE', $3, $4, 1000, 0)
     RETURNING id`,
    [packageProductId, `${PACKAGE_SKU}-STD`, PACKAGE_PRICE_MINOR.toString(), PRODUCT_CURRENCY],
  );

  const packageVariantId = packageVariant.rows[0].id;

  // -------------------------------------------------------------------------
  // 4. Promocion, version de reglas y activacion
  //
  // El orden NO es negociable: lo impone
  // `lsw_promotions_enforce_lifecycle()`. La promocion nace DRAFT, la version
  // de reglas se activa primero, se apunta desde la promocion, y solo entonces
  // DRAFT -> SCHEDULED -> ACTIVE (las unicas transiciones que
  // `promotion_status_transitions` admite hasta ahi).
  // -------------------------------------------------------------------------
  const promotion = await client.query(
    `INSERT INTO promotions (slug, internal_name, status, legal_timezone, starts_at, ends_at)
     VALUES ($1, $2, 'DRAFT', $3, $4, $5)
     RETURNING id`,
    [
      PROMOTION_SLUG,
      "E2E - promocion de prueba (datos ficticios)",
      LEGAL_TIMEZONE,
      window.startsAt.toISOString(),
      window.endsAt.toISOString(),
    ],
  );

  const promotionId = promotion.rows[0].id;

  await client.query(
    `INSERT INTO promotion_translations (promotion_id, locale, public_name, tagline)
     VALUES ($1, 'en-US', $2, $3), ($1, 'es-US', $4, $5)`,
    [
      promotionId,
      PROMOTION_TITLE["en-US"],
      "Fixture promotion for the end-to-end suite.",
      PROMOTION_TITLE["es-US"],
      "Promocion de prueba para la suite de punta a punta.",
    ],
  );

  const rulesVersion = await client.query(
    `INSERT INTO promotion_rules_versions
       (promotion_id, version, status, config, created_by_admin_user_id, attorney_approval_reference)
     VALUES ($1, 1, 'DRAFT', $2::jsonb, $3, $4)
     RETURNING id, unresolved_required_keys`,
    [
      promotionId,
      JSON.stringify(buildRulesConfig(window)),
      promotionManager.adminUserId,
      "E2E FIXTURE - no attorney approval exists for this row.",
    ],
  );

  const rulesVersionId = rulesVersion.rows[0].id;
  const unresolved = rulesVersion.rows[0].unresolved_required_keys ?? [];

  if (unresolved.length > 0) {
    // La columna es GENERATED: es el motor quien acaba de decir que faltan
    // claves. Fallar aqui es infinitamente mas barato que fallar al activar.
    throw new Error(
      `La configuracion de reglas deja claves de DEC-012 sin resolver: ${unresolved.join(", ")}`,
    );
  }

  await client.query(
    `UPDATE promotion_rules_versions
        SET status = 'ACTIVE',
            activated_at = now(),
            activated_by_admin_user_id = $2,
            effective_at = now()
      WHERE id = $1`,
    [rulesVersionId, promotionManager.adminUserId],
  );

  await client.query(`UPDATE promotions SET active_rules_version_id = $2 WHERE id = $1`, [
    promotionId,
    rulesVersionId,
  ]);

  await client.query(`UPDATE promotions SET status = 'SCHEDULED' WHERE id = $1`, [promotionId]);
  await client.query(`UPDATE promotions SET status = 'ACTIVE' WHERE id = $1`, [promotionId]);

  /*
   * Secuencia de numeros visibles. Se asigna SIEMPRE, aunque el flag
   * `visible_entry_numbers_enabled` este apagado: DEC-009 quiere que un rango
   * sea reconstruible hacia atras, y el flag solo decide si se ensena.
   */
  await client.query(
    `INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix, format_digits)
     VALUES ($1, 'E2E', 9)`,
    [promotionId],
  );

  // -------------------------------------------------------------------------
  // 5. Participante que ya llega cerca del tope
  //
  // POR QUE SE SIEMBRA EL SALDO Y NO SE GANA JUGANDO
  // ------------------------------------------------
  // La prueba del recorte (DEC-052 punto 5) necesita a alguien con 9,000
  // participaciones para que la ficha de 2,000 solo pueda entrar en 1,000.
  // Conseguirlas por la interfaz costaria dos inicios de sesion de personal con
  // segundo factor -y sus dos esperas de ventana TOTP- por cada ejecucion, para
  // probar algo que no es lo que la prueba mide.
  //
  // Lo que SI se respeta es la forma: no se escribe una fila suelta de ledger,
  // se escribe el PAR completo que deja un ajuste manual aprobado -la
  // transaccion `MANUAL_CREDIT` y su fila de `adjustments` en `APPLIED`, con
  // aprobador distinto del solicitante-, que es exactamente el estado que el
  // sistema produce por la via normal (ver `specs/08-adjustment.spec.mjs`). Un
  // ledger con un movimiento huerfano no cuadraria en la reconciliacion previa
  // al export, y esta suite existe tambien para que eso se note.
  // -------------------------------------------------------------------------
  const capIdentityId = await insertIdentity(client, {
    email: CAP_PARTICIPANT_EMAIL,
    password: FAKE_PARTICIPANT_PASSWORD,
  });

  const capParticipant = await client.query(
    `INSERT INTO participants (identity_id, display_name, preferred_locale, status)
     VALUES ($1, $2, 'es-US', 'ACTIVE')
     RETURNING id`,
    [capIdentityId, "Participante E2E cerca del tope"],
  );

  const capParticipantId = capParticipant.rows[0].id;
  const capAdjustmentId = randomUUID();

  const capTransaction = await client.query(
    `INSERT INTO entry_transactions
       (promotion_id, participant_id, type, source_type, source_ref, quantity_delta,
        effective_at, rules_version_id, engine_version, actor_type, actor_admin_user_id,
        reason_key, reason_detail, metadata)
     VALUES ($1, $2, 'MANUAL_CREDIT', 'ADMIN', $3, $4, now(), $5, 1, 'ADMIN', $6,
             'SYSTEM_ERROR_CORRECTION', $7, '{}'::jsonb)
     RETURNING id`,
    [
      promotionId,
      capParticipantId,
      `adjustment:${capAdjustmentId}`,
      CAP_SEEDED_ENTRIES,
      rulesVersionId,
      promotionManager.adminUserId,
      "Escenario de e2e: saldo de partida para probar el recorte por tope. Sin valor real.",
    ],
  );

  await client.query(
    `INSERT INTO adjustments
       (id, promotion_id, participant_id, direction, quantity, reason_key, reason_detail,
        status, requested_by_admin_user_id, requested_at, approved_by_admin_user_id,
        approved_at, rules_version_id, entry_transaction_id)
     VALUES ($1, $2, $3, 'CREDIT', $4, 'SYSTEM_ERROR_CORRECTION', $5, 'APPLIED', $6, now(),
             $7, now(), $8, $9)`,
    [
      capAdjustmentId,
      promotionId,
      capParticipantId,
      CAP_SEEDED_ENTRIES,
      "Escenario de e2e: saldo de partida para probar el recorte por tope. Sin valor real.",
      promotionManager.adminUserId,
      complianceOfficer.adminUserId,
      rulesVersionId,
      capTransaction.rows[0].id,
    ],
  );

  // -------------------------------------------------------------------------
  // 6. Feature flags
  //
  // Se encienden con UPDATE, que es la unica via que el rol `app` tiene y la
  // que exige el trigger de DEC-013: motivo de 10 caracteres o mas y actor
  // identificado. Hacerlo asi -y no con un INSERT que se salte el trigger-
  // deja ademas la fila de `feature_flag_changes`, que es lo que responde a
  // "estaba encendido el dia X".
  //
  // Solo se enciende lo que el recorrido necesita. Un escenario que enciende
  // todo no prueba nada sobre la postura por defecto de DEC-032.
  //
  // `entry_caps_enabled` y `entry_multipliers_enabled` se anaden en HO-041:
  // sin el primero, el tope de 10,000 esta declarado en la version de reglas y
  // NO se aplica -ni a las compras ni a la concesion AMOE-, y la prueba del
  // recorte mediria un sistema sin tope; sin el segundo, el periodo bonus se
  // crea pero no multiplica, y `entries_now` seria siempre igual a
  // `base_entries`.
  // -------------------------------------------------------------------------
  const flagReason =
    "Escenario de e2e: habilita la via AMOE, los ajustes manuales, el tope por participante y los multiplicadores del recorrido.";

  for (const key of [
    "amoe_enabled",
    "manual_adjustments_enabled",
    "entry_caps_enabled",
    "entry_multipliers_enabled",
  ]) {
    await client.query(
      `UPDATE feature_flags
          SET enabled = true, update_reason = $2, updated_by_admin_user_id = $3
        WHERE key = $1 AND enabled = false`,
      [key, flagReason, promotionManager.adminUserId],
    );
  }

  /*
   * La modalidad AMOE tiene que COINCIDIR con la de la version de reglas
   * (`AmoeService.readConfig` compara las dos fuentes y responde 409
   * AMOE_CONFIG_INVALID si difieren). El borrador v2 solo contempla la via
   * postal, asi que las dos dicen `MAIL_IN_REVIEW`.
   */
  await client.query(
    `UPDATE feature_flag_settings
        SET amoe_mode = 'MAIL_IN_REVIEW', update_reason = $1, updated_by_admin_user_id = $2
      WHERE singleton`,
    [flagReason, promotionManager.adminUserId],
  );

  return {
    seededAt: now.toISOString(),
    seedRunId: randomUUID(),
    legalTimezone: LEGAL_TIMEZONE,
    promotion: {
      id: promotionId,
      slug: PROMOTION_SLUG,
      rulesVersionId,
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
    },
    product: { id: productId, slug: PRODUCT_SLUG, variantId },
    entryPackage: {
      id: packageProductId,
      slug: PACKAGE_SLUG,
      variantId: packageVariantId,
      priceAmountMinor: PACKAGE_PRICE_MINOR.toString(),
    },
    participant: { identityId: participantIdentityId, id: participantId, email: PARTICIPANT_EMAIL },
    capParticipant: {
      identityId: capIdentityId,
      id: capParticipantId,
      email: CAP_PARTICIPANT_EMAIL,
      seededEntries: CAP_SEEDED_ENTRIES,
      adjustmentId: capAdjustmentId,
    },
    staff: {
      promotionManager: {
        email: PROMOTION_MANAGER_EMAIL,
        adminUserId: promotionManager.adminUserId,
        totpSecret: promotionManager.secretBase32,
      },
      complianceOfficer: {
        email: COMPLIANCE_OFFICER_EMAIL,
        adminUserId: complianceOfficer.adminUserId,
        totpSecret: complianceOfficer.secretBase32,
      },
    },
  };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[e2e-seed] Rechazado: este escenario es de prueba y nunca corre en produccion.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: requireEnv("DATABASE_URL_APP"),
    application_name: "lsw-e2e-seed",
    ssl: false,
  });

  await client.connect();

  try {
    // Una transaccion para todo: o queda un escenario coherente, o no queda
    // nada. Un escenario a medias es peor que ninguno, porque parece que
    // funciona y falla tres pantallas mas adelante.
    await client.query("BEGIN");
    const fixture = await seed(client);
    await client.query("COMMIT");

    await writeFile(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

    console.error("[e2e-seed] escenario creado:", {
      promotion: fixture.promotion.slug,
      promotionId: fixture.promotion.id,
      participant: fixture.participant.email,
      staff: [fixture.staff.promotionManager.email, fixture.staff.complianceOfficer.email],
      fixtureFile: FIXTURE_FILE,
    });
    console.error(
      "[e2e-seed] AVISO: la version de reglas lleva valores de RELLENO sin valor legal. Ningun valor de este escenario debe copiarse a otro entorno.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[e2e-seed] fallo:", error);
  process.exit(1);
});
