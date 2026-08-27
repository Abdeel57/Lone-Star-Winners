/**
 * `PromotionContextPort` contra PostgreSQL (DEC-012, DEC-013).
 *
 * ---------------------------------------------------------------------------
 * TODO LO LEGAL ENTRA POR AQUI, Y SOLO POR AQUI
 * ---------------------------------------------------------------------------
 *
 * DEC-012: cero constantes legales en codigo. Este adaptador LEE
 * `promotion_rules_versions.config` y lo entrega tal cual; no lo interpreta, no
 * lo completa y no le pone valores por defecto. Los flags salen de la tabla
 * `feature_flags` (DEC-013), nunca del entorno: un flag legalmente material
 * tiene que dejar rastro de quien lo cambio y por que, y un fichero de entorno
 * no deja ninguno.
 *
 * ---------------------------------------------------------------------------
 * DOS COSAS QUE DEVUELVEN `null`, Y NO SIGNIFICAN LO MISMO
 * ---------------------------------------------------------------------------
 *
 * `getContext` devuelve `null` cuando la promocion no existe Y TAMBIEN cuando
 * existe pero le falta algo sin lo que ninguna operacion de participaciones
 * tiene sentido: version de reglas ACTIVA, `starts_at` o `ends_at`.
 *
 * No es una fusion comoda de dos casos: el puerto de `@lsw/sweepstakes` declara
 * `startsAt` y `endsAt` como `Date` no anulable, precisamente porque una
 * promocion sin ventana no puede evaluar ningun deadline. Devolver un contexto
 * con fechas inventadas seria peor que no devolver ninguno, porque la ventana
 * es lo que decide si una compra entra.
 *
 * Quien necesite distinguir los dos casos -las rutas de admin, para dar un
 * error preciso- consulta `describeMissingContext`, que existe justo para eso.
 *
 * ---------------------------------------------------------------------------
 * LA MONEDA NO SE INVENTA
 * ---------------------------------------------------------------------------
 *
 * `promotions` no tiene columna de moneda, y este adaptador no le pone `USD`
 * "porque es lo obvio". Se lee de `config.currency` si las Official Rules la
 * declaran, y si no queda vacia. Ningun servicio del dominio la usa hoy -el
 * calculo compara la moneda de los items contra la de la ORDEN-, asi que
 * inventarla solo serviria para que un dia alguien la creyera autoritativa.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  DEFAULT_SWEEPSTAKES_FLAGS,
  ianaTimeZoneSchema,
  type AmoeMode,
  type PromotionContext,
  type PromotionContextPort,
  type SweepstakesFlags,
} from "@lsw/sweepstakes";

import { featureFlagSettings, featureFlags } from "../schema/feature-flags.js";
import { promotionRulesVersions, promotions } from "../schema/promotions.js";
import { currentExecutor, type DbExecutor } from "./executor.js";

/** Las ocho claves de `SweepstakesFlags`. Se leen juntas en una sola consulta. */
const SWEEPSTAKES_FLAG_KEYS = [
  "amoe_enabled",
  "visible_entry_numbers_enabled",
  "entry_multipliers_enabled",
  "entry_caps_enabled",
  "entry_expiration_enabled",
  "manual_adjustments_enabled",
  "provisional_entries_enabled",
  "dual_approval_for_sensitive_actions_enabled",
] as const;

type SweepstakesFlagKey = (typeof SWEEPSTAKES_FLAG_KEYS)[number];

export type MissingContextReason =
  "PROMOTION_NOT_FOUND" | "NO_ACTIVE_RULES_VERSION" | "NO_PROMOTION_WINDOW";

function currencyFromConfig(config: unknown): string {
  if (typeof config !== "object" || config === null) {
    return "";
  }
  const declared = (config as { currency?: unknown }).currency;
  return typeof declared === "string" && /^[A-Z]{3}$/u.test(declared) ? declared : "";
}

export class DrizzlePromotionContextRepository implements PromotionContextPort {
  private readonly fallback: DbExecutor;

  public constructor(executor: DbExecutor) {
    this.fallback = executor;
  }

  private get db(): DbExecutor {
    return currentExecutor(this.fallback);
  }

  /**
   * Los ocho flags que consulta este dominio, leidos de la base de datos.
   *
   * Si una clave falta en la tabla se usa el default de DEC-032, que para siete
   * de las ocho es `false`. No es una comodidad: la postura segura de un flag
   * ausente es la que DEC-032 le asigna, y la unica que arranca encendida es la
   * de la segunda aprobacion, porque un control que hay que acordarse de
   * encender acaba apagado.
   */
  public async readFlags(): Promise<SweepstakesFlags> {
    const rows = await this.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(inArray(featureFlags.key, [...SWEEPSTAKES_FLAG_KEYS]));

    const byKey = new Map<string, boolean>(rows.map((row) => [row.key, row.enabled]));

    const resolved: Record<SweepstakesFlagKey, boolean> = { ...DEFAULT_SWEEPSTAKES_FLAGS };
    for (const key of SWEEPSTAKES_FLAG_KEYS) {
      const stored = byKey.get(key);
      if (stored !== undefined) {
        resolved[key] = stored;
      }
    }
    return resolved;
  }

  /** Modalidad AMOE vigente. `null` = todavia sin elegir, que es el estado real. */
  public async readAmoeMode(): Promise<AmoeMode | null> {
    const rows = await this.db
      .select({ amoeMode: featureFlagSettings.amoeMode })
      .from(featureFlagSettings)
      .limit(1);

    return rows[0]?.amoeMode ?? null;
  }

  public async getContext(promotionId: string): Promise<PromotionContext | null> {
    const rows = await this.db
      .select({
        id: promotions.id,
        status: promotions.status,
        legalTimezone: promotions.legalTimezone,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
        rulesVersionId: promotionRulesVersions.id,
        rulesConfig: promotionRulesVersions.config,
      })
      .from(promotions)
      .leftJoin(
        promotionRulesVersions,
        and(
          eq(promotionRulesVersions.id, promotions.activeRulesVersionId),
          eq(promotionRulesVersions.status, "ACTIVE"),
        ),
      )
      .where(eq(promotions.id, promotionId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    // Se extraen a constantes y se comprueban EN POSITIVO, una a una. No es
    // ceremonia: escribirlo como una sola condicion negada sobre `null` es la
    // forma exacta de fallo que recoge HO-027 -al reescribirla con
    // encadenamiento opcional, la negacion se invierte y deja pasar el caso que
    // hay que rechazar- y ademas asi el compilador estrecha los tipos, que es
    // lo que permite devolver `startsAt` y `endsAt` como `Date` no anulable.
    const rulesVersionId = row.rulesVersionId;
    const startsAt = row.startsAt;
    const endsAt = row.endsAt;

    const usable = rulesVersionId !== null && startsAt !== null && endsAt !== null;
    if (!usable) {
      return null;
    }

    const [flags, amoeMode] = await Promise.all([this.readFlags(), this.readAmoeMode()]);

    return {
      promotionId: row.id,
      status: row.status,
      // La FORMA de la zona la valida `ianaTimeZoneSchema`; su EXISTENCIA la
      // valido PostgreSQL contra `pg_timezone_names` al escribir la fila
      // (migracion 0002). Se vuelve a pasar por el esquema porque el tipo es
      // marcado y un `as` a secas dejaria entrar cualquier cadena.
      legalTimeZone: ianaTimeZoneSchema.parse(row.legalTimezone),
      startsAt,
      endsAt,
      currency: currencyFromConfig(row.rulesConfig),
      rulesVersionId,
      rulesConfig: row.rulesConfig,
      flags,
      amoeMode,
    };
  }

  /**
   * Por que `getContext` devolveria `null`.
   *
   * Existe para que una ruta de administracion pueda decir "esta promocion no
   * tiene version de reglas activa" en vez de "no existe", que es informacion
   * distinta y accionable.
   */
  public async describeMissingContext(promotionId: string): Promise<MissingContextReason | null> {
    const rows = await this.db
      .select({
        activeRulesVersionId: promotions.activeRulesVersionId,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
      })
      .from(promotions)
      .where(eq(promotions.id, promotionId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return "PROMOTION_NOT_FOUND";
    }
    if (row.activeRulesVersionId === null) {
      return "NO_ACTIVE_RULES_VERSION";
    }
    if (row.startsAt === null || row.endsAt === null) {
      return "NO_PROMOTION_WINDOW";
    }
    return null;
  }

  /**
   * DEC-007: un reversal se juzga con las reglas DE ENTONCES, que pueden ser
   * una version ya `ARCHIVED`. Por eso esta lectura NO filtra por estado.
   */
  public async getRulesConfig(rulesVersionId: string): Promise<unknown> {
    const rows = await this.db
      .select({ config: promotionRulesVersions.config })
      .from(promotionRulesVersions)
      .where(eq(promotionRulesVersions.id, rulesVersionId))
      .limit(1);

    return rows[0]?.config ?? null;
  }
}
