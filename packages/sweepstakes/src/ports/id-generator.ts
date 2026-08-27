/**
 * Puerto de generacion de identificadores.
 *
 * POR QUE ESTO ES UN PUERTO Y NO UN `gen_random_uuid()` DE LA BASE DE DATOS
 *
 *   `entry_transactions.id` tiene `DEFAULT gen_random_uuid()` en el esquema Y
 *   esta dentro de `LEDGER_CANONICAL_FIELDS_V1`, o sea, dentro del preimage de
 *   la hash chain (DEC-008, DEC-035).
 *
 *   Es la MISMA trampa que DEC-035 documenta para `recorded_at`, y esta
 *   trampa no estaba escrita en ningun sitio: si quien inserta deja actuar al
 *   DEFAULT, no conoce el `id` hasta que la fila ya existe, y para entonces la
 *   tabla es append-only y el hash no se puede rellenar con un UPDATE. La
 *   cadena no se rompe mas tarde: NACE ROTA.
 *
 *   Por eso `LedgerAppendInput.id` es obligatorio y por eso el identificador se
 *   genera ARRIBA, antes del INSERT, y se pasa explicitamente.
 *
 * SOBRE LA ALEATORIEDAD
 *
 *   Un `id` de ledger no decide nada del sorteo: es una etiqueta. Aun asi, el
 *   adaptador de produccion debe usar el CSPRNG del sistema
 *   (`node:crypto.randomUUID`), y vive en la capa de aplicacion porque la regla
 *   de lint de DEC-017 mantiene este paquete libre de cualquier fuente de
 *   aleatoriedad, fuerte o debil. Un identificador predecible no es un fallo de
 *   sorteo, pero si un canal de enumeracion.
 */

export interface IdGenerator {
  /** Identificador nuevo, con forma de UUID. Nunca repetido. */
  next(): string;
}

/**
 * Generador determinista para tests.
 *
 * Produce UUID validos por su FORMA -version 4, variante RFC 4122- pero
 * completamente predecibles, para que una traza de test se pueda comparar
 * literal. No debe usarse fuera de un test, y por eso no se exporta ningun
 * alias que lo disfrace de generador real.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  private readonly prefix: string;

  public constructor(prefix = "0000") {
    if (!/^[0-9a-f]{4}$/u.test(prefix)) {
      throw new RangeError(`El prefijo debe ser 4 digitos hexadecimales: ${prefix}`);
    }
    this.prefix = prefix;
  }

  public next(): string {
    this.counter += 1;
    const tail = this.counter.toString(16).padStart(12, "0");
    if (tail.length > 12) {
      throw new RangeError("SequentialIdGenerator agotado.");
    }
    return `${this.prefix}0000-0000-4000-8000-${tail}`;
  }
}
