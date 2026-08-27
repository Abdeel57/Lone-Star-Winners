import type { Locale } from "@/i18n/locales";

import {
  fetchMe,
  fetchSession,
  type ApiFailure,
  type ParticipantProfile,
  type SessionContext,
  type SessionState,
} from "./api";
import { readSession } from "./session-server";

/**
 * Estado de sesion de una pantalla, resuelto en el servidor.
 *
 * CUATRO ESTADOS Y NO DOS. Es lo que hace que el portal se comporte bien tanto
 * el dia que la API no responda como el dia que alguien de personal entre con
 * su contrasena y le falte el segundo factor:
 *
 * - `active` ......... la sesion autentica. Se pinta la pantalla.
 * - `mfaPending` ..... la contrasena era correcta y la sesion TODAVIA NO
 *   AUTENTICA (seccion 10). No da acceso a nada; lo unico que se ofrece es
 *   completar el segundo factor.
 * - `anonymous` ...... no hay sesion. Se pide iniciarla, que NO es un error:
 *   es el estado normal de cualquier visitante.
 * - `unavailable` .... no se ha podido saber. Estado de error con su referencia.
 *
 * Colapsar `anonymous` y `unavailable` en uno es el fallo tipico, y tiene
 * consecuencias en las dos direcciones: si un fallo de red se pinta como
 * "inicia sesion", alguien que YA tiene sesion cree que le han echado y vuelve
 * a teclear su contrasena; si la ausencia de sesion se pinta como error, se
 * manda a soporte a quien solo tiene que entrar en su cuenta.
 *
 * Y colapsar `mfaPending` en `active` seria peor: abriria en la interfaz una
 * puerta que el backend tiene cerrada.
 */
export type SessionScreenState =
  | { readonly kind: "active"; readonly session: SessionState }
  | { readonly kind: "mfaPending"; readonly session: SessionState }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unavailable"; readonly failure: ApiFailure };

export interface SessionScreenContext {
  /** Cookies del navegador, para reenviarlas en el resto de lecturas. */
  readonly session: SessionContext;
  readonly state: SessionScreenState;
}

/**
 * Lee la sesion vigente.
 *
 * UNA SOLA PETICION. Es lo que consulta la cabecera en cada render, asi que
 * tiene que ser barata: `GET /auth/session` responde 200 siempre y no necesita
 * ninguna lectura mas.
 *
 * Devuelve TAMBIEN el `SessionContext`, y no solo el estado, porque toda
 * pantalla del portal necesita las dos cosas: saber quien es, y poder reenviar
 * la cookie en las lecturas que vengan detras. Leerla dos veces funcionaria
 * igual, pero abriria la puerta a que una pantalla pidiera datos de cuenta sin
 * reenviar la sesion y viera un 401 inexplicable.
 *
 * Se llama desde Server Components, en la misma peticion que el render. No hay
 * equivalente de cliente y no debe haberlo: la cookie es `httpOnly` (DEC-006).
 */
export async function loadSession(locale: Locale): Promise<SessionScreenContext> {
  const session = await readSession();

  // Sin ninguna cookie no hay sesion posible, y preguntarlo seria una llamada
  // de red por cada pagina publica que visite alguien que no ha entrado nunca.
  if (session.cookie === null) {
    return { session, state: { kind: "anonymous" } };
  }

  const result = await fetchSession(locale, session);

  if (!result.ok) {
    return { session, state: { kind: "unavailable", failure: result.error } };
  }

  const data = result.data;

  if (data.state === "MFA_PENDING") {
    return { session, state: { kind: "mfaPending", session: data } };
  }

  /*
   * ESCRITA EN POSITIVO, Y NO ES ESTILO (HO-027).
   *
   * La guarda dice que hace falta para PASAR -sesion autenticada Y en estado
   * `ACTIVE`- en vez de enumerar los casos que la bloquean. Una guarda escrita
   * en negativo se puede reescribir con `?.` o `??` sin que nadie note que ha
   * cambiado de significado, y en `apps/api` ya paso: un `--fix` convirtio
   * `session === null || session.revokedAt !== null` en
   * `session?.revokedAt != null`, que con `session === null` evalua `false` y
   * dejaba autenticar a un token sin sesion.
   *
   * NO APLICAR `eslint --fix` A ESTA COMPROBACION SIN LEERLA. Si alguna regla
   * sugiere "simplificarla", la simplificacion hay que probarla en negativo:
   * `ANONYMOUS`, `MFA_PENDING` y una respuesta incoherente
   * (`authenticated: true` con `state: "ANONYMOUS"`) tienen que seguir sin dar
   * acceso.
   *
   * Se exigen LAS DOS cosas aunque el contrato las publique coherentes: asi una
   * respuesta incoherente se resuelve por el lado seguro y no por el que mas
   * acceso da.
   */
  const usable = data.authenticated && data.state === "ACTIVE";

  if (!usable) {
    return { session, state: { kind: "anonymous" } };
  }

  return { session, state: { kind: "active", session: data } };
}

/**
 * Estado de una pantalla del portal, con el perfil ya cargado.
 *
 * Los cuatro estados de `loadSession` mas el perfil cuando la sesion autentica.
 */
export type ParticipantState =
  | {
      readonly kind: "authenticated";
      readonly session: SessionState;
      readonly participant: ParticipantProfile;
    }
  | { readonly kind: "mfaPending" }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unavailable"; readonly failure: ApiFailure };

export interface ParticipantContext {
  readonly session: SessionContext;
  readonly state: ParticipantState;
}

/**
 * Lee la sesion y, si autentica, el perfil.
 *
 * DOS PETICIONES, Y HACEN FALTA LAS DOS. `SessionState` contesta "quien eres y
 * en que estado esta tu sesion" -correo, estado, alcance, roles- y no trae
 * nombre para mostrar, idioma preferido ni fecha de alta. Eso es PERFIL y viaja
 * por `GET /me`, que sigue sin contrato.
 *
 * Por eso la cabecera usa `loadSession` y solo el portal usa esta: pedir el
 * perfil en cada pagina publica del sitio seria una lectura de mas en todas
 * ellas para pintar un nombre que la cabecera no necesita -le basta el correo,
 * que ya viene en la sesion-.
 *
 * SI EL PERFIL NO SE PUEDE LEER, la pantalla es de error y no de sesion
 * caducada. Es una distincion util: la sesion es valida, y decir "inicia
 * sesion" mandaria a alguien a teclear una contrasena que no arreglaria nada.
 */
export async function loadParticipant(locale: Locale): Promise<ParticipantContext> {
  const context = await loadSession(locale);

  if (context.state.kind !== "active") {
    return {
      session: context.session,
      state:
        context.state.kind === "mfaPending"
          ? { kind: "mfaPending" }
          : context.state.kind === "anonymous"
            ? { kind: "anonymous" }
            : { kind: "unavailable", failure: context.state.failure },
    };
  }

  const profile = await fetchMe(locale, context.session);

  if (!profile.ok) {
    /*
     * Un 401 aqui SI se trata como sesion caducada, y no es una contradiccion
     * con lo de arriba: significa que la sesion valia hace un instante y ya no
     * vale. Es el unico codigo que dice eso; cualquier otro fallo es un fallo.
     */
    if (profile.error.status === 401) {
      return { session: context.session, state: { kind: "anonymous" } };
    }

    return { session: context.session, state: { kind: "unavailable", failure: profile.error } };
  }

  return {
    session: context.session,
    state: {
      kind: "authenticated",
      session: context.state.session,
      participant: profile.data,
    },
  };
}
