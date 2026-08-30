import { describe, expect, it } from "vitest";

import {
  bonusCoversKind,
  normalizeEntryOffer,
  offerHasBonus,
  packageOfferOf,
  rateForKind,
} from "@/lib/entry-offer";
import { isSafeImageUrl, safeImageUrl } from "@/lib/media-url";
import { summaryOf } from "@/mocks/fixtures/catalog";
import { capProduct, package20, packageWithoutOffer } from "@/mocks/fixtures/catalog";
import {
  activeBonusPeriod,
  baseEntryOffer,
  bonusEntryOffer,
  partialEntryOffer,
  singleRateEntryOffer,
  uncappedEntryOffer,
  upcomingBonusPeriod,
} from "@/mocks/fixtures/promotions";

/**
 * Lectura de la oferta de participaciones (§13.5, DEC-052).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * No es que las funciones devuelvan lo esperado en el caso feliz: es que la
 * capa que separa "ausente" de "nulo" siga existiendo. El primer e2e contra la
 * API real (HO-039) demostro que un campo `[PROVISIONAL]` no llega como `null`
 * cuando el backend no lo conoce -no llega en absoluto-, y una comprobacion
 * contra `null` lo deja pasar por la rama del "si hay valor" para reventar en
 * el acceso siguiente. Con §13 a medio implementar, media docena de claves
 * estan en esa situacion.
 *
 * Y lo segundo que protege es lo que NO hacen: comparar dos cifras para decidir
 * si hay algo que explicar es legitimo; operar con ellas, no. La red
 * `no-client-entry-math.test.ts` vigila el codigo; esto vigila el
 * comportamiento.
 */

const NOW = "2026-08-29T12:00:00.000Z";

describe("normalizeEntryOffer", () => {
  it("una oferta ausente o nula se lee igual: no hay oferta", () => {
    expect(normalizeEntryOffer(null, NOW)).toBeNull();
    expect(normalizeEntryOffer(undefined, NOW)).toBeNull();
  });

  it("una oferta ANTERIOR a §13 no revienta y no inventa nada", () => {
    /*
     * Sin `caps_enabled`, sin `multipliers_enabled`, sin `active_bonus`, sin
     * `bonus_periods` y sin `amoe`. Es exactamente lo que sirve una API que
     * todavia no conoce §13.
     */
    const offer = normalizeEntryOffer(partialEntryOffer, NOW);

    expect(offer).not.toBeNull();
    expect(offer?.activeBonus).toBeNull();
    expect(offer?.upcomingBonuses).toEqual([]);
    expect(offer?.amoe).toBeNull();
    expect(offer?.perParticipantMax).toBeNull();
  });

  it("con los topes APAGADOS no publica el tope, aunque la oferta lo traiga", () => {
    /*
     * `entry_caps_enabled` es legalmente material: con el apagado el tope esta
     * declarado y el motor NO lo aplica, asi que anunciarlo seria decir algo
     * falso sobre como funciona la promocion.
     */
    expect(uncappedEntryOffer.per_participant_max, "el fixture trae la cifra").toBe(10000);

    const offer = normalizeEntryOffer(uncappedEntryOffer, NOW);

    expect(offer?.perParticipantMax).toBeNull();
    expect(offer?.capsEnabled).toBe(false);
  });

  it("separa el bonus VIGENTE de los ANUNCIADOS por identidad, no por fecha", () => {
    /*
     * Cual es el vigente lo decide el motor con la estrategia declarada, y
     * llega en `active_bonus`. Aqui solo se excluye de la lista de anunciados
     * para no decirlo dos veces: comparar fechas por nuestra cuenta haria
     * desaparecer del anuncio un periodo que el motor si aplica.
     */
    const offer = normalizeEntryOffer(bonusEntryOffer, NOW);

    expect(offer?.activeBonus?.id).toBe(activeBonusPeriod.id);
    expect(offer?.upcomingBonuses.map((period) => period.id)).toEqual([upcomingBonusPeriod.id]);
  });

  it("un instante ilegible no borra los anuncios", () => {
    // Perder el anuncio previo que exigen las Reglas por un formato de fecha
    // seria el peor de los dos fallos posibles.
    const offer = normalizeEntryOffer(bonusEntryOffer, "no es una fecha");

    expect(offer?.upcomingBonuses.map((period) => period.id)).toEqual([upcomingBonusPeriod.id]);
  });
});

describe("rateForKind", () => {
  it("con el modo por tipo, cada tipo tiene su tasa", () => {
    expect(rateForKind(baseEntryOffer.rates, "MERCHANDISE")?.entries_per_amount_unit).toEqual({
      numerator: 1,
      denominator: 1,
    });

    expect(rateForKind(baseEntryOffer.rates, "ENTRY_PACKAGE")?.entries_per_amount_unit).toEqual({
      numerator: 2,
      denominator: 1,
    });
  });

  it("con una tasa UNICA, la misma vale para los dos tipos", () => {
    // Es lo que publica §13.5 con `ENTRIES_PER_CURRENCY_UNIT`: una entrada con
    // `product_kind: null` que alcanza a todo el catalogo.
    expect(rateForKind(singleRateEntryOffer.rates, "MERCHANDISE")?.product_kind).toBeNull();
    expect(rateForKind(singleRateEntryOffer.rates, "ENTRY_PACKAGE")?.product_kind).toBeNull();
  });

  it("un tipo SIN tasa no hereda la del otro", () => {
    // Un tipo sin tasa no genera participaciones, y suponer la del otro seria
    // prometer una cifra que el motor no va a dar.
    const onlyPackages = baseEntryOffer.rates.filter(
      (rate) => rate.product_kind === "ENTRY_PACKAGE",
    );

    expect(rateForKind(onlyPackages, "MERCHANDISE")).toBeNull();
  });
});

describe("bonusCoversKind", () => {
  it("un ambito nulo alcanza a los dos tipos", () => {
    expect(bonusCoversKind(upcomingBonusPeriod, "MERCHANDISE")).toBe(true);
    expect(bonusCoversKind(upcomingBonusPeriod, "ENTRY_PACKAGE")).toBe(true);
  });

  it("un ambito de paquetes no alcanza a la mercancia", () => {
    expect(bonusCoversKind(activeBonusPeriod, "ENTRY_PACKAGE")).toBe(true);
    expect(bonusCoversKind(activeBonusPeriod, "MERCHANDISE")).toBe(false);
  });
});

describe("packageOfferOf", () => {
  it("la mercancia NO declara participaciones incluidas", () => {
    /*
     * Las Official Rules exigen declararlas en la pagina del PAQUETE. Para la
     * mercancia la cifra depende del subtotal del pedido entero, no del
     * articulo, y declararla ahi prometeria un resultado que el motor puede no
     * dar.
     */
    expect(packageOfferOf(summaryOf(capProduct))).toBeNull();
  });

  it("un paquete con oferta uniforme la declara", () => {
    const offer = packageOfferOf(summaryOf(package20));

    expect(offer?.base_entries).toBe(40);
    expect(offer?.entries_now).toBe(200);
  });

  it("un paquete SIN oferta publicada no dice ninguna cifra", () => {
    expect(packageOfferOf(summaryOf(packageWithoutOffer))).toBeNull();
  });

  it("`kind` ausente no cuenta como mercancia ni como paquete", () => {
    // `undefined` significa "no se sabe", y sin saberlo no se dice ninguna
    // cifra: suponerlo convertiria medio catalogo en paquetes por omision.
    const { kind, ...withoutKind } = summaryOf(package20);
    void kind;

    expect(packageOfferOf(withoutKind)).toBeNull();
  });

  it("un paquete con variantes que ofrecen cifras DISTINTAS se calla", () => {
    /*
     * No tiene UN numero de participaciones, tiene dos, y enseniar el de la
     * primera seria elegir por el comprador. La cifra se ve en la ficha, al
     * elegir variante.
     */
    const summary = summaryOf(package20);
    const first = summary.variants[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const mixed = {
      ...summary,
      variants: [
        first,
        {
          ...first,
          id: "var_otra",
          sku: "PKG-20-2",
          entry_offer:
            first.entry_offer === null || first.entry_offer === undefined
              ? null
              : { ...first.entry_offer, base_entries: 999, entries_now: 999 },
        },
      ],
    };

    expect(packageOfferOf(mixed)).toBeNull();
  });
});

describe("offerHasBonus", () => {
  it("sin multiplicador declarado no hay bonus que explicar", () => {
    /*
     * Si las dos cifras difirieran sin multiplicadores, la diferencia no
     * tendria explicacion que dar y la pantalla se callaria en vez de
     * inventarsela.
     */
    const offer = package20.variants[0]?.entry_offer;
    expect(offer).toBeDefined();
    if (offer === null || offer === undefined) return;

    expect(offerHasBonus({ ...offer, multiplier_ids: [] })).toBe(false);
  });

  it("con multiplicador y cifras distintas, hay bonus", () => {
    const offer = package20.variants[0]?.entry_offer;
    expect(offer).toBeDefined();
    if (offer === null || offer === undefined) return;

    expect(offerHasBonus(offer)).toBe(true);
  });

  it("con multiplicador y las MISMAS cifras, no se anuncia nada", () => {
    const offer = package20.variants[0]?.entry_offer;
    expect(offer).toBeDefined();
    if (offer === null || offer === undefined) return;

    expect(offerHasBonus({ ...offer, entries_now: offer.base_entries })).toBe(false);
  });
});

describe("isSafeImageUrl (§13.4, DEC-053)", () => {
  it("acepta https y rutas raiz del propio sitio", () => {
    expect(isSafeImageUrl("https://cdn.example.test/cap.jpg")).toBe(true);
    expect(isSafeImageUrl("/products/premium-cap.jpg")).toBe(true);
  });

  it("rechaza los esquemas que ejecutan o incrustan contenido de terceros", () => {
    /*
     * La API tambien lo valida al escribir, y la duplicidad es deliberada: la
     * validacion que importa es la del lado que construye el atributo.
     */
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isSafeImageUrl("http://example.test/cap.jpg")).toBe(false);
  });

  it("rechaza la URL de esquema relativo, que parece una ruta local", () => {
    // `//evil.example/cap.jpg` NO es una ruta del sitio: es una URL que hereda
    // el esquema de la pagina.
    expect(isSafeImageUrl("//evil.example/cap.jpg")).toBe(false);
    expect(isSafeImageUrl("/\\evil.example/cap.jpg")).toBe(false);
  });

  it("una cadena sin esquema no pasa por absoluta", () => {
    expect(isSafeImageUrl("products/cap.jpg")).toBe(false);
  });

  it("ausente, nulo y vacio se leen igual: no hay imagen", () => {
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
    expect(safeImageUrl("")).toBeNull();
  });
});
