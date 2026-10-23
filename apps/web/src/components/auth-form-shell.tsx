"use client";

import { Alert, Button, FormField, Input } from "@lsw/ui";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { StepUpPrompt } from "@/components/admin/step-up-prompt";
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
 * No hay longitud minima de contrasena escrita aqui, ni patron de correo mas
 * alla del `type="email"` del navegador, ni edad, ni jurisdiccion. La politica
 * de contrasenas es de `packages/security` (DEC-006) y la elegibilidad es de
 * las Official Rules: escribir aqui un `12` seria fijar en el frontend una
 * regla que vive en otro sitio, y el dia que cambiara, esta pantalla
 * rechazaria contrasenas que el backend acepta. El minimo que SI se ensena
 * llega publicado por `GET /config` (`password_policy`).
 */

/**
 * Mensaje de error de un resultado de accion.
 *
 * Devuelve `null` cuando no hay error o cuando el error pertenece a un campo
 * concreto: en ese caso lo pinta el campo, no la cabecera del formulario.
 *
 * `STEP_UP_REQUIRED` NO SE PINTA COMO ERROR. Es el backend pidiendo un codigo
 * reciente antes de una accion sensible del panel (DEC-006), y se ensena como
 * el paso que falta, con el boton para darlo (`StepUpPrompt`). Vive aqui y no
 * en cada formulario del panel porque todos pasan por este componente: asi
 * ninguna accion con step-up puede volver a contestar con una averia. Solo el
 * panel recibe ese codigo; en el escaparate esta rama no se ejecuta nunca.
 *
 * `stepUpAnchor`: `id` de la seccion que contiene el formulario, para que la
 * vuelta tras el codigo aterrice en ella y no en lo alto de la pantalla.
 */
export function FormError({
  result,
  stepUpAnchor,
}: {
  readonly result: ActionResult;
  readonly stepUpAnchor?: string;
}) {
  const t = useTranslations();
  const message = useApiErrorMessage();

  if (result.status !== "error" || result.field !== null) return null;

  if (result.code === "STEP_UP_REQUIRED") {
    return <StepUpPrompt {...(stepUpAnchor === undefined ? {} : { anchor: stepUpAnchor })} />;
  }

  /*
   * El titulo dice lo que paso: la ACCION no se completo. Antes decia "no hemos
   * podido cargar esta seccion", que es el titulo de un fallo de carga, y
   * delante de un formulario que si cargo sonaba a averia de la pantalla.
   */
  return (
    <Alert tone="danger" title={t("states.actionFailed.title")}>
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
  const t = useTranslations("auth.fields");
  const message = useApiErrorMessage();

  return (field: string): string | undefined => {
    if (result.status !== "error" || result.field !== field) return undefined;

    // El minimo llega CON el rechazo (`details.minimum_length`), no esta escrito
    // aqui: es la forma de decir cuantos caracteres faltan sin romper la regla
    // de arriba. Si el backend no lo manda, se cae al mensaje generico.
    if (result.minimumPasswordLength !== undefined) {
      return t("passwordTooShort", { count: result.minimumPasswordLength });
    }

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
 * `minLength` solo cuando llega `minimumLength`, que es el que publica el
 * backend. Sin el, ni `minLength` ni `pattern`: la politica es de
 * `packages/security`.
 */
export function PasswordField({
  result,
  name,
  label,
  purpose,
  description,
  minimumLength,
}: {
  readonly result: ActionResult;
  readonly name: string;
  readonly label: string;
  readonly purpose: "new-password" | "current-password";
  readonly description?: ReactNode;
  readonly minimumLength?: number | null;
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
      <Input
        name={name}
        type="password"
        autoComplete={purpose}
        {...(minimumLength === undefined || minimumLength === null
          ? {}
          : { minLength: minimumLength })}
      />
    </FormField>
  );
}

/**
 * Contrasena nueva y su repeticion: alta, restablecimiento por correo y por SMS.
 *
 * Con `minimumLength` (de `GET /config`, `password_policy.minimum_length`) la
 * pista dice cuantos caracteres hacen falta ANTES de enviar y el navegador
 * frena una contrasena corta sin gastar el viaje. Sin el -una API anterior o un
 * fallo de configuracion- vuelve a la pista generica y el numero llega con el
 * 422, como antes.
 */
export function NewPasswordFields({
  result,
  minimumLength,
}: {
  readonly result: ActionResult;
  readonly minimumLength: number | null;
}) {
  const t = useTranslations("auth.fields");

  return (
    <>
      <PasswordField
        result={result}
        name="password"
        label={t("password")}
        purpose="new-password"
        description={
          minimumLength === null
            ? t("passwordHint")
            : t("passwordHintMinimum", { count: minimumLength })
        }
        minimumLength={minimumLength}
      />

      <PasswordField
        result={result}
        name="password_confirmation"
        label={t("passwordConfirmation")}
        purpose="new-password"
        minimumLength={minimumLength}
      />
    </>
  );
}

/** Campo oculto con el locale, que la accion valida antes de usarlo. */
export function LocaleField({ locale }: { readonly locale: string }) {
  return <input type="hidden" name="locale" value={locale} />;
}

/**
 * Celular (DEC-060). `type="tel"` abre el teclado numerico en el movil.
 *
 * Controlado a proposito, al contrario que los demas campos: el numero tiene
 * que sobrevivir al paso de "enviar codigo" a "escribir codigo", y ninguna
 * accion devuelve datos. No es un secreto, asi que tenerlo en el estado del
 * cliente no expone nada que el propio campo no ensene ya.
 */
export function PhoneField({
  result,
  value,
  onChange,
}: {
  readonly result: ActionResult;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  const t = useTranslations("auth.fields");
  const fieldError = useFieldError(result);

  return (
    <FormField
      label={t("phone")}
      description={t("phoneHint")}
      required
      requiredHint={t("requiredHint")}
      error={fieldError("phone")}
    >
      <Input
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </FormField>
  );
}

/** Codigo que llego por SMS. `one-time-code` deja que el movil lo sugiera solo. */
export function SmsCodeField({ result }: { readonly result: ActionResult }) {
  const t = useTranslations("auth.fields");
  const fieldError = useFieldError(result);

  return (
    <FormField
      label={t("smsCode")}
      description={t("smsCodeHint")}
      required
      requiredHint={t("requiredHint")}
      error={fieldError("sms_code")}
    >
      <Input name="sms_code" type="text" inputMode="numeric" autoComplete="one-time-code" />
    </FormField>
  );
}

export type AuthChannel = "email" | "phone";

/**
 * Selector "Correo | Celular" (DEC-060).
 *
 * Dos botones con `aria-pressed` y no pestanas: no cambian de pagina ni de
 * panel accesible, cambian que campos pide el formulario de abajo.
 */
export function ChannelSwitch({
  value,
  onChange,
}: {
  readonly value: AuthChannel;
  readonly onChange: (next: AuthChannel) => void;
}) {
  const t = useTranslations("auth.channel");

  return (
    <div role="group" aria-label={t("legend")} className="grid grid-cols-2 gap-s2">
      {(["email", "phone"] as const).map((channel) => (
        <Button
          key={channel}
          type="button"
          variant={value === channel ? "accent" : "secondary"}
          aria-pressed={value === channel}
          onClick={() => {
            onChange(channel);
          }}
        >
          {t(channel)}
        </Button>
      ))}
    </div>
  );
}
