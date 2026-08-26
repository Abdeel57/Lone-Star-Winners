import { Alert, buttonVariants, EmptyState } from "@lsw/ui";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ApiErrorState } from "@/components/api-error-state";
import { ProductCard } from "@/components/product-card";
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

  return (
    <div className="pb-s16">
      {/* Cabecera de la tienda sobre atmosfera: es la segunda pantalla mas
          visitada del sitio y necesita entrada propia, no un titulo suelto
          encima de una rejilla (DEC-038). */}
      <div className="lsw-atmosphere lsw-grain relative isolate py-s12 lg:py-s16">
        <div className="lsw-container">
          <SectionHeading
            eyebrow={t("nav.shop")}
            title={t("shop.title")}
            lead={t("shop.intro")}
            level="h1"
            size="lg"
          />
        </div>
      </div>

      <div className="lsw-container pt-s10">
        {!result.ok ? (
          <ApiErrorState failure={result.error} headingLevel="h2" />
        ) : (
          <>
            <ShopFilters
              action={`/${locale}/shop`}
              categories={categoriesOf(result.data.items)}
              selectedCategory={category}
            />

            {/* Entre promociones el catalogo sigue en pie, pero ningun articulo
                trae elegibilidad. Se dice una vez arriba en vez de repetir la
                misma insignia gris en cada tarjeta. */}
            {result.data.items.length > 0 &&
            result.data.items.every((product) => product.entry_eligibility === null) ? (
              <Alert tone="info" className="mt-s6">
                {t("shop.noPromotionNotice")}
              </Alert>
            ) : null}

            <div className="mt-s8">
              {result.data.items.length === 0 ? (
                <EmptyState
                  headingLevel="h2"
                  title={category === null ? t("shop.catalogEmpty.title") : t("shop.empty.title")}
                  description={
                    category === null ? t("shop.catalogEmpty.body") : t("shop.empty.body")
                  }
                  action={
                    category === null ? undefined : (
                      <Link href="/shop" className={buttonVariants({ variant: "secondary" })}>
                        {t("shop.clear")}
                      </Link>
                    )
                  }
                />
              ) : (
                <ul className="grid list-none gap-s5 sm:grid-cols-2 lg:grid-cols-3">
                  {result.data.items.map((product) => (
                    <ProductCard key={product.id} product={product} locale={locale} />
                  ))}
                </ul>
              )}
            </div>

            {result.data.next_cursor === null ? null : (
              <div className="mt-s10 flex justify-center">
                <Link
                  href={`/shop?${nextPageQuery(result.data.next_cursor, category)}`}
                  className={buttonVariants({ variant: "secondary", size: "lg" })}
                >
                  {t("shop.loadMore")}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
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
