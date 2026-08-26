/**
 * Redondeo entero (DEC-010: nunca coma flotante).
 *
 * POR QUE ESTO NO USA `Math.round`
 *
 *   Porque `Math.round` obliga a pasar por `number`, y ahi ya se ha perdido la
 *   partida: `0.1 + 0.2 !== 0.3`, y un importe grande en unidad menor deja de
 *   ser representable exactamente. Una discrepancia de una entry entre lo que
 *   el sistema dice y lo que el auditor recalcula no se puede defender ante un
 *   tercero, por pequena que sea.
 *
 *   Todo aqui es `bigint`: el cociente y el resto son exactos, y la politica de
 *   redondeo se decide comparando `2 * resto` con el divisor, sin dividir.
 *
 * POR QUE LA POLITICA ES UN PARAMETRO Y NO UNA ELECCION DEL INGENIERO
 *
 *   `partial_refund_rounding_policy` es una clave REQUERIDA de
 *   `PromotionRulesVersion` (DEC-012) y sigue en `TBD`. Redondear "hacia
 *   abajo, que es lo prudente" seria inventar un requisito legal, que es lo
 *   que prohibe el principio 2. La funcion exige que le digan cual usar.
 */

export const ROUNDING_POLICIES = ["FLOOR", "CEIL", "HALF_UP", "HALF_DOWN", "HALF_EVEN"] as const;

export type RoundingPolicy = (typeof ROUNDING_POLICIES)[number];

/**
 * Divide `numerator / denominator` aplicando la politica indicada.
 *
 * Solo admite operandos no negativos y divisor positivo. El dominio no tiene
 * ninguna division con signo -las cantidades de entries y los importes son no
 * negativos, y el signo lo pone el TIPO de movimiento del ledger-, y admitir
 * negativos obligaria a decidir si "hacia abajo" significa hacia cero o hacia
 * menos infinito. Esa ambiguedad no se resuelve: se prohibe.
 */
export function divideWithRounding(
  numerator: bigint,
  denominator: bigint,
  policy: RoundingPolicy,
): bigint {
  if (denominator <= 0n) {
    throw new RangeError("El divisor debe ser positivo.");
  }
  if (numerator < 0n) {
    throw new RangeError("Este dominio no divide cantidades negativas.");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) {
    return quotient;
  }

  const twiceRemainder = remainder * 2n;

  switch (policy) {
    case "FLOOR":
      return quotient;
    case "CEIL":
      return quotient + 1n;
    case "HALF_UP":
      return twiceRemainder >= denominator ? quotient + 1n : quotient;
    case "HALF_DOWN":
      return twiceRemainder > denominator ? quotient + 1n : quotient;
    case "HALF_EVEN": {
      if (twiceRemainder > denominator) {
        return quotient + 1n;
      }
      if (twiceRemainder < denominator) {
        return quotient;
      }
      // Empate exacto: al par mas cercano.
      return quotient % 2n === 0n ? quotient : quotient + 1n;
    }
    default: {
      const exhaustive: never = policy;
      throw new RangeError(`Politica de redondeo desconocida: ${String(exhaustive)}`);
    }
  }
}
