"use client";

import { Alert, Button, FormField, Input, Radio, RadioGroup, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";
import { pickLocalized, type AdminProductCategoryRow, type ProductKind } from "@/lib/api";

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
 * ---------------------------------------------------------------------------
 * EL TIPO DE PRODUCTO ES LA DECISION MAS CARA DE ESTA PANTALLA (DEC-052)
 * ---------------------------------------------------------------------------
 * `kind` decide QUE TASA aplica la version de reglas a cada compra de este
 * producto: 1 participacion por cada $1 en mercancia, 2 por cada $1 en un
 * paquete de participaciones. Por eso son dos opciones exclusivas y visibles
 * -no un desplegable entre otros ocho campos- y por eso, al editar un producto
 * que la API sirve SIN `kind`, no se preselecciona ninguna: `undefined`
 * significa "no se sabe", no "mercancia", y elegir por omision cambiaria en
 * silencio lo que vale comprarlo.
 *
 * NINGUNA COLUMNA DEL PRODUCTO DICE CUANTAS PARTICIPACIONES DA. Lo dice la
 * version de reglas (DEC-012, frontera de `0003_catalog`), y este formulario no
 * tiene ni un campo de participaciones.
 *
 * FUNCIONA SIN JAVASCRIPT: es un `<form>` con Server Action. `useActionState`
 * solo conserva el error sin recargar, y el editor de variantes del alta -que
 * si necesita estado- degrada a UNA variante, que es exactamente el flujo que
 * habia antes.
 */
export function ProductForm({
  locale,
  action,
  product,
  categories,
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
    /** `undefined` cuando la API no publica el campo (anterior a §13). */
    readonly kind?: ProductKind;
    readonly categoryKey?: string | null;
    readonly imageUrl?: string | null;
  };
  /** Categorias que ofrece el desplegable. Vacia si la API no las publica. */
  readonly categories: readonly AdminProductCategoryRow[];
}) {
  const t = useTranslations("admin.catalog");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);
  const editing = product !== undefined;

  /*
   * VARIANTES DEL ALTA.
   *
   * Al crear, el formulario permite declarar varias de golpe -las cinco gorras
   * de un color cada una- porque darlas de alta una a una despues obligaria a
   * volver a la ficha cinco veces. Al EDITAR no aparece: alli las variantes se
   * gestionan de una en una, con su propio formulario, porque cada una tiene
   * existencias y estado propios y un guardado masivo podria archivar por
   * descuido la que alguien acaba de reponer.
   *
   * Empieza VACIO: sin ninguna variante declarada, la API crea `<sku>-1` con el
   * precio y las existencias del nivel producto, que es el flujo de siempre.
   */
  const [variantCount, setVariantCount] = useState(0);

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      {editing ? <input type="hidden" name="product_id" value={product.id} /> : null}
      <input type="hidden" name="variant_count" value={String(variantCount)} />

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

      {/*
       * TIPO DE PRODUCTO. Dos opciones exclusivas y a la vista: es lo que
       * decide la tasa que se aplica a cada compra. Sin valor previo no se
       * preselecciona ninguna, y la ayuda dice por que importa.
       */}
      <div className="flex flex-col gap-s3">
        <RadioGroup
          label={t("fieldKind")}
          name="kind"
          description={t("fieldKindHint")}
          orientation="horizontal"
          {...(fieldError("kind") === undefined ? {} : { error: fieldError("kind") })}
        >
          <Radio
            value="MERCHANDISE"
            defaultChecked={product?.kind === "MERCHANDISE"}
            label={t("kindMerchandise")}
          />
          <Radio
            value="ENTRY_PACKAGE"
            defaultChecked={product?.kind === "ENTRY_PACKAGE"}
            label={t("kindEntryPackage")}
          />
        </RadioGroup>

        {editing && product.kind === undefined ? (
          <Alert tone="info">{t("kindUnknown")}</Alert>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <FormField
          label={t("fieldCategory")}
          description={t("fieldCategoryHint")}
          error={fieldError("category_key")}
        >
          <Select name="category_key" defaultValue={product?.categoryKey ?? ""}>
            {/* "SIN CATEGORIA" ES UNA OPCION, no la ausencia de eleccion: un
                producto puede no pertenecer a ninguna, y el contrato lo declara
                nulable. */}
            <option value="">{t("categoryNone")}</option>
            {categories.map((category) => (
              <option key={category.key} value={category.key}>
                {pickLocalized(category.name, locale)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label={t("fieldImageUrl")}
          description={t("fieldImageUrlHint")}
          error={fieldError("image_url")}
        >
          <Input
            name="image_url"
            defaultValue={product?.imageUrl ?? ""}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
        </FormField>
      </div>

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

      {editing ? null : (
        <fieldset className="flex flex-col gap-s4 border-t border-border pt-s5">
          <legend className="text-label font-medium text-text">{t("variantsHeading")}</legend>
          <p className="text-caption text-text-subtle">{t("variantsCreateHint")}</p>

          {Array.from({ length: variantCount }, (_, index) => (
            <div key={index} className="grid grid-cols-1 gap-s3 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label={t("variantNameEs")} required>
                <Input name={`variant_${index}_name_es`} lang="es" required />
              </FormField>

              <FormField label={t("variantNameEn")} required>
                <Input name={`variant_${index}_name_en`} lang="en" required />
              </FormField>

              <FormField label={t("variantSku")} description={t("variantSkuHint")}>
                <Input name={`variant_${index}_sku`} autoComplete="off" spellCheck={false} />
              </FormField>

              <FormField label={t("fieldPrice")} required>
                <Input name={`variant_${index}_price`} inputMode="decimal" required />
              </FormField>

              <FormField label={t("fieldStock")} description={t("fieldStockHint")}>
                <Input name={`variant_${index}_stock`} inputMode="numeric" pattern="[0-9]*" />
              </FormField>

              <FormField label={t("fieldImageUrl")}>
                <Input name={`variant_${index}_image_url`} inputMode="url" spellCheck={false} />
              </FormField>
            </div>
          ))}

          <div className="flex flex-wrap gap-s3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setVariantCount(variantCount + 1);
              }}
            >
              {t("variantsAdd")}
            </Button>

            {variantCount === 0 ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVariantCount(variantCount - 1);
                }}
              >
                {t("variantsRemoveLast")}
              </Button>
            )}
          </div>
        </fieldset>
      )}

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
