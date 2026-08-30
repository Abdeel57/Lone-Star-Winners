import { Alert, buttonVariants, cn, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { MerchandiseBand } from "@/components/merchandise-band";
import { SectionHeading } from "@/components/section-heading";
import { ShopFilters } from "@/components/shop-filters";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  fetchActivePromotion,
  fetchProductCategories,
  fetchProducts,
  fetchPromotion,
  PRODUCT_KINDS,
  type BonusPeriod,
  type ProductCategory,
  type ProductKind,
  type ProductListQuery,
} from "@/lib/api";
import { normalizeEntryOffer } from "@/lib/entry-offer";
import { isFeatureEnabled } from "@/lib/flags";
import { loadFeatureFlags } from "@/lib/flags-server";

/**
 * Render por peticion, siempre (DEC-013).
 *
 * El catalogo declara elegibilidad respecto de la promocion vigente. Si esta
 * pagina se prerenderizara en el build, esas insignias quedarian CONGELADAS en
 * el HTML y seguirian diciendo "forma parte de la promocion" despues de que la
 * promocion cerrara.
 */
export const dynamic = "force-dynamic";

/** Tamano de pagina. Solicitud al backend, no un tope del cliente. */
const PAGE_SIZE = 24;

/**
 * Catalogo de mercancia elegible.
 *
 * QUE SE COMPRA Y QUE SE OTORGA
 * -----------------------------
 * Lo que se adquiere en esta pagina es MERCANCIA. Que esa compra pueda otorgar
 * participaciones promocionales lo determinan las Official Rules, y esta
 * pantalla lo dice sin prometer ninguna cifra. En ningun sitio del storefront
 * hay un numero de participaciones: el unico que existe lo produce el backend
 * sobre el carrito de servidor (DEC-023, requisito R13 de `security`).
 *
 * PAGINACION POR CURSOR, Y POR ESO NO HAY NUMEROS DE PAGINA
 * ---------------------------------------------------------
 * El contrato pagina por cursor y el cursor es opaco. Con un cursor no se sabe
 * cuantas paginas hay ni se puede saltar a la quinta, asi que la interfaz
 * ofrece "ver mas" como ENLACE -no como boton con estado de cliente-: la
 * siguiente pagina es una URL, se puede compartir y funciona sin JavaScript.
 *
 * El precio de esa honestidad es que "ver mas" navega en vez de anadir a la
 * lista. Es el comportamiento correcto para un cursor: acumular en cliente
 * obligaria a mantener en memoria una lista que el servidor ya no garantiza que
 * siga siendo la misma.
 *
 * ---------------------------------------------------------------------------
 * DOS BANDAS (DEC-039)
 * ---------------------------------------------------------------------------
 * La pagina se parte en dos superficies con proposito distinto:
 *
 *   1. **Cabecera OSCURA.** Titulo, entradilla, filtros y el aviso de "no hay
 *      promocion vigente". Es contexto: dice donde estas y sobre que se filtra.
 *   2. **Rejilla sobre BANDA CLARA.** Solo producto.
 *
 * Los filtros se quedan arriba, en el oscuro, y no dentro de la banda clara. No
 * es una comodidad de implementacion -aunque tambien evita repintar `Select` y
 * `FormField` en una segunda paleta-: la banda clara existe para que la
 * mercancia se lea limpia, y un formulario dentro de ella es la primera cosa
 * que rompe eso. En la referencia, la seccion blanca es rejilla y nada mas.
 *
 * CUANDO HAY BANDA, Y CUANDO NO
 * -----------------------------
 * Si la consulta FUNCIONO hay banda, con articulos o sin ellos: el estado vacio
 * se compone dentro, en paleta clara. La version anterior la pintaba solo con
 * resultados, y como el esqueleto de carga si la dibuja siempre, un catalogo
 * vacio producia el salto -blanco de golpe a negro- que el esqueleto existe
 * para evitar (hallazgo M5).
 *
 * Si la consulta FALLO no hay banda. No es una excepcion a la regla anterior
 * sino la misma regla: sin respuesta no hay superficie de mercancia que pintar,
 * y una banda blanca vacia con un cartel de error dentro seria decoracion
 * alrededor de una averia.
 */
export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const query = await searchParams;

  const cursor = singleParam(query.cursor);
  const category = singleParam(query.category);
  const kind = kindParam(query.kind);

  const request: ProductListQuery = {
    limit: PAGE_SIZE,
    ...(cursor === null ? {} : { cursor }),
    ...(category === null ? {} : { category }),
    ...(kind === null ? {} : { kind }),
  };

  /*
   * CUATRO LECTURAS EN PARALELO, Y SOLO UNA PUEDE TUMBAR LA PAGINA.
   *
   * El catalogo es el contenido; si falla, no hay tienda que pintar. Las otras
   * tres son adorno con distinto grado: las categorias alimentan el filtro, y
   * la promocion mas su detalle sirven para poder NOMBRAR el bonus que produjo
   * las cifras de los paquetes. Un fallo en cualquiera de ellas degrada -menos
   * filtro, menos frase- y no rompe.
   */
  const [result, categoriesResult, promotionResult, flags] = await Promise.all([
    fetchProducts(locale, request),
    fetchProductCategories(locale),
    fetchActivePromotion(locale),
    loadFeatureFlags(locale),
  ]);

  const categories: readonly ProductCategory[] = categoriesResult.ok
    ? categoriesResult.data.items
    : [];

  /*
   * EL BONUS VIGENTE, PARA PODER NOMBRARLO EN LAS TARJETAS.
   *
   * Las cifras de cada paquete -`base_entries` y `entries_now`- vienen ya
   * calculadas por el backend en el propio catalogo. Lo que NO viene ahi es
   * como se llama el periodo que produjo la diferencia ni cuando termina, y sin
   * eso la tarjeta solo puede decir "ahora N" sin explicar por que.
   *
   * Es informacion ADICIONAL y su peticion es de mejor esfuerzo: si la
   * promocion o su detalle fallan, las tarjetas siguen pintando las dos cifras.
   * Y solo se pide si la promocion declara version de reglas, por la misma
   * razon que en la banda de anuncio (DEC-044).
   */
  const promotion = promotionResult.ok ? promotionResult.data : null;
  const rulesVersionId = promotion?.rules_version_id ?? null;
  const bonus =
    promotion === null || rulesVersionId === null
      ? null
      : await fetchActiveBonus(promotion.slug, promotion.legal_timezone, locale, flags);

  /*
   * Los articulos, o ninguno.
   *
   * Se resuelve ANTES del marcado porque tres decisiones distintas dependen de
   * la misma respuesta -si hay aviso de "sin promocion", si hay banda clara y
   * si hay rejilla- y encadenarlas dentro del JSX obligaria a repetir el mismo
   * `result.ok` en tres sitios.
   */
  const items = result.ok ? result.data.items : [];

  /*
   * Entre promociones el catalogo sigue en pie, pero ningun articulo trae
   * elegibilidad.
   *
   * El aviso de la cabecera y el chip de cada tarjeta dicen cosas distintas y
   * por eso conviven: el aviso explica LA SITUACION -no hay promocion abierta,
   * nada de lo que se pida hoy queda asociado a una, la tienda sigue abierta- y
   * el chip declara el ESTADO DE ESE ARTICULO. El chip tiene que estar en la
   * tarjeta porque la misma tarjeta se usa en la portada, donde no hay ninguna
   * cabecera que lo explique. Lo que si se corrigio (hallazgo F1) es su peso:
   * era la insignia mas ruidosa de la rejilla -relleno solido, y ademas en
   * paleta oscura- y ahora es la mas discreta, que es lo que corresponde al
   * estado normal entre promociones.
   */
  const noPromotion =
    items.length > 0 && items.every((product) => product.entry_eligibility === null);

  /** Si hay algun filtro activo. Decide que estado vacio se pinta. */
  const filtered = category !== null || kind !== null;

  return (
    <div className="pb-s16">
      {/* Cabecera de la tienda sobre atmosfera: es la segunda pantalla mas
          visitada del sitio y necesita entrada propia, no un titulo suelto
          encima de una rejilla (DEC-038). Lleva ademas los filtros y el aviso
          de promocion: es la banda de CONTEXTO. */}
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container">
          <SectionHeading
            eyebrow={t("nav.shop")}
            title={t("shop.title")}
            lead={t("shop.intro")}
            level="h1"
            size="lg"
          />

          {!result.ok ? null : (
            <div className="mt-s8 flex flex-col gap-s5">
              <ShopFilters
                action={`/${locale}/shop`}
                categories={categories}
                selectedCategory={category}
                selectedKind={kind}
                locale={locale}
              />

              {/* La seccion de paquetes se explica una vez, arriba, y no en cada
                  tarjeta: que es un paquete de participaciones y que existe un
                  metodo gratuito equivalente son afirmaciones de la promocion,
                  no del articulo. El texto remite a las Reglas Oficiales y no
                  promete ninguna cifra. */}
              {kind === "ENTRY_PACKAGE" ? (
                <Alert tone="info" className="max-w-narrow">
                  {t("shop.entryPackagesNotice")}
                </Alert>
              ) : null}

              {noPromotion ? (
                <Alert tone="info" className="max-w-narrow">
                  {t("shop.noPromotionNotice")}
                </Alert>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {!result.ok ? (
        <div className="lsw-container pt-s10">
          <ApiErrorState failure={result.error} headingLevel="h2" />
        </div>
      ) : (
        /* BANDA CLARA (DEC-039): a partir de aqui todo es `light-*`. */
        <MerchandiseBand
          products={items}
          locale={locale}
          bonus={bonus}
          empty={
            <EmptyState
              headingLevel="h2"
              tone="light"
              title={filtered ? t("shop.empty.title") : t("shop.catalogEmpty.title")}
              description={filtered ? t("shop.empty.body") : t("shop.catalogEmpty.body")}
              action={
                !filtered ? undefined : (
                  // `ink` y no `secondary`, igual que el "ver mas": este estado
                  // vive DENTRO de la banda desde DEC-039, y el contorno dorado
                  // de `secondary` sobre blanco da 2,3:1.
                  <Link href="/shop" className={cn(buttonVariants({ variant: "ink" }))}>
                    {t("shop.clear")}
                  </Link>
                )
              }
            />
          }
          footer={
            result.data.next_cursor === null ? undefined : (
              <div className="mt-s10 flex justify-center">
                <Link
                  href={`/shop?${nextPageQuery(result.data.next_cursor, category, kind)}`}
                  // `ink` y no `secondary`: sobre el blanco de la banda, el
                  // contorno dorado de `secondary` da 2,3:1 y su texto tambien.
                  className={cn(buttonVariants({ variant: "ink", size: "lg" }))}
                >
                  {t("shop.loadMore")}
                </Link>
              </div>
            )
          }
        />
      )}
    </div>
  );
}

/**
 * Un parametro de query que solo tiene sentido una vez.
 *
 * `?cursor=a&cursor=b` llega como array. Se descarta en vez de coger el primero:
 * una peticion asi no la produce esta interfaz, y adivinar cual vale seria
 * inventarse la intencion.
 */
function singleParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * El tipo de producto pedido en la URL, comprobado contra el enum.
 *
 * SE COMPARA CON LA LISTA DEL CONTRATO y no se acepta cualquier texto: la API
 * responde 422 a un valor desconocido (§13.4), y mandarselo convertiria una URL
 * mal escrita -o pegada a mano- en un error de pantalla en vez de en el
 * catalogo completo, que es la respuesta razonable.
 */
function kindParam(value: string | string[] | undefined): ProductKind | null {
  const raw = singleParam(value);
  if (raw === null) return null;

  return PRODUCT_KINDS.find((kind) => kind === raw) ?? null;
}

/**
 * Periodo bonus vigente de la promocion, con su zona legal.
 *
 * DOS CERROJOS ANTES DE NOMBRARLO: el flag `entry_multipliers_enabled` leido en
 * servidor (DEC-013) y el que declara la propia oferta. Con cualquiera de los
 * dos apagado no se nombra ningun bonus, aunque el backend siga publicando el
 * periodo: un "5X" que el motor no aplica es una afirmacion falsa sobre lo que
 * vale una compra.
 *
 * Devuelve `null` ante cualquier fallo. Es informacion adicional: sin ella la
 * tarjeta sigue pintando las dos cifras que le llegan del catalogo.
 */
async function fetchActiveBonus(
  slug: string,
  timeZone: string,
  locale: (typeof routing.locales)[number],
  flags: Awaited<ReturnType<typeof loadFeatureFlags>>,
): Promise<{ readonly period: BonusPeriod; readonly timeZone: string } | null> {
  if (!isFeatureEnabled(flags, "entry_multipliers_enabled")) return null;

  const detail = await fetchPromotion(slug, locale);
  if (!detail.ok) return null;

  const offer = normalizeEntryOffer(detail.data.entry_offer, new Date().toISOString());
  if (offer === null || !offer.multipliersEnabled || offer.activeBonus === null) return null;

  return { period: offer.activeBonus, timeZone };
}

function nextPageQuery(cursor: string, category: string | null, kind: ProductKind | null): string {
  const search = new URLSearchParams({ cursor });
  if (category !== null) search.set("category", category);
  if (kind !== null) search.set("kind", kind);
  return search.toString();
}
