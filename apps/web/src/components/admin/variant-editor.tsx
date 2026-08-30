"use client";

import { Alert, Badge, Button, Card, FormField, Input, Select } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import type { AdminProductVariantRow } from "@/lib/api";

/**
 * Los dos estados que el editor ofrece para una variante.
 *
 * `DRAFT` no esta a proposito: una variante nace con el estado de su producto y
 * publicarlo es otra ruta con otra capacidad (`product.publish`). Lo que este
 * formulario decide es si la variante sigue a la venta o se ARCHIVA, que son
 * los dos unicos valores que la API admite en `PATCH …/variants/:id`.
 */
const VARIANT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

/**
 * Variantes de un producto (§13.6, DEC-053).
 *
 * POR QUE UNA POR UNA Y NO UN GUARDADO MASIVO
 * -------------------------------------------
 * Cada variante tiene existencias y estado propios, y las existencias cambian
 * solas -por cada compra-. Un formulario que guardara las cinco de golpe
 * escribiria valores leidos hace cinco minutos sobre los cuatro colores que
 * nadie tocaba, y podria archivar por descuido el que alguien acaba de reponer.
 * Un formulario por variante escribe exactamente lo que se miro.
 *
 * NO HAY BORRADO: SE ARCHIVA
 * --------------------------
 * Un SKU vendido tiene que seguir existiendo para que los pedidos que lo
 * contienen puedan explicarse (principios #5 y #6). `status: "ARCHIVED"` lo
 * retira de la tienda sin borrar nada, y la API ni siquiera publica un DELETE.
 *
 * EL NOMBRE VA EN LOS DOS IDIOMAS (principio 4) y uno al lado del otro, no uno
 * debajo como traduccion. Es lo que distingue "Rojo" de "Red" para el mismo
 * color, y lo que hace que el selector de la ficha deje de enseñar SKUs.
 *
 * LA IMAGEN PUEDE APUNTAR A UN FICHERO QUE NO EXISTE TODAVIA: no hay almacen de
 * medios (DEC-053) y las entrega el usuario en `apps/web/public/products/`. El
 * formulario acepta la ruta y el escaparate tolera el 404.
 */
export function VariantEditor({
  locale,
  productId,
  variants,
  createAction,
  updateAction,
  editable,
}: {
  readonly locale: Locale;
  readonly productId: string;
  readonly variants: readonly AdminProductVariantRow[];
  readonly createAction: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly updateAction: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly editable: boolean;
}) {
  const t = useTranslations("admin.catalog");

  return (
    <div className="flex flex-col gap-s5">
      {variants.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t("variantsEmpty")}</p>
      ) : (
        <ul className="flex list-none flex-col gap-s4">
          {variants.map((variant) => (
            <li key={variant.id}>
              <Card elevation="flat" padding="md">
                <div className="flex flex-wrap items-center justify-between gap-s3">
                  <p className="break-all font-mono text-body-sm text-text">{variant.sku}</p>

                  <Badge tone={variant.status === "ACTIVE" ? "success" : "neutral"} size="sm">
                    {variant.status}
                  </Badge>
                </div>

                <div className="mt-s4">
                  {editable ? (
                    <VariantForm
                      locale={locale}
                      action={updateAction}
                      productId={productId}
                      variant={variant}
                    />
                  ) : (
                    <Alert tone="info">{t("noWriteCapability")}</Alert>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {!editable ? null : (
        <Card elevation="flat" padding="md">
          <p className="text-label font-medium text-text">{t("variantsAddHeading")}</p>

          <div className="mt-s4">
            <VariantForm locale={locale} action={createAction} productId={productId} />
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Alta o edicion de UNA variante.
 *
 * Un solo componente para las dos cosas porque los campos son los mismos; lo
 * que cambia es si hay `variant_id` -y, con el, la opcion de archivar-. Dos
 * componentes casi iguales acabarian divergiendo en el campo que se anadiera
 * solo a uno.
 */
function VariantForm({
  locale,
  action,
  productId,
  variant,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly productId: string;
  /** `undefined` al crear. */
  readonly variant?: AdminProductVariantRow;
}) {
  const t = useTranslations("admin.catalog");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const editing = variant !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-s4">
      <LocaleField locale={locale} />
      <input type="hidden" name="product_id" value={productId} />
      {editing ? <input type="hidden" name="variant_id" value={variant.id} /> : null}

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      <div className="grid grid-cols-1 gap-s3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label={t("variantNameEs")} required error={fieldError("name_es")}>
          <Input name="name_es" lang="es" required defaultValue={variant?.name?.["es-US"] ?? ""} />
        </FormField>

        <FormField label={t("variantNameEn")} required error={fieldError("name_en")}>
          <Input name="name_en" lang="en" required defaultValue={variant?.name?.["en-US"] ?? ""} />
        </FormField>

        {editing ? null : (
          <FormField
            label={t("variantSku")}
            description={t("variantSkuHint")}
            error={fieldError("sku")}
          >
            <Input name="sku" autoComplete="off" spellCheck={false} />
          </FormField>
        )}

        <FormField label={t("fieldPrice")} required error={fieldError("price")}>
          <Input
            name="price"
            inputMode="decimal"
            required
            defaultValue={variant?.price_amount_minor ?? ""}
          />
        </FormField>

        <FormField
          label={t("fieldStock")}
          description={t("fieldStockHint")}
          error={fieldError("stock")}
        >
          <Input
            name="stock"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue={
              variant?.stock_quantity === null || variant?.stock_quantity === undefined
                ? ""
                : String(variant.stock_quantity)
            }
          />
        </FormField>

        <FormField label={t("fieldImageUrl")} error={fieldError("image_url")}>
          <Input
            name="image_url"
            inputMode="url"
            spellCheck={false}
            defaultValue={variant?.image_url ?? ""}
          />
        </FormField>

        {/* ARCHIVAR NO ES BORRAR, y el desplegable lo dice con los dos unicos
            valores que la API admite. Solo al editar: una variante nueva nace
            activa. */}
        {!editing ? null : (
          <FormField
            label={t("variantStatus")}
            description={t("variantStatusHint")}
            error={fieldError("status")}
          >
            {/* Los dos valores se pintan EN CRUDO: son los del enum del
                contrato (`AdminProductStatus`) y coinciden con lo que muestra
                la insignia de arriba, de modo que elegir uno y ver el resultado
                usan la misma palabra. `DRAFT` no se ofrece: el estado de la
                variante lo hereda del producto, y publicar es otra ruta. */}
            <Select name="status" defaultValue={variant.status}>
              {VARIANT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </FormField>
        )}
      </div>

      <Button
        type="submit"
        variant={editing ? "secondary" : "primary"}
        size="sm"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {editing ? t("variantSave") : t("variantCreate")}
      </Button>
    </form>
  );
}
