/**
 * Lo que la promocion OFRECE, calculado por el backend (DEC-052, contrato 13.4
 * y 13.5).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO LO PUEDE HACER EL ESCAPARATE
 * ---------------------------------------------------------------------------
 *
 * DRAFT v2 Opcion 2 obliga a declarar cuantas participaciones incluye cada
 * paquete EN LA PAGINA DONDE SE OFRECE. La tentacion es evidente -precio por
 * tasa, dos lineas de JavaScript- y produce una cifra que no es la que la
 * compra va a generar: sin elegibilidad, sin periodos de multiplicador, sin la
 * politica de redondeo de la formula y sin saber si el tipo de ese producto
 * tiene tasa declarada.
 *
 * Aqui se ejecuta EL MISMO MOTOR que ejecutara la compra, sobre una unidad. Es
 * la unica forma de que lo anunciado y lo concedido coincidan por construccion,
 * y es lo que el escaner `no-client-entry-math` del frontend existe para
 * proteger.
 *
 * ---------------------------------------------------------------------------
 * CUANDO NO HAY CIFRA, SE DICE QUE NO HAY CIFRA
 * ---------------------------------------------------------------------------
 *
 * `null` -y nunca un cero, ni una estimacion- cuando no hay promocion activa,
 * no hay version de reglas activa, el tipo de producto no tiene tasa, el
 * producto no es elegible o la configuracion no parsea. Un cero significaria
 * "esto no da participaciones", que es una afirmacion distinta y puede ser
 * falsa; un numero inventado seria una promesa que la compra no cumple.
 *
 * ---------------------------------------------------------------------------
 * SIN TOPES, Y A PROPOSITO
 * ---------------------------------------------------------------------------
 *
 * La ficha es ANONIMA: no hay participante del que leer un saldo, y aplicar un
 * tope con `participantEntriesBefore = 0` daria la cifra de quien empieza de
 * cero, que es la mayoria pero no todos. Se publica la oferta -lo que vale una
 * unidad- y el recorte por tope aparece donde se puede calcular de verdad: en
 * la cotizacion del carrito y en la concesion.
 */

import {
  CalculationConfigError,
  CalculationError,
  calculateEntries,
  calculationConfigSchema,
  readAmoeConfig,
  AmoeConfigError,
  type CalculationConfig,
  type MultiplierPeriodConfig,
  type ProductKind,
} from "@lsw/sweepstakes";
import { type z } from "zod";

import type {
  bonusPeriodSchema,
  entryOfferSchema,
  promotionEntryOfferSchema,
} from "../http/schemas.js";
import type { ProductRecord, RulesVersionRecord, VariantRecord } from "./ports.js";

export type VariantEntryOffer = z.infer<typeof entryOfferSchema>;
export type PromotionEntryOffer = z.infer<typeof promotionEntryOfferSchema>;
type BonusPeriod = z.infer<typeof bonusPeriodSchema>;

export interface EntryOfferContext {
  readonly promotionId: string;
  readonly rulesVersion: RulesVersionRecord;
  readonly multipliersEnabled: boolean;
  readonly capsEnabled: boolean;
  readonly amoeEnabled: boolean;
  readonly evaluatedAt: Date;
  /**
   * La moneda de arranque de la API (`COMMERCE_DEFAULT_CURRENCY`), como
   * respaldo cuando la version de reglas no declara la suya.
   *
   * NO es un valor legal ni una suposicion del backend: es la moneda en la que
   * ya esta operando este despliegue -la misma con la que se crean los
   * productos y se cobran los pedidos-, declarada explicitamente en el entorno.
   * Sin ella, DEC-010 quedaria incumplido en la unica cifra monetaria de
   * `entry_offer`: un importe sin moneda obliga a quien lo pinta a inventarse
   * el simbolo, que es exactamente lo que ese principio prohibe.
   */
  readonly defaultCurrency: string | null;
}

/**
 * La configuracion de calculo ya parseada, o `null` si no se puede leer.
 *
 * `null` y no una excepcion: la tienda tiene que poder pintarse aunque la
 * configuracion legal de la promocion activa este rota. Lo que NO puede hacer
 * es publicar una cifra; de eso se encarga el `null` de `entry_offer`.
 */
export function readCalculationConfig(rulesVersion: RulesVersionRecord): CalculationConfig | null {
  const parsed = calculationConfigSchema.safeParse(rulesVersion.config);
  return parsed.success ? parsed.data : null;
}

/**
 * Lo que genera UNA unidad de esta variante.
 *
 * Se llama dos veces al motor -una con los multiplicadores apagados y otra con
 * el flag real- porque el anuncio necesita las DOS cifras: sin la base, "5X" no
 * se puede comprobar. El coste es despreciable: el motor no toca red ni disco.
 */
export function variantEntryOffer(
  product: ProductRecord,
  variant: VariantRecord,
  context: EntryOfferContext,
): VariantEntryOffer | null {
  const input = {
    promotionId: context.promotionId,
    rulesVersionId: context.rulesVersion.id,
    evaluatedAt: context.evaluatedAt,
    currency: variant.currency,
    items: [
      {
        // Identificador sintetico: no hay linea de carrito. El motor solo lo
        // usa para ordenar y para la traza, que aqui se descarta.
        lineId: variant.id,
        sku: variant.sku,
        productKind: product.kind,
        quantity: 1,
        unitAmountMinor: variant.priceAmountMinor,
        currency: variant.currency,
      },
    ],
    // Ver la cabecera: la ficha es anonima y no hay saldo que leer.
    participantEntriesBefore: 0,
    flags: { entryMultipliersEnabled: false, entryCapsEnabled: false },
  } as const;

  try {
    const base = calculateEntries(input, context.rulesVersion.config);

    // Una linea inelegible -tipo sin tasa, producto fuera de la lista- no tiene
    // oferta que anunciar. Cero seria una afirmacion sobre esa variante que
    // puede dejar de ser cierta con la version de reglas siguiente.
    if (base.eligibleItems.length === 0) {
      return null;
    }

    const now = context.multipliersEnabled
      ? calculateEntries(
          { ...input, flags: { entryMultipliersEnabled: true, entryCapsEnabled: false } },
          context.rulesVersion.config,
        )
      : base;

    return {
      base_entries: base.finalEntries,
      entries_now: now.finalEntries,
      multiplier_ids: [...(now.eligibleItems[0]?.multiplierIds ?? [])],
      evaluated_at: context.evaluatedAt.toISOString(),
      rules_version_id: context.rulesVersion.id,
    };
  } catch (error) {
    // `CalculationConfigError` = la configuracion no parsea;
    // `CalculationError` = el motor se niega (por ejemplo `EXCLUSIVE` con dos
    // periodos solapados). En los dos casos la respuesta honesta es "no hay
    // cifra publicable", no un 500 que tumbe la tienda entera.
    if (error instanceof CalculationConfigError || error instanceof CalculationError) {
      return null;
    }
    throw error;
  }
}

function toBonusPeriod(period: MultiplierPeriodConfig): BonusPeriod {
  return {
    id: period.id,
    multiplier: {
      numerator: period.multiplier.numerator,
      denominator: period.multiplier.denominator,
    },
    starts_at: period.starts_at,
    ends_at: period.ends_at,
    product_kind_scope: period.product_kind_scope === null ? null : [...period.product_kind_scope],
    sku_scope: period.sku_scope === null ? null : [...period.sku_scope],
  };
}

/**
 * La moneda en la que se expresa la unidad de importe de la tasa.
 *
 * DOS FUENTES, EN ESTE ORDEN, Y NINGUNA INVENTADA
 *
 *   1. `config.currency` de la version de reglas, que es la moneda de la
 *      PROMOCION -la misma que lee `promotion-context-repository` para
 *      construir `PromotionContext.currency`-. Manda porque es lo que aprueba
 *      el abogado.
 *   2. La moneda de arranque de la API (`COMMERCE_DEFAULT_CURRENCY`). No es una
 *      suposicion: es la moneda con la que este despliegue ya crea productos y
 *      cobra pedidos, declarada en el entorno.
 *
 * `null` solo si no existe ninguna de las dos, y entonces la respuesta lo dice
 * en vez de escribir un `USD` que nadie ha declarado. Devolver `null` cuando SI
 * hay moneda era el defecto que corregia el Team Lead: obligaba al frontend a
 * inventarse el simbolo, que es justo lo que DEC-010 prohibe.
 */
function rateCurrency(rawConfig: unknown, fallback: string | null): string | null {
  const declared: unknown =
    typeof rawConfig === "object" && rawConfig !== null
      ? (rawConfig as { currency?: unknown }).currency
      : undefined;

  if (typeof declared === "string" && /^[A-Z]{3}$/u.test(declared)) {
    return declared;
  }
  return fallback !== null && /^[A-Z]{3}$/u.test(fallback) ? fallback : null;
}

/**
 * Las tasas que declara la formula, en la forma que publica el contrato.
 *
 * Los modos que NO se expresan por importe -`FIXED_PER_ORDER`,
 * `FIXED_PER_PRODUCT`, `TIERED_BY_AMOUNT`- devuelven lista vacia. Traducirlos a
 * una tasa equivalente seria inventarla: "7 participaciones por pedido" no es
 * "X por dolar" y presentarlo como tal enganaria sobre lo que dicen las Reglas.
 */
function ratesOf(config: CalculationConfig, currency: string | null): PromotionEntryOffer["rates"] {
  const formula = config.purchase_entry_formula;

  if (formula.mode === "ENTRIES_PER_CURRENCY_UNIT") {
    return [
      {
        product_kind: null,
        entries_per_amount_unit: {
          numerator: formula.entries_per_amount_unit.numerator,
          denominator: formula.entries_per_amount_unit.denominator,
        },
        amount_unit: {
          amount_minor: formula.amount_unit_minor.toString(10),
          currency,
        },
      },
    ];
  }

  if (formula.mode === "ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND") {
    const kinds: readonly ProductKind[] = ["MERCHANDISE", "ENTRY_PACKAGE"];
    return kinds.flatMap((kind) => {
      const rate = formula.rates[kind];
      // Un tipo SIN tasa no aparece. Publicarlo con cero diria "este tipo da
      // cero participaciones", que es una regla que nadie ha escrito: lo que
      // dice la configuracion es que no genera por esta via.
      if (rate === null) {
        return [];
      }
      return [
        {
          product_kind: kind,
          entries_per_amount_unit: {
            numerator: rate.entries_per_amount_unit.numerator,
            denominator: rate.entries_per_amount_unit.denominator,
          },
          amount_unit: { amount_minor: rate.amount_unit_minor.toString(10), currency },
        },
      ];
    });
  }

  return [];
}

/**
 * El periodo vigente que el motor aplicaria, resuelto por la estrategia
 * declarada.
 *
 * Se obtiene ejecutando el propio motor sobre una linea sintetica del tipo
 * indicado, y no reimplementando la seleccion: dos implementaciones de "que
 * bonus manda" acaban discrepando, y el dia que discrepen el sitio anunciara un
 * multiplicador que la compra no aplica.
 */
function activeBonusFor(
  config: CalculationConfig,
  rawConfig: unknown,
  promotionId: string,
  rulesVersionId: string,
  evaluatedAt: Date,
): BonusPeriod | null {
  const periods = config.multipliers?.periods ?? [];
  if (periods.length === 0) {
    return null;
  }

  // Una unidad de importe unitario por cada tipo: lo unico que interesa del
  // resultado es QUE periodos marco el motor como aplicados. La moneda solo
  // tiene que ser CONSISTENTE consigo misma -el motor compara la de cada linea
  // con la del calculo- y aqui no se publica: se descarta con el resultado.
  const probeCurrency = "";
  const applied = new Set<string>();
  for (const productKind of ["MERCHANDISE", "ENTRY_PACKAGE"] as const) {
    try {
      const result = calculateEntries(
        {
          promotionId,
          rulesVersionId,
          evaluatedAt,
          currency: probeCurrency,
          items: [
            {
              lineId: `announcement-${productKind}`,
              // SKU sintetico: un periodo acotado por SKU no se anuncia como
              // bonus general, y con este no coincidira ninguno.
              sku: "LSW-ANNOUNCEMENT",
              productKind,
              quantity: 1,
              unitAmountMinor: 100n,
              currency: probeCurrency,
            },
          ],
          participantEntriesBefore: 0,
          flags: { entryMultipliersEnabled: true, entryCapsEnabled: false },
        },
        rawConfig,
      );
      for (const multiplier of result.appliedMultipliers) {
        applied.add(multiplier.id);
      }
    } catch (error) {
      if (error instanceof CalculationConfigError || error instanceof CalculationError) {
        // `EXCLUSIVE` con solapamiento, por ejemplo. No hay un bonus que
        // anunciar porque el motor no sabria cual aplicar tampoco.
        return null;
      }
      throw error;
    }
  }

  const candidates = periods.filter((period) => applied.has(period.id));
  const [first, ...rest] = candidates;
  if (first === undefined) {
    return null;
  }

  // Con `STACK` puede haber varios; se anuncia el de mayor valor, que es el
  // que el participante mirara. Los demas siguen en `bonus_periods`.
  let best = first;
  for (const candidate of rest) {
    const left = BigInt(candidate.multiplier.numerator) * BigInt(best.multiplier.denominator);
    const right = BigInt(best.multiplier.numerator) * BigInt(candidate.multiplier.denominator);
    if (left > right) {
      best = candidate;
    }
  }
  return toBonusPeriod(best);
}

export function promotionEntryOffer(context: EntryOfferContext): PromotionEntryOffer | null {
  const config = readCalculationConfig(context.rulesVersion);
  if (config === null) {
    return null;
  }

  const currency = rateCurrency(context.rulesVersion.config, context.defaultCurrency);

  const nowMs = context.evaluatedAt.getTime();
  const upcoming = (config.multipliers?.periods ?? [])
    // Los que YA terminaron no se anuncian: el anuncio existe para lo que
    // esta o va a estar vigente.
    .filter((period) => Date.parse(period.ends_at) > nowMs)
    .slice()
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .map(toBonusPeriod);

  let amoe: PromotionEntryOffer["amoe"] = null;
  try {
    const amoeConfig = readAmoeConfig(context.rulesVersion.config);
    amoe =
      amoeConfig === null
        ? {
            enabled: false,
            mode: null,
            entries_per_approved_submission: null,
            max_per_participant_per_period: null,
            limit_period: null,
          }
        : {
            enabled: context.amoeEnabled,
            mode: amoeConfig.mode,
            entries_per_approved_submission: amoeConfig.entries_per_approved_submission,
            max_per_participant_per_period: amoeConfig.limit.max_per_participant_per_period,
            limit_period: amoeConfig.limit.period,
          };
  } catch (error) {
    if (!(error instanceof AmoeConfigError)) {
      throw error;
    }
    // Configuracion AMOE ilegible: el resto de la oferta sigue siendo cierto,
    // asi que se publica sin el resumen en vez de tumbar la pagina entera.
    amoe = null;
  }

  return {
    rules_version_id: context.rulesVersion.id,
    rates: ratesOf(config, currency),
    per_participant_max: config.entry_limits.per_participant_max,
    per_order_max: config.entry_limits.per_order_max,
    caps_enabled: context.capsEnabled,
    multipliers_enabled: context.multipliersEnabled,
    active_bonus: context.multipliersEnabled
      ? activeBonusFor(
          config,
          context.rulesVersion.config,
          context.promotionId,
          context.rulesVersion.id,
          context.evaluatedAt,
        )
      : null,
    bonus_periods: upcoming,
    amoe,
  };
}
