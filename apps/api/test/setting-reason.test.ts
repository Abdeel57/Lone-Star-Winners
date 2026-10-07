import { describe, expect, it } from "vitest";

import { SETTING_REASON_MAX_LENGTH, writtenSettingReason } from "../src/services/setting-reason.js";

/**
 * El motivo escrito de un cambio de ajuste tiene que caber en lo que exige la
 * base de datos: entre 10 y 1000 caracteres tras recortar (migracion `0005`,
 * DEC-013). Estas pruebas fijan esos dos bordes, que el doble del repositorio
 * no comprueba.
 */
const MIN = 10;

function charLength(text: string): number {
  return Array.from(text.trim()).length;
}

describe("writtenSettingReason", () => {
  it("compone codigo, ajuste y nota", () => {
    expect(writtenSettingReason("OTHER", "entry_multipliers_enabled", "El cliente lo indica")).toBe(
      "OTHER — entry_multipliers_enabled: El cliente lo indica",
    );
  });

  it("sin nota, codigo y ajuste", () => {
    expect(writtenSettingReason("OTHER", "amoe_enabled", null)).toBe("OTHER — amoe_enabled");
    expect(writtenSettingReason("OTHER", "amoe_enabled", "   ")).toBe("OTHER — amoe_enabled");
  });

  it("con el codigo y el ajuste mas cortos posibles sigue pasando del minimo", () => {
    // `reason_code` exige 3 caracteres como minimo; `amoe_mode` es el ajuste
    // de nombre mas corto.
    expect(charLength(writtenSettingReason("abc", "amoe_mode", null))).toBeGreaterThanOrEqual(MIN);
    expect(charLength(writtenSettingReason("abc", "amoe_mode", "x"))).toBeGreaterThanOrEqual(MIN);
  });

  it("una nota larguisima se recorta al maximo de la columna, sin romper caracteres", () => {
    const reason = writtenSettingReason("OTHER", "amoe_enabled", "🙂".repeat(2000));
    expect(charLength(reason)).toBeLessThanOrEqual(SETTING_REASON_MAX_LENGTH);
    expect(reason.endsWith("🙂")).toBe(true);
  });
});
