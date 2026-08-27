"use client";

import { Alert, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useApiErrorMessage } from "@/components/api-error-state";
import type { ActionResult } from "@/lib/action-result";

/**
 * Piezas comunes de los formularios de identidad.
 *
 * POR QUE ESTAN AQUI Y NO REPETIDAS EN CADA FORMULARIO
 * ----------------------------------------------------
 * Las cinco pantallas de identidad comparten exactamente el mismo cableado: un
 * campo oculto con el locale, un aviso de error del formulario entero, y la
 * regla de que un error atribuido a un campo se pinta JUNTO a ese campo y no
 * arriba. Repetirlo cinco veces garantiza que la quinta se olvide de algo, y lo
 * que se olvida siempre es la asociacion accesible del error con su campo.
 *
 * NINGUNA DE ESTAS PIEZAS CONTIENE UNA REGLA
 * ------------------------------------------
 * No hay longitud minima de contrasena, ni patron de correo mas alla del
 * `type="email"` del navegador, ni edad, ni jurisdiccion. La politica de
 * contrasenas es de `packages/security` (DEC-006) y la elegibilidad es de las
 * Official Rules: escribir aqui un `minLength` seria fijar en el frontend una
 * regla que vive en otro sitio, y el dia que cambiara, esta pantalla
 * rechazaria contrasenas que el backend acepta.
 */

/**
 * Mensaje de error de un resultado de accion.
 *
 * Devuelve `null` cuando no hay error o cuando el error pertenece a un campo
 * concreto: en ese caso lo pinta el campo, no la cabecera del formulario.
 */
export function FormError({ result }: { readonly result: ActionResult }) {
  const t = useTranslations();
  const message = useApiErrorMessage();

  if (result.status !== "error" || result.field !== null) return null;

  return (
    <Alert tone="danger" title={t("states.loadFailed.title")}>
      {message(result.code)}
      {result.requestId === null ? null : (
        <p className="mt-s2 text-caption text-text-subtle">
          {t("states.loadFailed.requestIdLabel")}: {result.requestId}
        </p>
      )}
    </Alert>
  );
}

/**
 * Error atribuido a un campo concreto, ya traducido.
 *
 * Se pasa a `FormField.error`, que lo asocia por `aria-describedby` y lo
 * anuncia con `role="alert"`. Devolver `undefined` -y no cadena vacia- es lo
 * que hace que el campo no se marque invalido cuando no lo esta.
 */
export function useFieldError(result: ActionResult): (field: string) => string | undefined {
  const message = useApiErrorMessage();

  return (field: string): string | undefined => {
    if (result.status !== "error" || result.field !== field) return undefined;
    return message(result.code);
  };
}

/**
 * Campo de correo electronico.
 *
 * `type="email"` y `autoComplete="email"`: la validacion de formato la hace el
 * navegador -que la tiene- y el gestor de contrasenas rellena el campo, que en
 * movil es la diferencia entre entrar y abandonar. `inputMode="email"` cambia
 * el teclado del telefono.
 */
export function EmailField({
  result,
  defaultValue,
}: {
  readonly result: ActionResult;
  readonly defaultValue?: string;
}) {
  const t = useTranslations("auth.fields");
  const fieldError = useFieldError(result);

  return (
    <FormField
      label={t("email")}
      required
      requiredHint={t("requiredHint")}
      error={fieldError("email")}
    >
      <Input
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        {...(defaultValue === undefined ? {} : { defaultValue })}
      />
    </FormField>
  );
}

/**
 * Campo de contrasena.
 *
 * `autoComplete` es distinto segun el proposito y no es un detalle: con
 * `new-password` el gestor de contrasenas ofrece generar una, y con
 * `current-password` ofrece la guardada. Poner el mismo en los dos sitios
 * rompe justo la funcion que hace que la gente use contrasenas buenas.
 *
 * SIN `minLength` NI `pattern`. La politica es de `packages/security`.
 */
export function PasswordField({
  result,
  name,
  label,
  purpose,
  description,
}: {
  readonly result: ActionResult;
  readonly name: string;
  readonly label: string;
  readonly purpose: "new-password" | "current-password";
  readonly description?: ReactNode;
}) {
  const t = useTranslations("auth.fields");
  const fieldError = useFieldError(result);

  return (
    <FormField
      label={label}
      required
      requiredHint={t("requiredHint")}
      error={fieldError(name)}
      {...(description === undefined ? {} : { description })}
    >
      <Input name={name} type="password" autoComplete={purpose} />
    </FormField>
  );
}

/** Campo oculto con el locale, que la accion valida antes de usarlo. */
export function LocaleField({ locale }: { readonly locale: string }) {
  return <input type="hidden" name="locale" value={locale} />;
}
