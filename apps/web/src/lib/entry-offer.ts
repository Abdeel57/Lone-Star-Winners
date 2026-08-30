import type {
  BonusPeriod,
  EntryOffer,
  EntryOfferAmoeSummary,
  EntryRate,
  ProductKind,
  ProductSummary,
  VariantEntryOffer,
} from "@/lib/api";

/**
 * Lectura de la oferta de participaciones de una promocion (§13.5, DEC-052).
 *
 * POR QUE EXISTE ESTA CAPA
 * ------------------------
 * Es la misma razon que justifica `@/lib/amoe-config`: el contrato declara
 * campos que la API real todavia no publica -backend implementa §13 en
 * paralelo (HO-041)- y la diferencia entre "ausente" y "nulo" no puede decidir
 * si la portada se ve o revienta. Si cada pantalla comparase con `=== null`, un
 * `undefined` se colaria por la rama del "si hay valor" y el acceso siguiente
 * lanzaria: es exactamente el fallo que el primer e2e real encontro con
 * `prize.name` (HO-039).
 *
 * Aqui ausente y nulo significan lo mismo -no hay dato- y eso se decide UNA vez.
 *
 * LO QUE ESTA CAPA NO HACE, Y NO PUEDE HACER
 * ------------------------------------------
 * No multiplica, no suma, no resta y no compara cifras de participaciones. Ni
 * siquiera "para ir enseñando algo": la unica aritmetica valida sobre
 * participaciones es la del motor, sobre el carrito de servidor (DEC-023,
 * requisito R13 de `security`, red `no-client-entry-math.test.ts`).
 *
 * Lo unico que compara son INSTANTES, para separar los periodos bonus vigentes
 * de los anunciados. Eso no es una cifra de participaciones y ademas la
 * pertenencia real la decide el backend: `active_bonus` llega ya resuelto con
 * la estrategia declarada, y esta capa solo lo distingue de los futuros para
 * poder anunciarlos por separado, que es lo que exigen las Reglas.
 */

/** Oferta con sus ausencias resueltas. */
export interface NormalizedEntryOffer {
  readonly rulesVersionId: string | null;
  /** Tasas declaradas, en el orden que llegan. Vacia si no hay ninguna. */
  readonly rates: readonly EntryRate[];
  /**
   * Tope POR PARTICIPANTE, y solo si los topes estan encendidos.
   *
   * `caps_enabled` es un flag legalmente material: con el apagado, el tope
   * existe en la configuracion y NO se aplica, asi que anunciarlo seria decir
   * algo falso sobre como funciona la promocion. Cuando el campo no llega -API
   * anterior a §13- se trata como ENCENDIDO, porque el tope solo se publica si
   * la version de reglas lo declara y el caso seguro es enseñar el limite, no
   * ocultarlo.
   */
  readonly perParticipantMax: number | null;
  readonly perOrderMax: number | null;
  readonly capsEnabled: boolean;
  readonly multipliersEnabled: boolean;
  /** Periodo vigente de mayor valor, ya resuelto por el backend. */
  readonly activeBonus: BonusPeriod | null;
  /** Periodos anunciables que todavia no han empezado. */
  readonly upcomingBonuses: readonly BonusPeriod[];
  readonly amoe: EntryOfferAmoeSummary | null;
}

export function normalizeEntryOffer(
  offer: EntryOffer | null | undefined,
  nowIso: string,
): NormalizedEntryOffer | null {
  if (offer === null || offer === undefined) return null;

  const capsEnabled = offer.caps_enabled ?? true;
  const periods = offer.bonus_periods ?? [];
  const activeBonus = offer.active_bonus ?? null;

  return {
    rulesVersionId: offer.rules_version_id ?? null,
    rates: offer.rates ?? [],
    // El tope solo se publica si los topes estan encendidos: ver arriba.
    perParticipantMax: capsEnabled ? (offer.per_participant_max ?? null) : null,
    perOrderMax: capsEnabled ? (offer.per_order_max ?? null) : null,
    capsEnabled,
    multipliersEnabled: offer.multipliers_enabled ?? true,
    activeBonus,
    upcomingBonuses: upcomingPeriods(periods, activeBonus, nowIso),
    amoe: offer.amoe ?? null,
  };
}

/**
 * Periodos que todavia NO han empezado.
 *
 * El backend ya filtra por `ends_at > ahora`, asi que la lista que llega mezcla
 * el vigente con los futuros. Se separan porque se anuncian distinto: uno esta
 * pasando y el otro esta prometido, y decirlos con la misma frase confundiria
 * las dos cosas.
 *
 * El vigente se excluye por IDENTIDAD y no por fecha: cual es el vigente lo
 * decide el motor con la estrategia de conflicto declarada, y esta capa no
 * vuelve a decidirlo. Una fecha mal comparada aqui haria desaparecer del
 * anuncio un periodo que el motor si aplica.
 *
 * Una fecha ilegible NO descarta el periodo: se anuncia igual. Perder el
 * anuncio previo que exigen las Reglas por un formato de fecha seria el peor de
 * los dos fallos posibles.
 */
function upcomingPeriods(
  periods: readonly BonusPeriod[],
  activeBonus: BonusPeriod | null,
  nowIso: string,
): readonly BonusPeriod[] {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return periods.filter((period) => period.id !== activeBonus?.id);

  return periods.filter((period) => {
    if (period.id === activeBonus?.id) return false;

    const starts = Date.parse(period.starts_at);
    if (Number.isNaN(starts)) return true;

    return starts > now;
  });
}

/**
 * Tasa que corresponde a un tipo de producto.
 *
 * Con el modo de tasa UNICA (`ENTRIES_PER_CURRENCY_UNIT`) llega una sola
 * entrada con `product_kind: null`, que vale para todo el catalogo. Con el modo
 * por tipo, hay una entrada por tipo con tasa declarada y un tipo SIN tasa
 * sencillamente no aparece: eso significa que no genera participaciones, y la
 * pantalla no dice ninguna cifra en vez de suponer la del otro tipo.
 */
export function rateForKind(
  rates: readonly EntryRate[],
  kind: ProductKind | undefined,
): EntryRate | null {
  const universal = rates.find((rate) => rate.product_kind === null);
  if (universal !== undefined) return universal;
  if (kind === undefined) return null;

  return rates.find((rate) => rate.product_kind === kind) ?? null;
}

/**
 * Si un periodo bonus alcanza a un tipo de producto.
 *
 * `null` en el ambito significa TODOS. Con `sku_scope` presente la pertenencia
 * real es la interseccion de los dos, y esta funcion no la resuelve: sirve para
 * ETIQUETAR el anuncio ("5X en paquetes"), no para decidir cuantas
 * participaciones da una compra, que es del motor.
 */
export function bonusCoversKind(period: BonusPeriod, kind: ProductKind): boolean {
  const scope = period.product_kind_scope;
  return scope === null || scope === undefined || scope.includes(kind);
}

/**
 * La oferta de una variante, con sus ausencias resueltas.
 *
 * Devuelve `null` en el mismo caso en el que el backend manda `null`: no hay
 * promocion activa, no hay version de reglas, el tipo no tiene tasa o el
 * producto no es elegible. La tarjeta y la ficha entonces NO dicen ninguna
 * cifra, que es la unica respuesta correcta.
 */
export function variantOffer(
  offer: VariantEntryOffer | null | undefined,
): VariantEntryOffer | null {
  return offer ?? null;
}

/**
 * Si hay que anunciar `entries_now` ademas de `base_entries`.
 *
 * SE COMPARAN DOS CIFRAS, NO SE OPERA CON ELLAS. Es la misma distincion que ya
 * hace el panel del carrito con `final_entries` y `entries_before_caps`: una
 * comparacion decide si hace falta explicar por que una cifra subio; una resta
 * seria una segunda implementacion del motor.
 *
 * Ademas exige que el backend declare al menos un multiplicador aplicado: si
 * las dos cifras difirieran sin multiplicadores, la diferencia no tendria
 * explicacion que dar y la pantalla se callaria en vez de inventarsela.
 */
export function offerHasBonus(offer: VariantEntryOffer): boolean {
  if (offer.multiplier_ids.length === 0) return false;
  return offer.entries_now !== offer.base_entries;
}

/**
 * La oferta de un PAQUETE, cuando se puede declarar sin ambiguedad.
 *
 * DOS CONDICIONES, Y LAS DOS SON NECESARIAS:
 *
 * 1. **El producto es un paquete.** Las Official Rules exigen que "el numero de
 *    participaciones incluido se declare en la pagina donde se ofrece el
 *    paquete"; para la mercancia no existe esa obligacion y la cifra depende
 *    del subtotal del pedido entero, no del articulo. Declararla en una tarjeta
 *    de mercancia seria prometer un resultado que el motor puede no dar.
 * 2. **Todas sus variantes ofrecen LO MISMO.** Un paquete con dos variantes de
 *    valor distinto no tiene UN numero de participaciones, tiene dos, y enseñar
 *    el de la primera seria elegir por el comprador. En ese caso la tarjeta se
 *    calla y la cifra se ve en la ficha, al elegir variante.
 *
 * `kind` AUSENTE NO ES "MERCANCIA": es "no se sabe", y sin saberlo no se dice
 * ninguna cifra. La API anterior a §13 no publica el campo, y suponerlo
 * convertiria cada producto en un paquete o en mercancia por omision.
 *
 * Las dos cifras se COMPARAN para decidir si son la misma oferta; no se operan.
 */
export function packageOfferOf(product: ProductSummary): VariantEntryOffer | null {
  if (product.kind !== "ENTRY_PACKAGE") return null;

  const offers = product.variants
    .map((variant) => variant.entry_offer ?? null)
    .filter((offer): offer is VariantEntryOffer => offer !== null);

  const first = offers.at(0);
  if (first === undefined) return null;
  if (offers.length !== product.variants.length) return null;

  const uniform = offers.every(
    (offer) => offer.base_entries === first.base_entries && offer.entries_now === first.entries_now,
  );

  return uniform ? first : null;
}
