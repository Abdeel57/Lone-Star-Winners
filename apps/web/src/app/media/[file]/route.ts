import { ADMIN_MEDIA_CONTENT_TYPES, apiBaseUrl, mediaPath } from "@/lib/api";

/**
 * Imagenes de catalogo subidas desde el panel (§14, DEC-056).
 *
 * POR QUE PASAN POR AQUI Y NO SE PIDEN A LA API DESDE EL NAVEGADOR
 * ----------------------------------------------------------------
 * Por las dos mismas decisiones que rigen el resto del sitio:
 *
 *   1. El navegador no habla con `apps/api` (`src/lib/api/http.ts`). Su origen ni
 *      siquiera se publica.
 *   2. La CSP fija `img-src 'self'` (`src/lib/security-headers.ts`). Una imagen
 *      servida desde otro origen se bloquearia, y abrir la directiva a un origen
 *      externo por las fotos del catalogo es justo lo que esa politica evita.
 *
 * Asi `image_url` es una ruta raiz del propio sitio -`/media/<id>.<ext>`-, que
 * es una de las dos formas que el contrato ya admitia (§13.4), y
 * `safeImageUrl` la acepta sin cambios.
 *
 * Vive fuera de `[locale]` porque una imagen no tiene idioma, y el middleware
 * no la toca: su `matcher` excluye todo lo que lleva punto.
 *
 * LA RESPUESTA NO SE CONFIA A CIEGAS
 * ----------------------------------
 * El `content-type` de la API solo se reenvia si es uno de los tres tipos de
 * imagen del contrato. Cualquier otra cosa -un envelope JSON de error, un HTML
 * de un intermediario- se convierte en 404: este manejador sirve imagenes bajo
 * el origen del sitio, y lo que no sea una imagen no sale por el.
 */

const FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/u;

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await context.params;

  // Se comprueba ANTES de componer la URL: lo que no tenga forma de
  // `<uuid>.<ext>` no llega a la API ni como ruta ni como nada.
  if (!FILE_PATTERN.test(file)) return notFound();

  const ifNoneMatch = request.headers.get("if-none-match");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBaseUrl().replace(/\/+$/, "")}${mediaPath(file)}`, {
      headers: ifNoneMatch === null ? {} : { "if-none-match": ifNoneMatch },
      // Los bytes son inmutables, pero cachearlos es trabajo del navegador y
      // del CDN, no de la cache de datos de Next: son megas, no JSON.
      cache: "no-store",
    });
  } catch {
    return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  }

  const cacheHeaders = {
    // El contenido de una imagen no cambia nunca: cambiar la foto de un
    // producto es subir OTRA, con otra direccion.
    "cache-control": "public, max-age=31536000, immutable",
    ...(upstream.headers.get("etag") === null ? {} : { etag: upstream.headers.get("etag") ?? "" }),
  };

  if (upstream.status === 304) return new Response(null, { status: 304, headers: cacheHeaders });
  if (!upstream.ok) return notFound();

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!(ADMIN_MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType)) return notFound();

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...cacheHeaders,
      "content-type": contentType,
      // Contenido subido por un formulario, servido bajo el origen del sitio:
      // aunque alguien consiguiera colar algo que no es una imagen, no puede
      // cargar ni ejecutar nada.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
