/**
 * Documentos que hay que aceptar para darse de alta (DEC-067).
 *
 * Se publican en `GET /config` como `required_consents` -la web pinta una
 * casilla por cada uno- y el alta exige recibirlos todos, con ESTA version.
 *
 * La version es la fecha de vigencia del documento que el sitio publica:
 *
 *   - OFFICIAL_RULES: las Reglas que el cliente entrego el 2026-10-04 y que
 *     viajan en la version de reglas de la edicion;
 *   - TERMS y PRIVACY: los documentos de `apps/web/src/legal/` (2026-09-30).
 *
 * Cuando el abogado entregue una version nueva de un documento, se cambia su
 * fecha AQUI y en la web en el mismo commit. Quien se dio de alta con la
 * anterior la conserva en `participant_consents`; no se reescribe.
 */
export const REQUIRED_CONSENTS = [
  { key: "OFFICIAL_RULES", version: "2026-10-04", text_key: "OFFICIAL_RULES", required: true },
  { key: "TERMS", version: "2026-09-30", text_key: "TERMS", required: true },
  { key: "PRIVACY", version: "2026-09-30", text_key: "PRIVACY", required: true },
] as const;

/**
 * DEC-098: permiso OPCIONAL para recibir correo promocional.
 *
 * No es un documento que haya que aceptar: no va en `REQUIRED_CONSENTS`, no se
 * guarda en `participant_consents` (se retira y se vuelve a dar, ver 0046) y no
 * hace falta para comprar ni para participar. Aceptar las Reglas, los Terminos
 * o la Privacidad NO lo da.
 *
 * `version` identifica el TEXTO de la casilla que pinta la web
 * (`apps/web/messages/*.json`, `marketingConsent.checkbox` y
 * `marketingConsent.checkboxHint`, en los dos idiomas). Si cambia el texto,
 * cambia la version en el mismo commit; quien acepto la anterior la conserva.
 *
 * `legallyApproved` era `false` mientras nadie aprobara ese texto en ingles y
 * en espanol (`docs/LEGAL_PENDING.md`, 33). El 2026-11-12 lo aprobo el usuario
 * (operador de la tienda) tal cual, pendiente de ratificar por el abogado. Con
 * `false`, el esquema de entorno no deja encender
 * `MARKETING_EMAIL_CONSENT_ENABLED` en produccion.
 */
export const MARKETING_EMAIL_CONSENT = {
  key: "MARKETING_EMAIL",
  version: "2026-11-12",
  text_key: "MARKETING_EMAIL",
  required: false,
  legallyApproved: true,
} as const;

/**
 * DEC-099: si Resend autorizo POR ESCRITO el correo promocional de un sorteo con
 * compra opcional. Su Politica de Uso Aceptable prohibe "Gambling services or
 * products" y no menciona los sorteos, asi que no se da por supuesto.
 *
 * Con `false`, el esquema de entorno no deja arrancar la sincronizacion `live`.
 */
export const RESEND_PROMOTIONAL_USE = {
  authorizedInWriting: false,
} as const;

/**
 * DEC-098: la version del texto de la casilla de correo promocional si llego
 * marcada en el alta, o `null`.
 *
 * Solo cuenta la version VIGENTE: una casilla pintada con otro texto no prueba
 * que la persona aceptara este, y en la duda no hay permiso. Con el permiso
 * apagado se ignora, como cualquier clave que no se pidio.
 */
export function marketingEmailOptIn(
  consents: readonly { readonly key: string; readonly version: string }[],
  enabled: boolean,
): string | null {
  if (!enabled) return null;
  const offered = consents.find(
    (consent) =>
      consent.key === MARKETING_EMAIL_CONSENT.key &&
      consent.version === MARKETING_EMAIL_CONSENT.version,
  );
  return offered === undefined ? null : offered.version;
}

/**
 * Faltan consentimientos obligatorios: las claves que no llegaron con la
 * version vigente. Vacio si estan todos.
 */
export function missingConsents(
  accepted: readonly { readonly key: string; readonly version: string }[],
): string[] {
  return REQUIRED_CONSENTS.filter(
    (required) =>
      !accepted.some(
        (consent) => consent.key === required.key && consent.version === required.version,
      ),
  ).map((required) => required.key);
}
