/**
 * Primitivas de contrasena (DEC-006, DEC-045).
 */

import { describe, expect, it } from "vitest";

import {
  ARGON2_PARAMETERS,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  PasswordPolicyError,
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "@lsw/security";

const VALID_PASSWORD = "correcto-caballo-bateria-grapa";

describe("hashing de contrasenas", () => {
  it("produce un hash Argon2id, no otro algoritmo", async () => {
    // Esta es la red que sostiene el `const ARGON2ID = 2` de password.ts. Ese
    // valor no se puede importar del enum de la libreria (`const enum`
    // ambiental + verbatimModuleSyntax), asi que va escrito a mano. Si la
    // libreria renumerara sus variantes, el hash saldria Argon2i o Argon2d y
    // aqui se veria, en vez de degradarse en silencio.
    const phc = await hashPassword(VALID_PASSWORD);
    expect(phc.startsWith("$argon2id$")).toBe(true);
  });

  it("incrusta los parametros de coste declarados", async () => {
    const phc = await hashPassword(VALID_PASSWORD);
    expect(phc).toContain(`m=${String(ARGON2_PARAMETERS.memoryCost)}`);
    expect(phc).toContain(`t=${String(ARGON2_PARAMETERS.timeCost)}`);
    expect(phc).toContain(`p=${String(ARGON2_PARAMETERS.parallelism)}`);
  });

  it("dos hashes de la misma contrasena son distintos", async () => {
    // Si coincidieran, no habria salt, y un unico diccionario precalculado
    // valdria contra toda la base de datos.
    const [a, b] = await Promise.all([hashPassword(VALID_PASSWORD), hashPassword(VALID_PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it("verifica la contrasena correcta y rechaza la incorrecta", async () => {
    const phc = await hashPassword(VALID_PASSWORD);
    await expect(verifyPassword(VALID_PASSWORD, phc)).resolves.toBe(true);
    await expect(verifyPassword(`${VALID_PASSWORD}x`, phc)).resolves.toBe(false);
  });

  it("devuelve false -no lanza- ante un hash corrupto", async () => {
    // Desde fuera, "la contrasena no vale" y "el hash almacenado esta roto"
    // deben ser indistinguibles. Si lanzara, la diferencia entre un usuario
    // existente y uno inventado seria observable.
    for (const roto of ["", "no-es-un-hash", "$argon2id$v=19$roto", "$2b$10$bcryptdisfrazado"]) {
      await expect(verifyPassword(VALID_PASSWORD, roto)).resolves.toBe(false);
    }
  });
});

describe("politica de longitud", () => {
  it("rechaza por debajo del minimo", () => {
    const corta = "a".repeat(MINIMUM_PASSWORD_LENGTH - 1);
    expect(() => {
      assertPasswordAcceptable(corta);
    }).toThrow(PasswordPolicyError);
  });

  it("acepta exactamente el minimo", () => {
    expect(() => {
      assertPasswordAcceptable("a".repeat(MINIMUM_PASSWORD_LENGTH));
    }).not.toThrow();
  });

  it("rechaza por encima del maximo", () => {
    // El tope no es cosmetico: sin el, alguien envia diez megabytes y convierte
    // el login en una denegacion de servicio contra nuestra propia CPU.
    expect(() => {
      assertPasswordAcceptable("a".repeat(MAXIMUM_PASSWORD_LENGTH + 1));
    }).toThrow(/too_long/u);
  });
});

describe("rehash", () => {
  it("no pide rehash de un hash recien creado", async () => {
    const phc = await hashPassword(VALID_PASSWORD);
    expect(needsRehash(phc)).toBe(false);
  });

  it("pide rehash de parametros por debajo de los actuales", () => {
    const barato = "$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA";
    expect(needsRehash(barato)).toBe(true);
  });

  it("pide rehash de cualquier cosa que no sea Argon2id v19", () => {
    for (const ajeno of ["$2b$10$loquesea", "$argon2i$v=19$m=19456,t=2,p=1$x$y", "basura"]) {
      expect(needsRehash(ajeno)).toBe(true);
    }
  });
});
