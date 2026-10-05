/**
 * QUIEN esta preguntando, en la forma que necesitan los handlers.
 *
 * ---------------------------------------------------------------------------
 * ESTE MODULO NO RESUELVE SESIONES: LAS CONSUME
 * ---------------------------------------------------------------------------
 *
 * `session-authorizer.ts` (DEC-045) es el unico sitio del proyecto que canjea
 * una cookie por una sesion: lee la cookie, busca el hash en `sessions` y
 * evalua la politica con `evaluateSession` de `@lsw/security`. Aqui se importa
 * su `resolveSession` y no se reimplementa nada.
 *
 * La primera version de este fichero SI tenia su propia lectura de cookie,
 * escrita antes de que aquel existiera. Se ha borrado entera: dos lectores de
 * la misma cookie son dos sitios donde arreglar el dia que la politica cambie,
 * y `CLAUDE.md` seccion 4 prohibe un segundo sistema de sesion precisamente por
 * eso. Lo que queda es la traduccion que aquel modulo no hace.
 *
 * ---------------------------------------------------------------------------
 * `identity_id` NO ES `participant_id`
 * ---------------------------------------------------------------------------
 *
 * Esa es la traduccion. `identities` es quien inicia sesion; `participants` es
 * quien acumula entries, y el ledger referencia SIEMPRE al participante. Una
 * identidad puede existir sin perfil de participante -una cuenta de personal-,
 * y en ese caso aqui no hay principal: un miembro del personal no tiene carrito
 * ni saldo.
 *
 * ---------------------------------------------------------------------------
 * EL VISITANTE SIN CUENTA (DEC-023, DEC-079)
 * ---------------------------------------------------------------------------
 *
 * `app.ts` monta este resolutor. Las rutas de carrito admiten ademas sesiones
 * ANONIMAS, y desde DEC-079 existen: las emite `cart-session.ts` en
 * `cart_sessions`, una tabla aparte de `sessions` para que ninguna puerta de
 * participante o de personal pueda aceptarlas por error.
 */

import type { FastifyRequest } from "fastify";

import type { ApiConfig } from "../config/env.js";
import type { IdentityRepositories } from "../services/identity-ports.js";
import type { ParticipantLookup } from "../services/participant-lookup.js";
import { resolveCartSession } from "./cart-session.js";
import type { RequestPrincipal } from "./principal.js";
import { resolveSession, type ResolvedSession } from "./session-authorizer.js";

export interface PrincipalResolverDependencies {
  readonly identity: IdentityRepositories;
  readonly config: ApiConfig;
  readonly participants: ParticipantLookup;
}

/**
 * De sesion resuelta a principal.
 *
 * Devuelve `null` cuando la identidad no tiene perfil de participante. No es un
 * error: es la respuesta correcta para una sesion de personal.
 */
export async function principalFromSession(
  participants: ParticipantLookup,
  session: ResolvedSession,
): Promise<RequestPrincipal | null> {
  const participantId = await participants.findIdByIdentity(session.identityId);

  if (participantId === null) {
    return null;
  }

  return { kind: "PARTICIPANT", participantId, sessionRef: session.sessionId };
}

/**
 * Resolutor de identidad para las rutas que leen datos de alguien.
 *
 * DEC-079: si no hay participante, prueba la sesion ANONIMA de carrito y la
 * traduce a `ANONYMOUS_SESSION`. Ese principal solo sirve en las rutas de
 * carrito: el resto (`portal.ts`, `orders.ts`, `amoe.ts`) exige
 * `kind === "PARTICIPANT"`, y sus puertas leen `sessions`, donde una sesion de
 * carrito no existe. Este resolutor NO emite nada: emitir la sesion es cosa de
 * `POST /cart/items`, la unica ruta que la necesita.
 *
 * Gana el participante: con sesion de cuenta, el carrito es el de la cuenta
 * aunque la cookie de carrito siga en el navegador.
 */
export function createSessionPrincipalResolver(dependencies: PrincipalResolverDependencies) {
  return async (request: FastifyRequest): Promise<RequestPrincipal | null> => {
    const deps = { identity: dependencies.identity, config: dependencies.config };
    const session = await resolveSession(request, deps);

    if (session !== null) {
      const participant = await principalFromSession(dependencies.participants, session);
      if (participant !== null) {
        return participant;
      }
    }

    const cartSession = await resolveCartSession(request, deps);
    return cartSession === null ? null : { kind: "ANONYMOUS_SESSION", sessionRef: cartSession.id };
  };
}
