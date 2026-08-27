/**
 * INVARIANTE: el entorno esta declarado, validado y endurecido.
 *
 * DEC-018 exige un esquema de entorno validado en el arranque. Para que eso
 * signifique algo, la lista de variables tiene que coincidir con la que se
 * documenta en `.env.example`: una variable que solo existe en el fichero de
 * ejemplo no la valida nadie, y una que solo existe en el registro no la
 * configura nadie.
 *
 * `.env.example` pertenece a `backend`. Este test no lo edita: lo contrasta. Si
 * falla porque se ha anadido una variable nueva, la correccion es declararla en
 * `packages/security/src/env/registry.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  ENV_REGISTRY,
  PRODUCTION_HARDENING_RULES,
  findUndeclaredNames,
  findUndocumentedNames,
  parseEnvFile,
  validateEnv,
} from "@lsw/security";

import { readRepoFile } from "../helpers/repo.js";

const entries = parseEnvFile(readRepoFile(".env.example"));
const documentedNames = entries.map((entry) => entry.name);

describe("esquema de entorno", () => {
  it("toda variable de .env.example esta declarada en el registro", () => {
    const undeclared = findUndeclaredNames(documentedNames);
    expect(
      undeclared,
      `Variables en .env.example sin declarar en packages/security/src/env/registry.ts:\n${undeclared.join(", ")}`,
    ).toStrictEqual([]);
  });

  it("toda variable declarada aparece en .env.example", () => {
    const undocumented = findUndocumentedNames(documentedNames);
    expect(
      undocumented,
      `Variables declaradas que .env.example no documenta:\n${undocumented.join(", ")}`,
    ).toStrictEqual([]);
  });

  it("ninguna variable declarada como secreta se sirve al navegador", () => {
    const leaked = ENV_REGISTRY.filter(
      (spec) => spec.secret && spec.name.startsWith("NEXT_PUBLIC_"),
    ).map((spec) => spec.name);
    expect(leaked).toStrictEqual([]);
  });

  it("ningun secreto de .env.example lleva un valor con forma de secreto real", () => {
    const secretNames = new Set(
      ENV_REGISTRY.filter((spec) => spec.secret).map((spec) => spec.name),
    );
    const suspicious = entries
      .filter((entry) => secretNames.has(entry.name) && entry.value !== "")
      .filter((entry) => !/FAKE|CHANGE_ME|PLACEHOLDER|EJEMPLO|EXAMPLE|localhost/i.test(entry.value))
      .map((entry) => `${entry.name} (linea ${String(entry.line)})`);

    expect(
      suspicious,
      `.env.example es publico y versionado. Estos valores no estan marcados como falsos:\n${suspicious.join("\n")}`,
    ).toStrictEqual([]);
  });

  it("la configuracion de desarrollo de .env.example es valida", () => {
    const source: Record<string, string> = {};
    for (const entry of entries) {
      source[entry.name] = entry.value;
    }
    const result = validateEnv(source, "development");
    const detail = result.issues.map((current) => `${current.name}: ${current.message}`).join("\n");
    expect(result.ok, `.env.example no pasa su propia validacion:\n${detail}`).toBe(true);
  });

  it("la misma configuracion NO seria valida en produccion", () => {
    const source: Record<string, string> = {};
    for (const entry of entries) {
      source[entry.name] = entry.value;
    }
    const result = validateEnv(source, "production");

    // No es un detalle: los valores comodos de desarrollo (cookie sin Secure,
    // TLS sin verificar, http) deben impedir el arranque en produccion.
    expect(result.ok).toBe(false);
    const hardening = result.issues.filter((issue) => issue.code === "PRODUCTION_HARDENING");
    expect(hardening.length).toBeGreaterThan(0);
  });
});

/**
 * DEC-043. El endurecimiento de TLS contra PostgreSQL dejo de ser una regla
 * unica: depende de por que red viaja la conexion. Lo que estos casos protegen
 * no es la rama nueva, sino que la excepcion no se derrame sobre la otra.
 */
describe("DEC-043: endurecimiento condicionado al camino de red", () => {
  const PRODUCTION_BASE: Record<string, string> = {
    SESSION_COOKIE_SECURE: "true",
    API_PUBLIC_URL: "https://api.ejemplo.invalid",
    WEB_ENABLE_API_MOCKS: "false",
  };

  function sslIssues(source: Record<string, string>): readonly string[] {
    return validateEnv({ ...PRODUCTION_BASE, ...source }, "production")
      .issues.filter(
        (issue) => issue.name === "DATABASE_SSL_MODE" && issue.code === "PRODUCTION_HARDENING",
      )
      .map((issue) => issue.message);
  }

  it("sin declarar la red, sigue exigiendo verify-full", () => {
    // El caso que de verdad importa: omitir DATABASE_NETWORK no puede apagar
    // el endurecimiento. Si esto se rompe, la excepcion de red privada se
    // convierte en el comportamiento por defecto sin que nadie lo escriba.
    expect(sslIssues({ DATABASE_SSL_MODE: "disable" })).toHaveLength(1);
    expect(sslIssues({ DATABASE_SSL_MODE: "require" })).toHaveLength(1);
    expect(sslIssues({ DATABASE_SSL_MODE: "verify-full" })).toHaveLength(0);
  });

  it("en red publica exige verify-full", () => {
    expect(sslIssues({ DATABASE_NETWORK: "public", DATABASE_SSL_MODE: "require" })).toHaveLength(1);
    expect(
      sslIssues({ DATABASE_NETWORK: "public", DATABASE_SSL_MODE: "verify-full" }),
    ).toHaveLength(0);
  });

  it("toda regla condicionada cubre TODOS los valores posibles de su condicion", () => {
    // El agujero que esto cierra: `checkHardening` no hace nada, en silencio,
    // cuando el valor condicionante no coincide con ninguna rama. Hoy es
    // inofensivo porque `allowedValues` y zod rechazan los valores no
    // previstos. Pero si alguien anade un tercer valor a DATABASE_NETWORKS sin
    // anadir su rama, el endurecimiento de TLS desaparece entero y ningun test
    // nombrado lo detecta: los de arriba prueban tres casos concretos, no
    // exhaustividad.
    const conditioned = PRODUCTION_HARDENING_RULES.filter((rule) => rule.appliesWhen !== undefined);
    expect(conditioned.length).toBeGreaterThan(0);

    const uncovered: string[] = [];

    for (const rule of conditioned) {
      const condition = rule.appliesWhen;
      if (condition === undefined) {
        continue;
      }

      const spec = ENV_REGISTRY.find((current) => current.name === condition.name);
      const values = spec?.allowedValues ?? [];

      // El caso "ausente" cuenta como un valor posible mas: omitir la variable
      // no puede apagar el endurecimiento.
      const cases: readonly (string | undefined)[] = [...values, undefined];

      for (const value of cases) {
        const covered = conditioned.some((candidate) => {
          const other = candidate.appliesWhen;
          if (other === undefined || candidate.name !== rule.name) {
            return false;
          }
          return value === undefined ? other.whenAbsent : other.equals === value;
        });

        if (!covered) {
          uncovered.push(`${rule.name} sin rama para ${condition.name}=${value ?? "(ausente)"}`);
        }
      }
    }

    expect(
      uncovered,
      `Reglas de endurecimiento con valores de condicion sin cubrir. Anadir un valor al enum sin anadir su rama apaga el endurecimiento en silencio:\n${uncovered.join("\n")}`,
    ).toStrictEqual([]);
  });

  it("en red privada exige disable y rechaza el TLS que no se verifica", () => {
    expect(sslIssues({ DATABASE_NETWORK: "private", DATABASE_SSL_MODE: "disable" })).toHaveLength(
      0,
    );
    for (const mode of ["require", "verify-ca", "verify-full"]) {
      expect(
        sslIssues({ DATABASE_NETWORK: "private", DATABASE_SSL_MODE: mode }),
        `DATABASE_SSL_MODE=${mode} deberia ser rechazado sobre red privada`,
      ).toHaveLength(1);
    }
  });
});
