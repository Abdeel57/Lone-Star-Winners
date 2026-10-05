/**
 * Sesion ANONIMA de carrito (DEC-079): el unico sitio que la canjea, la emite y
 * la borra.
 *
 * QUE ES
 *
 *   Lo que permite que un visitante sin cuenta tenga carrito. Se emite al
 *   anadir el primer articulo -nunca al leer: un rastreador no deja filas- y su
 *   `id` es el dueno del carrito en `carts.session_ref`. No identifica a nadie,
 *   no lleva roles y ninguna puerta de participante ni de personal la acepta:
 *   esas leen `sessions`, y esta vive en `cart_sessions`.
 *
 * POR QUE NO ES UN SEGUNDO SISTEMA DE SESION
 *
 *   `CLAUDE.md` seccion 4 prohibe crear un segundo sistema de autenticacion, y
 *   una cookie de carrito "propia" lo seria. Esta usa las MISMAS piezas que la
 *   del participante: token de `generateSessionToken`, SHA-256 de
 *   `hashSessionToken`, politica de `packages/security` (`CART_SESSION_POLICY`)
 *   y atributos de cookie de `session-cookie.ts`. Lo que cambia es para que
 *   sirve, igual que cambia entre participante y personal.
 *
 * QUE PASA AL INICIAR SESION
 *
 *   `routes/auth.ts` llama a `adoptCartSession`: el carrito se suma al de la
 *   cuenta, esta sesion se revoca y su cookie se borra. Nunca se promueve a
 *   sesion de participante: la de participante es nueva (fijacion de sesion).
 */

import {
  evaluateCartSession,
  generateSessionToken,
  hashSessionToken,
  looksLikeSessionToken,
  CART_SESSION_POLICY,
} from "@lsw/security";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { ApiConfig } from "../config/env.js";
import type { IdentityRepositories } from "../services/identity-ports.js";

import {
  cartCookieNameFor,
  cartCookieOptions,
  clearCartCookieOptions,
  type SessionCookieConfig,
} from "./session-cookie.js";

export interface CartSessionDeps {
  readonly identity: IdentityRepositories;
  readonly config: ApiConfig;
}

/** Sesion de carrito ya canjeada y vigente. */
export interface ResolvedCartSession {
  readonly id: string;
}

function cookieConfigOf(config: ApiConfig): SessionCookieConfig {
  return {
    name: config.session.cookieName,
    secure: config.session.cookieSecure,
    domain: config.session.cookieDomain,
  };
}

/**
 * La sesion de carrito de la peticion, o `null`.
 *
 * `null` tanto si no hay cookie como si esta revocada o caducada: desde fuera
 * no se distingue, igual que en `resolveSession`.
 */
export async function resolveCartSession(
  request: FastifyRequest,
  deps: CartSessionDeps,
  now: number = Date.now(),
): Promise<ResolvedCartSession | null> {
  const cookies = request.cookies as Record<string, string | undefined>;
  const raw = cookies[cartCookieNameFor(deps.config.session.cookieName)];

  // La forma se mira antes de consultar: filtra ruido sin gastar una consulta.
  if (raw === undefined || !looksLikeSessionToken(raw)) {
    return null;
  }

  const found = await deps.identity.cartSessions.findByTokenHash(hashSessionToken(raw));
  if (found === null) {
    return null;
  }

  const state = evaluateCartSession(
    { createdAt: found.createdAt.getTime(), revokedAt: found.revokedAt?.getTime() ?? null },
    now,
  );

  return state === "ACTIVE" ? { id: found.id } : null;
}

/** Emite una sesion de carrito nueva y su cookie. */
export async function issueCartSession(
  reply: FastifyReply,
  deps: CartSessionDeps,
  now: Date,
): Promise<ResolvedCartSession> {
  const token = generateSessionToken();
  const ttlMinutes = CART_SESSION_POLICY.absoluteTtlMinutes;

  const created = await deps.identity.cartSessions.create({
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
  });

  void reply.setCookie(
    cartCookieNameFor(deps.config.session.cookieName),
    token,
    cartCookieOptions(cookieConfigOf(deps.config), ttlMinutes * 60),
  );

  return { id: created.id };
}

/** Borra la cookie de carrito con los MISMOS atributos con que se emitio. */
export function clearCartSessionCookie(reply: FastifyReply, config: ApiConfig): void {
  void reply.clearCookie(
    cartCookieNameFor(config.session.cookieName),
    clearCartCookieOptions(cookieConfigOf(config)),
  );
}
