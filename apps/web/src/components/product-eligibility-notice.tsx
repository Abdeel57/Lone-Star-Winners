import { Alert } from "@lsw/ui";
import { useTranslations } from "next-intl";

import { useIneligibilityReason } from "@/i18n/storefront-labels";
import type { ProductDetail } from "@/lib/api";

/**
 * Relacion del articulo con la promocion vigente, en su ficha.
 *
 * Tres estados, no dos: elegible, no elegible, y "no hay promocion contra la
 * que evaluar". El tercero no es un caso raro -es lo normal entre promociones-
 * y colapsarlo con "no elegible" diria que el articulo esta excluido cuando lo
 * que pasa es que no hay nada de lo que excluirlo.
 *
 * Y un cuarto caso que NO es ninguno de los tres: la API no publica el campo
 * (`undefined`, HO-019). Entonces no se dice nada. Tratarlo como `null`
 * pintaba "ahora mismo no hay ninguna promocion abierta" en cada ficha con la
 * promocion abierta (2026-10-06); la tarjeta tuvo el mismo fallo (DEC-077).
 */
export function ProductEligibilityNotice({ product }: { readonly product: ProductDetail }) {
  const t = useTranslations("product");
  const tShop = useTranslations("shop");
  const ineligibilityReason = useIneligibilityReason();

  const eligibility = product.entry_eligibility;
  if (eligibility === undefined) {
    return null;
  }

  // `null` es dato del contrato: no hay promocion contra la que evaluar.
  if (eligibility === null) {
    return <Alert tone="info">{tShop("noPromotionNotice")}</Alert>;
  }

  if (!eligibility.is_eligible) {
    return <Alert tone="info">{ineligibilityReason(eligibility.reason_key)}</Alert>;
  }

  return (
    <Alert tone="info" title={t("entryHeading")}>
      {t("eligible")}
    </Alert>
  );
}
