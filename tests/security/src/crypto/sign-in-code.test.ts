/**
 * Codigos para entrar sin contrasena (DEC-089).
 *
 * Lo que se protege: que el codigo tenga siempre seis digitos, que lo guardado
 * no sirva para recuperarlo sin la clave del servidor, y que la comparacion
 * dependa de la fila y de la clave, no solo del codigo.
 */

import { describe, expect, it } from "vitest";

import {
  generateSignInCode,
  hashSignInCode,
  looksLikeSignInCode,
  SIGN_IN_CODE_DIGITS,
  SIGN_IN_CODE_POLICY,
  SIGNUP_TICKET_POLICY,
  signInCodeMatches,
} from "@lsw/security";

const KEY = "FAKE-clave-de-prueba-de-al-menos-32-caracteres";
const ROW = "0f9c2a4e-1111-4111-8111-111111111111";

describe("generateSignInCode", () => {
  it("siempre seis digitos, ceros a la izquierda incluidos", () => {
    for (let i = 0; i < 2_000; i += 1) {
      const code = generateSignInCode();
      expect(code).toHaveLength(SIGN_IN_CODE_DIGITS);
      expect(code).toMatch(/^\d{6}$/u);
    }
  });

  it("no repite: dos mil codigos dan practicamente dos mil distintos", () => {
    const codes = new Set(Array.from({ length: 2_000 }, () => generateSignInCode()));
    // Con un millon de valores, esperar menos de diez colisiones es holgado.
    expect(codes.size).toBeGreaterThan(1_990);
  });
});

describe("looksLikeSignInCode", () => {
  it("acepta seis digitos y nada mas", () => {
    expect(looksLikeSignInCode("012345")).toBe(true);
    for (const value of ["12345", "1234567", "12345a", "12 345", "", "１２３４５６"]) {
      expect(looksLikeSignInCode(value), value).toBe(false);
    }
  });
});

describe("hashSignInCode", () => {
  it("es un HMAC de 64 hexadecimales que no contiene el codigo", () => {
    const hash = hashSignInCode("123456", ROW, KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(hash).not.toContain("123456");
  });

  it("depende de la fila y de la clave: el mismo codigo no da el mismo valor", () => {
    const base = hashSignInCode("123456", ROW, KEY);
    expect(hashSignInCode("123456", "otra-fila", KEY)).not.toBe(base);
    expect(hashSignInCode("123456", ROW, `${KEY}-otra`)).not.toBe(base);
  });

  it("compara el codigo bueno y rechaza los demas", () => {
    const stored = hashSignInCode("482913", ROW, KEY);
    expect(signInCodeMatches("482913", ROW, KEY, stored)).toBe(true);
    expect(signInCodeMatches("482914", ROW, KEY, stored)).toBe(false);
    expect(signInCodeMatches("482913", "otra-fila", KEY, stored)).toBe(false);
    expect(signInCodeMatches("482913", ROW, KEY, "")).toBe(false);
  });
});

describe("politica del codigo y del permiso de alta", () => {
  it("diez minutos, cinco intentos y tres codigos sin usar cada quince minutos", () => {
    expect(SIGN_IN_CODE_POLICY).toStrictEqual({
      ttlMinutes: 10,
      maxAttempts: 5,
      throttleWindowMinutes: 15,
      throttleMaxCodes: 3,
    });
    // Un acierto al azar por cada doscientos mil codigos enviados, como mucho.
    expect(SIGN_IN_CODE_POLICY.maxAttempts / 10 ** SIGN_IN_CODE_DIGITS).toBeLessThanOrEqual(
      1 / 200_000,
    );
  });

  it("el permiso de alta es una cookie httpOnly y Secure de media hora", () => {
    expect(SIGNUP_TICKET_POLICY.cookie).toStrictEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(SIGNUP_TICKET_POLICY.absoluteTtlMinutes).toBe(30);
  });
});
