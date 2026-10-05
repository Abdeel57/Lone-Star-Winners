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
