import type { AvailabilityStatus, ProductVariant } from "@/lib/api";

/**
 * Estado de disponibilidad de un PRODUCTO, derivado de sus variantes.
 *
 * LA API NO PUBLICA ESTO, Y NO ES UN OLVIDO
 * -----------------------------------------
 * `docs/API_CONTRACT.md` seccion 4 publica `availability` POR VARIANTE. Un
 * producto con cuatro tallas no tiene un estado: tiene cuatro. Lo que la
 * tarjeta y la ficha necesitan es responder una pregunta de PRESENTACION -"¿se
 * puede pedir algo de este articulo hoy?"- y esa respuesta se compone aqui, a
 * la vista, en vez de pedirle al backend un campo que no existe o -peor- de
 * declararlo en el tipo del contrato como si viajara.
 *
 * QUE NO ES ESTO
 * --------------
 * No es una regla de negocio ni una cifra: es una agregacion sobre datos que ya
 * vienen en la respuesta. No decide si algo se puede comprar -eso lo diria
 * `is_purchasable`, que sigue pendiente (HO-017)- y no toca ninguna cifra de
 * participaciones (DEC-023, requisito R13 de `security`).
 *
 * LA REGLA: EL MEJOR ESTADO QUE OFREZCA ALGUNA VARIANTE
 * -----------------------------------------------------
 * - alguna variante con margen        -> `IN_STOCK`
 * - ninguna con margen, alguna con lo justo -> `LOW_STOCK`
 * - todas sin existencias             -> `OUT_OF_STOCK`
 * - sin variantes                     -> `null`
 *
 * Se toma el MEJOR y no el peor a proposito: un producto con cuatro tallas de
 * las que una se agoto sigue siendo un producto que se puede pedir, y marcarlo
 * como agotado por su peor talla mandaria a alguien a otra tienda teniendo su
 * talla disponible. Lo contrario -decir "disponible" cuando no queda ninguna-
 * seria peor todavia, y por eso el caso de todas agotadas es el unico que
 * produce `OUT_OF_STOCK`.
 *
 * `null` para un producto sin variantes es deliberado: no es "agotado" -no hay
 * nada que agotar- y la pantalla decide que hace, que no es lo mismo en la
 * tarjeta que en la ficha.
 */
export function productAvailabilityStatus(
  variants: readonly ProductVariant[],
): AvailabilityStatus | null {
  if (variants.length === 0) return null;

  if (variants.some((variant) => variant.availability.status === "IN_STOCK")) {
    return "IN_STOCK";
  }

  if (variants.some((variant) => variant.availability.status === "LOW_STOCK")) {
    return "LOW_STOCK";
  }

  return "OUT_OF_STOCK";
}

/**
 * Si no queda NINGUNA variante que se pueda pedir hoy.
 *
 * Es la pregunta que hace la tarjeta del catalogo, y se responde con la misma
 * agregacion para que la tarjeta y la ficha no puedan discrepar.
 */
export function isProductSoldOut(variants: readonly ProductVariant[]): boolean {
  return productAvailabilityStatus(variants) === "OUT_OF_STOCK";
}
