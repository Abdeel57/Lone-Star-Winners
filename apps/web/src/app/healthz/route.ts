/**
 * Liveness probe del proceso de Next (DEC-043).
 *
 * Deliberadamente NO consulta `apps/api`. Un healthcheck que dependa de la API
 * convierte una caida de la API en una caida tambien del frontend: el
 * orquestador reiniciaria un proceso sano y retiraria de rotacion las paginas
 * que si pueden servirse, incluidas las Official Rules. La misma separacion
 * liveness/readiness que ya aplica `apps/api/src/routes/health.ts`.
 *
 * Vive fuera de `[locale]` porque no es una pagina y no tiene idioma, y esta
 * excluido del middleware de i18n en `src/middleware.ts` para que no se
 * redirija a `/en/healthz`.
 *
 * No se sirve bajo `/api`: ese prefijo esta reservado para no crear rutas
 * ambiguas con el proceso de la API de negocio (DEC-004).
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      // Un intermediario que cachee esta respuesta convierte la sonda en una
      // mentira: seguiria devolviendo `ok` con el proceso ya caido.
      headers: { "cache-control": "no-store" },
    },
  );
}
