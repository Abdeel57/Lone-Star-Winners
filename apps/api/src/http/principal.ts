/**
 * QUIEN esta haciendo la peticion.
 *
 * DOS PREGUNTAS DISTINTAS, DOS PUERTOS DISTINTOS
 *
 *   `lswAuthorizer` responde "puede pasar?". Este modulo responde "quien es?".
 *   Separarlos no es ceremonia: la primera se resuelve ANTES del handler y
 *   decide el codigo HTTP; la segunda la necesita el handler para saber de
 *   quien es el carrito que va a leer. Un solo puerto que devolviera ambas
 *   cosas obligaria al autorizador a cargar datos que la mayoria de las rutas
 *   -todas las publicas- no necesita.
 *
 * POR QUE ESTO ES UN PUERTO Y NO UNA IMPLEMENTACION
 *
 *   DEC-006 asigna identidad y sesion a `packages/security`: cookie opaca,
 *   `httpOnly`, revocable, respaldada por tabla. `CLAUDE.md` seccion 4 prohibe
 *   ademas crear un segundo sistema de autenticacion, y una cookie de carrito
 *   propia inventada aqui seria exactamente eso.
 *
 *   Asi que `apps/api` declara la FORMA de lo que necesita y no la produce. El
 *   valor por defecto es `null`: sin sesion resuelta, ninguna ruta de carrito
 *   funciona. Un stub permisivo tiene la costumbre de sobrevivir al despliegue.
 *
 * QUE ES `sessionRef`
 *
 *   La referencia opaca de la sesion, tal y como la emita `packages/security`.
 *   Es lo que permite que un visitante sin cuenta tenga carrito: la columna
 *   `carts.session_ref` la guarda sin interpretarla. Su forma la valida la base
 *   de datos (`^[A-Za-z0-9_-]{16,128}$`), no este archivo.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Un participante autenticado, o una sesion anonima con carrito.
 *
 * Union discriminada, no un objeto con dos campos opcionales: "participante" y
 * "sesion anonima" son estados excluyentes, y la base de datos lo impone con un
 * CHECK. Si el tipo admitiera ambos a la vez, el codigo tendria que decidir
 * cual gana, y esa decision acabaria escrita de forma distinta en cada handler.
 */
export type RequestPrincipal =
  | { readonly kind: "PARTICIPANT"; readonly participantId: string; readonly sessionRef: string }
  | { readonly kind: "ANONYMOUS_SESSION"; readonly sessionRef: string };

export type PrincipalResolver = (
  request: FastifyRequest,
) => Promise<RequestPrincipal | null> | RequestPrincipal | null;

/**
 * Resolutor por defecto: NO HAY NADIE.
 *
 * Mientras `packages/security` no lo sustituya, toda ruta que necesite saber
 * quien pregunta falla cerrada. Es la misma postura que `denyAllAuthorizer`, y
 * por el mismo motivo.
 */
export const noPrincipalResolver: PrincipalResolver = () => null;

/** Dueno de un carrito, en la forma en que lo guarda `carts` (DEC-023). */
export type CartOwner =
  | { readonly kind: "PARTICIPANT"; readonly participantId: string }
  | { readonly kind: "SESSION"; readonly sessionRef: string };

/**
 * Traduce el principal al dueno del carrito.
 *
 * Un participante autenticado es dueno POR PARTICIPANTE aunque tambien tenga
 * `sessionRef`: si el carrito colgara de la sesion, cerrar sesion y volver a
 * entrar dejaria el carrito huerfano, y el participante veria uno vacio sin
 * que nada se lo explicara.
 */
export function cartOwnerOf(principal: RequestPrincipal): CartOwner {
  return principal.kind === "PARTICIPANT"
    ? { kind: "PARTICIPANT", participantId: principal.participantId }
    : { kind: "SESSION", sessionRef: principal.sessionRef };
}

export function installPrincipalResolver(app: FastifyInstance, resolver: PrincipalResolver): void {
  app.decorate("lswPrincipalResolver", resolver);
}

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Resolutor de identidad. `packages/security` lo sustituira por la
     * implementacion real (DEC-006); hasta entonces devuelve `null` siempre.
     */
    lswPrincipalResolver: PrincipalResolver;
  }
}
