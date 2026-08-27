/**
 * Tokens de sesion y cifrado de secretos (DEC-006, DEC-045).
 */

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SECRET_BOX_KEY_BYTES,
  SESSION_TOKEN_LENGTH,
  SecretBoxError,
  decodeSecretBoxKey,
  decryptSecret,
  encryptSecret,
  generateSessionToken,
  hashSessionToken,
  looksLikeSessionToken,
  tokenHashesEqual,
} from "@lsw/security";

describe("tokens de sesion", () => {
  it("genera tokens de la longitud declarada y seguros para cookie y URL", () => {
    for (let i = 0; i < 50; i += 1) {
      const token = generateSessionToken();
      expect(token).toHaveLength(SESSION_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    }
  });

  it("no repite tokens", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      vistos.add(generateSessionToken());
    }
    expect(vistos.size).toBe(500);
  });

  it("el hash es de 64 hexadecimales, que es lo que exige el CHECK de la tabla", () => {
    const hash = hashSessionToken(generateSessionToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("el hash es estable para el mismo token y distinto para otro", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(hashSessionToken(generateSessionToken()));
  });

  it("el hash no revela el token", () => {
    // Suena obvio, pero es LA propiedad por la que existe la columna: quien
    // lea `sessions` no puede reconstruir la credencial portadora.
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it("filtra por forma antes de tocar la base de datos", () => {
    expect(looksLikeSessionToken(generateSessionToken())).toBe(true);
    for (const malo of ["", "corto", "a".repeat(SESSION_TOKEN_LENGTH + 1), "con espacio aqui!!"]) {
      expect(looksLikeSessionToken(malo)).toBe(false);
    }
  });

  it("compara hashes sin filtrar por longitud desigual", () => {
    const a = hashSessionToken("uno");
    const b = hashSessionToken("dos");
    expect(tokenHashesEqual(a, a)).toBe(true);
    expect(tokenHashesEqual(a, b)).toBe(false);
    expect(tokenHashesEqual(a, "corto")).toBe(false);
  });
});

describe("cifrado de secretos en reposo", () => {
  const key = randomBytes(SECRET_BOX_KEY_BYTES);

  it("cifra y descifra de ida y vuelta", () => {
    const secreto = "JBSWY3DPEHPK3PXP";
    expect(decryptSecret(encryptSecret(secreto, key), key)).toBe(secreto);
  });

  it("el texto cifrado no contiene el secreto", () => {
    const secreto = "JBSWY3DPEHPK3PXP";
    expect(encryptSecret(secreto, key)).not.toContain(secreto);
  });

  it("dos cifrados del mismo secreto son distintos", () => {
    // Nonce aleatorio: sin el, dos administradores con el mismo secreto -o el
    // mismo secreto cifrado dos veces- producirian filas identicas, y eso
    // filtra informacion sin necesidad de romper nada.
    const secreto = "JBSWY3DPEHPK3PXP";
    expect(encryptSecret(secreto, key)).not.toBe(encryptSecret(secreto, key));
  });

  it("lleva prefijo de version desde el primer dia", () => {
    expect(encryptSecret("x".repeat(16), key).startsWith("v1.")).toBe(true);
  });

  it("rechaza el descifrado con otra clave", () => {
    const otra = randomBytes(SECRET_BOX_KEY_BYTES);
    const sobre = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(() => decryptSecret(sobre, otra)).toThrow(SecretBoxError);
  });

  it("detecta manipulacion del texto cifrado", () => {
    // Esta es la razon de usar GCM y no un cifrado sin autenticar: con
    // escritura sobre la tabla, un atacante podria alterar secretos y el
    // descifrado devolveria basura silenciosamente en vez de fallar.
    const sobre = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const partes = sobre.split(".");
    const alterado = Buffer.from(partes[2] ?? "", "base64url");
    alterado[0] = (alterado[0] ?? 0) ^ 0xff;
    partes[2] = alterado.toString("base64url");

    expect(() => decryptSecret(partes.join("."), key)).toThrow(/authentication_failed/u);
  });

  it("rechaza sobres malformados y versiones desconocidas", () => {
    expect(() => decryptSecret("no-es-un-sobre", key)).toThrow(/malformed/u);
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow(/unsupported_version/u);
  });

  it("rechaza una clave que no mida 32 bytes", () => {
    // Falla al decodificar, no en la primera inscripcion de MFA en produccion.
    expect(() => decodeSecretBoxKey(randomBytes(16).toString("base64url"))).toThrow(
      /invalid_key_length/u,
    );
    expect(() => decodeSecretBoxKey(randomBytes(32).toString("base64url"))).not.toThrow();
  });
});
