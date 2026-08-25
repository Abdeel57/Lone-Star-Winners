/**
 * Vocabulario canonico del dominio de Lone Star Winners.
 *
 * `CLAUDE.md` seccion 1 es explicito: esto NO es venta de boletos, ni rifa, ni
 * loteria. Este archivo existe para que el nombre correcto sea el que esta a
 * mano cuando alguien escribe codigo nuevo, y para que un revisor pueda
 * comprobar mecanicamente que no se ha colado el vocabulario equivocado.
 *
 * Ver `docs/ARCHITECTURE.md` seccion 2.
 */

/** Entidades canonicas del dominio. Cualquier tabla o tipo nuevo deberia poder mapearse a una de estas. */
export const CANONICAL_ENTITIES = [
  "Identity",
  "Participant",
  "AdminUser",
  "Promotion",
  "PromotionRulesVersion",
  "Product",
  "ProductVariant",
  "Cart",
  "Order",
  "OrderItem",
  "EntryCalculationSnapshot",
  "EntryTransaction",
  "EntryBatch",
  "AMOESubmission",
  "Adjustment",
  "AuditEvent",
  "ExportSnapshot",
  "DrawAuthorization",
  "PotentialWinner",
] as const;

export type CanonicalEntity = (typeof CANONICAL_ENTITIES)[number];

/**
 * Terminos prohibidos en identificadores, nombres de tabla y copy de producto.
 * La clave es el termino prohibido; el valor, por que lo esta.
 *
 * No es una lista de palabras "feas": cada una de ellas describe un producto
 * legalmente distinto del que se esta construyendo.
 */
export const FORBIDDEN_TERMS: Readonly<Record<string, string>> = Object.freeze({
  ticket: "Una entry promocional no es un boleto. Un boleto se compra; una entry se gana conforme a las Official Rules.",
  boleto: "Una entry promocional no es un boleto (CLAUDE.md seccion 1).",
  rifa: "Una rifa es un producto legalmente distinto de un sweepstakes.",
  raffle: "A raffle is a legally distinct product from a sweepstakes.",
  loteria: "Una loteria es un producto legalmente distinto de un sweepstakes.",
  lottery: "A lottery is a legally distinct product from a sweepstakes.",
  sorteo_mexicano: "El sorteo no depende de ninguna loteria mexicana.",
  buy_entries: "Las entries no se venden. Se adquiere mercancia elegible que puede generarlas.",
  comprar_entries: "Las entries no se venden. Se adquiere mercancia elegible que puede generarlas.",
});
