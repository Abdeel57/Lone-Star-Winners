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
import { fetchProducts, type ProductListQuery } from "@/lib/api";

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

  const request: ProductListQuery = {
    limit: PAGE_SIZE,
    ...(cursor === null ? {} : { cursor }),
    ...(category === null ? {} : { category_key: category }),
  };

  const result = await fetchProducts(locale, request);

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
                categories={categoriesOf(items)}
                selectedCategory={category}
              />

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
          empty={
            <EmptyState
              headingLevel="h2"
              tone="light"
              title={category === null ? t("shop.catalogEmpty.title") : t("shop.empty.title")}
              description={category === null ? t("shop.catalogEmpty.body") : t("shop.empty.body")}
              action={
                category === null ? undefined : (
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
                  href={`/shop?${nextPageQuery(result.data.next_cursor, category)}`}
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
 * Categorias presentes en la pagina actual.
 *
 * Es una limitacion CONOCIDA: el contrato no publica un endpoint de categorias,
 * asi que el filtro solo puede ofrecer las que vienen en esta pagina de
 * resultados. Con paginacion por cursor, eso significa que una categoria que
 * solo aparezca en la pagina tres no es seleccionable desde la primera.
 *
 * Se ha pedido a `backend` un endpoint de facetas. Mientras tanto esto degrada
 * de forma visible pero no rompe nada, y no se sustituye por una lista de
 * categorias cableada aqui: seria dato de negocio metido en el frontend.
 */
function categoriesOf(products: readonly { readonly category_key: string }[]): readonly string[] {
  return [...new Set(products.map((product) => product.category_key))].sort();
}

function nextPageQuery(cursor: string, category: string | null): string {
  const search = new URLSearchParams({ cursor });
  if (category !== null) search.set("category", category);
  return search.toString();
}
