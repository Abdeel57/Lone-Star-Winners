import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/account",
    redirect: () => undefined,
    getPathname: ({ href }: { href: string }) => href,
    Link: ({
      href,
      locale,
      children,
      ...rest
    }: {
      href: string;
      locale?: string;
      children: ReactNode;
    }) =>
      createElement(
        "a",
        { href: locale === undefined ? href : `/${locale}${href}`, ...rest },
        children,
      ),
  };
});

vi.mock("@/lib/account-actions", () => {
  const idle = { status: "idle" as const, code: null, requestId: null, field: null };
  return { updateProfileAction: () => Promise.resolve(idle) };
});

import { EntryCalculationTrace } from "@/components/entry-calculation-trace";
import { EntryLedgerList } from "@/components/entry-ledger-list";
import { EntryNumberList } from "@/components/entry-number-list";
import { EntrySummaryCards } from "@/components/entry-summary-cards";
import { OrderCard } from "@/components/order-card";
import { OrderLineList } from "@/components/order-line-list";
import { ProfileForm } from "@/components/profile-form";
import { formatEntryCount } from "@/i18n/formatters";
import { readCalculationTrace } from "@/lib/entry-calculation";
import { LOCALES, type Locale } from "@/i18n/locales";
import {
  chargebackOrder,
  emptyEntryNumbersPage,
  emptySummary,
  entryNumbersPage,
  entrySummary,
  entryTransactions,
  grantedOrder,
  orderSummaries,
  participant,
  purchaseNumberBatch,
  refundedOrder,
  summaryWithReversals,
} from "@/mocks/fixtures/account";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Portal del participante (FE-M4).
 *
 * LA RED MAS IMPORTANTE DE ESTE FICHERO
 * -------------------------------------
 * No es que las tarjetas se pinten: es que NINGUNA cifra de participaciones se
 * derive aqui. El caso decisivo es `summaryWithReversals`, cuyo total NO
 * coincide con la suma de sus dos procedencias -hay un ajuste manual por
 * medio-. Una pantalla que sumara pasaria todos los demas tests y fallaria este.
 *
 * La segunda red: que las correcciones del ledger SE VEAN. Una devolucion es
 * una fila nueva con delta negativo y la original sigue estando (DEC-007); una
 * pantalla que las ocultara convertiria el historial en un resumen.
 */

const TIME_ZONE = "America/Chicago";

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("saldo de participaciones", () => {
  it.each(LOCALES)("pinta el total y su procedencia en %s", (locale) => {
    renderIn(
      locale,
      <EntrySummaryCards summary={entrySummary} locale={locale} timeZone={TIME_ZONE} />,
    );

    expect(
      screen.getByText(formatEntryCount(entrySummary.active_entries, locale)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(formatEntryCount(entrySummary.purchase_entries, locale)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(formatEntryCount(entrySummary.amoe_entries, locale)),
    ).toBeInTheDocument();
  });

  it("el total es el SERVIDO, aunque no cuadre con la suma de sus procedencias", () => {
    /*
     * `summaryWithReversals` trae 11.250 de compra, 200 de AMOE y un total de
     * 11.700, porque hay 250 de un ajuste manual aprobado que no es ni una cosa
     * ni la otra. Si alguien sustituyera el total servido por una suma, la
     * pantalla ensenaria 11.450 y este test lo diria.
     */
    renderIn(
      "en",
      <EntrySummaryCards summary={summaryWithReversals} locale="en" timeZone={TIME_ZONE} />,
    );

    expect(screen.getByText("11,700")).toBeInTheDocument();
    expect(screen.queryByText("11,450")).toBeNull();
  });

  it("dice que compra y AMOE son el mismo conjunto (principio 9)", () => {
    renderIn("en", <EntrySummaryCards summary={entrySummary} locale="en" timeZone={TIME_ZONE} />);
    expect(screen.getByText(enMessages.account.entries.originNote)).toBeInTheDocument();
  });

  it("un participante sin participaciones ve ceros y no un hueco", () => {
    renderIn("en", <EntrySummaryCards summary={emptySummary} locale="en" timeZone={TIME_ZONE} />);
    expect(screen.getAllByText("0")).toHaveLength(3);
  });
});

describe("numeros de participacion (DEC-080)", () => {
  function renderNumbers(
    locale: Locale,
    page = entryNumbersPage,
    links: { moreHref: string | null; firstHref: string | null } = {
      moreHref: null,
      firstHref: null,
    },
  ) {
    return renderIn(
      locale,
      <EntryNumberList page={page} locale={locale} timeZone={TIME_ZONE} {...links} />,
    );
  }

  it("pinta cada numero tal cual llega, con sus ceros a la izquierda", () => {
    renderNumbers("en");

    for (const entry of purchaseNumberBatch.numbers) {
      expect(screen.getByText(entry.number)).toBeInTheDocument();
    }
    // `04669096` no se convierte en `4,669,096` ni en `4669096` (DEC-010).
    expect(screen.getByText("04669096")).toBeInTheDocument();
  });

  it("los anulados se ven tachados y se anuncian como anulados", () => {
    renderNumbers("es");

    const voided = screen.getByText("70215844").closest("li");
    expect(voided).toHaveClass("line-through");
    expect(voided).toHaveTextContent(esMessages.account.entries.numberVoid);

    const active = screen.getByText("04669096").closest("li");
    expect(active).not.toHaveClass("line-through");
    expect(active).not.toHaveTextContent(esMessages.account.entries.numberVoid);
  });

  it("dice cuantos hay vigentes y anulados, con las cifras del servidor", () => {
    renderNumbers("en");
    expect(screen.getByText("2,005 active numbers")).toBeInTheDocument();
    expect(screen.getByText("3 void numbers")).toBeInTheDocument();
  });

  it("un lote partido entre paginas dice cuantos de su total se ven aqui", () => {
    renderNumbers("es");
    expect(screen.getByText("En esta página: 4 de 2,000 números.")).toBeInTheDocument();
  });

  it("enlaza a la pagina siguiente y de vuelta al principio", () => {
    renderNumbers("es", entryNumbersPage, {
      moreHref: "/account/entries?cursor=abc#numeros",
      firstHref: "/account/entries#numeros",
    });

    expect(
      screen.getByRole("link", { name: esMessages.account.entries.numbersMore }),
    ).toHaveAttribute("href", "/account/entries?cursor=abc#numeros");
    expect(
      screen.getByRole("link", { name: esMessages.account.entries.numbersFirstPage }),
    ).toHaveAttribute("href", "/account/entries#numeros");
  });

  it("sin numeros lo dice, en vez de dejar la seccion vacia", () => {
    renderNumbers("es", emptyEntryNumbersPage);
    expect(screen.getByText(esMessages.account.entries.numbersEmpty)).toBeInTheDocument();
  });

  it.each(LOCALES)("advierte que los numeros no son el sorteo en %s", (locale) => {
    // DEC-017 y principio 11: quien ve numeros asume que se sortea sobre ellos
    // si nadie le dice quien elige al ganador.
    renderNumbers(locale);

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.account.entries.numbersNote)).toBeInTheDocument();
  });

  it.each(LOCALES)("no usa vocabulario de rifa en %s", (locale) => {
    const { container } = renderNumbers(locale);
    expect(container.textContent).not.toMatch(/boleto|ticket|raffle|rifa|chance to win/iu);
  });
});

describe("historial del ledger", () => {
  it("las correcciones SIGUEN estando, con su movimiento original", () => {
    const { container } = renderIn(
      "en",
      <EntryLedgerList transactions={entryTransactions} locale="en" timeZone={TIME_ZONE} />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(entryTransactions.length);

    // La devolucion y el contracargo, con su signo.
    expect(screen.getByText(enMessages.entryReason.ORDER_REFUNDED)).toBeInTheDocument();
    expect(screen.getByText(enMessages.entryReason.ORDER_CHARGEBACK)).toBeInTheDocument();
  });

  it("un movimiento negativo se pinta con su signo, sin recalcularlo", () => {
    const reversal = entryTransactions.find((item) => item.quantity_delta < 0);
    expect(reversal).toBeDefined();
    if (reversal === undefined) return;

    renderIn("en", <EntryLedgerList transactions={[reversal]} locale="en" timeZone={TIME_ZONE} />);

    expect(screen.getByText(formatEntryCount(reversal.quantity_delta, "en"))).toBeInTheDocument();
  });

  it("marca las filas que revierten a otra", () => {
    renderIn(
      "es",
      <EntryLedgerList transactions={entryTransactions} locale="es" timeZone={TIME_ZONE} />,
    );

    const reversals = entryTransactions.filter((item) => item.reverses_transaction_id !== null);
    expect(screen.getAllByText(esMessages.account.ledger.reversalOf)).toHaveLength(
      reversals.length,
    );
  });

  it("un tipo o un motivo que el frontend no conoce no aparece en crudo", () => {
    const unknown = entryTransactions.find((item) => item.type.includes("DOES_NOT_KNOW"));
    expect(unknown).toBeDefined();
    if (unknown === undefined) return;

    const { container } = renderIn(
      "en",
      <EntryLedgerList transactions={[unknown]} locale="en" timeZone={TIME_ZONE} />,
    );

    expect(container.textContent).not.toContain("DOES_NOT_KNOW");
    expect(screen.getByText(enMessages.entryType.fallback)).toBeInTheDocument();
    expect(screen.getByText(enMessages.entryReason.fallback)).toBeInTheDocument();
  });

  it.each(LOCALES)("cada procedencia se nombra en %s", (locale) => {
    renderIn(
      locale,
      <EntryLedgerList transactions={entryTransactions} locale={locale} timeZone={TIME_ZONE} />,
    );

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getAllByText(messages.entrySource.AMOE).length).toBeGreaterThan(0);
    expect(screen.getAllByText(messages.entrySource.PURCHASE).length).toBeGreaterThan(0);
  });
});

describe("pedidos", () => {
  it.each(LOCALES)("cada pedido pinta SUS DOS estados en %s", (locale) => {
    // El del pedido y el de sus participaciones. Uno no se deduce del otro.
    const order = orderSummaries[0];
    expect(order).toBeDefined();
    if (order === undefined) return;

    renderIn(locale, <OrderCard order={order} locale={locale} timeZone={TIME_ZONE} />);

    const messages = locale === "en" ? enMessages : esMessages;
    expect(screen.getByText(messages.orderStatus[order.status])).toBeInTheDocument();
    expect(screen.getByText(messages.orderEntryState[order.entry_state])).toBeInTheDocument();
  });

  it("un pedido pendiente NO ensena un cero donde no se sabe todavia", () => {
    const pending = orderSummaries.find((order) => order.entry_state === "PENDING_QUALIFICATION");
    expect(pending).toBeDefined();
    if (pending === undefined) return;
    expect(pending.entries_granted).toBeNull();

    renderIn("en", <OrderCard order={pending} locale="en" timeZone={TIME_ZONE} />);

    expect(screen.getByText(enMessages.orderEntryState.PENDING_QUALIFICATION)).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("un pedido devuelto y uno con contracargo NO dicen lo mismo", () => {
    renderIn("en", <OrderCard order={refundedOrder} locale="en" timeZone={TIME_ZONE} />);
    expect(screen.getByText(enMessages.orderStatus.REFUNDED)).toBeInTheDocument();

    renderIn("en", <OrderCard order={chargebackOrder} locale="en" timeZone={TIME_ZONE} />);
    expect(screen.getByText(enMessages.orderStatus.CHARGEBACK)).toBeInTheDocument();
  });

  it("las lineas pintan el total que llega, sin multiplicar", () => {
    renderIn("en", <OrderLineList lines={grantedOrder.items} locale="en" />);

    // 2 x $25.00 = $50.00, y el $50.00 viene del backend. Que coincida es
    // correcto; lo que no puede es haberse calculado aqui.
    expect(screen.getByText("$50.00")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });
});

describe("traza del calculo de un pedido", () => {
  it.each(LOCALES)("publica version de reglas y del motor en %s", (locale) => {
    const calculation = grantedOrder.entry_calculation;
    expect(calculation).toBeDefined();
    if (calculation === null || calculation === undefined) return;

    const { container } = renderIn(
      locale,
      <EntryCalculationTrace
        calculation={calculation}
        locale={locale}
        timeZone={TIME_ZONE}
        currency="USD"
      />,
    );

    // Sin la procedencia no se puede explicar la cifra meses despues (DEC-012).
    expect(container.textContent).toContain(calculation.rules_version_id);
    expect(container.textContent).toContain(String(calculation.engine_version));
  });

  it("explica por que la cifra bajo, en vez de ensenar un numero menor sin motivo", () => {
    const calculation = grantedOrder.entry_calculation;
    if (calculation === null || calculation === undefined) return;
    const entriesBeforeCaps = readCalculationTrace(calculation, "USD").entriesBeforeCaps;
    expect(entriesBeforeCaps).not.toBeNull();
    expect(calculation.final_entries).not.toBe(entriesBeforeCaps);

    renderIn(
      "en",
      <EntryCalculationTrace
        calculation={calculation}
        locale="en"
        timeZone={TIME_ZONE}
        currency="USD"
      />,
    );

    expect(screen.getByText(enMessages.account.order.calculationCaps)).toBeInTheDocument();

    // La cifra ANTES de los topes aparece justamente porque difiere de la
    // final: es lo que permite explicar por que bajo.
    expect(
      screen.getByText(
        enMessages.account.order.calculationBeforeCaps.replace(
          "{entries}",
          formatEntryCount(entriesBeforeCaps ?? 0, "en"),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("el multiplicador se imprime como fraccion, nunca como decimal", () => {
    const calculation = grantedOrder.entry_calculation;
    if (calculation === null || calculation === undefined) return;

    const { container } = renderIn(
      "en",
      <EntryCalculationTrace
        calculation={calculation}
        locale="en"
        timeZone={TIME_ZONE}
        currency="USD"
      />,
    );

    // DEC-010: `3/2` no se puede pintar como "1.5x" sin redondear una cifra que
    // el motor aplica exacta. Aqui es 2/1 y se escribe asi.
    expect(container.textContent).toContain("2/1");
    expect(container.textContent).not.toContain("2.0");
  });

  it("sin traza registrada lo dice, en vez de dejar la seccion vacia", () => {
    renderIn(
      "es",
      <EntryCalculationTrace calculation={null} locale="es" timeZone={TIME_ZONE} currency="USD" />,
    );
    expect(screen.getByText(esMessages.account.order.noCalculation)).toBeInTheDocument();
  });

  it("con la forma MINIMA del contrato -una traza sin desglose- pinta la cifra y no cae", () => {
    /*
     * REGRESION (DEC-078). La API publica `entry_calculation` con cinco campos y
     * la traza del motor dentro de `trace`. La pantalla leia `applied_multipliers`
     * del primer nivel, que no existe, y hacia `.length` sobre `undefined`: la
     * ficha de cualquier pedido otorgado -tarjeta o efectivo- caia con un error
     * de servidor. Una traza vacia o rara se tiene que poder pintar igual.
     */
    const { container } = renderIn(
      "en",
      <EntryCalculationTrace
        calculation={{
          rules_version_id: "prv_minimal",
          engine_version: 2,
          evaluated_at: "2026-10-05T16:00:00.000Z",
          final_entries: 50,
          trace: { applied_caps: "no es una lista", ineligible_items: [{ sku: 1 }] },
        }}
        locale="en"
        timeZone={TIME_ZONE}
        currency="USD"
      />,
    );

    expect(container.textContent).toContain("prv_minimal");
    expect(screen.queryByText(enMessages.account.order.calculationCaps)).not.toBeInTheDocument();
  });

  it("un pedido devuelto conserva su traza original", () => {
    // El reversal no borra el calculo: lo que paso sigue pudiendo explicarse.
    expect(refundedOrder.entry_calculation).not.toBeNull();
    expect(chargebackOrder.entry_calculation).not.toBeNull();
  });
});

describe("perfil", () => {
  it.each(LOCALES)("el correo se ensena y no se edita en %s", (locale) => {
    const { container } = renderIn(
      locale,
      <ProfileForm participant={participant} locale={locale} />,
    );

    const email = container.querySelector('input[name="email_display"]');
    expect(email).not.toBeNull();
    expect(email?.hasAttribute("disabled")).toBe(true);

    // Y no viaja con el formulario: no hay ningun campo `email`.
    expect(container.querySelector('input[name="email"]')).toBeNull();
  });

  it("ofrece los dos idiomas como iguales", () => {
    const { container } = renderIn("en", <ProfileForm participant={participant} locale="en" />);

    const options = container.querySelectorAll('select[name="language_preference"] option');
    expect(options).toHaveLength(2);
    expect([...options].map((option) => option.getAttribute("value"))).toEqual(["en-US", "es-US"]);
  });
});
