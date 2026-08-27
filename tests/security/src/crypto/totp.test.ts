/**
 * TOTP (DEC-006, DEC-045).
 *
 * Todos los instantes son explicitos. Ni un `Date.now()`: un TOTP se define por
 * ventanas de tiempo, y los fallos viven en los bordes de esas ventanas, que es
 * justo lo que no se puede probar si la funcion lee el reloj por su cuenta.
 */

import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";

import {
  TOTP_PARAMETERS,
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotp,
} from "@lsw/security";

const PERIOD_MS = TOTP_PARAMETERS.periodSeconds * 1_000;

/** Genera el codigo que un autenticador mostraria en ese instante. */
function codeAt(secretBase32: string, atMillis: number): string {
  const totp = new TOTP({
    issuer: "lsw",
    label: "verification",
    algorithm: TOTP_PARAMETERS.algorithm,
    digits: TOTP_PARAMETERS.digits,
    period: TOTP_PARAMETERS.periodSeconds,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp: atMillis });
}

describe("secretos e inscripcion", () => {
  it("genera secretos base32 distintos", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]+$/u);
    expect(a).not.toBe(b);
  });

  it("la URI de aprovisionamiento lleva emisor, etiqueta y parametros", () => {
    const secreto = generateTotpSecret();
    const uri = totpProvisioningUri(secreto, "admin@ejemplo.invalid", "Lone Star Winners");

    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secreto}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("verificacion", () => {
  const secreto = generateTotpSecret();
  // Instante fijo, elegido a mano. Nada aqui depende de cuando corran los tests.
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);

  it("acepta el codigo de la ventana actual", () => {
    const resultado = verifyTotp({
      code: codeAt(secreto, now),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: null,
    });

    expect(resultado.valid).toBe(true);
    expect(resultado.counter).not.toBeNull();
  });

  it("tolera un desfase de reloj de una ventana en cada sentido", () => {
    for (const desfase of [-PERIOD_MS, PERIOD_MS]) {
      const resultado = verifyTotp({
        code: codeAt(secreto, now + desfase),
        secretBase32: secreto,
        nowMillis: now,
        lastUsedCounter: null,
      });
      expect(resultado.valid).toBe(true);
    }
  });

  it("rechaza mas alla de la tolerancia", () => {
    for (const desfase of [-3 * PERIOD_MS, 3 * PERIOD_MS]) {
      const resultado = verifyTotp({
        code: codeAt(secreto, now + desfase),
        secretBase32: secreto,
        nowMillis: now,
        lastUsedCounter: null,
      });
      expect(resultado.valid).toBe(false);
    }
  });

  it("rechaza codigos con forma invalida sin trabajo criptografico", () => {
    for (const malo of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(
        verifyTotp({ code: malo, secretBase32: secreto, nowMillis: now, lastUsedCounter: null })
          .valid,
      ).toBe(false);
    }
  });

  it("acepta el codigo con espacios, que es como lo copia la gente", () => {
    const code = codeAt(secreto, now);
    const conEspacios = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(
      verifyTotp({
        code: conEspacios,
        secretBase32: secreto,
        nowMillis: now,
        lastUsedCounter: null,
      }).valid,
    ).toBe(true);
  });

  it("rechaza el codigo de otro secreto", () => {
    const otro = generateTotpSecret();
    expect(
      verifyTotp({
        code: codeAt(otro, now),
        secretBase32: secreto,
        nowMillis: now,
        lastUsedCounter: null,
      }).valid,
    ).toBe(false);
  });
});

describe("un codigo solo vale una vez", () => {
  const secreto = generateTotpSecret();
  const now = Date.UTC(2026, 7, 26, 12, 0, 0);

  it("rechaza la reutilizacion de la ventana ya consumida", () => {
    // El fallo que esto previene: sin consumir la ventana, un codigo visto por
    // encima del hombro sirve durante toda su vigencia MAS la tolerancia, es
    // decir hasta minuto y medio.
    const primera = verifyTotp({
      code: codeAt(secreto, now),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: null,
    });
    expect(primera.valid).toBe(true);

    const repetida = verifyTotp({
      code: codeAt(secreto, now),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: primera.counter,
    });
    expect(repetida.valid).toBe(false);
  });

  it("rechaza tambien una ventana ANTERIOR a la ya consumida", () => {
    // Si solo se comprobara la igualdad, un codigo de la ventana previa -aun
    // dentro de la tolerancia- seguiria colandose despues de haber usado el
    // actual.
    const consumida = verifyTotp({
      code: codeAt(secreto, now),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: null,
    });

    const anterior = verifyTotp({
      code: codeAt(secreto, now - PERIOD_MS),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: consumida.counter,
    });
    expect(anterior.valid).toBe(false);
  });

  it("acepta la ventana siguiente", () => {
    const consumida = verifyTotp({
      code: codeAt(secreto, now),
      secretBase32: secreto,
      nowMillis: now,
      lastUsedCounter: null,
    });

    const siguiente = verifyTotp({
      code: codeAt(secreto, now + PERIOD_MS),
      secretBase32: secreto,
      nowMillis: now + PERIOD_MS,
      lastUsedCounter: consumida.counter,
    });
    expect(siguiente.valid).toBe(true);
    expect(siguiente.counter).toBeGreaterThan(consumida.counter ?? 0);
  });
});
