import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({
  locale: "es",
  fetchActivePromotion: vi.fn(),
  fetchPromotions: vi.fn(),
  fetchEntrySummary: vi.fn(),
  fetchEntryNumbers: vi.fn(),
  fetchEntryTransactions: vi.fn(),
  fetchOrders: vi.fn(),
}));

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");
  return {
    usePathname: () => "/account",
    redirect: () => undefined,
    getPathname: ({ href }: { href: string }) => href,
    Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
      createElement("a", { href, ...rest }, children),
  };
});

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const en = (await import("../../messages/en-US.json")).default;
  const es = (await import("../../messages/es-US.json")).default;
  return {
    setRequestLocale: () => undefined,
    getTranslations: (namespace?: string) => {
      const locale = current.locale === "en" ? "en" : "es";
      const messages = current.locale === "en" ? en : es;
      return Promise.resolve(
        namespace === undefined
          ? createTranslator({ locale, messages })
          : createTranslator({ locale, messages, namespace: namespace as never }),
      );
    },
  };
});

vi.mock("@/components/account-shell", () => ({
  AccountShell: ({ children }: { children: ReactNode }) => children,
  MfaRequired: () => null,
  SignInRequired: () => null,
}));

vi.mock("@/components/email-verification", () => ({ UnverifiedEmailNotice: () => null }));

vi.mock("@/lib/flags-server", () => ({
  loadFeatureFlags: () => Promise.resolve(new Map([["visible_entry_numbers_enabled", true]])),
}));

vi.mock("@/lib/participant-server", async () => {
  const { participant } = await import("@/mocks/fixtures/account");
  return {
    loadParticipant: () =>
      Promise.resolve({
        session: { cookie: "c" },
        state: { kind: "authenticated", session: {}, participant },
      }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  return {
    ...original,
    fetchActivePromotion: current.fetchActivePromotion,
    fetchPromotions: current.fetchPromotions,
    fetchEntrySummary: current.fetchEntrySummary,
    fetchEntryNumbers: current.fetchEntryNumbers,
    fetchEntryTransactions: current.fetchEntryTransactions,
    fetchOrders: current.fetchOrders,
  };
});

import AccountOverviewPage from "@/app/[locale]/account/page";
import AccountLedgerPage from "@/app/[locale]/account/entries/ledger/page";
import AccountEntriesPage from "@/app/[locale]/account/entries/page";
import { latestEndedPromotion, loadAccountPromotion } from "@/lib/account-promotion";
import type * as ApiModule from "@/lib/api";
import type { PromotionStatus, PromotionSummary } from "@/lib/api";
import { CLOSING_EDITION } from "@/lib/closing-notice";
import {
  emptyEntryNumbersPage,
  emptySummary,
  entryNumbersPage,
  entrySummary,
  entryTransactions,
} from "@/mocks/fixtures/account";
import { activePromotion, closedPromotion } from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * La cuenta sigue ensenando las participaciones de una edicion cerrada (DEC-102).
 */

function promotion(
  slug: string,
  status: PromotionStatus,
  endsAt: string,
  rules: string | null = "rules",
): PromotionSummary {
  return { ...closedPromotion, slug, status, ends_at: endsAt, rules_version_id: rules };
}

const ok = <T,>(data: T) => ({ ok: true as const, data });
const failed = { ok: false as const, error: { status: 503 } };
const params = Promise.resolve({ locale: "es" });
const searchParams = Promise.resolve({});

function show(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={current.locale === "en" ? "en" : "es"}
      messages={current.locale === "en" ? enMessages : esMessages}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

function withEnded(edition: PromotionSummary = closedPromotion) {
  current.fetchActivePromotion.mockResolvedValue(ok(null));
  current.fetchPromotions.mockResolvedValue(ok({ items: [edition], next_cursor: null }));
}

beforeEach(() => {
  current.locale = "es";
  for (const mock of [
    current.fetchActivePromotion,
    current.fetchPromotions,
    current.fetchEntrySummary,
    current.fetchEntryNumbers,
    current.fetchEntryTransactions,
    current.fetchOrders,
  ]) {
    mock.mockReset();
  }
  current.fetchEntrySummary.mockResolvedValue(ok(entrySummary));
  current.fetchEntryNumbers.mockResolvedValue(ok(entryNumbersPage));
  current.fetchEntryTransactions.mockResolvedValue(
    ok({ items: entryTransactions, next_cursor: null }),
  );
  current.fetchOrders.mockResolvedValue(ok({ items: [], next_cursor: null }));
});

describe("latestEndedPromotion", () => {
  it("elige la terminada mas reciente", () => {
    const older = promotion("vieja", "COMPLETED", "2026-01-01T00:00:00.000Z");
    const newer = promotion("nueva", "CLOSED", "2026-11-09T05:59:00.000Z");
    expect(latestEndedPromotion([older, newer])?.slug).toBe("nueva");
  });

  it.each(["EXPORT_PREPARATION", "DRAW_PENDING", "POTENTIAL_WINNER_REVIEW"] as const)(
    "sigue ensenandola en %s",
    (status) => {
      expect(latestEndedPromotion([promotion("a", status, "2026-11-09T00:00:00.000Z")])).not.toBe(
        null,
      );
    },
  );

  it.each(["SCHEDULED", "DRAFT", "CANCELLED", "ACTIVE"] as const)("nunca ensena %s", (status) => {
    expect(latestEndedPromotion([promotion("a", status, "2030-01-01T00:00:00.000Z")])).toBeNull();
  });

  it("no ensena una edicion sin reglas publicadas", () => {
    expect(
      latestEndedPromotion([promotion("a", "CLOSED", "2026-11-09T00:00:00.000Z", null)]),
    ).toBeNull();
  });
});

describe("loadAccountPromotion", () => {
  it("con una activa, esa, sin consultar la lista", async () => {
    current.fetchActivePromotion.mockResolvedValue(ok(activePromotion));

    expect(await loadAccountPromotion("es")).toEqual({ promotion: activePromotion, ended: false });
    expect(current.fetchPromotions).not.toHaveBeenCalled();
  });

  it("sin activa, la ultima terminada", async () => {
    withEnded();

    expect(await loadAccountPromotion("es")).toEqual({ promotion: closedPromotion, ended: true });
  });

  it("si no se sabe cual es la activa, no ensena otra", async () => {
    current.fetchActivePromotion.mockResolvedValue(failed);

    expect(await loadAccountPromotion("es")).toBeNull();
    expect(current.fetchPromotions).not.toHaveBeenCalled();
  });

  it("si falla la lista, no hay edicion que ensenar", async () => {
    current.fetchActivePromotion.mockResolvedValue(ok(null));
    current.fetchPromotions.mockResolvedValue(failed);

    expect(await loadAccountPromotion("es")).toBeNull();
  });
});

describe("Mis participaciones con la edicion cerrada", () => {
  async function renderEntries() {
    show(await AccountEntriesPage({ params, searchParams }));
  }

  it("pide el saldo y los numeros de esa edicion y avisa que termino", async () => {
    withEnded();

    await renderEntries();

    expect(current.fetchEntrySummary.mock.calls[0]?.[0]).toBe(closedPromotion.id);
    expect(current.fetchEntryNumbers.mock.calls[0]?.[0]).toMatchObject({
      promotion_id: closedPromotion.id,
    });
    expect(screen.getByText("Periodo de participación terminado")).toBeInTheDocument();
    expect(document.body.textContent).toContain("se rige por las Reglas Oficiales");
  });

  it("sin participaciones no invita a comprar", async () => {
    withEnded();
    current.fetchEntrySummary.mockResolvedValue(ok(emptySummary));
    current.fetchEntryNumbers.mockResolvedValue(ok(emptyEntryNumbersPage));

    await renderEntries();

    expect(screen.getByText("No tienes participaciones en esta edición")).toBeInTheDocument();
    expect(document.querySelector('a[href="/shop"]')).toBeNull();
  });

  it("con una promocion activa no cambia nada", async () => {
    current.fetchActivePromotion.mockResolvedValue(ok(activePromotion));
    current.fetchEntrySummary.mockResolvedValue(ok(emptySummary));
    current.fetchEntryNumbers.mockResolvedValue(ok(emptyEntryNumbersPage));

    await renderEntries();

    expect(screen.queryByText("Periodo de participación terminado")).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/shop"]')).not.toBeNull();
  });

  it("sin ninguna edicion mantiene el mensaje de siempre", async () => {
    current.fetchActivePromotion.mockResolvedValue(ok(null));
    current.fetchPromotions.mockResolvedValue(ok({ items: [], next_cursor: null }));

    await renderEntries();

    expect(document.body.textContent).toContain("no hay ninguna promoción abierta");
  });

  it("en esta edicion dice la fecha del sorteo y enlaza sus reglas", async () => {
    withEnded({
      ...closedPromotion,
      slug: CLOSING_EDITION.slug,
      ends_at: "2026-11-09T05:59:00.000Z",
      legal_timezone: CLOSING_EDITION.legalTimeZone,
    });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-09T20:00:00.000Z") });

    await renderEntries();
    vi.useRealTimers();

    expect(document.body.textContent).toContain("programada para el 11 de noviembre");
    expect(
      document.querySelector(`a[href="/official-rules?promotion=${CLOSING_EDITION.slug}"]`),
    ).not.toBeNull();
  });

  it("nunca anuncia ganadores ni afirma que la participacion sea valida", () => {
    const copy = JSON.stringify([esMessages.account.endedEdition, enMessages.account.endedEdition]);
    expect(copy).not.toMatch(/ganador|ganaste|winner|you won|confirmad|confirmed|válida/iu);
  });
});

describe("el resto de la cuenta con la edicion cerrada", () => {
  it("el historial pide los movimientos de esa edicion", async () => {
    withEnded();

    show(await AccountLedgerPage({ params, searchParams }));

    expect(current.fetchEntryTransactions.mock.calls[0]?.[0]).toMatchObject({
      promotion_id: closedPromotion.id,
    });
    expect(screen.getByText("Periodo de participación terminado")).toBeInTheDocument();
  });

  it("el resumen la presenta como ultima edicion, no como vigente", async () => {
    withEnded();

    show(await AccountOverviewPage({ params }));

    expect(screen.getByText("Última edición")).toBeInTheDocument();
    expect(screen.queryByText("Promoción vigente")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Cerró:");
    expect(current.fetchEntrySummary.mock.calls[0]?.[0]).toBe(closedPromotion.id);
  });
});
