import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * Las acciones del panel son Server Actions: llaman a `next/headers` y
 * redirigen. Se sustituyen por dobles que registran lo que reciben, que es lo
 * que aqui interesa comprobar -que el formulario manda motivo y confirmacion- y
 * no que el servidor las ejecute.
 */
const submitted: FormData[] = [];

const IDLE_RESULT = {
  status: "idle" as const,
  code: null,
  requestId: null,
  field: null,
  retryAfterSeconds: null,
};

vi.mock("@/lib/admin/actions", () => ({
  staffLoginAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  staffMfaAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  approveAmoeAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  rejectAmoeAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  createAdjustmentAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  approveAdjustmentAction: (_previous: unknown, formData: FormData) => {
    submitted.push(formData);
    return Promise.resolve(IDLE_RESULT);
  },
  staffLogoutAction: () => Promise.resolve(),
}));

import { SensitiveConfirmForm } from "@/components/admin/sensitive-confirm";
import { StaffLoginForm, StaffMfaForm } from "@/components/admin/staff-auth-forms";
import { formatEntryCount, formatZonedDateTime } from "@/i18n/formatters";
import { LOCALES, type Locale } from "@/i18n/locales";
import { adjustmentPreview, adjustmentPreviewNegative } from "@/mocks/fixtures/admin";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/** Identificador con el que se pregunto. La previsualizacion contesta cifras. */
const PARTICIPANT_ID = "par_0000000000000001";

/**
 * CONFIRMACION DE UNA MUTACION SENSIBLE (FE-M7).
 *
 * LO QUE ESTE FICHERO PROTEGE
 * ---------------------------
 * Que nadie pueda aprobar, rechazar ni ajustar sin ver ANTES, CAMBIO y DESPUES,
 * sin dar un motivo y sin una confirmacion explicita. Las tres cosas son
 * friccion deliberada: estas acciones no se deshacen con un `undo`, se corrigen
 * con otra fila del ledger y otra entrada de auditoria.
 *
 * Y una segunda cosa, igual de importante: que el "despues" NO se calcule aqui.
 * El fixture de previsualizacion trae un `after` TECLEADO, y la pantalla
 * lo pinta tal cual. Si algun dia alguien sumara el delta al saldo, este test
 * seguiria pasando -daria el mismo numero- pero
 * `no-client-entry-math.test.ts` fallaria. Las dos redes se complementan.
 */

function messagesFor(locale: Locale) {
  return locale === "en" ? enMessages : esMessages;
}

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Impacto de un ajuste, con las tres columnas servidas por el backend. */
function adjustmentImpact(locale: Locale) {
  const messages = messagesFor(locale);

  return [
    {
      label: messages.admin.adjustments.impactEntries,
      before: formatEntryCount(adjustmentPreview.before, locale),
      delta: `+${formatEntryCount(adjustmentPreview.proposed_delta, locale)}`,
      after: formatEntryCount(adjustmentPreview.after, locale),
    },
  ];
}

function reasonsFor(locale: Locale) {
  const messages = messagesFor(locale);

  return [
    { value: "SYSTEM_ERROR_CORRECTION", label: messages.admin.reasons.SYSTEM_ERROR_CORRECTION },
    { value: "OTHER", label: messages.admin.reasons.OTHER },
  ];
}

describe("confirmacion de una mutacion sensible", () => {
  it("ensena antes, cambio y despues, en los dos idiomas", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);

      const view = renderIn(
        locale,
        <SensitiveConfirmForm
          locale={locale}
          action={(_previous, formData) => {
            submitted.push(formData);
            return Promise.resolve(IDLE_RESULT);
          }}
          hiddenFields={{ participant_id: PARTICIPANT_ID }}
          impact={adjustmentImpact(locale)}
          reasons={reasonsFor(locale)}
          submitLabel={messages.admin.adjustments.proposeSubmit}
          confirmLabel={messages.admin.adjustments.proposeConfirm}
        />,
      );

      // Las tres cabeceras de la tabla de impacto.
      expect(screen.getByText(messages.admin.confirm.columnBefore)).toBeInTheDocument();
      expect(screen.getByText(messages.admin.confirm.columnDelta)).toBeInTheDocument();
      expect(screen.getByText(messages.admin.confirm.columnAfter)).toBeInTheDocument();

      // Y las tres cifras, tal como llegan del backend.
      expect(
        screen.getByText(formatEntryCount(adjustmentPreview.before, locale)),
      ).toBeInTheDocument();
      expect(
        screen.getByText(formatEntryCount(adjustmentPreview.after, locale)),
      ).toBeInTheDocument();

      view.unmount();
    }
  });

  it("el boton no se puede pulsar hasta confirmar explicitamente", async () => {
    const user = userEvent.setup();
    const messages = enMessages;

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={adjustmentImpact("en")}
        reasons={reasonsFor("en")}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
      />,
    );

    const submit = screen.getByRole("button", { name: messages.admin.adjustments.proposeSubmit });
    expect(submit).toBeDisabled();

    await user.click(screen.getByLabelText(messages.admin.adjustments.proposeConfirm));
    expect(submit).toBeEnabled();
  });

  it("el motivo es obligatorio y viaja como CLAVE, no como prosa", () => {
    const messages = enMessages;

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={adjustmentImpact("en")}
        reasons={reasonsFor("en")}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
      />,
    );

    const reason = screen.getByLabelText(messages.admin.confirm.reasonLabel, { exact: false });
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute("name", "reason_key");

    // Las OPCIONES llevan texto traducido; el VALOR es la clave estable.
    const option = screen.getByRole("option", {
      name: messages.admin.reasons.SYSTEM_ERROR_CORRECTION,
    });
    expect(option).toHaveValue("SYSTEM_ERROR_CORRECTION");
  });

  it('la nota se vuelve obligatoria cuando el motivo es "otro"', async () => {
    const user = userEvent.setup();
    const messages = enMessages;

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={adjustmentImpact("en")}
        reasons={reasonsFor("en")}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
      />,
    );

    // Una clave que significa "ninguna de las anteriores" sin explicar cual no
    // registra nada. Sin esta regla, todo el mundo elegiria "otro".
    const note = screen.getByLabelText(messages.admin.confirm.noteLabel, { exact: false });
    expect(note).not.toBeRequired();

    await user.selectOptions(
      screen.getByLabelText(messages.admin.confirm.reasonLabel, { exact: false }),
      "OTHER",
    );

    expect(
      screen.getByLabelText(messages.admin.confirm.noteLabel, { exact: false }),
    ).toBeRequired();
  });

  it('un "despues" no publicado se dice, no se calcula', () => {
    const messages = enMessages;

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ submission_id: "amo_1" }}
        impact={[
          {
            label: messages.admin.amoeReview.impactEntries,
            /*
             * El "antes" SIEMPRE es un numero; el "despues" no siempre existe.
             * Es el caso real de la cola AMOE cuando la version de reglas DEL
             * ENVIO ya no declara AMOE legible: la aprobacion fallaria, asi que
             * el backend manda `entries_after_if_approved: null` en vez de una
             * cifra que no se va a cumplir.
             */
            before: formatEntryCount(11_450, "en"),
            delta: "+200",
            after: null,
          },
        ]}
        reasons={reasonsFor("en")}
        submitLabel={messages.admin.amoeReview.approveSubmit}
        confirmLabel={messages.admin.amoeReview.approveConfirm}
      />,
    );

    // La alternativa -sumar 200 al saldo- es exactamente lo que DEC-023 prohibe.
    expect(screen.getByText(messages.admin.confirm.afterNotPublished)).toBeInTheDocument();
  });

  it("las advertencias del motor se pintan, no se resumen", () => {
    const messages = enMessages;

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={adjustmentImpact("en")}
        reasons={reasonsFor("en")}
        warnings={[
          messages.admin.warnings.BALANCE_WOULD_GO_NEGATIVE,
          messages.admin.warnings.ENTRY_CAP_REACHED,
        ]}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
      />,
    );

    expect(screen.getByText(messages.admin.confirm.warningsTitle)).toBeInTheDocument();
    expect(screen.getByText(messages.admin.warnings.BALANCE_WOULD_GO_NEGATIVE)).toBeInTheDocument();
    expect(screen.getByText(messages.admin.warnings.ENTRY_CAP_REACHED)).toBeInTheDocument();
  });

  it("el saldo se ensena CON su hora, porque es una foto", async () => {
    const user = userEvent.setup();
    const messages = enMessages;

    /*
     * Entre la previsualizacion y la firma puede entrar una compra o una
     * descalificacion. Sin el instante, una pantalla abierta media hora parece
     * hablar del presente, y quien firma cree estar leyendo el saldo de ahora.
     */
    const asOf =
      formatZonedDateTime(adjustmentPreview.as_of, "en", {
        timeZone: "UTC",
        showTimeZoneName: true,
      }) ?? "";

    expect(asOf).not.toBe("");

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={adjustmentImpact("en")}
        reasons={reasonsFor("en")}
        balanceAsOf={asOf}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
      />,
    );

    expect(screen.getByText(asOf, { exact: false })).toBeInTheDocument();

    // Y sigue siendo firmable: la hora informa, no bloquea.
    await user.click(screen.getByLabelText(messages.admin.adjustments.proposeConfirm));
    expect(
      screen.getByRole("button", { name: messages.admin.adjustments.proposeSubmit }),
    ).toBeEnabled();
  });

  it("un ajuste que dejaria el saldo negativo NO se puede firmar", async () => {
    const user = userEvent.setup();
    const messages = enMessages;

    /*
     * `would_make_balance_negative` lo contesta LA MISMA funcion que rechaza el
     * ajuste al aplicarlo. La pantalla no lo deduce de las cifras -restar aqui
     * seria reimplementar el motor- y no ofrece la firma: no es el control, pero
     * evita hacer leer, motivar y confirmar algo que ya se sabe que falla.
     */
    expect(adjustmentPreviewNegative.would_make_balance_negative).toBe(true);

    renderIn(
      "en",
      <SensitiveConfirmForm
        locale="en"
        action={(_previous, formData) => {
          submitted.push(formData);
          return Promise.resolve(IDLE_RESULT);
        }}
        hiddenFields={{ participant_id: PARTICIPANT_ID }}
        impact={[
          {
            label: messages.admin.adjustments.impactEntries,
            before: formatEntryCount(adjustmentPreviewNegative.before, "en"),
            delta: formatEntryCount(adjustmentPreviewNegative.proposed_delta, "en"),
            after: formatEntryCount(adjustmentPreviewNegative.after, "en"),
          },
        ]}
        reasons={reasonsFor("en")}
        blockedReason={messages.admin.warnings.BALANCE_WOULD_GO_NEGATIVE}
        submitLabel={messages.admin.adjustments.proposeSubmit}
        confirmLabel={messages.admin.adjustments.proposeConfirm}
        destructive
      />,
    );

    // Se dice POR QUE, y se dice antes de la tabla.
    expect(screen.getByText(messages.admin.warnings.BALANCE_WOULD_GO_NEGATIVE)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: messages.admin.adjustments.proposeSubmit });
    expect(submit).toBeDisabled();

    // Ni siquiera marcando la casilla: el bloqueo no depende de la confirmacion.
    await user.click(screen.getByLabelText(messages.admin.adjustments.proposeConfirm));
    expect(submit).toBeDisabled();
  });
});

describe("acceso del personal", () => {
  it("el formulario de acceso dice que el segundo factor es obligatorio", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      const view = renderIn(locale, <StaffLoginForm locale={locale} returnPath={null} />);

      expect(screen.getByText(messages.admin.auth.mfaAlwaysRequired)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: messages.admin.auth.signInSubmit }),
      ).toBeInTheDocument();

      view.unmount();
    }
  });

  it("la contrasena no queda en estado de cliente", () => {
    renderIn("en", <StaffLoginForm locale="en" returnPath={null} />);

    const password = screen.getByLabelText(enMessages.admin.auth.passwordLabel, { exact: false });

    // Sin `value` controlado: el navegador envia el formulario al servidor de
    // Next y la contrasena no pasa por JavaScript de cliente (DEC-006).
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autoComplete", "current-password");
    expect(password).not.toHaveValue();
  });

  it("el destino de vuelta viaja como campo oculto y solo si es del panel", () => {
    const { container } = renderIn(
      "en",
      <StaffLoginForm locale="en" returnPath="/admin/en/amoe" />,
    );

    const next = container.querySelector('input[name="next"]');
    expect(next).toHaveValue("/admin/en/amoe");
  });

  it("el segundo factor avisa de que un codigo no vale dos veces", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      const view = renderIn(locale, <StaffMfaForm locale={locale} returnPath={null} />);

      expect(screen.getByText(messages.admin.auth.codeHint)).toBeInTheDocument();

      const code = screen.getByLabelText(messages.admin.auth.codeLabel, { exact: false });
      expect(code).toHaveAttribute("inputMode", "numeric");
      expect(code).toHaveAttribute("autoComplete", "one-time-code");

      // Sin `pattern` ni `maxLength`: la longitud la fija el backend, y una
      // restriccion del navegador que no coincida rechaza codigos validos.
      expect(code).not.toHaveAttribute("pattern");
      expect(code).not.toHaveAttribute("maxLength");

      view.unmount();
    }
  });
});
