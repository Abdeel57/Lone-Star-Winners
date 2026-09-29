// @vitest-environment node
//
// ENTORNO `node` Y NO EL `jsdom` POR DEFECTO, a proposito. Una Server Action
// corre en Node, y lo que recibe es el `File` de Node -el de `undici`-, que
// tiene `arrayBuffer()`. El `File` de jsdom no lo tiene: con jsdom este test
// fallaria por una carencia del simulador de navegador que en produccion no
// existe, y arreglarla en el codigo seria escribir una rama solo para el test.

import { http, HttpResponse, type JsonBodyType } from "msw";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      toString: () => "lsw_dev_session_staff=Bd4kM9tXr6ZaP1wQ7nJc2sF5hL8gV3eY-uRiO_pCz0T",
      set: () => undefined,
    }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

import { IDLE } from "@/lib/action-result";
import { createProductAction, updateProductAction, updateVariantAction } from "@/lib/admin/actions";
import {
  ADMIN_MEDIA_MAX_BYTES,
  adminProductPath,
  adminProductVariantPath,
  API_PATHS,
  apiBaseUrl,
} from "@/lib/api";
import { adminProducts } from "@/mocks/fixtures/admin";
import { mockApiServer } from "@/mocks/node";

/**
 * LAS FOTOS DEL CATALOGO SALEN DEL DISPOSITIVO (§14, DEC-056).
 *
 * Lo que se comprueba es lo que SALE POR EL CABLE hacia la API:
 *
 *   1. El fichero del formulario se sube a `POST /admin/media` en base64, y la
 *      ruta que devuelve es la que viaja como `image_url`.
 *   2. En una EDICION sin tocar la foto, `image_url` NO viaja: la API deja la que
 *      habia. Es lo que permite no repetir la ruta actual en un campo oculto.
 *   3. "Quitar la imagen" manda `image_url: null`.
 *   4. Un fichero que no es imagen, o que pesa de mas, no gasta la subida ni
 *      llega a crear nada.
 *   5. Las fotos se suben LO ULTIMO: un formulario invalido no deja imagenes
 *      guardadas que nadie va a usar.
 */

const BASE = apiBaseUrl().replace(/\/+$/, "");

const UPLOADED_URL = "/media/5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d.jpg";

/** Cabecera JPEG y relleno. La firma la valida la API, no esta capa. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function jpeg(name = "gorra.jpg"): File {
  return new File([JPEG_BYTES], name, { type: "image/jpeg" });
}

function formWith(entries: Readonly<Record<string, string | File>>): FormData {
  const formData = new FormData();
  formData.set("locale", "es");
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}

function capture(
  method: "post" | "patch",
  path: string,
  body: JsonBodyType,
): { readonly bodies: unknown[] } {
  const bodies: unknown[] = [];
  const url = `${BASE}${path}`;

  mockApiServer.use(
    method === "post"
      ? http.post(url, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(body, { status: 201 });
        })
      : http.patch(url, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(body, { status: 200 });
        }),
  );

  return { bodies };
}

function captureUpload(): { readonly bodies: unknown[] } {
  return capture("post", API_PATHS.adminMedia, {
    id: "5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d",
    url: UPLOADED_URL,
    content_type: "image/jpeg",
    byte_size: JPEG_BYTES.length,
  });
}

const NEW_PRODUCT = {
  sku: "GORRA-LS-001",
  slug: "gorra-lone-star",
  currency: "USD",
  name_es: "Gorra Lone Star",
  name_en: "Lone Star Cap",
  price: "25.00",
  kind: "MERCHANDISE",
} as const;

function firstProduct(): (typeof adminProducts)[number] {
  const product = adminProducts[0];
  if (product === undefined) throw new Error("fixture");
  return product;
}

describe("createProductAction con foto", () => {
  it("sube el fichero en base64 y manda la ruta devuelta como image_url", async () => {
    const uploads = captureUpload();
    const products = capture("post", API_PATHS.adminProducts, firstProduct());

    await createProductAction(IDLE, formWith({ ...NEW_PRODUCT, image_file: jpeg() })).catch(
      () => undefined,
    );

    expect(uploads.bodies).toEqual([{ data_base64: Buffer.from(JPEG_BYTES).toString("base64") }]);
    expect(products.bodies[0]).toMatchObject({ image_url: UPLOADED_URL });
  });

  it("sin foto el alta manda image_url null y no sube nada", async () => {
    const uploads = captureUpload();
    const products = capture("post", API_PATHS.adminProducts, firstProduct());

    // Un input de fichero SIN seleccion llega asi: un `File` vacio y sin nombre.
    const empty = new File([], "", { type: "application/octet-stream" });

    await createProductAction(IDLE, formWith({ ...NEW_PRODUCT, image_file: empty })).catch(
      () => undefined,
    );

    expect(uploads.bodies).toHaveLength(0);
    expect(products.bodies[0]).toMatchObject({ image_url: null });
  });

  it("la foto de cada variante viaja en su variante", async () => {
    const uploads = captureUpload();
    const products = capture("post", API_PATHS.adminProducts, firstProduct());

    await createProductAction(
      IDLE,
      formWith({
        ...NEW_PRODUCT,
        variant_count: "2",
        variant_0_name_es: "Rojo",
        variant_0_name_en: "Red",
        variant_0_price: "25.00",
        variant_1_name_es: "Azul",
        variant_1_name_en: "Blue",
        variant_1_price: "25.00",
        variant_1_image_file: jpeg("azul.jpg"),
      }),
    ).catch(() => undefined);

    expect(uploads.bodies).toHaveLength(1);

    const sent = products.bodies[0] as { variants: Record<string, unknown>[] };
    expect(sent.variants[0]).not.toHaveProperty("image_url");
    expect(sent.variants[1]).toMatchObject({ image_url: UPLOADED_URL });
  });

  it("un fichero que no es imagen no se sube ni crea nada", async () => {
    const uploads = captureUpload();
    const products = capture("post", API_PATHS.adminProducts, firstProduct());

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "ficha.pdf", {
      type: "application/pdf",
    });

    const result = await createProductAction(IDLE, formWith({ ...NEW_PRODUCT, image_file: pdf }));

    expect(result).toMatchObject({
      status: "error",
      code: "MEDIA_TYPE_UNSUPPORTED",
      field: "image_file",
    });
    expect(uploads.bodies).toHaveLength(0);
    expect(products.bodies).toHaveLength(0);
  });

  it("una imagen por encima del tope no se sube", async () => {
    const uploads = captureUpload();

    const huge = new File([new Uint8Array(ADMIN_MEDIA_MAX_BYTES + 1)], "enorme.jpg", {
      type: "image/jpeg",
    });

    const result = await createProductAction(IDLE, formWith({ ...NEW_PRODUCT, image_file: huge }));

    expect(result).toMatchObject({ code: "MEDIA_TOO_LARGE", field: "image_file" });
    expect(uploads.bodies).toHaveLength(0);
  });

  it("una variante con un fichero invalido impide subir TAMBIEN la foto del producto", async () => {
    const uploads = captureUpload();

    const result = await createProductAction(
      IDLE,
      formWith({
        ...NEW_PRODUCT,
        image_file: jpeg(),
        variant_count: "1",
        variant_0_name_es: "Rojo",
        variant_0_name_en: "Red",
        variant_0_price: "25.00",
        variant_0_image_file: new File(["<svg/>"], "rojo.svg", { type: "image/svg+xml" }),
      }),
    );

    expect(result).toMatchObject({
      code: "MEDIA_TYPE_UNSUPPORTED",
      field: "variant_0_image_file",
    });
    expect(uploads.bodies).toHaveLength(0);
  });

  it("un formulario invalido no deja ninguna imagen subida", async () => {
    const uploads = captureUpload();

    const result = await createProductAction(
      IDLE,
      formWith({ ...NEW_PRODUCT, price: "25.999", image_file: jpeg() }),
    );

    expect(result).toMatchObject({ code: "PRICE_INVALID" });
    expect(uploads.bodies).toHaveLength(0);
  });

  it("si la API rechaza la foto, el error se atribuye al campo del fichero", async () => {
    mockApiServer.use(
      http.post(`${BASE}${API_PATHS.adminMedia}`, () =>
        HttpResponse.json(
          { error: { code: "MEDIA_TYPE_UNSUPPORTED", request_id: "req_media_1" } },
          { status: 415 },
        ),
      ),
    );
    const products = capture("post", API_PATHS.adminProducts, firstProduct());

    const result = await createProductAction(
      IDLE,
      formWith({ ...NEW_PRODUCT, image_file: jpeg() }),
    );

    expect(result).toMatchObject({
      status: "error",
      code: "MEDIA_TYPE_UNSUPPORTED",
      field: "image_file",
      requestId: "req_media_1",
    });
    expect(products.bodies).toHaveLength(0);
  });
});

describe("updateProductAction con foto", () => {
  const product = firstProduct();

  const EDIT = {
    product_id: product.id,
    name_es: "Gorra Lone Star",
    name_en: "Lone Star Cap",
    price: "25.00",
  } as const;

  it("sin tocar la foto, image_url NO viaja: la API conserva la que habia", async () => {
    const uploads = captureUpload();
    const patches = capture("patch", adminProductPath(product.id), product);

    const result = await updateProductAction(IDLE, formWith(EDIT));

    expect(result.status).toBe("ok");
    expect(uploads.bodies).toHaveLength(0);
    expect(patches.bodies[0]).not.toHaveProperty("image_url");
  });

  it("con foto nueva, image_url es la ruta subida", async () => {
    captureUpload();
    const patches = capture("patch", adminProductPath(product.id), product);

    await updateProductAction(IDLE, formWith({ ...EDIT, image_file: jpeg() }));

    expect(patches.bodies[0]).toMatchObject({ image_url: UPLOADED_URL });
  });

  it('"quitar la imagen" manda image_url null', async () => {
    const patches = capture("patch", adminProductPath(product.id), product);

    await updateProductAction(IDLE, formWith({ ...EDIT, image_remove: "on" }));

    expect(patches.bodies[0]).toMatchObject({ image_url: null });
  });

  it("con foto nueva Y quitar marcado gana la foto", async () => {
    captureUpload();
    const patches = capture("patch", adminProductPath(product.id), product);

    await updateProductAction(IDLE, formWith({ ...EDIT, image_file: jpeg(), image_remove: "on" }));

    expect(patches.bodies[0]).toMatchObject({ image_url: UPLOADED_URL });
  });
});

describe("updateVariantAction con foto", () => {
  it("la foto de una variante sigue el mismo camino", async () => {
    const product = adminProducts.find((candidate) => (candidate.variants?.length ?? 0) > 0);
    const variant = product?.variants?.[0];
    if (product === undefined || variant === undefined) throw new Error("fixture");

    captureUpload();
    const patches = capture("patch", adminProductVariantPath(product.id, variant.id), variant);

    const result = await updateVariantAction(
      IDLE,
      formWith({
        product_id: product.id,
        variant_id: variant.id,
        name_es: "Rojo",
        name_en: "Red",
        price: "25.00",
        image_file: jpeg(),
      }),
    );

    expect(result.status).toBe("ok");
    expect(patches.bodies[0]).toMatchObject({ image_url: UPLOADED_URL });
  });
});
