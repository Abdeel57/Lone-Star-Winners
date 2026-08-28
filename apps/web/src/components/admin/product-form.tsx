"use client";

import { Alert, Button, FormField, Input, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Alta y edicion de un producto.
 *
 * UN FORMULARIO, DOS MODOS. Al crear se piden SKU, direccion y moneda; al
 * editar no, porque no se editan: el SKU esta en albaranes, la direccion en
 * enlaces y la moneda en el precio de cada variante. Cambiarlos no es una
 * edicion, es otro producto.
 *
 * LOS DOS IDIOMAS SON OBLIGATORIOS y van uno al lado del otro, no uno debajo
 * como "traduccion". Es la forma visible del principio 4: el formulario no
 * sugiere que uno de los dos sea el de verdad y el otro un anadido.
 *
 * EL PRECIO SE TECLEA CON DECIMALES ("25.00") y la accion lo convierte a la
 * unidad menor en el servidor, sin coma flotante. El campo no es `type="number"`
 * a proposito: la rueda del raton sobre un campo numerico con foco cambia el
 * precio sin que nadie lo pida, y `inputMode="decimal"` ya saca el teclado
 * correcto en el telefono.
 *
 * FUNCIONA SIN JAVASCRIPT: es un `<form>` con Server Action. `useActionState`
 * solo conserva el error sin recargar.
 */
export function ProductForm({
  locale,
  action,
  product,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** `undefined` al crear. Al editar, los valores actuales. */
  readonly product?: {
    readonly id: string;
    readonly sku: string;
    readonly slug: string;
    readonly currency: string;
    readonly name: { readonly "es-US": string; readonly "en-US": string };
    /** Ya convertido a texto con decimales ("25.00"). */
    readonly priceText: string;
    readonly stockQuantity: number | null;
  };
}) {
  const t = useTranslations("admin.catalog");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const editing = product !== undefined;

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {editing ? <input type="hidden" name="product_id" value={product.id} /> : null}

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      {editing ? null : (
        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <FormField
            label={t("fieldSku")}
            description={t("fieldSkuHint")}
            required
            error={fieldError("sku")}
          >
            <Input
              name="sku"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
            />
          </FormField>

          <FormField
            label={t("fieldSlug")}
            description={t("fieldSlugHint")}
            required
            error={fieldError("slug")}
          >
            <Input
              name="slug"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </FormField>
        </div>
      )}

      <p className="text-caption text-text-subtle">{t("bothLanguages")}</p>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField label={t("fieldNameEs")} required error={fieldError("name_es")}>
          <Input
            name="name_es"
            lang="es"
            required
            {...(editing ? { defaultValue: product.name["es-US"] } : {})}
          />
        </FormField>

        <FormField label={t("fieldNameEn")} required error={fieldError("name_en")}>
          <Input
            name="name_en"
            lang="en"
            required
            {...(editing ? { defaultValue: product.name["en-US"] } : {})}
          />
        </FormField>
      </div>

      {editing ? null : (
        <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
          <FormField label={t("fieldDescriptionEs")} error={fieldError("description_es")}>
            <Textarea name="description_es" lang="es" rows={3} />
          </FormField>

          <FormField label={t("fieldDescriptionEn")} error={fieldError("description_en")}>
            <Textarea name="description_en" lang="en" rows={3} />
          </FormField>
        </div>
      )}

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-3">
        {editing ? (
          <input type="hidden" name="currency" value={product.currency} />
        ) : (
          <FormField label={t("fieldCurrency")} required error={fieldError("currency")}>
            <Input
              name="currency"
              defaultValue="USD"
              maxLength={3}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </FormField>
        )}

        <FormField
          label={t("fieldPrice")}
          description={t("fieldPriceHint")}
          required
          error={fieldError("price")}
        >
          <Input
            name="price"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            required
            {...(editing ? { defaultValue: product.priceText } : {})}
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
            autoComplete="off"
            spellCheck={false}
            {...(editing && product.stockQuantity !== null
              ? { defaultValue: String(product.stockQuantity) }
              : {})}
          />
        </FormField>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="w-full sm:w-auto sm:self-start"
      >
        {editing ? t("saveSubmit") : t("createSubmit")}
      </Button>
    </form>
  );
}
