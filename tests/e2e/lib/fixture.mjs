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

/**
 * Participante que YA llega cerca del tope (HO-041).
 *
 * Existe para poder comprobar el recorte de DEC-052 punto 5 sin tener que
 * fabricar 9,000 participaciones desde la interfaz en cada ejecucion. Es una
 * persona distinta de `PARTICIPANT_EMAIL` a proposito: si compartieran cuenta,
 * el resto de los recorridos empezaria con el saldo casi lleno y cualquier
 * concesion posterior saldria recortada por un motivo que la prueba no estaria
 * midiendo.
 */
export const CAP_PARTICIPANT_EMAIL = "e2e.tope@example.invalid";

/** Catalogo y promocion sembrados. */
export const PROMOTION_SLUG = "e2e-promocion";
export const PRODUCT_SLUG = "e2e-camiseta";
export const PRODUCT_SKU = "E2E-TEE-001";

/**
 * Paquete de participaciones (DEC-052).
 *
 * Es un producto mas del catalogo -mismo carrito, mismo checkout, mismo
 * reembolso- cuya UNICA particularidad es el tipo. Ninguna columna del producto
 * dice cuantas participaciones da: eso lo dice la version de reglas, y por eso
 * el numero esperado de esta suite se deriva de la tasa, no del producto.
 */
export const PACKAGE_SLUG = "e2e-paquete-10";
export const PACKAGE_SKU = "E2E-PKG-10";
export const PACKAGE_PRICE_MINOR = 1000n;
export const PACKAGE_CATEGORY_KEY = "entry-packages";

export const PACKAGE_NAME = {
  "en-US": "E2E $10 Entry Package",
  "es-US": "Paquete de participaciones E2E de $10",
};

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

/**
 * CIFRAS ESPERADAS DEL ESCENARIO.
 *
 * Se declaran aqui, DERIVADAS de la configuracion que siembra `seed-e2e.mjs`,
 * y no se recalculan en cada prueba: una prueba que multiplicara precio por
 * tasa seria una segunda implementacion del motor viviendo en la suite, y
 * entonces comprobaria que su copia coincide consigo misma. Aqui son
 * constantes escritas a mano contra las que se compara lo que devuelve el
 * backend.
 *
 * Siguen siendo valores de FIXTURE. La tasa real la fija el abogado; estas
 * reproducen la FORMA del borrador v2 (1 por $1 en mercancia, 2 por $1 en
 * paquete) para que el recorrido tenga algo que comprobar.
 */
export const PACKAGE_BASE_ENTRIES = 20; // $10.00 a 2 por dolar
export const MERCHANDISE_BASE_ENTRIES = 25; // $25.00 a 1 por dolar
export const BONUS_MULTIPLIER = 5;
export const PACKAGE_ENTRIES_WITH_BONUS = PACKAGE_BASE_ENTRIES * BONUS_MULTIPLIER; // 100

/** Tope por participante que declara la version de reglas del escenario. */
export const PER_PARTICIPANT_MAX = 10_000;

/** Saldo con el que nace `CAP_PARTICIPANT_EMAIL`, y el hueco que le queda. */
export const CAP_SEEDED_ENTRIES = 9_000;
export const CAP_REMAINING_ENTRIES = PER_PARTICIPANT_MAX - CAP_SEEDED_ENTRIES; // 1,000

/** Configuracion AMOE postal del escenario (modalidad `MAIL_IN_REVIEW`). */
export const AMOE_ENTRIES_PER_CARD = 2_000;
export const AMOE_MAX_CARDS_PER_PARTICIPANT = 5;
export const AMOE_CARDS_PER_ENVELOPE = 2;

/**
 * Claves de los campos que pide la ficha postal, en el orden de la seccion 13.2.
 *
 * Son SIETE porque el borrador v2 pide siete datos manuscritos. La suite las usa
 * para comprobar que el formulario y la cola los piden todos, y para construir
 * el cuerpo de la transcripcion.
 */
export const AMOE_FIELD_KEYS = [
  "full_name",
  "mailing_address",
  "email",
  "phone",
  "date_of_birth",
  "signature_present",
  "postmark_date",
];

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
