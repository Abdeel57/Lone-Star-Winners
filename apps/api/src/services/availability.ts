/**
 * Disponibilidad publicada: UNA sola lectura de las existencias.
 *
 * POR QUE ESTO NO VIVE DENTRO DE UNA RUTA
 *
 *   `POST /cart/items` y `PATCH /cart/items/{id}` deciden con esta comparacion
 *   el `409 INSUFFICIENT_STOCK`. `GET /cart` publica con ella el
 *   `availability` de cada linea. `GET /products` y `GET /products/{slug}`
 *   publican con ella el de cada variante. Son cinco usos, dos ficheros de
 *   rutas y UNA sola pregunta.
 *
 *   Si cada ruta leyera el stock a su manera, la ficha podria anunciar
 *   "disponible" y el carrito responder 409 al pulsar. Ese sintoma es dificil
 *   de atribuir y no lo detecta ningun test que mire una ruta sola, asi que la
 *   funcion es compartida a proposito.
 *
 * ESTO VALIDA, NO RESERVA
 *
 *   El esquema no tiene ninguna reserva de inventario. Entre esta lectura y el
 *   checkout las existencias pueden bajar, y por eso `availability` se
 *   recalcula en cada respuesta en vez de darse por buena una comprobacion
 *   anterior.
 *
 * LO QUE ESTO NO RESPONDE
 *
 *   "Esta a la venta?" es otra pregunta -la que HO-017 llama
 *   `is_purchasable`, todavia pendiente- y NO se deduce de esta. Una variante
 *   retirada o no publicada puede tener existencias de sobra.
 */

/**
 * Enum estable del contrato (secciones 4 y 5). El copy es de `frontend`
 * (DEC-022): `OUT_OF_STOCK` significa "esta cantidad no se puede servir hoy",
 * no necesariamente "no queda ninguna".
 */
export type AvailabilityStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

/**
 * La pregunta que responde el CATALOGO es "se puede comprar UNA unidad?".
 *
 * En la ficha no hay cantidad pedida: nadie ha elegido todavia cuantas
 * unidades quiere. Uno es la unica cantidad que no inventa intencion del
 * comprador, y hace que el catalogo diga `OUT_OF_STOCK` exactamente cuando
 * anadir la primera unidad devolveria `409 INSUFFICIENT_STOCK`.
 */
export const CATALOG_PROBE_QUANTITY = 1;

/**
 * Caben `quantity` unidades en las existencias?
 *
 * `null` es "existencias no gestionadas", que NO es cero: no se comprueba nada
 * y se deja pasar.
 */
export function fitsStock(stockQuantity: number | null, quantity: number): boolean {
  return stockQuantity === null || stockQuantity >= quantity;
}

/**
 * Estado derivado del stock y de la cantidad por la que se pregunta.
 *
 * | stock                    | estado         | significado                     |
 * | ------------------------ | -------------- | ------------------------------- |
 * | no gestionado (`null`)   | `IN_STOCK`     | nada limita esta cantidad       |
 * | menor que `quantity`     | `OUT_OF_STOCK` | no cabe: pedirla daria 409      |
 * | igual a `quantity`       | `LOW_STOCK`    | justo lo que queda, ni una mas  |
 * | mayor que `quantity`     | `IN_STOCK`     | queda margen                    |
 *
 * POR QUE EL UMBRAL ES LA CANTIDAD PREGUNTADA Y NO UN NUMERO
 *
 *   Lo habitual seria "LOW_STOCK si quedan menos de N". Ese N es una constante
 *   de negocio que nadie ha aprobado, y el principio 2 de `CLAUDE.md` prohibe
 *   inventarla. La tabla de arriba no inventa nada: sale entera de la misma
 *   comparacion que ya decide el 409.
 *
 *   En el carrito la cantidad preguntada es la de la linea; en el catalogo es
 *   `CATALOG_PROBE_QUANTITY`. Es el MISMO predicado evaluado con la cantidad
 *   que cada superficie conoce, no dos definiciones parecidas.
 */
export function availabilityFor(
  stockQuantity: number | null,
  quantity: number,
): { status: AvailabilityStatus } {
  if (!fitsStock(stockQuantity, quantity)) {
    return { status: "OUT_OF_STOCK" };
  }
  if (stockQuantity === quantity) {
    return { status: "LOW_STOCK" };
  }
  return { status: "IN_STOCK" };
}
