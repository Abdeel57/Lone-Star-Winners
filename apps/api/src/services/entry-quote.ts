/**
 * Cotizacion de entries del carrito de SERVIDOR (DEC-023).
 *
 * LA LINEA QUE NO SE CRUZA
 *
 *   Esta funcion recibe un `CartRecord` leido de la base de datos. NO recibe
 *   items, ni un cuerpo de peticion, ni nada que el cliente haya podido
 *   componer. DEC-023 lo decide expresamente, y `frontend` lo marco como
 *   bloqueante duro: si el cliente aportara los items, seria el cliente quien
 *   decide que se cotiza.
 *
 *   La firma es la garantia. No hay un parametro por el que puedan entrar
 *   items del cuerpo, asi que no hace falta acordarse de no usarlo.
 *
 * ESTA CIFRA ES ORIENTATIVA
 *
 *   Cotizar no genera nada. Las entries las escribe el backend cuando el pedido
 *   alcanza el estado que las Official Rules definan como cualificante, nunca
 *   cuando el frontend llega a una pagina de exito. Aqui no se escribe ni una
 *   fila del ledger, y esa ausencia es intencionada.
 *
 * EL RELOJ ENTRA POR PARAMETRO
 *
 *   El motor no mira `new Date()` por dentro (seria irreproducible). Lo mira
 *   este servicio, una sola vez, y lo pasa. El instante cotizado viaja ademas en
 *   la respuesta: dos cotizaciones distintas del mismo carrito a los dos lados
 *   de una frontera de multiplicador son ambas correctas, y sin `evaluated_at`
 *   no habria forma de explicarlo.
 */

import {
  CalculationConfigError,
  CalculationError,
  calculateEntries,
  type CalculationInput,
  type CalculationItemInput,
  type CalculationResult,
} from "@lsw/sweepstakes";

import { ApiErrors } from "../http/errors.js";
import type { RequestPrincipal } from "../http/principal.js";
import type { CartRecord, MoneyMinor, Repositories } from "./ports.js";

export interface EntryQuoteResponse {
  readonly promotion_id: string;
  readonly rules_version_id: string;
  readonly engine_version: number;
  readonly evaluated_at: string;
  /** `null` cuando el carrito esta vacio: sin lineas no hay moneda que declarar. */
  readonly eligible_subtotal: MoneyMinor | null;
  readonly entries_before_caps: number;
  readonly final_entries: number;
  readonly eligible_items: {
    readonly line_id: string;
    readonly sku: string;
    readonly quantity: number;
    readonly multiplier_ids: string[];
  }[];
  readonly ineligible_items: {
    readonly line_id: string;
    readonly sku: string;
    readonly reason_key: string;
  }[];
  readonly applied_multipliers: {
    readonly id: string;
    readonly numerator: number;
    readonly denominator: number;
  }[];
  readonly applied_caps: {
    readonly kind: string;
    readonly limit: number;
    readonly entries_before: number;
    readonly entries_after: number;
  }[];
}

export interface QuoteDependencies {
  readonly repositories: Repositories;
  /** Se inyecta para poder fijar el instante en los tests (DEC-011). */
  readonly now: () => Date;
}

/**
 * `cart_items.id` como `lineId`.
 *
 * Es estable mientras la linea exista y el indice unico
 * `cart_items_unique_variant_per_cart` garantiza que identifica una variante sin
 * ambiguedad. El motor ordena por `lineId`, asi que el orden de proceso no
 * depende del orden en que el participante fue anadiendo cosas.
 */
function toCalculationItems(cart: CartRecord): readonly CalculationItemInput[] {
  return cart.lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    quantity: line.quantity,
    unitAmountMinor: line.unitAmountMinor,
    currency: line.currency,
  }));
}

function toResponse(
  promotionId: string,
  rulesVersionId: string,
  evaluatedAt: Date,
  currency: string | null,
  result: CalculationResult,
): EntryQuoteResponse {
  return {
    promotion_id: promotionId,
    rules_version_id: rulesVersionId,
    engine_version: result.engineVersion,
    evaluated_at: evaluatedAt.toISOString(),
    eligible_subtotal:
      currency === null
        ? null
        : { amount_minor: result.eligibleSubtotalMinor.toString(10), currency },
    entries_before_caps: result.entriesBeforeCaps,
    final_entries: result.finalEntries,
    eligible_items: result.eligibleItems.map((item) => ({
      line_id: item.lineId,
      sku: item.sku,
      quantity: item.quantity,
      multiplier_ids: [...item.multiplierIds],
    })),
    ineligible_items: result.ineligibleItems.map((item) => ({
      line_id: item.lineId,
      sku: item.sku,
      reason_key: item.reasonKey,
    })),
    applied_multipliers: result.appliedMultipliers.map((multiplier) => ({
      id: multiplier.id,
      numerator: multiplier.numerator,
      denominator: multiplier.denominator,
    })),
    applied_caps: result.appliedCaps.map((cap) => ({
      kind: cap.kind,
      limit: cap.limit,
      entries_before: cap.entriesBefore,
      entries_after: cap.entriesAfter,
    })),
  };
}

export async function quoteServerCart(
  dependencies: QuoteDependencies,
  cart: CartRecord,
  principal: RequestPrincipal,
): Promise<EntryQuoteResponse> {
  const { repositories } = dependencies;

  const promotion = await repositories.promotions.findActive();
  if (promotion === null) {
    throw ApiErrors.noActivePromotion();
  }

  // Una promocion ACTIVE sin version de reglas activa no deberia existir: un
  // trigger de la migracion 0002 lo impide. Se comprueba igualmente, porque si
  // llegara aqui el fallo seria calcular con una configuracion vacia.
  if (promotion.rulesVersionId === null) {
    throw ApiErrors.noActivePromotion();
  }

  const rulesVersion = await repositories.promotions.findRulesVersion(promotion.rulesVersionId);
  if (rulesVersion === null) {
    throw ApiErrors.calculationConfigInvalid();
  }

  const config = await repositories.config.read();

  const participantEntriesBefore =
    principal.kind === "PARTICIPANT"
      ? await repositories.entryBalances.activeEntries(promotion.id, principal.participantId)
      : 0;

  const evaluatedAt = dependencies.now();

  const input: CalculationInput = {
    promotionId: promotion.id,
    rulesVersionId: rulesVersion.id,
    evaluatedAt,
    // La moneda del carrito, que un trigger mantiene unica (migracion 0009).
    // Con el carrito vacio no hay ninguna, y tampoco hay nada que calcular.
    currency: cart.currency ?? "",
    items: toCalculationItems(cart),
    participantEntriesBefore,
    flags: {
      entryMultipliersEnabled: config.featureFlags.entry_multipliers_enabled,
      entryCapsEnabled: config.featureFlags.entry_caps_enabled,
    },
  };

  try {
    const result = calculateEntries(input, rulesVersion.config);
    return toResponse(promotion.id, rulesVersion.id, evaluatedAt, cart.currency, result);
  } catch (error) {
    if (error instanceof CalculationConfigError) {
      // No se propaga `issues`: describen la forma de la configuracion legal, y
      // eso no es informacion de cliente.
      throw ApiErrors.calculationConfigInvalid();
    }
    if (error instanceof CalculationError) {
      throw ApiErrors.calculationRejected(error.code);
    }
    throw error;
  }
}
