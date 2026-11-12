import { apiBaseUrl, orderReceiptPdfPath } from "@/lib/api";
import { lastForwardedAddress } from "@/lib/api/visitor-address";

/**
 * DEC-103: descarga del comprobante de pago en PDF, `/receipts/<pedido>.pdf`.
 *
 * POR QUE PASA POR AQUI
 * ---------------------
 * El navegador no habla con `apps/api` (`src/lib/api/http.ts`): ni siquiera se
 * publica su origen. Este manejador reenvia la cookie de sesion del navegador a
 * la API y devuelve los bytes del PDF bajo el origen del sitio.
 *
 * LA AUTORIZACION LA DECIDE LA API, NO ESTE ARCHIVO
 * -------------------------------------------------
 * Aqui no se mira de quien es el pedido. La API lo busca con el participante de
 * la sesion en el `WHERE` y responde 404 si no es suyo, y 409 si no esta
 * cobrado. Conocer el identificador de un pedido ajeno no sirve de nada.
 *
 * Vive fuera de `[locale]` porque un PDF no tiene idioma (el comprobante es en
 * ingles), y el middleware no lo toca: su `matcher` excluye lo que lleva punto.
 *
 * LA RESPUESTA NO SE CONFIA A CIEGAS
 * ----------------------------------
 * Solo se reenvia un `application/pdf` con 200. Cualquier otra respuesta -sin
 * sesion, pedido ajeno, pedido sin cobrar, un error- manda a la pagina del
 * pedido, que explica la situacion con sus propios textos: pedir que se inicie
 * sesion, "pendiente de pago" o "no encontrado".
 */

const FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pdf$/u;

export const dynamic = "force-dynamic";

function noStore(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store", ...extra } });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await context.params;

  // Se comprueba ANTES de componer la URL: lo que no tenga forma de
  // `<uuid>.pdf` no llega a la API ni como ruta ni como nada.
  const match = FILE_PATTERN.exec(file);
  const orderId = match?.[1];
  if (orderId === undefined) return noStore(404);

  const headers = new Headers({ accept: "application/pdf" });
  const cookie = request.headers.get("cookie");
  if (cookie !== null && cookie.length > 0) headers.set("cookie", cookie);
  // DEC-061: la API limita por visitante, no por servidor web.
  const visitor = lastForwardedAddress(request.headers.get("x-forwarded-for"));
  if (visitor !== null) headers.set("x-forwarded-for", visitor);

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl().replace(/\/+$/, "")}${orderReceiptPdfPath(orderId)}`, {
      headers,
      cache: "no-store",
    });
  } catch {
    return noStore(502);
  }

  // La sesion se renueva al usarse: si la API manda cookie, se propaga.
  const setCookies = upstream.headers.getSetCookie();

  const contentType = upstream.headers.get("content-type") ?? "";
  if (upstream.status !== 200 || !contentType.startsWith("application/pdf")) {
    // Relativa a proposito: detras del proxy de Railway, `request.url` puede
    // llevar el host interno del contenedor.
    const response = noStore(303, { location: `/orders/${orderId}/confirmation` });
    for (const value of setCookies) response.headers.append("set-cookie", value);
    return response;
  }

  const disposition =
    upstream.headers.get("content-disposition") ?? 'attachment; filename="receipt.pdf"';
  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": disposition,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
  for (const value of setCookies) response.headers.append("set-cookie", value);
  return response;
}
