import { Card, CardTitle } from "@lsw/ui";
import { useTranslations } from "next-intl";

import type { FulfillmentMethod, PostalAddress } from "@/lib/api";

/**
 * Direccion de envio de un pedido.
 *
 * La comparten la ficha del participante y la del panel, por lo mismo que
 * `OrderLineList`: quien prepara el envio y quien lo espera tienen que leer la
 * misma direccion, escrita igual. Sin ella en el panel no habia forma de saber
 * a donde mandar un pedido.
 *
 * Se pinta LINEA A LINEA tal como llega, sin recomponerla en un formato
 * nacional concreto: el orden de ciudad, region y codigo postal no es el mismo
 * en todas partes, y una plantilla fija seria una regla de jurisdiccion
 * escondida en una pantalla.
 *
 * DEC-079: un pedido en efectivo que se RECOGE en el punto de venta no tiene
 * direccion, y no es un olvido: se dice que se entrega ahi, para que quien
 * atiende lo entregue en mano en vez de buscar a donde mandarlo.
 */
export function OrderAddress({
  address,
  fulfillmentMethod = "DELIVERY",
}: {
  readonly address: PostalAddress | null;
  readonly fulfillmentMethod?: FulfillmentMethod | undefined;
}) {
  const t = useTranslations("account.order");

  if (fulfillmentMethod === "PICKUP") {
    return (
      <Card elevation="raised" padding="lg">
        <CardTitle as="h2" size="sm">
          {t("pickupHeading")}
        </CardTitle>
        <p className="mt-s4 text-body-sm text-text-muted">{t("pickupBody")}</p>
      </Card>
    );
  }

  return (
    <Card elevation="raised" padding="lg">
      <CardTitle as="h2" size="sm">
        {t("addressHeading")}
      </CardTitle>

      {address === null ? (
        <p className="mt-s4 text-body-sm text-text-muted">{t("noAddress")}</p>
      ) : (
        <address className="mt-s4 not-italic text-body-sm text-text-muted">
          {[
            address.full_name,
            address.line1,
            address.line2,
            address.city,
            address.region,
            address.postal_code,
            address.country,
          ]
            .filter((line): line is string => line !== null && line.length > 0)
            .map((line, index) => (
              // La posicion entra en la clave: ciudad y region pueden llamarse
              // igual, y React exige claves unicas entre hermanos.
              <span key={`${index}-${line}`} className="block">
                {line}
              </span>
            ))}
        </address>
      )}
    </Card>
  );
}
