import { Badge } from "@lsw/ui";

import { useAvailabilityLabel } from "@/i18n/storefront-labels";
import type { AvailabilityStatus } from "@/lib/api";

/**
 * Insignia de disponibilidad, sobre BANDA OSCURA.
 *
 * UNA SOLA INSIGNIA PARA UN SOLO ESTADO
 * -------------------------------------
 * La linea del carrito y la ficha del producto pintan el MISMO enum, calculado
 * por el backend con el mismo predicado (`docs/API_CONTRACT.md` secciones 4 y
 * 5). Antes cada pantalla elegia su tono por su cuenta y una de las dos llamaba
 * "agotado" a lo que la otra llamaba otra cosa. El copy sale del diccionario
 * compartido (`useAvailabilityLabel`) y el tono, de aqui.
 *
 * LOS TONOS SON UNA ESCALA, NO UN SEMAFORO
 * ----------------------------------------
 * Discreto -> ambar de contorno -> ambar pleno. Los dos estados que piden
 * atencion comparten color y se distinguen por PESO, que es la misma relacion
 * que hay entre ellos: `LOW_STOCK` avisa de que no queda margen y
 * `OUT_OF_STOCK` de que la cantidad preguntada ya no cabe.
 *
 * `IN_STOCK` va discreto A PROPOSITO. Es el estado normal: en una ficha con
 * cuatro tallas o en un carrito de seis lineas, un chip verde repetido seis
 * veces convierte lo normal en el elemento mas ruidoso de la pantalla y deja
 * sin sitio al unico que hay que ver.
 *
 * NO SE USA `danger`. Rojo diria "algo ha fallado", y aqui no ha fallado nada:
 * el carrito es valido, la linea cuenta y el pedido puede seguir. Ademas
 * DEC-042 reserva el rojo para la ACCION de compra, y un rojo de error junto al
 * boton de finalizar pedido es donde peor se confunden.
 *
 * POR QUE SOLO BANDA OSCURA
 * -------------------------
 * `Badge` solo publica `neutral`, `brand` y `accent` en la paleta clara, y el
 * tipo lo impide para el resto: los tonos de estado no tienen tinta medida
 * sobre blanco (DEC-039/040). La unica superficie clara que pinta
 * disponibilidad es la tarjeta del catalogo, que ademas solo ensena UN estado
 * -el articulo entero sin existencias- y lo resuelve con `neutral solid`, el
 * espejo exacto de esta escala en claro. Ofrecer aqui una prop `surface` seria
 * ofrecer combinaciones que no tienen contraste.
 *
 * El color no es la unica senal: el texto dice lo mismo que el tono (WCAG
 * 1.4.1).
 */
export function AvailabilityBadge({ status }: { readonly status: AvailabilityStatus }) {
  const availabilityLabel = useAvailabilityLabel();
  const label = availabilityLabel(status);

  switch (status) {
    case "IN_STOCK":
      return (
        <Badge tone="neutral" emphasis="subtle" shape="square" size="sm">
          {label}
        </Badge>
      );
    case "LOW_STOCK":
      return (
        <Badge tone="warning" emphasis="subtle" shape="square" size="sm">
          {label}
        </Badge>
      );
    case "OUT_OF_STOCK":
      return (
        <Badge tone="warning" emphasis="solid" shape="square" size="sm">
          {label}
        </Badge>
      );
  }
}
