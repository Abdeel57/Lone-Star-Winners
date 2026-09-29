/**
 * Imagenes de catalogo subidas desde el panel (DEC-056, seccion 14 del contrato).
 *
 * ---------------------------------------------------------------------------
 * QUE SE PRUEBA AQUI Y QUE NO
 * ---------------------------------------------------------------------------
 * Igual que `admin-catalog.test.ts`: se inyecta en la aplicacion REAL y se lee
 * lo que sale por el cable. Lo que se sustituye es el REPOSITORIO. Lo que
 * impone el motor -el tope de 5 MiB por CHECK, la unicidad de `sha256`, que
 * `lsw_app` no pueda UPDATE ni DELETE- es de `packages/database`.
 *
 * ---------------------------------------------------------------------------
 * LOS INVARIANTES QUE ESTE ARCHIVO VIGILA
 * ---------------------------------------------------------------------------
 *   1. El tipo de una imagen lo decide LA FIRMA DE SUS BYTES. Lo que no empiece
 *      como un JPEG, un PNG o un WebP no se guarda, se llame como se llame.
 *   2. SVG no entra: es un documento que puede llevar script.
 *   3. La ruta devuelta tiene la forma que el CHECK de `image_url` ya admite.
 *   4. Una imagen tiene UNA direccion: `<id>.png` sobre un JPEG es 404.
 *   5. La respuesta binaria no pasa por el serializador JSON y va `immutable`.
 *   6. Un cuerpo por encima del limite de la ruta es 413 con envelope, no 500;
 *      y el limite ampliado es SOLO de esta ruta.
 */

import { createHash } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import type * as MediaModule from "../src/services/media.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const ASSET_ID = "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d";
const ADMIN_USER_ID = "44444444-4444-4444-8444-444444444444";

/** `vi.mock` se eleva sobre los imports, asi que el estado va en `vi.hoisted`. */
const shared: { repository: unknown } = vi.hoisted(() => ({ repository: null }));

// Solo se sustituye la fabrica del repositorio. El resto del modulo -la lectura
// de la firma, el base64 estricto, la forma de la ruta- es justo lo que se
// quiere probar, y tiene que ser el de verdad.
vi.mock("../src/services/media.js", async (importOriginal) => ({
  ...(await importOriginal<typeof MediaModule>()),
  createMediaRepository: () => shared.repository,
}));

vi.mock("../src/http/require-staff.js", () => ({
  requireStaffContext: () =>
    Promise.resolve({
      principal: { actor: { type: "ADMIN", adminUserId: ADMIN_USER_ID }, scope: "STAFF" },
      roles: [],
      secondsSinceLastMfa: 10,
      adminUserId: ADMIN_USER_ID,
    }),
}));

// ---------------------------------------------------------------------------
// Fixtures: cabeceras reales de cada formato, con relleno detras.
// ---------------------------------------------------------------------------

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
]);

interface ErrorBody {
  readonly error: { readonly code: string };
}

interface StoredInput {
  readonly contentType: string;
  readonly content: Buffer;
  readonly sha256: string;
  readonly uploadedByAdminUserId: string | null;
}

function storingRepository(): { readonly stored: StoredInput[]; readonly repository: unknown } {
  const stored: StoredInput[] = [];
  return {
    stored,
    repository: {
      store: (input: StoredInput) => {
        stored.push(input);
        return Promise.resolve({
          id: ASSET_ID,
          contentType: input.contentType,
          byteSize: input.content.length,
          sha256: input.sha256,
        });
      },
      find: () => Promise.resolve(null),
    },
  };
}

function buildDependencies(): AppDependencies {
  return {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies;
}

/** App con el autorizador ABIERTO. La postura por defecto se prueba aparte. */
async function appAllowingPermissions(): Promise<FastifyInstance> {
  const app = await createApp(buildDependencies());
  app.lswAuthorizer = () => ({ allowed: true });
  return app;
}

// Sin tipo de retorno anotado: `inject` esta sobrecargado, y
// `ReturnType<typeof app.inject>` elige la firma sin argumentos -la cadena
// fluida-, no la que devuelve la respuesta.
function upload(app: FastifyInstance, bytes: Buffer) {
  return app.inject({
    method: "POST",
    url: "/api/v1/admin/media",
    payload: { data_base64: bytes.toString("base64") },
  });
}

beforeEach(() => {
  shared.repository = null;
});

// ---------------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------------

describe("POST /admin/media", () => {
  it.each([
    ["JPEG", JPEG, "image/jpeg", "jpg"],
    ["PNG", PNG, "image/png", "png"],
    ["WebP", WEBP, "image/webp", "webp"],
  ])("guarda un %s y devuelve una ruta raiz del sitio", async (_label, bytes, type, extension) => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await appAllowingPermissions();

    const response = await upload(app, bytes);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: ASSET_ID,
      url: `/media/${ASSET_ID}.${extension}`,
      content_type: type,
      byte_size: bytes.length,
    });

    // La misma forma que exige el CHECK de `products.image_url` (migracion 0026).
    expect(response.json<{ url: string }>().url).toMatch(/^\/[^/\s]\S*$/u);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.contentType).toBe(type);
    expect(stored[0]?.content.equals(bytes)).toBe(true);
    expect(stored[0]?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(stored[0]?.uploadedByAdminUserId).toBe(ADMIN_USER_ID);
  });

  it("rechaza un SVG: es un documento que puede llevar script", async () => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await appAllowingPermissions();

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const response = await upload(app, svg);

    expect(response.statusCode).toBe(415);
    expect(response.json<ErrorBody>().error.code).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(stored).toHaveLength(0);
  });

  it("rechaza un HTML aunque el cliente jure que es una imagen", async () => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/media",
      // Un `content_type` declarado no forma parte del contrato y se IGNORA: el
      // tipo sale de los bytes.
      payload: {
        data_base64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
        content_type: "image/png",
      },
    });

    expect(response.statusCode).toBe(415);
    expect(stored).toHaveLength(0);
  });

  it("rechaza base64 mal formado con 422, sin guardar lo que Node consiga decodificar", async () => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/media",
      payload: { data_base64: "/9j/4AAQ$$$$" },
    });

    expect(response.statusCode).toBe(422);
    expect(stored).toHaveLength(0);
  });

  it("un cuerpo por encima del limite de la ruta es 413 con envelope, no 500", async () => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await appAllowingPermissions();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/media",
      payload: { data_base64: "A".repeat(8_000_000) },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json<ErrorBody>().error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(stored).toHaveLength(0);
  });

  it("el limite ampliado es SOLO de esta ruta", async () => {
    shared.repository = storingRepository().repository;
    const app = await appAllowingPermissions();

    // 2 MB cabe de sobra en `/admin/media` y no en ninguna otra: subir el limite
    // global para que quepa una foto abriria el login a cuerpos de varios megas.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "a@example.com", password: "x".repeat(2_000_000) },
    });

    expect(response.statusCode).toBe(413);
  });

  it("sin permiso no se sube nada (postura por defecto)", async () => {
    const { stored, repository } = storingRepository();
    shared.repository = repository;
    const app = await createApp(buildDependencies());
    app.lswAuthorizer = ({ authorization }) =>
      authorization.kind === "PUBLIC"
        ? { allowed: true }
        : { allowed: false, reason: "UNAUTHENTICATED" };

    const response = await upload(app, JPEG);

    expect(response.statusCode).toBe(401);
    expect(stored).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

describe("GET /media/:file", () => {
  const sha256 = createHash("sha256").update(JPEG).digest("hex");

  function repositoryWithJpeg(): unknown {
    return {
      store: () => Promise.reject(new Error("no se esperaba una subida")),
      find: (id: string) =>
        Promise.resolve(
          id === ASSET_ID
            ? { id, contentType: "image/jpeg", byteSize: JPEG.length, sha256, content: JPEG }
            : null,
        ),
    };
  }

  /** La lectura es publica: se prueba con el autorizador que deniega lo demas. */
  async function publicApp(): Promise<FastifyInstance> {
    const app = await createApp(buildDependencies());
    app.lswAuthorizer = ({ authorization }) =>
      authorization.kind === "PUBLIC"
        ? { allowed: true }
        : { allowed: false, reason: "UNAUTHENTICATED" };
    return app;
  }

  it("sirve los bytes tal cual, sin sesion, con su tipo y cache inmutable", async () => {
    shared.repository = repositoryWithJpeg();
    const app = await publicApp();

    const response = await app.inject({ method: "GET", url: `/api/v1/media/${ASSET_ID}.jpg` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers.etag).toBe(`"${sha256}"`);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload.equals(JPEG)).toBe(true);
  });

  it("una imagen tiene UNA direccion: otra extension es 404", async () => {
    shared.repository = repositoryWithJpeg();
    const app = await publicApp();

    const response = await app.inject({ method: "GET", url: `/api/v1/media/${ASSET_ID}.png` });

    expect(response.statusCode).toBe(404);
  });

  it.each(["gorra.jpg", `${ASSET_ID}.svg`, ASSET_ID, `${ASSET_ID.toUpperCase()}.jpg`])(
    "un nombre sin forma de <uuid>.<ext> es 404 sin consultar nada: %s",
    async (file) => {
      const find = vi.fn(() => Promise.resolve(null));
      shared.repository = { find };
      const app = await publicApp();

      const response = await app.inject({ method: "GET", url: `/api/v1/media/${file}` });

      expect(response.statusCode).toBe(404);
      expect(find).not.toHaveBeenCalled();
    },
  );

  it("una imagen que no existe es 404 con el envelope de siempre", async () => {
    shared.repository = { find: () => Promise.resolve(null) };
    const app = await publicApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/media/6e6e6e6e-6e6e-4e6e-8e6e-6e6e6e6e6e6e.jpg",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe("NOT_FOUND");
  });

  it("con If-None-Match vigente responde 304 sin cuerpo", async () => {
    shared.repository = repositoryWithJpeg();
    const app = await publicApp();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/media/${ASSET_ID}.jpg`,
      headers: { "if-none-match": `"${sha256}"` },
    });

    expect(response.statusCode).toBe(304);
    expect(response.rawPayload.length).toBe(0);
  });
});
