import { Button, FormField, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { useCategoryLabel } from "@/i18n/storefront-labels";

/**
 * Filtros del catalogo.
 *
 * Es un `<form method="get">` sin JavaScript. Tres razones, en orden:
 *
 * 1. **Funciona sin JS.** Cambiar de categoria es navegar, y navegar es lo que
 *    un formulario GET hace de serie. En movil, con la red a medias, la pagina
 *    responde antes de que cargue el bundle.
 * 2. **El filtro queda en la URL.** Se puede compartir, marcar y volver atras.
 *    Un filtro guardado en estado de cliente no sobrevive a un enlace pegado en
 *    un mensaje.
 * 3. **El servidor sigue siendo quien decide.** El filtro viaja al backend como
 *    parametro de `GET /products`; la interfaz no filtra una lista completa por
 *    su cuenta, que ademas rompeeria la paginacion por cursor.
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
}: {
  /** Ruta localizada a la que envia el formulario. */
  readonly action: string;
  readonly categories: readonly string[];
  readonly selectedCategory: string | null;
}) {
  const t = useTranslations("shop");
  const categoryLabel = useCategoryLabel();

  if (categories.length === 0) return null;

  return (
    <form
      method="get"
      action={action}
      aria-label={t("filtersHeading")}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <FormField label={t("categoryLabel")} controlId="category" className="sm:max-w-xs sm:flex-1">
        <Select name="category" defaultValue={selectedCategory ?? ""}>
          <option value="">{t("allCategories")}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
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
  );
}
