import { ADMIN_CAPABILITIES, type AdminCapability, type SessionState } from "@/lib/api";

/**
 * Capacidades efectivas del actor que mira el panel.
 *
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 * ---------------------------------------
 * Esto decide QUE SE PINTA. No decide QUE SE PUEDE HACER. Quien autoriza es el
 * backend, en cada peticion, y responde 403; la interfaz pinta ese 403 como un
 * estado deliberado. Ocultar un enlace es cortesia -no mandar a nadie a una
 * pantalla que le va a rechazar-, nunca un control de acceso.
 *
 * Si algun dia alguien escribe aqui una comprobacion de la que dependa que un
 * dato sensible NO se muestre, sera un defecto: el dato ya habria viajado en la
 * respuesta y estaria en el HTML. Lo que no se puede ver no se pide.
 *
 * DE DONDE SALEN LAS CAPACIDADES
 * ------------------------------
 * De `session.capabilities`, que la API publica en `GET /auth/session`,
 * `POST /auth/login` y `POST /auth/mfa/verify` (contrato seccion 10, desde
 * f0a1c74), resueltas por el backend con `ROLE_CAPABILITIES` de
 * `packages/security/src/permissions.ts`: el mapa rol -> capacidad existe UNA
 * vez, en el servidor. Aqui no hay ninguna copia. El espejo local que hubo
 * mientras el campo no existia se borro con el; una segunda copia de una
 * politica de autorizacion es lo que CLAUDE.md seccion 4 llama "dos fuentes de
 * verdad", y su sintoma era un menu que podia desincronizarse de la API.
 *
 * SI EL CAMPO NO LLEGA (una API anterior a la seccion 10 actual), el panel NO
 * deriva nada: el menu queda vacio y el chrome lo dice. Fallar en cerrado es
 * lo correcto; pintar enlaces a partir de una suposicion no lo era.
 */

function isAdminCapability(value: string): value is AdminCapability {
  return (ADMIN_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Capacidades del actor de una sesion.
 *
 * Una capacidad que el backend publique y la interfaz no conozca se IGNORA: no
 * hay pantalla que pintar para ella, y dejar de compilar contra una respuesta
 * legitima seria peor que no ensenar un enlace que todavia no existe.
 */
export function capabilitiesOf(session: SessionState): ReadonlySet<AdminCapability> {
  // Sin capacidades publicadas no se deriva nada: conjunto vacio, menu vacio y
  // aviso en el chrome (`capabilitiesArePublished`).
  return new Set((session.capabilities ?? []).filter(isAdminCapability));
}

/** Si la respuesta de sesion trajo `capabilities`. `false` = API anterior a la seccion 10 actual. */
export function capabilitiesArePublished(session: SessionState): boolean {
  return session.capabilities !== undefined;
}

/**
 * Actor del panel: quien es y que puede hacer.
 *
 * Se construye UNA vez por render y se pasa hacia abajo. Recalcularlo en cada
 * componente funcionaria igual, pero abriria la puerta a que dos partes de la
 * misma pantalla resolvieran capacidades distintas.
 */
export interface AdminActor {
  readonly email: string;
  readonly roles: readonly string[];
  readonly capabilities: ReadonlySet<AdminCapability>;
  /** `false` si la API no publico `capabilities`; entonces el menu esta vacio a proposito. */
  readonly capabilitiesPublished: boolean;
}

export function toAdminActor(session: SessionState): AdminActor {
  return {
    email: session.email,
    roles: session.roles,
    capabilities: capabilitiesOf(session),
    capabilitiesPublished: capabilitiesArePublished(session),
  };
}

/** Si el actor tiene una capacidad concreta. */
export function can(actor: AdminActor, capability: AdminCapability): boolean {
  return actor.capabilities.has(capability);
}

/** Si el actor tiene AL MENOS UNA de varias. Lo que decide si un enlace se pinta. */
export function canAny(actor: AdminActor, capabilities: readonly AdminCapability[]): boolean {
  return capabilities.some((capability) => actor.capabilities.has(capability));
}
