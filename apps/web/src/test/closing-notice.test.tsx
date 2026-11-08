import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  sessionKind: "anonymous",
  fetchPromotion: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () =>
    Promise.resolve({
      get: () => (server.cookieValue === undefined ? undefined : { value: server.cookieValue }),
    }),
}));

vi.mock("@/lib/api", () => ({ fetchPromotion: server.fetchPromotion }));

vi.mock("@/lib/participant-server", () => ({
  loadSession: async () =>
    Promise.resolve({
      state:
        server.sessionKind === "active"
          ? { kind: "active", session: { email: "persona@example.com", phone: null } }
          : { kind: server.sessionKind },
    }),
}));

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    Link: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: ReactNode;
      className?: string;
    }) => createElement("a", { href, ...rest }, children),
  };
});

import { ClosingNoticeBody, loadClosingNotice } from "@/components/closing-notice";
import { ClosingNoticeFrame } from "@/components/closing-notice-frame";
import { formatZonedDate, formatZonedMonthDay, formatZonedTime } from "@/i18n/formatters";
import type { Locale } from "@/i18n/locales";
import {
  CLOSING_EDITION,
  CLOSING_NOTICE_COOKIE,
  isClosingNoticeDismissed,
  resolveClosingPhase,
  type ClosingNoticePhase,
} from "@/lib/closing-notice";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Aviso de cierre de la primera edicion (DEC-100).
 *
 * Lo que importa es lo que el aviso NO puede decir: una fecha distinta de la del
 * reglamento, una invitacion a comprar o un ganador.
 */

const TZ = CLOSING_EDITION.legalTimeZone;

/** Tal como la publica hoy la API: 59 s antes que el reglamento. */
const edition = {
  slug: CLOSING_EDITION.slug,
  status: "ACTIVE",
  ends_at: "2026-11-09T05:59:00.000Z",
  legal_timezone: TZ,
} as const;

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

function renderBody(
  locale: Locale,
  phase: ClosingNoticePhase,
  showEntriesLink = false,
): ReturnType<typeof render> {
  return renderIn(
    locale,
    <ClosingNoticeBody
      phase={phase}
      locale={locale}
      timeZone={TZ}
      showEntriesLink={showEntriesLink}
    />,
  );
}

function clearCookie(): void {
  document.cookie = `${CLOSING_NOTICE_COOKIE}=; Max-Age=0; Path=/`;
}

afterEach(clearCookie);

describe("las fechas son las de las Reglas Oficiales", () => {
  it("el cierre es 11:59:59 p.m. del 8 de noviembre en hora central", () => {
    expect(formatZonedDate(CLOSING_EDITION.closesAtIso, "es", { timeZone: TZ })).toBe(
      "8 de noviembre de 2026",
    );
    expect(formatZonedDate(CLOSING_EDITION.closesAtIso, "en", { timeZone: TZ })).toBe(
      "November 8, 2026",
    );
    expect(formatZonedTime(CLOSING_EDITION.closesAtIso, "en", TZ, "medium")).toMatch(
      /^11:59:59\sPM$/u,
    );
  });

  it("ese dia ya es horario estandar: el cambio de hora fue el 1 de noviembre", () => {
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" });
    expect(zone.format(new Date(CLOSING_EDITION.closesAtIso))).toContain("CST");
    expect(zone.format(new Date("2026-10-31T12:00:00.000Z"))).toContain("CDT");
  });

  it("el sorteo es el 11 de noviembre y su dia acaba a medianoche central", () => {
    expect(formatZonedMonthDay(CLOSING_EDITION.selectionDayIso, "es", TZ)).toBe("11 de noviembre");
    expect(formatZonedMonthDay(CLOSING_EDITION.selectionDayIso, "en", TZ)).toBe("November 11");
    expect(formatZonedDate(CLOSING_EDITION.selectionDayEndsAtIso, "en", { timeZone: TZ })).toBe(
      "November 12, 2026",
    );
    expect(formatZonedTime(CLOSING_EDITION.selectionDayEndsAtIso, "en", TZ)).toMatch(
      /^12:00\sAM$/u,
    );
  });
});

describe("resolveClosingPhase", () => {
  it("antes del cierre: abierto", () => {
    expect(resolveClosingPhase(edition, "2026-11-08T23:00:00.000Z")).toBe("open");
  });

  it("en los 59 s de discrepancia manda el reglamento, no `ends_at`", () => {
    expect(resolveClosingPhase(edition, "2026-11-09T05:59:30.000Z")).toBe("open");
  });

  it("en el instante del reglamento pasa a cerrado aunque siga ACTIVE", () => {
    expect(resolveClosingPhase(edition, "2026-11-09T05:59:59.000Z")).toBe("closed");
  });

  it("un cierre anticipado del personal se respeta", () => {
    expect(resolveClosingPhase({ ...edition, status: "CLOSED" }, "2026-11-08T23:00:00.000Z")).toBe(
      "closed",
    );
  });

  it("el dia del sorteo sigue cerrado; al acabar el dia cambia", () => {
    const closed = { ...edition, status: "DRAW_PENDING" } as const;
    expect(resolveClosingPhase(closed, "2026-11-12T05:59:59.000Z")).toBe("closed");
    expect(resolveClosingPhase(closed, "2026-11-12T06:00:00.000Z")).toBe("afterSelection");
  });

  it("corregir `ends_at` al segundo del reglamento no apaga el aviso", () => {
    expect(
      resolveClosingPhase(
        { ...edition, ends_at: "2026-11-09T05:59:59.999Z" },
        "2026-11-08T23:00:00.000Z",
      ),
    ).toBe("open");
  });

  it.each([
    ["el personal movio el cierre", { ends_at: "2026-11-15T05:59:00.000Z" }],
    ["otra edicion", { slug: "otra-edicion" }],
    ["otra zona legal", { legal_timezone: "America/Denver" }],
    ["fecha ilegible", { ends_at: "" }],
    ["edicion terminada con ganadores confirmados", { status: "COMPLETED" }],
    ["edicion cancelada", { status: "CANCELLED" }],
    ["borrador", { status: "DRAFT" }],
    ["programada", { status: "SCHEDULED" }],
  ] as const)("no se pinta: %s", (_case, change) => {
    expect(resolveClosingPhase({ ...edition, ...change }, "2026-11-08T23:00:00.000Z")).toBeNull();
  });
});

describe("el texto, antes del cierre", () => {
  it("en espanol da fecha, hora exacta, sorteo y la linea legal", () => {
    renderBody("es", "open");

    expect(screen.getByText("Primera edición — Aviso de cierre")).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).toMatch(
      /Nuestra primera edición cierra el 8 de noviembre de 2026 a las 11:59:59\sp\.\s?m\.,\shora central\./u,
    );
    expect(body).toContain(
      "La selección de los dos ganadores está programada para el 11 de noviembre.",
    );
    expect(body).toContain("No es necesario comprar para participar o ganar.");
    expect(body).toContain("Una compra no mejora las probabilidades de ganar.");
  });

  it("en ingles dice lo mismo", () => {
    renderBody("en", "open");

    const body = document.body.textContent ?? "";
    expect(body).toMatch(
      /Our first edition closes on November 8, 2026 at 11:59:59\sPM Central Time\./u,
    );
    expect(body).toContain("The selection of the two winners is scheduled for November 11.");
    expect(body).toContain("No purchase necessary to enter or win.");
  });
});

describe("el texto, despues del cierre", () => {
  it("dice que termino y cuando es el sorteo, sin la linea de compra", () => {
    renderBody("es", "closed");

    const body = document.body.textContent ?? "";
    expect(body).toMatch(/terminó el 8 de noviembre de 2026 a las 11:59:59/u);
    expect(body).toContain("programada para el 11 de noviembre.");
    expect(body).not.toContain("cierra el");
    expect(body).not.toContain("comprar");
  });

  it("pasado el dia del sorteo no afirma que ocurriera ni nombra a nadie", () => {
    renderBody("es", "afterSelection");

    const body = document.body.textContent ?? "";
    expect(body).toContain("confirmación oficial");
    expect(body).not.toContain("11 de noviembre");
    expect(body).not.toContain("programada");
  });
});

describe("los enlaces", () => {
  it.each(["open", "closed", "afterSelection"] as const)(
    "%s: un visitante solo ve las reglas de esta edicion",
    (phase) => {
      renderBody("es", phase);

      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName("Ver reglas oficiales");
      expect(links[0]?.getAttribute("href")).toContain(
        `/official-rules?promotion=${CLOSING_EDITION.slug}`,
      );
    },
  );

  it.each(["open", "closed", "afterSelection"] as const)(
    "%s: con sesion anade sus participaciones y nada para comprar",
    (phase) => {
      renderBody("en", phase, true);

      const links = screen.getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["View official rules", "My entries"]);
      expect(links[1]?.getAttribute("href")).toContain("/account/entries");
      for (const link of links) {
        expect(link.getAttribute("href")).not.toMatch(/shop|cart|checkout|packages/u);
      }
    },
  );
});

describe("lo que el aviso nunca dice", () => {
  const closingCopy = JSON.stringify([esMessages.closingNotice, enMessages.closingNotice]);

  it("no presiona ni habla de probabilidades a favor", () => {
    expect(closingCopy).not.toMatch(
      /última oportunidad|ultima oportunidad|últimas horas|date prisa|no te lo pierdas|compra más|last chance|hurry|don't miss|buy more|mejores probabilidades|better odds/iu,
    );
  });

  it("no invita a enviar una ficha por correo", () => {
    expect(closingCopy).not.toMatch(
      /correo postal|matasellos|tarjeta postal|by mail|postcard|postmark/iu,
    );
  });
});

describe("loadClosingNotice: que se pinta en la portada", () => {
  const OPEN = "2026-11-08T23:00:00.000Z";
  const active = edition as unknown as Parameters<typeof loadClosingNotice>[0]["activePromotion"];

  beforeEach(() => {
    server.cookieValue = undefined;
    server.sessionKind = "anonymous";
    server.fetchPromotion.mockReset();
  });

  async function renderNotice(
    activePromotion: Parameters<typeof loadClosingNotice>[0]["activePromotion"],
    nowIso = OPEN,
  ) {
    const element = await loadClosingNotice({ activePromotion, locale: "es", nowIso });
    if (element !== null) renderIn("es", <ClosingNoticeBody {...element} />);
    return { element };
  }

  it("usa la promocion activa que la portada ya leyo, sin otra peticion", async () => {
    await renderNotice(active);

    expect(screen.getByRole("region", { name: /Aviso de cierre/u })).toBeInTheDocument();
    expect(server.fetchPromotion).not.toHaveBeenCalled();
  });

  it("cerrada por el personal deja de ser la activa y se pide por su slug", async () => {
    server.fetchPromotion.mockResolvedValue({
      ok: true,
      data: { ...edition, status: "CLOSED" },
    });

    await renderNotice(null, "2026-11-09T07:00:00.000Z");

    expect(server.fetchPromotion).toHaveBeenCalledWith(CLOSING_EDITION.slug, "es");
    expect(screen.getByRole("region", { name: /terminado/u })).toBeInTheDocument();
  });

  it("si la API falla no pinta nada", async () => {
    server.fetchPromotion.mockResolvedValue({ ok: false, error: { status: 503 } });

    const { element } = await renderNotice(null);

    expect(element).toBeNull();
  });

  it("con otra edicion abierta no pinta nada ni pregunta por esta", async () => {
    const { element } = await renderNotice({
      ...active!,
      slug: "segunda-edicion",
    });

    expect(element).toBeNull();
    expect(server.fetchPromotion).not.toHaveBeenCalled();
  });

  it("cerrado en esta sesion, el servidor ya no lo pinta", async () => {
    server.cookieValue = "open";

    const { element } = await renderNotice(active);

    expect(element).toBeNull();
  });

  it("cerrado en la fase anterior, la nueva si se pinta", async () => {
    server.cookieValue = "open";

    await renderNotice(active, "2026-11-09T07:00:00.000Z");

    expect(screen.getByRole("region", { name: /terminado/u })).toBeInTheDocument();
  });

  it("un visitante no ve sus participaciones", async () => {
    await renderNotice(active);

    expect(screen.queryByRole("link", { name: "Mis participaciones" })).not.toBeInTheDocument();
  });

  it("con sesion a medias (MFA) tampoco", async () => {
    server.sessionKind = "mfaPending";
    await renderNotice(active);

    expect(screen.queryByRole("link", { name: "Mis participaciones" })).not.toBeInTheDocument();
  });

  it("con sesion las ve, y no sale ningun dato de la persona", async () => {
    server.sessionKind = "active";
    await renderNotice(active);

    expect(screen.getByRole("link", { name: "Mis participaciones" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("persona@example.com");
  });
});

describe("cerrar el aviso", () => {
  function renderFrame(phase: ClosingNoticePhase = "open") {
    return renderIn(
      "es",
      <ClosingNoticeFrame phase={phase} titleId="t" dismissLabel="Cerrar aviso">
        <p id="t">Aviso</p>
      </ClosingNoticeFrame>,
    );
  }

  it("es una region con nombre y un boton accesible", () => {
    renderFrame();

    const region = screen.getByRole("region", { name: "Aviso" });
    expect(within(region).getByRole("button", { name: "Cerrar aviso" })).toBeInTheDocument();
  });

  it("al cerrarlo desaparece y guarda la fase en una cookie de sesion", () => {
    renderFrame();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(isClosingNoticeDismissed(document.cookie, "open")).toBe(true);
  });

  it("no vuelve a aparecer en la misma sesion", () => {
    document.cookie = `${CLOSING_NOTICE_COOKIE}=open; Path=/`;
    renderFrame("open");

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("si cambia la fase vuelve, porque dice algo nuevo", () => {
    document.cookie = `${CLOSING_NOTICE_COOKIE}=open; Path=/`;
    renderFrame("closed");

    expect(screen.getByRole("region", { name: "Aviso" })).toBeInTheDocument();
  });
});
