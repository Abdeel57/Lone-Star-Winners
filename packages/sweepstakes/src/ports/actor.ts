/**
 * Quien ejecuta una operacion del dominio.
 *
 * DOS COSAS DISTINTAS QUE NO SE MEZCLAN
 *
 *   `DomainActor` es lo que acaba en las columnas `actor_*` del ledger. Es una
 *   union discriminada porque el CHECK `entry_transactions_actor_consistent`
 *   exige exactamente una identificacion: un ADMIN lleva `admin_user_id` y no
 *   `participant_id`, un PARTICIPANT al reves, y SYSTEM ninguno de los dos. Con
 *   tres campos opcionales sueltos, la combinacion invalida seria
 *   representable y solo fallaria en el INSERT.
 *
 *   `Principal` es el resultado de resolver una sesion. El dominio NO decodifica
 *   tokens: el token de sesion es OPACO -43 caracteres base64url, toda la
 *   informacion vive en la fila- y quien lo canjea por un `Principal` es el
 *   modulo de identidad, por puerto. Aqui llega ya resuelto.
 */

/** Actor tal y como se registra en el ledger y en la auditoria. */
export type DomainActor =
  | { readonly type: "SYSTEM" }
  | { readonly type: "ADMIN"; readonly adminUserId: string }
  | { readonly type: "PARTICIPANT"; readonly participantId: string };

export const SYSTEM_ACTOR: DomainActor = Object.freeze({ type: "SYSTEM" as const });

export interface ActorColumns {
  readonly actorType: DomainActor["type"];
  readonly actorAdminUserId: string | null;
  readonly actorParticipantId: string | null;
}

/**
 * Proyecta el actor a las tres columnas del ledger.
 *
 * Existe para que ningun servicio construya esa terna a mano: la unica forma
 * de escribir una combinacion que el CHECK rechace es no usar esta funcion.
 */
export function actorColumns(actor: DomainActor): ActorColumns {
  switch (actor.type) {
    case "SYSTEM":
      return { actorType: "SYSTEM", actorAdminUserId: null, actorParticipantId: null };
    case "ADMIN":
      return {
        actorType: "ADMIN",
        actorAdminUserId: actor.adminUserId,
        actorParticipantId: null,
      };
    case "PARTICIPANT":
      return {
        actorType: "PARTICIPANT",
        actorAdminUserId: null,
        actorParticipantId: actor.participantId,
      };
    default: {
      const exhaustive: never = actor;
      throw new RangeError(`Actor desconocido: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Ambito de la sesion. Separa al participante del personal.
 *
 * No es lo mismo que las capacidades y no lo sustituye: un participante con
 * una capacidad de administracion pegada a mano seguiria siendo un
 * participante, y las operaciones de administracion exigen las DOS cosas.
 */
export const PRINCIPAL_SCOPES = ["PARTICIPANT", "STAFF"] as const;
export type PrincipalScope = (typeof PRINCIPAL_SCOPES)[number];

/**
 * Estados de sesion del modulo de identidad (`docs/API_CONTRACT.md`).
 *
 * `MFA_PENDING` es el que importa aqui: la sesion existe, las credenciales se
 * validaron, y AUN ASI no autentica. Falta el segundo factor.
 */
export const SESSION_STATES = ["ANONYMOUS", "MFA_PENDING", "ACTIVE"] as const;
export type SessionStateName = (typeof SESSION_STATES)[number];

/**
 * Que estados de sesion autentican. SOLO `ACTIVE`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO ES UNA FUNCION Y NO UN `if (session.authenticated)`
 * ---------------------------------------------------------------------------
 *
 * Porque `MFA_PENDING` es una trampa con forma de estado intermedio. Quien lee
 * el codigo por encima ve una sesion con `scope`, con `email` y con `roles`, y
 * es facil tratarla como una sesion. No lo es: el segundo factor todavia no se
 * ha presentado, asi que quien la tiene ha demostrado saber una contrasena y
 * nada mas.
 *
 * Un principal en ese estado NO puede calificar una orden, ni enviar AMOE, ni
 * pedir un ajuste. Se trata exactamente igual que un anonimo.
 *
 * La regla vive aqui, en una funcion con nombre y con test, en vez de repartida
 * por cada servicio. Repartida, basta con que un sitio se olvide.
 */
export function sessionStateAuthenticates(state: SessionStateName): boolean {
  return state === "ACTIVE";
}

/**
 * Sesion ya resuelta.
 *
 * El dominio NO decodifica tokens: el token de sesion es OPACO -43 caracteres
 * base64url, toda la informacion vive en la fila- y quien lo canjea por un
 * `Principal` es el modulo de identidad, por puerto. Aqui llega ya resuelto.
 *
 * `capabilities` son las claves del catalogo de `packages/security`
 * (`amoe.review.approve`, `entry.adjust.create`, ...), ya derivadas de los
 * roles. El dominio las comprueba para las operaciones donde la separacion de
 * funciones es una regla de NEGOCIO -no solo de ruta-: quien pide un ajuste no
 * puede aprobarlo. La autorizacion de transporte sigue siendo de `apps/api`;
 * esta es la segunda linea, y las dos hacen falta.
 */
export interface Principal {
  readonly actor: DomainActor;
  readonly scope: PrincipalScope;
  readonly capabilities: readonly string[];
}

export function principalHasCapability(principal: Principal, capability: string): boolean {
  return principal.capabilities.includes(capability);
}

/** Un principal de personal. Necesario -no suficiente- para operar en administracion. */
export function principalIsStaff(principal: Principal): boolean {
  return principal.scope === "STAFF";
}

/** La forma que entrega el modulo de identidad al resolver una sesion. */
export interface ResolvedSession {
  readonly state: SessionStateName;
  readonly scope: PrincipalScope;
  readonly actor: DomainActor;
  readonly capabilities: readonly string[];
}

/**
 * Convierte una sesion resuelta en un principal, o en `null`.
 *
 * `null` significa 'esta peticion no esta autenticada', y cubre tanto
 * `ANONYMOUS` como `MFA_PENDING`. Devolver `null` -en vez de un principal sin
 * capacidades- es deliberado: un principal vacio se puede pasar a un servicio
 * y fallara mas adelante, con un error de permisos que sugiere que a alguien le
 * falta un rol. `null` obliga a decidir en la frontera.
 */
export function principalFromSession(session: ResolvedSession): Principal | null {
  if (!sessionStateAuthenticates(session.state)) {
    return null;
  }
  return {
    actor: session.actor,
    scope: session.scope,
    capabilities: session.capabilities,
  };
}
