import { Button, cn, FormField, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";

import type { Locale } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import { pickLocalized, PRODUCT_KINDS, type ProductCategory, type ProductKind } from "@/lib/api";

/**
 * Filtros del catalogo: tipo de producto y categoria (§13.4, DEC-052/DEC-053).
 *
 * DOS CONTROLES CON DOS FORMAS DISTINTAS, Y NO ES CAPRICHO
 * -------------------------------------------------------
 * El TIPO son tres enlaces -todo, paquetes, mercancia- y la CATEGORIA es un
 * `<select>` dentro de un formulario GET. La diferencia esta en lo que hace cada
 * uno: el tipo parte el catalogo en secciones que se leen distinto -un paquete
 * de participaciones y una gorra no se comparan-, y eso es navegacion; la
 * categoria acota dentro de lo que ya se esta mirando, y eso es un filtro.
 *
 * Como enlaces, ademas, el tipo se ve seleccionado sin JavaScript y cada seccion
 * tiene su URL, que es lo que hace que "los paquetes" se pueda enlazar desde
 * fuera.
 *
 * EL FORMULARIO SIGUE SIENDO UN `<form method="get">` SIN JAVASCRIPT
 * ------------------------------------------------------------------
 * Tres razones, en orden:
 *
 * 1. **Funciona sin JS.** Cambiar de categoria es navegar, y navegar es lo que
 *    un formulario GET hace de serie. En movil, con la red a medias, la pagina
 *    responde antes de que cargue el bundle.
 * 2. **El filtro queda en la URL.** Se puede compartir, marcar y volver atras.
 * 3. **El servidor sigue siendo quien decide.** El filtro viaja al backend como
 *    parametro de `GET /products`; la interfaz no filtra una lista completa por
 *    su cuenta, que ademas romperia la paginacion por cursor.
 *
 * LAS CATEGORIAS LLEGAN DE LA API, Y SU NOMBRE TAMBIEN (DEC-053)
 * --------------------------------------------------------------
 * Antes se derivaban de los productos de la pagina actual -con cursor, una
 * categoria que solo apareciera en la pagina tres no era seleccionable- y su
 * texto salia del diccionario del frontend. Las dos cosas eran defectos: el
 * panel puede crear categorias, y un nombre en `messages/*.json` obligaria a un
 * despliegue por cada alta. Ahora llegan de `GET /product-categories` con su
 * nombre en los dos idiomas y se pintan con `pickLocalized`, sin traducir.
 *
 * `action` apunta a la ruta ya localizada, que la pagina le pasa: un `<form>`
 * nativo no pasa por los envoltorios de `next-intl` y perderia el prefijo de
 * idioma.
 *
 * El `cursor` NO se conserva al aplicar un filtro. Es correcto: un cursor es
 * una posicion dentro de un listado concreto, y al cambiar el filtro el listado
 * es otro.
 */
export function ShopFilters({
  action,
  categories,
  selectedCategory,
  selectedKind,
  locale,
}: {
  /** Ruta localizada a la que envia el formulario. */
  readonly action: string;
  readonly categories: readonly ProductCategory[];
  readonly selectedCategory: string | null;
  readonly selectedKind: ProductKind | null;
  readonly locale: Locale;
}) {
  const t = useTranslations("shop");

  return (
    <div className="flex flex-col gap-s5">
      <KindTabs selectedKind={selectedKind} selectedCategory={selectedCategory} />

      {categories.length === 0 ? null : (
        <form
          method="get"
          action={action}
          aria-label={t("filtersHeading")}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          {/* El tipo viaja con el filtro para no perderse al cambiar de
              categoria. Es un campo oculto y no un segundo control: quien lo
              cambia son las pestañas de arriba. */}
          {selectedKind === null ? null : <input type="hidden" name="kind" value={selectedKind} />}

          <FormField
            label={t("categoryLabel")}
            controlId="category"
            className="sm:max-w-xs sm:flex-1"
          >
            <Select name="category" defaultValue={selectedCategory ?? ""}>
              <option value="">{t("allCategories")}</option>
              {categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {pickLocalized(category.name, locale)}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" variant="secondary">
              {t("apply")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Las tres secciones del catalogo.
 *
 * "TODO" ES UNA SECCION Y NO LA AUSENCIA DE FILTRO, y por eso se pinta como una
 * pestaña mas: sin ella, volver del listado de paquetes al catalogo completo
 * seria borrar un parametro de la URL a mano.
 *
 * El orden pone PAQUETES en medio y no primero: la primera pestaña es la que se
 * lee como estado por defecto, y el estado por defecto de esta tienda es el
 * catalogo entero. Encabezar con los paquetes convertiria la tienda en un
 * escaparate de paquetes, que es exactamente el encuadre que `CLAUDE.md` §1 no
 * permite.
 */
function KindTabs({
  selectedKind,
  selectedCategory,
}: {
  readonly selectedKind: ProductKind | null;
  readonly selectedCategory: string | null;
}) {
  const t = useTranslations("shop");

  const href = (kind: ProductKind | null): string => {
    const search = new URLSearchParams();
    if (kind !== null) search.set("kind", kind);
    if (selectedCategory !== null) search.set("category", selectedCategory);

    const query = search.toString();
    return query.length === 0 ? "/shop" : `/shop?${query}`;
  };

  const label = (kind: ProductKind | null): string =>
    kind === null
      ? t("kindAll")
      : kind === "ENTRY_PACKAGE"
        ? t("kindEntryPackages")
        : t("kindMerchandise");

  return (
    <nav aria-label={t("kindHeading")}>
      <ul className="flex list-none flex-wrap gap-s2">
        {[null, ...PRODUCT_KINDS].map((kind) => {
          const current = kind === selectedKind;

          return (
            <li key={kind ?? "ALL"}>
              <Link
                href={href(kind)}
                // `aria-current` y no solo el color: quien navega por voz o por
                // teclado tiene que poder saber en que seccion esta sin ver el
                // contraste.
                {...(current ? { "aria-current": "page" as const } : {})}
                className={cn(
                  "inline-flex min-h-touch items-center rounded-pill border px-s4 text-body-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  current
                    ? "border-brand bg-brand/15 font-semibold text-brand"
                    : "border-border text-text-muted hover:border-brand/50 hover:text-text",
                )}
              >
                {label(kind)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
