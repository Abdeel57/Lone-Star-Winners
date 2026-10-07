/**
 * El motivo ESCRITO que se guarda al cambiar un flag o la modalidad AMOE.
 *
 * QUE EXIGE LA BASE DE DATOS
 * --------------------------
 * `lsw_feature_flags_enforce_change` y `lsw_feature_flag_settings_enforce_change`
 * (migracion `0005`, DEC-013) rechazan un cambio cuyo `update_reason` tenga
 * menos de 10 caracteres, y el CHECK de la columna, mas de 1000.
 *
 * POR QUE NO BASTA EL CODIGO DE MOTIVO
 * ------------------------------------
 * Antes se guardaba solo `reason_code`. Con un codigo largo
 * (`COMPLIANCE_INSTRUCTION`) pasaba; con `OTHER` -5 caracteres, y es justo el
 * motivo que obliga a escribir una nota- el trigger lo rechazaba y la ruta
 * respondia 500. Al APROBAR una solicitud el codigo es el de la solicitud, asi
 * que una pedida con "Otro" no se podia aprobar nunca (2026-10-07, al encender
 * `entry_multipliers_enabled` en produccion).
 *
 * Se compone codigo + ajuste + nota: siempre pasa del minimo (el nombre del
 * ajuste mas corto, `amoe_mode`, ya tiene 9) y deja en el historico del flag
 * lo mismo que se pidio, con la nota de quien lo pidio.
 */
export const SETTING_REASON_MAX_LENGTH = 1000;

export function writtenSettingReason(
  reasonCode: string,
  settingKey: string,
  reasonText: string | null,
): string {
  const note = reasonText?.trim() ?? "";
  const full =
    note === "" ? `${reasonCode} — ${settingKey}` : `${reasonCode} — ${settingKey}: ${note}`;

  // Por puntos de codigo y no por unidades UTF-16: `length` de PostgreSQL
  // cuenta caracteres, y cortar a mitad de un par sustituto dejaria basura.
  const chars = Array.from(full);
  return chars.length <= SETTING_REASON_MAX_LENGTH
    ? full
    : chars.slice(0, SETTING_REASON_MAX_LENGTH).join("").trimEnd();
}
