/**
 * Puerto de transaccion.
 *
 * QUE OPERACIONES TIENEN QUE SER ATOMICAS, Y POR QUE
 *
 *   - Award: snapshot de calculo + fila de ledger + bloque de numeros. Si el
 *     snapshot se guarda y la fila no, queda un calculo sin efecto; si la fila
 *     se escribe y el bloque no, hay entries sin numero con el flag encendido.
 *   - Reversal: lectura del ancla + comprobacion de sobre-reversal + escritura.
 *     Sin atomicidad, dos refunds concurrentes contra la misma transaccion
 *     pueden pasar la comprobacion los dos y dejar el saldo negativo.
 *   - Aprobacion de AMOE y de ajuste: cambio de estado + fila de ledger.
 *
 *   La barrera real es de la base de datos: restricciones de unicidad, lock
 *   consultivo por promocion y por transaccion revertida, y exclusion GiST
 *   sobre los rangos (DEC-009). Este puerto no las sustituye; garantiza que el
 *   conjunto se confirme o se descarte entero.
 *
 * POR QUE `withTransaction(() => ...)` Y NO UN OBJETO DE TRANSACCION
 *
 *   Porque un objeto de transaccion que viaja como parametro se puede olvidar
 *   en una llamada, y esa llamada saldria de la transaccion sin que nada lo
 *   avise. Con un ambito lexico, el adaptador ata los repositorios a la
 *   transaccion viva y el olvido deja de ser posible.
 */

export interface UnitOfWork {
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
}
