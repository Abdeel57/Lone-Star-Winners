import { useTranslations } from "next-intl";

import type { AvailabilityStatus } from "@/lib/api";

/**
 * Traduccion de los enums del storefront.
 *
 * Mismo razonamiento que `promotion-labels.ts`: los enums cerrados se traducen
 * con un `switch` exhaustivo, de modo que un valor nuevo en el contrato deja de
 * compilar en lugar de aparecer en crudo en pantalla.
 *
 * PERO NO TODOS LOS ENUMS SON CERRADOS
 * ------------------------------------
 * `reason_key` (linea no elegible), `kind` (tope aplicado) y `category_key` los
 * publica `docs/API_CONTRACT.md` como "enums estables" SIN enumerar sus
 * valores: solo nombra `PRODUCT_NOT_ELIGIBLE` y `PER_ORDER` como ejemplos.
 *
 * Para esos se usa el patron de `ApiErrorState`: una lista explicita de claves
 * traducidas y un texto generico para todo lo demas. Un valor que el backend
 * anada manana produce una frase generica -util aunque imprecisa- y nunca una
 * clave tecnica delante de un participante. Anadir una clave a la lista es un
 * acto deliberado que obliga a escribir el texto en los DOS diccionarios, y el
 * test de paridad comprueba que no falte ninguno.
 */

/**
 * Disponibilidad, en las DOS superficies que la publican.
 *
 * UN SOLO COPY PARA UN SOLO ESTADO
 * --------------------------------
 * El catalogo y el carrito publican el mismo objeto, calculado con el mismo
 * predicado (`docs/API_CONTRACT.md` secciones 4 y 5). Dos diccionarios para el
 * mismo enum acabarian diciendo cosas distintas del mismo dato, y la primera en
 * quedarse atras seria la superficie que menos se toca.
 *
 * POR QUE `OUT_OF_STOCK` NO DICE "AGOTADO"
 * ----------------------------------------
 * Porque el texto tiene que ser cierto en los dos sitios y lo que cambia entre
 * ellos es LA CANTIDAD POR LA QUE SE PREGUNTA:
 *
 *   - en el catalogo se pregunta por UNA unidad, y entonces si no cabe es que
 *     no queda nada;
 *   - en el carrito se pregunta por la cantidad de la linea, y entonces puede
 *     significar "quedan tres y pediste cinco".
 *
 * "Agotado" seria falso en el segundo caso. "Existencias insuficientes" es
 * cierto en los dos, y donde hace falta mas precision -la linea del carrito- la
 * pantalla anade una frase que lo explica.
 *
 * NINGUN texto de este bloque promete unidades: la cantidad exacta NO se
 * publica en ninguna de las dos superficies (HO-017 pidio expresamente que no).
 *
 * `UNAVAILABLE` ya no existe. "Retirado de la venta" es otra pregunta
 * -`is_purchasable`-, sigue pendiente y el contrato dice que no se deduce de
 * esta.
 */
export function useAvailabilityLabel(): (status: AvailabilityStatus) => string {
  const t = useTranslations("availability");

  return (status: AvailabilityStatus): string => {
    switch (status) {
      case "IN_STOCK":
        return t("IN_STOCK");
      case "LOW_STOCK":
        return t("LOW_STOCK");
      case "OUT_OF_STOCK":
        return t("OUT_OF_STOCK");
    }
  };
}

/** Claves de motivo de no elegibilidad con texto propio en los dos idiomas. */
const TRANSLATED_REASON_KEYS = ["PRODUCT_NOT_ELIGIBLE"] as const;

type TranslatedReasonKey = (typeof TRANSLATED_REASON_KEYS)[number];

function isTranslatedReasonKey(value: string): value is TranslatedReasonKey {
  return (TRANSLATED_REASON_KEYS as readonly string[]).includes(value);
}

export function useIneligibilityReason(): (reasonKey: string | null) => string {
  const t = useTranslations("ineligibility");

  return (reasonKey: string | null): string => {
    if (reasonKey === null) return t("fallback");

    if (isTranslatedReasonKey(reasonKey)) {
      switch (reasonKey) {
        case "PRODUCT_NOT_ELIGIBLE":
          return t("PRODUCT_NOT_ELIGIBLE");
      }
    }

    return t("fallback");
  };
}

/** Clases de tope con texto propio en los dos idiomas. */
const TRANSLATED_CAP_KINDS = ["PER_ORDER", "PER_PARTICIPANT", "PER_PROMOTION"] as const;

type TranslatedCapKind = (typeof TRANSLATED_CAP_KINDS)[number];

function isTranslatedCapKind(value: string): value is TranslatedCapKind {
  return (TRANSLATED_CAP_KINDS as readonly string[]).includes(value);
}

export function useCapKindLabel(): (kind: string) => string {
  const t = useTranslations("entryCap");

  return (kind: string): string => {
    if (isTranslatedCapKind(kind)) {
      switch (kind) {
        case "PER_ORDER":
          return t("PER_ORDER");
        case "PER_PARTICIPANT":
          return t("PER_PARTICIPANT");
        case "PER_PROMOTION":
          return t("PER_PROMOTION");
      }
    }

    return t("fallback");
  };
}

/**
 * Categorias del catalogo.
 *
 * El backend manda una clave estable y el copy es del frontend. Una categoria
 * que el backend anada aparece con su clave sin traducir en el FILTRO -no en
 * una frase- lo que la deja usable y visible como pendiente de traducir.
 */
const TRANSLATED_CATEGORY_KEYS = ["APPAREL", "DRINKWARE", "ACCESSORIES", "HOME"] as const;

type TranslatedCategoryKey = (typeof TRANSLATED_CATEGORY_KEYS)[number];

function isTranslatedCategoryKey(value: string): value is TranslatedCategoryKey {
  return (TRANSLATED_CATEGORY_KEYS as readonly string[]).includes(value);
}

export function useCategoryLabel(): (categoryKey: string) => string {
  const t = useTranslations("category");

  return (categoryKey: string): string => {
    if (isTranslatedCategoryKey(categoryKey)) {
      switch (categoryKey) {
        case "APPAREL":
          return t("APPAREL");
        case "DRINKWARE":
          return t("DRINKWARE");
        case "ACCESSORIES":
          return t("ACCESSORIES");
        case "HOME":
          return t("HOME");
      }
    }

    return categoryKey;
  };
}
