import { describe, expect, it } from "vitest";

import {
  API_PATHS,
  fetchActivePromotion,
  fetchCart,
  fetchProducts,
  fetchPromotions,
  fetchSiteConfig,
} from "@/lib/api";
import { scenarios } from "@/mocks/handlers";
import { mockApiServer } from "@/mocks/node";

/**
 * Capa de API contra MSW.
 *
 * Estos tests no comprueban el backend (que no existe): comprueban que la capa
 * de adaptacion se comporta bien ante cada forma de respuesta, incluidas las
 * que hoy nadie ha contratado todavia. Es lo que permite sustituir el
 * adaptador por el cliente generado desde OpenAPI (DEC-014) y saber que la
 * interfaz sigue reaccionando igual.
 */

describe("fetchActivePromotion", () => {
  it("devuelve la promocion cuando la hay", async () => {
    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.status).toBe("ACTIVE");
    // DEC-010: el importe viaja como CADENA de digitos en unidad menor, nunca
    // como numero. Es lo que impide que un importe grande pierda precision al
    // pasar por `JSON.parse`.
    expect(typeof result.data?.prize_value?.amount_minor).toBe("string");
    expect(result.data?.prize_value?.amount_minor).toMatch(/^-?[0-9]+$/);
    // DEC-011: la promocion declara su zona horaria legal.
    expect(result.data?.legal_timezone).toBe("America/Chicago");
  });

  it("trata el 404 como 'no hay promocion abierta', no como error", async () => {
    mockApiServer.use(scenarios.noActivePromotion());

    const result = await fetchActivePromotion("es");

    // Entre promociones no hay ninguna activa. Eso es un estado vacio, no un
    // fallo: pintarlo como error asustaria al participante sin motivo.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("propaga codigo y request_id de un error del servidor", async () => {
    mockApiServer.use(scenarios.serverError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    expect(result.error.status).toBe(500);
    expect(result.error.code).toBe("INTERNAL_ERROR");
    // El `request_id` es lo unico que permite a soporte encontrar el fallo.
    expect(result.error.requestId).toBe("req_mock_000000000000");
  });

  it("acepta el envelope sin `message_key` y no reintroduce el campo (DEC-031)", async () => {
    // DEC-031 elimina `message_key` del contrato: `code` es la unica clave.
    // Un envelope que solo trae `code` es VALIDO, no malformado.
    mockApiServer.use(scenarios.serverError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("http");
    expect(result.error.code).toBe("INTERNAL_ERROR");
    // Si alguien reintrodujera `messageKey`, este test lo delata.
    expect(Object.keys(result.error)).not.toContain("messageKey");
  });

  it("distingue una respuesta que no respeta el envelope de DEC-022", async () => {
    mockApiServer.use(scenarios.malformedError(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // No es un error de dominio: es un defecto del backend, y hay que poder
    // verlo como tal en lugar de disfrazarlo de error de negocio.
    expect(result.error.kind).toBe("malformed");
    expect(result.error.code).toBeNull();
  });

  it("no lanza excepciones cuando no hay red", async () => {
    mockApiServer.use(scenarios.networkFailure(API_PATHS.activePromotion));

    const result = await fetchActivePromotion("en");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
    expect(result.error.status).toBeNull();
  });
});

describe("fetchSiteConfig", () => {
  it("devuelve la configuracion publica", async () => {
    const result = await fetchSiteConfig("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.supported_locales).toEqual(["en-US", "es-US"]);
  });
});

describe("catalogo y paginacion por cursor", () => {
  it("el listado de promociones llega como pagina, no como lista suelta", async () => {
    // El contrato pagina por cursor: `{ items, next_cursor }`. Si esto volviera
    // a ser `{ promotions: [...] }`, la interfaz dejaria de compilar en un solo
    // sitio en vez de romperse en la pantalla.
    const result = await fetchPromotions("en", { limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Array.isArray(result.data.items)).toBe(true);
    expect(result.data).toHaveProperty("next_cursor");
  });

  it("el catalogo NO declara cuantas participaciones da un producto", async () => {
    // Seccion 4 del contrato: la formula pertenece a la version de reglas
    // (DEC-012). Si el numero viviera en el producto, editar el catalogo
    // cambiaria retroactivamente lo que significo una compra pasada.
    const result = await fetchProducts("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const product of result.data.items) {
      expect(product).not.toHaveProperty("entries");
      expect(product).not.toHaveProperty("entries_per_unit");

      // Lo que SI trae es elegibilidad ya evaluada, y con procedencia.
      if (product.entry_eligibility !== null) {
        expect(product.entry_eligibility.evaluated_against_rules_version_id.length).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("el catalogo publica `availability` POR VARIANTE y ya no `stock_quantity`", async () => {
    // El catalogo es ANONIMO y publicaba el inventario exacto en crudo mientras
    // el carrito, que va con sesion, deliberadamente no lo hacia: una de las dos
    // superficies estaba mal y se resolvio hacia la que no filtra (seccion 4,
    // HO-017).
    const result = await fetchProducts("en");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.length).toBeGreaterThan(0);

    for (const product of result.data.items) {
      expect(product).not.toHaveProperty("stock_quantity");
      // La disponibilidad es de la VARIANTE. No hay estado agregado del
      // producto: la tarjeta lo deriva a la vista.
      expect(product).not.toHaveProperty("availability");
      expect(product.variants.length).toBeGreaterThan(0);

      for (const variant of product.variants) {
        expect(variant).not.toHaveProperty("stock_quantity");
        expect(variant).not.toHaveProperty("quantity_available");
        // `is_purchasable` -"¿esta a la venta?"- sigue pendiente (HO-017) y NO
        // se deduce de la disponibilidad. Consumirlo antes de que exista es lo
        // que dejo la pantalla del carrito sin poder pintar una linea.
        expect(variant).not.toHaveProperty("is_purchasable");

        expect(variant.availability).not.toBeTypeOf("string");
        expect(Object.keys(variant.availability)).toEqual(["status"]);
        expect(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]).toContain(variant.availability.status);
      }
    }
  });
});

describe("carrito sin sesion", () => {
  it("un 401 llega como estado de dominio, no como excepcion", async () => {
    // Es el comportamiento REAL del backend hoy: las cinco rutas de carrito son
    // `PARTICIPANT_SELF` y la identidad la resuelve `packages/security`
    // (DEC-006). La capa de API no puede tratarlo como un fallo de infra: la
    // pantalla necesita distinguirlo para decir "inicia sesion".
    mockApiServer.use(scenarios.cartUnauthenticated());

    const result = await fetchCart("en", { cookie: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("http");
    expect(result.error.status).toBe(401);
    expect(result.error.code).toBe("UNAUTHENTICATED");
  });

  it("con sesion devuelve el carrito PLANO y su cotizacion en la misma respuesta", async () => {
    const result = await fetchCart("en", { cookie: "lsw_session=example" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // LA FORMA IMPORTA, y este test existe porque llego a no importar: la capa
    // esperaba `{ cart: {...}, entry_quote }` y la ruta devuelve el carrito
    // PLANO (`docs/API_CONTRACT.md` seccion 5). La pantalla no podia pintar ni
    // una linea contra la API real y ningun test lo veia, porque el fixture
    // tenia la forma equivocada tambien (HO-034 punto 2).
    expect(result.data).not.toHaveProperty("cart");
    expect(result.data).toHaveProperty("id");
    expect(result.data).toHaveProperty("currency");
    expect(result.data).toHaveProperty("updated_at");
    expect(result.data).toHaveProperty("item_count");
    expect(result.data).toHaveProperty("lines");
    expect(result.data).toHaveProperty("subtotal");
    expect(result.data).toHaveProperty("entry_quote");
  });

  it("el carrito vacio trae `item_count` a CERO y `updated_at` a `null`", async () => {
    // Los dos nulables del carrito vacio dicen cosas distintas y el contrato es
    // explicito en ambas: `item_count` es CERO -contar cero cosas es cero, no
    // "no se sabe"- y `updated_at` es `null` porque no existe fila que fechar.
    // Invertirlos seria afirmar que un carrito inexistente acaba de cambiar.
    const result = await fetchCart("en", { cookie: "lsw_session=example" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.lines).toHaveLength(0);
    expect(result.data.item_count).toBe(0);
    expect(result.data.updated_at).toBeNull();
    expect(result.data.currency).toBeNull();
    expect(result.data.subtotal).toBeNull();
  });

  it("`item_count` cuenta UNIDADES y llega del servidor, no de las lineas", async () => {
    mockApiServer.use(scenarios.cartWithLines());

    const result = await fetchCart("en", { cookie: "lsw_session=example" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Dos lineas, tres unidades. Si la interfaz contara `lines.length` diria
    // dos, y si el backend paginara las lineas diria menos todavia: la cifra
    // correcta es la que publica el servidor.
    expect(result.data.lines).toHaveLength(2);
    expect(result.data.item_count).toBe(3);
    expect(result.data.updated_at).toEqual(expect.any(String));
  });

  it("`availability` es un OBJETO con `status` y sin cantidad de existencias", async () => {
    mockApiServer.use(scenarios.cartWithAvailability());

    const result = await fetchCart("en", { cookie: "lsw_session=example" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.lines.map((line) => line.availability.status)).toEqual([
      "IN_STOCK",
      "LOW_STOCK",
      "OUT_OF_STOCK",
    ]);

    for (const line of result.data.lines) {
      // La forma importa: `availability` es objeto y no cadena justo para que se
      // le pueda anadir un campo el dia que se decida. Hoy solo lleva `status`,
      // y la CANTIDAD EXACTA no se publica (HO-017 pidio que no).
      expect(line.availability).not.toBeTypeOf("string");
      expect(Object.keys(line.availability)).toEqual(["status"]);
      expect(line.availability).not.toHaveProperty("quantity_available");

      // Hoy es siempre `null` porque no hay tabla de medios. Un fixture con URL
      // haria pasar una rama que contra la API real no se recorre.
      expect(line.image_url).toBeNull();
    }

    // Y la linea que no se puede servir hoy NO desaparece de la cotizacion: que
    // la mercancia no entregable de participaciones es una pregunta legal
    // abierta, y responderla desde el cliente seria inventarla.
    const outOfStock = result.data.lines[2];
    expect(outOfStock).toBeDefined();
    expect(result.data.entry_quote?.eligible_items.map((item) => item.line_id)).toContain(
      outOfStock?.id,
    );
  });

  it("las lineas traen los campos que el contrato publica, con `id` y `line_subtotal`", async () => {
    mockApiServer.use(scenarios.cartWithLines());

    const result = await fetchCart("en", { cookie: "lsw_session=example" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const line = result.data.lines[0];
    expect(line).toBeDefined();
    if (line === undefined) return;

    // `id`, no `line_id`: es la misma identidad que usa la cotizacion en
    // `ineligible_items[].line_id`, y es lo que permite decir QUE linea no
    // cuenta.
    expect(line.id).toEqual(expect.any(String));
    expect(result.data.entry_quote?.ineligible_items.map((item) => item.line_id)).toContain(
      result.data.lines[1]?.id,
    );

    expect(line).toHaveProperty("line_subtotal");
    expect(line).toHaveProperty("name");
    expect(line).toHaveProperty("image_url");
    expect(line).toHaveProperty("availability");
    expect(line).not.toHaveProperty("line_total");
    expect(line).not.toHaveProperty("product_name");
  });
});
