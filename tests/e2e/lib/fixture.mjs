/**
 * El escenario que siembra `seed/seed-e2e.mjs`, en un solo sitio.
 *
 * Lo que es CONSTANTE (slugs, correos, la contrasena falsa) se declara aqui,
 * porque tanto la semilla como las pruebas lo necesitan y dos copias acabarian
 * divergiendo. Lo que se GENERA en cada ejecucion (identificadores, el secreto
 * TOTP del personal) viaja por un fichero temporal, nunca por el repositorio.
 *
 * SOBRE LA CONTRASENA DE ESTE FICHERO
 * -----------------------------------
 * Lleva `FAKE` en el valor a proposito, y no por estilo: `.gitleaks.toml`
 * permite explicitamente los valores marcados asi, y el gate de higiene de
 * `.github/workflows/security.yml` usa el mismo criterio. Una contrasena de
 * test versionada sigue siendo una contrasena versionada; lo unico que la hace
 * aceptable es que sea IMPOSIBLE confundirla con una real y que solo exista en
 * una base de datos efimera que se destruye con el job.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Fichero por el que la semilla pasa a las pruebas lo que ha generado.
 *
 * Fuera del arbol del repositorio a proposito: un artefacto generado dentro de
 * `tests/e2e/` ensuciaria `git status` y podria acabar en un commit ajeno, que
 * es exactamente el fallo que `apps/web/scripts/smoke.mjs` documenta con su
 * lista `NEXT_MANAGED_FILES`.
 */
export const FIXTURE_FILE = process.env.E2E_FIXTURE_FILE ?? join(tmpdir(), "lsw-e2e-fixture.json");

/** Base del navegador. La declara el job de CI; el valor de aqui es el de local. */
export const WEB_BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3310";

/** Base de la API, para las comprobaciones que van directas al backend. */
export const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:4310/api/v1";

/**
 * Contrasenas del escenario. FALSAS y evidentes.
 *
 * `MINIMUM_PASSWORD_LENGTH` de `@lsw/security` son 12 caracteres; estas los
 * superan con holgura para que la politica no sea lo que falle.
 */
export const FAKE_PARTICIPANT_PASSWORD = "FAKE-e2e-participant-2026";
export const FAKE_STAFF_PASSWORD = "FAKE-e2e-staff-2026";

/**
 * Correos del escenario.
 *
 * TLD `.invalid` (RFC 2606): no existe y no puede existir, asi que ninguna de
 * estas direcciones puede recibir correo por accidente. Es el mismo criterio
 * que usa `packages/database/src/seed/dev-seed.ts`.
 */
export const PARTICIPANT_EMAIL = "e2e.participante@example.invalid";
export const PROMOTION_MANAGER_EMAIL = "e2e.promotion.manager@example.invalid";
export const COMPLIANCE_OFFICER_EMAIL = "e2e.compliance.officer@example.invalid";

/** Catalogo y promocion sembrados. */
export const PROMOTION_SLUG = "e2e-promocion";
export const PRODUCT_SLUG = "e2e-camiseta";
export const PRODUCT_SKU = "E2E-TEE-001";

/**
 * Precio unitario del producto, en unidades menores (DEC-010: entero + moneda,
 * nunca coma flotante).
 */
export const PRODUCT_PRICE_MINOR = 2500n;
export const PRODUCT_CURRENCY = "USD";

/** Nombres publicos del producto y de la promocion, por locale. */
export const PRODUCT_NAME = {
  "en-US": "E2E Fixture Tee",
  "es-US": "Camiseta de prueba E2E",
};

export const PROMOTION_TITLE = {
  "en-US": "E2E Fixture Promotion",
  "es-US": "Promocion de prueba E2E",
};

/** Claves de los campos que pide el formulario AMOE del escenario. */
export const AMOE_FIELD_KEYS = ["full_name", "email"];

/**
 * Lee el fichero que dejo la semilla.
 *
 * Falla ruidosamente si no esta: una prueba que continua con identificadores
 * `undefined` produce un error tres pasos mas adelante, en el sitio equivocado.
 */
export async function readFixture() {
  const { readFile } = await import("node:fs/promises");

  let raw;
  try {
    raw = await readFile(FIXTURE_FILE, "utf8");
  } catch (error) {
    throw new Error(
      `No existe el fichero de escenario ${FIXTURE_FILE}. Ejecuta antes \`node tests/e2e/seed/seed-e2e.mjs\`. Causa: ${String(error)}`,
    );
  }

  return JSON.parse(raw);
}
