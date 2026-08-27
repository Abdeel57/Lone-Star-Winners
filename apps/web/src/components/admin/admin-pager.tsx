import { buttonVariants } from "@lsw/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { adminHref } from "@/i18n/admin-routing";
import type { Locale } from "@/i18n/locales";

/**
 * Paginacion por CURSOR de los listados del panel.
 *
 * SOLO HAY "SIGUIENTE", Y NO ES UNA CARENCIA
 * ------------------------------------------
 * Un cursor opaco describe una posicion hacia delante y nada mas: no tiene
 * inverso, no dice cuantas paginas hay y no permite saltar a la quinta. Pintar
 * "anterior" exigiria que el frontend guardara la pila de cursores visitados, y
 * pintar "1 2 3 ... 47" exigiria un total que el backend no publica -y que en
 * una tabla que crece mientras se pagina no seria cierto un segundo despues-.
 *
 * Lo que si hay es el boton de ATRAS del navegador, que funciona porque el
 * cursor viaja en la URL. Es la forma correcta de volver, y es gratis.
 *
 * POR QUE CURSOR Y NO OFFSET: con offset, una fila nueva durante la paginacion
 * desplaza las demas y quien pagina ve duplicados o huecos. En una cola de
 * revision eso significa revisar dos veces el mismo envio, o ninguna.
 *
 * `next_cursor: null` SIGNIFICA QUE NO HAY MAS, y entonces no se pinta nada: un
 * boton deshabilitado al final de cada listado es ruido en todas las pantallas
 * para informar de lo mismo que la ausencia de boton.
 */
export async function AdminPager({
  locale,
  path,
  nextCursor,
  hasItems,
  extraQuery,
}: {
  readonly locale: Locale;
  /** Ruta interna del panel a la que vuelve el enlace. */
  readonly path: string;
  readonly nextCursor: string | null;
  readonly hasItems: boolean;
  /** Filtros que hay que conservar al pasar de pagina. */
  readonly extraQuery?: Readonly<Record<string, string>>;
}) {
  if (nextCursor === null || !hasItems) return null;

  const t = await getTranslations({ locale, namespace: "admin.pager" });

  const search = new URLSearchParams(extraQuery ?? {});
  // El cursor se transporta TAL CUAL. Es opaco: no se decodifica, no se
  // interpreta y no se construye uno a mano.
  search.set("cursor", nextCursor);

  return (
    <nav aria-label={t("label")} className="flex justify-center">
      <Link
        href={`${adminHref(locale, path)}?${search.toString()}`}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        {t("next")}
      </Link>
    </nav>
  );
}
