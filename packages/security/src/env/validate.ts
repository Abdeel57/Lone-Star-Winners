/**
 * Validacion del entorno.
 *
 * DEC-018: si falta una variable o es invalida, el proceso NO arranca.
 * `assertEnv` lanza; no existe un modo "avisa y sigue". Un servicio de
 * sweepstakes que arranca con la configuracion a medias acaba escribiendo en el
 * ledger con valores que nadie eligio.
 */

import { ENV_REGISTRY, ENV_REGISTRY_BY_NAME, PRODUCTION_HARDENING_RULES } from "./registry.js";
import type { EnvIssue, EnvName, EnvValidationResult, EnvVarSpec } from "./spec.js";

export type EnvSource = Readonly<Record<string, string | undefined>>;

const BOOLEANS = new Set(["true", "false"]);
const INTEGER_PATTERN = /^-?\d+$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const POSTGRES_PREFIXES = ["postgres://", "postgresql://"];

/** Tope duro de DEC-006 para la ventana de step-up. */
const STEP_UP_HARD_LIMIT_SECONDS = 300;

function issue(name: string, code: EnvIssue["code"], message: string): EnvIssue {
  return { name, code, message };
}

function validateValue(spec: EnvVarSpec, value: string): EnvIssue | null {
  switch (spec.kind) {
    case "integer":
      return INTEGER_PATTERN.test(value)
        ? null
        : issue(spec.name, "INVALID_INTEGER", "Debe ser un entero.");
    case "boolean":
      return BOOLEANS.has(value)
        ? null
        : issue(spec.name, "INVALID_BOOLEAN", "Debe ser exactamente 'true' o 'false'.");
    case "url":
      return URL.canParse(value) ? null : issue(spec.name, "INVALID_URL", "No es una URL valida.");
    case "postgres_url":
      return POSTGRES_PREFIXES.some((prefix) => value.startsWith(prefix))
        ? null
        : issue(
            spec.name,
            "INVALID_POSTGRES_URL",
            "Debe empezar por postgres:// o postgresql:// (DEC-003).",
          );
    case "email":
      return EMAIL_PATTERN.test(value)
        ? null
        : issue(spec.name, "INVALID_EMAIL", "No es una direccion de correo valida.");
    case "enum":
    case "string":
    case "cron":
    case "path":
      return null;
  }
}

function checkHardening(source: EnvSource, environment: EnvName): readonly EnvIssue[] {
  const issues: EnvIssue[] = [];
  for (const rule of PRODUCTION_HARDENING_RULES) {
    if (!rule.appliesTo.includes(environment)) {
      continue;
    }
    // DEC-043: reglas cuyo valor correcto depende de otra variable.
    if (rule.appliesWhen !== undefined) {
      const condition = source[rule.appliesWhen.name];
      const active =
        condition === undefined || condition === ""
          ? rule.appliesWhen.whenAbsent
          : condition === rule.appliesWhen.equals;
      if (!active) {
        continue;
      }
    }
    const value = source[rule.name];
    if (value === undefined || value === "") {
      continue;
    }
    const violated =
      (rule.requirement === "MUST_EQUAL" && value !== rule.value) ||
      (rule.requirement === "MUST_NOT_EQUAL" && value === rule.value) ||
      (rule.requirement === "MUST_NOT_CONTAIN" && value.includes(rule.value)) ||
      (rule.requirement === "MUST_START_WITH" && !value.startsWith(rule.value));
    if (violated) {
      issues.push(
        issue(
          rule.name,
          "PRODUCTION_HARDENING",
          `${rule.requirement} '${rule.value}' en ${environment}. ${rule.rationale}`,
        ),
      );
    }
  }
  return issues;
}

export function validateEnv(source: EnvSource, environment: EnvName): EnvValidationResult {
  const issues: EnvIssue[] = [];

  for (const spec of ENV_REGISTRY) {
    const raw = source[spec.name];
    const required = spec.requiredIn.includes(environment);

    if (raw === undefined) {
      if (required) {
        issues.push(issue(spec.name, "MISSING", `Obligatoria en ${environment}. ${spec.notes}`));
      }
      continue;
    }
    if (raw === "") {
      if (required) {
        issues.push(issue(spec.name, "EMPTY", `Obligatoria en ${environment} y llega vacia.`));
      }
      continue;
    }

    if (spec.secret && spec.name.startsWith("NEXT_PUBLIC_")) {
      issues.push(
        issue(
          spec.name,
          "SECRET_EXPOSED_TO_BROWSER",
          "Una variable NEXT_PUBLIC_ se sirve al navegador y no puede ser un secreto.",
        ),
      );
    }

    if (spec.allowedValues !== null && !spec.allowedValues.includes(raw)) {
      issues.push(
        issue(spec.name, "INVALID_ENUM", `Valores admitidos: ${spec.allowedValues.join(", ")}.`),
      );
      continue;
    }

    const kindIssue = validateValue(spec, raw);
    if (kindIssue !== null) {
      issues.push(kindIssue);
    }
  }

  // DEC-006: la ventana de step-up es un tope duro, no una preferencia.
  const stepUp = source.STEP_UP_MAX_AGE_SECONDS;
  if (stepUp !== undefined && INTEGER_PATTERN.test(stepUp)) {
    const seconds = Number.parseInt(stepUp, 10);
    if (seconds > STEP_UP_HARD_LIMIT_SECONDS || seconds <= 0) {
      issues.push(
        issue(
          "STEP_UP_MAX_AGE_SECONDS",
          "PRODUCTION_HARDENING",
          `Debe estar entre 1 y ${String(STEP_UP_HARD_LIMIT_SECONDS)} segundos (DEC-006).`,
        ),
      );
    }
  }

  issues.push(...checkHardening(source, environment));

  return { environment, ok: issues.length === 0, issues };
}

export class EnvValidationError extends Error {
  public readonly issues: readonly EnvIssue[];

  public constructor(result: EnvValidationResult) {
    const detail = result.issues
      .map((current) => `  - ${current.name} [${current.code}]: ${current.message}`)
      .join("\n");
    super(`Configuracion de entorno invalida para '${result.environment}':\n${detail}`);
    this.name = "EnvValidationError";
    this.issues = result.issues;
  }
}

/** Uso en el arranque: si algo falla, no se arranca. */
export function assertEnv(source: EnvSource, environment: EnvName): void {
  const result = validateEnv(source, environment);
  if (!result.ok) {
    throw new EnvValidationError(result);
  }
}

/** Nombres presentes en un fichero de entorno que nadie ha declarado. */
export function findUndeclaredNames(names: Iterable<string>): readonly string[] {
  const undeclared: string[] = [];
  for (const name of names) {
    if (!ENV_REGISTRY_BY_NAME.has(name)) {
      undeclared.push(name);
    }
  }
  return undeclared;
}

/** Nombres declarados que un fichero de entorno no documenta. */
export function findUndocumentedNames(names: Iterable<string>): readonly string[] {
  const documented = new Set(names);
  return ENV_REGISTRY.filter((spec) => !documented.has(spec.name)).map((spec) => spec.name);
}
