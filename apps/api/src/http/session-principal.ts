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
 * POR QUE ESTE RESOLUTOR NO ESTA INSTALADO TODAVIA
 * ---------------------------------------------------------------------------
 *
 * `app.ts` sigue montando `noPrincipalResolver`, y la decision es de la sesion
 * que escribio el autorizador: las rutas de carrito admiten ademas SESIONES
 * ANONIMAS (DEC-023), que no existen aun, y montar este resolutor a medias
 * dejaria el carrito funcionando solo para quien ya tiene cuenta.
 *
 * Mientras siga asi, todo handler que llame a `lswPrincipalResolver` recibe
 * `null` y responde 401. Es coherente y falla cerrado; no es lo definitivo. El
 * cambio es de UNA linea y esta en el informe del hito B5.
 */

import type { FastifyRequest } from "fastify";

import type { ApiConfig } from "../config/env.js";
import type { IdentityRepositories } from "../services/identity-ports.js";
import type { ParticipantLookup } from "../services/participant-lookup.js";
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
 * Devuelve `null` -y no un principal anonimo- cuando no hay sesion. Emitir aqui
 * una cookie propia para el visitante sin cuenta seria exactamente el segundo
 * sistema de sesion que `CLAUDE.md` seccion 4 prohibe; cuando el modulo de
 * identidad emita sesiones anonimas, este es el punto donde se traducen.
 */
export function createSessionPrincipalResolver(dependencies: PrincipalResolverDependencies) {
  return async (request: FastifyRequest): Promise<RequestPrincipal | null> => {
    const session = await resolveSession(request, {
      identity: dependencies.identity,
      config: dependencies.config,
    });

    if (session === null) {
      return null;
    }

    return await principalFromSession(dependencies.participants, session);
  };
}
