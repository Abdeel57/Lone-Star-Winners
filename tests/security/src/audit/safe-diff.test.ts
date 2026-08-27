/**
 * INVARIANTE: un diff de auditoria no puede llevar lo que nadie autorizo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE FICHERO IMPORTA MAS DE LO QUE PARECE
 * ---------------------------------------------------------------------------
 *
 * `audit_events` es append-only (DEC-007): no admite `UPDATE` y no admite
 * `DELETE`. Lo que entre, se queda, y se queda durante toda la retencion del
 * historico.
 *
 * Eso convierte un descuido normal -volcar el objeto de dominio entero en
 * `before`/`after`- en un problema que no tiene arreglo posterior: un hash de
 * contrasena, un token de sesion o una fecha de nacimiento guardados para
 * siempre, sin forma de retirarlos sin destruir la cadena.
 *
 * Por eso el saneador es una ALLOWLIST -falla en cerrado- y por eso ademas
 * tiene un SUELO que la allowlist no puede bajar: un descuido puede olvidar un
 * campo util, pero no puede colar un secreto.
 */

import { AUDIT_DIFF_MAX_TEXT_LENGTH, isNeverAuditableKey, redactDiff } from "@lsw/audit";
import { describe, expect, it } from "vitest";

describe("allowlist: lo que no esta, no viaja", () => {
  it("guarda solo los campos declarados", () => {
    const result = redactDiff({
      allow: ["status", "quantity"],
      before: { status: "PENDING", quantity: 10, internal_note: "no declarado" },
      after: { status: "APPROVED", quantity: 12, internal_note: "tampoco" },
    });

    expect(result.before).toStrictEqual({ status: "PENDING", quantity: 10 });
    expect(result.after).toStrictEqual({ status: "APPROVED", quantity: 12 });
  });

  it("deja constancia de lo descartado: un saneador silencioso miente por omision", () => {
    // Un auditor que vea un `before` con dos campos tiene que poder distinguir
    // "tenia dos" de "tenia veinte y se guardaron dos".
    const result = redactDiff({
      allow: ["status"],
      before: { status: "PENDING", internal_note: "x", reviewer_comment: "y" },
      after: null,
    });

    expect(result.droppedKeys).toStrictEqual(["internal_note", "reviewer_comment"]);
  });

  it("un objeto vacio NO es lo mismo que `null`", () => {
    // `null` dice "no habia estado"; `{}` dice "habia estado y no se pudo
    // guardar nada de el". La diferencia importa al leerlo dentro de un ano.
    const result = redactDiff({ allow: [], before: { a: 1 }, after: null });
    expect(result.before).toStrictEqual({});
    expect(result.after).toBeNull();
  });
});

describe("el suelo: hay nombres que no se auditan aunque se pidan", () => {
  it("un campo de la lista prohibida se descarta AUNQUE este en la allowlist", () => {
    const result = redactDiff({
      allow: ["password_hash", "session_token", "status"],
      before: { password_hash: "argon2id$...", session_token: "abc", status: "ACTIVE" },
      after: null,
    });

    expect(result.before).toStrictEqual({ status: "ACTIVE" });
    expect(result.droppedKeys).toStrictEqual(["password_hash", "session_token"]);
  });

  it("la comparacion es por subcadena: el mismo campo tiene cuatro nombres segun quien lo escriba", () => {
    for (const key of ["password", "passwordHash", "newPassword", "hashed_password"]) {
      expect(isNeverAuditableKey(key), key).toBe(true);
    }
    for (const key of ["cardLast4", "pan", "cvv", "ssn", "date_of_birth", "dob"]) {
      expect(isNeverAuditableKey(key), key).toBe(true);
    }
    expect(isNeverAuditableKey("status")).toBe(false);
    expect(isNeverAuditableKey("quantity_delta")).toBe(false);
  });
});

describe("forma de los valores", () => {
  it("un objeto anidado no se guarda: la allowlist no dice nada de lo que hay dentro", () => {
    // Sin esta regla, el control se saltaria escribiendo
    // `{"detalle": {...todo el objeto...}}` con `detalle` en la allowlist.
    const result = redactDiff({
      allow: ["detalle", "lista", "status"],
      before: { detalle: { password: "x" }, lista: [1, 2, 3], status: "ACTIVE" },
      after: null,
    });

    expect(result.before).toStrictEqual({ status: "ACTIVE" });
    expect(result.droppedKeys).toStrictEqual(["detalle", "lista"]);
  });

  it("un texto largo se recorta Y se marca: un recorte silencioso seria una cita falsa", () => {
    const long = "a".repeat(AUDIT_DIFF_MAX_TEXT_LENGTH + 50);
    const result = redactDiff({ allow: ["nota"], before: { nota: long }, after: null });

    const kept = result.before?.nota;
    expect(typeof kept).toBe("string");
    const text = typeof kept === "string" ? kept : "";
    expect(text.length).toBeLessThan(long.length);
    expect(text).toContain("[truncado]");
    expect(result.truncatedKeys).toStrictEqual(["nota"]);
  });

  it("un decimal se descarta en vez de redondearse: redondear inventaria un dato", () => {
    // DEC-010 y la canonicalizacion de DEC-035 solo admiten enteros seguros.
    const result = redactDiff({
      allow: ["importe", "unidades"],
      before: { importe: 12.5, unidades: 3 },
      after: null,
    });

    expect(result.before).toStrictEqual({ unidades: 3 });
    expect(result.droppedKeys).toStrictEqual(["importe"]);
  });

  it("`null`, booleanos y enteros pasan tal cual", () => {
    const result = redactDiff({
      allow: ["a", "b", "c"],
      before: { a: null, b: true, c: -7 },
      after: null,
    });

    expect(result.before).toStrictEqual({ a: null, b: true, c: -7 });
  });
});
