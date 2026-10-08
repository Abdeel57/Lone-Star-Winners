import type { EntryMultiplier, ProductKind } from "@/lib/api";

/**
 * Un periodo bonus tal como lo declara la version de reglas activa (DEC-084).
 *
 * El panel lo LEE para poder ofrecer "extender"; no decide nada con el. Quien
 * valida la forma y aplica el periodo es el backend.
 */
export interface AdminBonusPeriodView {
  readonly id: string;
  readonly multiplier: EntryMultiplier;
  readonly startsAt: string;
  readonly endsAt: string;
  /** `null` = todos los tipos de producto. */
  readonly productKindScope: readonly ProductKind[] | null;
}

/**
 * Los periodos de `config.multipliers.periods`, leidos a la defensiva.
 *
 * `config` llega como `unknown` a proposito (ver `AdminRulesVersion.config`):
 * su forma la fija el dominio legal. Un periodo que no tenga la forma esperada
 * se OMITE en vez de pintarse a medias; la version sigue siendo valida para el
 * motor, que la valido al activarla.
 */
export function bonusPeriodsOf(config: unknown): readonly AdminBonusPeriodView[] {
  if (typeof config !== "object" || config === null) return [];
  const multipliers = (config as { multipliers?: unknown }).multipliers;
  if (typeof multipliers !== "object" || multipliers === null) return [];
  const periods = (multipliers as { periods?: unknown }).periods;
  if (!Array.isArray(periods)) return [];

  return periods.flatMap((raw): AdminBonusPeriodView[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const period = raw as Record<string, unknown>;
    const multiplier = period.multiplier as Record<string, unknown> | undefined;

    if (
      typeof period.id !== "string" ||
      typeof period.starts_at !== "string" ||
      typeof period.ends_at !== "string" ||
      typeof multiplier?.numerator !== "number" ||
      typeof multiplier.denominator !== "number"
    ) {
      return [];
    }

    const scope = Array.isArray(period.product_kind_scope)
      ? period.product_kind_scope.filter(
          (kind): kind is ProductKind => kind === "MERCHANDISE" || kind === "ENTRY_PACKAGE",
        )
      : null;

    return [
      {
        id: period.id,
        multiplier: { numerator: multiplier.numerator, denominator: multiplier.denominator },
        startsAt: period.starts_at,
        endsAt: period.ends_at,
        productKindScope: scope === null || scope.length === 0 ? null : scope,
      },
    ];
  });
}

/** En que punto esta el periodo respecto de `nowMs`. Compara instantes, nada mas. */
export function bonusPeriodPhase(
  period: AdminBonusPeriodView,
  nowMs: number,
): "UPCOMING" | "ACTIVE" | "ENDED" {
  if (Date.parse(period.endsAt) <= nowMs) return "ENDED";
  if (Date.parse(period.startsAt) > nowMs) return "UPCOMING";
  return "ACTIVE";
}
