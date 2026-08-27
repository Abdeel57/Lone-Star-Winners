import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/",
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

import { AmoeCallout } from "@/components/amoe-callout";
import { EntryOfferPanel } from "@/components/entry-offer-panel";
import { PromotionHero } from "@/components/promotion-hero";
import { PromotionTimeline } from "@/components/promotion-timeline";
import type { Locale } from "@/i18n/locales";
import { PROMOTION_LIFECYCLE } from "@/lib/api";
import { presentPromotion } from "@/lib/promotion-state";
import {
  activePromotion,
  activePromotionDetail,
  activePromotionWithoutPrize,
  activePromotionWithoutRules,
  activePromotionWithoutRulesDetail,
  baseEntryOffer,
  fractionalEntryOffer,
  multipliedEntryOffer,
  promotionInStatus,
  promotionsByStatus,
  promotionWithoutRules,
} from "@/mocks/fixtures/promotions";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * Experiencia publica de la promocion.
 *
 * Lo que se verifica aqui es lo que un vistazo a la pantalla no basta para
 * garantizar: que los NUEVE estados del contrato dicen cosas distintas, que un
 * flag apagado no deja restos en el DOM, y que ninguna afirmacion sobre
 * participaciones aparece cuando no procede.
 */

const NOW = "2026-08-25T12:00:00.000Z";

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

/**
 * Titulo esperado de cada fase, escrito una a una.
 *
 * Se enumeran a mano y no se indexa el diccionario con la clave calculada. Si
 * se indexara, un fallo en la maquina de estados que devolviera la clave
 * equivocada haria que el test buscase EL MISMO texto equivocado y pasara: el
 * test y el codigo compartirian el error. Escribir las nueve parejas obliga a
 * que la expectativa sea independiente de la implementacion.
 */
const NOTICE_TITLES = [
  {
    status: "DRAFT",
    en: enMessages.promotionState.draft.title,
    es: esMessages.promotionState.draft.title,
  },
  {
    status: "SCHEDULED",
    en: enMessages.promotionState.scheduled.title,
    es: esMessages.promotionState.scheduled.title,
  },
  {
    status: "ACTIVE",
    en: enMessages.promotionState.active.title,
    es: esMessages.promotionState.active.title,
  },
  {
    status: "CLOSED",
    en: enMessages.promotionState.closed.title,
    es: esMessages.promotionState.closed.title,
  },
  {
    status: "EXPORT_PREPARATION",
    en: enMessages.promotionState.exportPreparation.title,
    es: esMessages.promotionState.exportPreparation.title,
  },
  {
    status: "DRAW_PENDING",
    en: enMessages.promotionState.drawPending.title,
    es: esMessages.promotionState.drawPending.title,
  },
  {
    status: "POTENTIAL_WINNER_REVIEW",
    en: enMessages.promotionState.potentialWinnerReview.title,
    es: esMessages.promotionState.potentialWinnerReview.title,
  },
  {
    status: "COMPLETED",
    en: enMessages.promotionState.completed.title,
    es: esMessages.promotionState.completed.title,
  },
  {
    status: "CANCELLED",
    en: enMessages.promotionState.cancelled.title,
    es: esMessages.promotionState.cancelled.title,
  },
] as const;

describe("PromotionHero en los nueve estados", () => {
  it("cada estado muestra su propio aviso, en los dos idiomas", () => {
    for (const expected of NOTICE_TITLES) {
      const promotion = promotionsByStatus.find((item) => item.status === expected.status);
      expect(promotion, `falta fixture para ${expected.status}`).toBeDefined();
      if (promotion === undefined) continue;

      for (const locale of ["en", "es"] as const) {
        const view = renderIn(
          locale,
          <PromotionHero
            promotion={promotion}
            detail={null}
            locale={locale}
            nowIso={NOW}
            amoeEnabled={false}
          />,
        );

        expect(
          screen.getByText(locale === "en" ? expected.en : expected.es),
          `falta el aviso de ${expected.status} en ${locale}`,
        ).toBeInTheDocument();

        view.unmount();
      }
    }
  });

  it("los nueve avisos son textos distintos entre si", () => {
    // Si dos fases dijeran lo mismo, tener nueve estados no serviria de nada.
    for (const language of ["en", "es"] as const) {
      const titles = NOTICE_TITLES.map((entry) => (language === "en" ? entry.en : entry.es));
      expect(new Set(titles).size, `avisos repetidos en ${language}`).toBe(NOTICE_TITLES.length);
    }
  });

  it("la cuenta atras solo aparece antes de abrir y mientras esta abierta", () => {
    for (const promotion of promotionsByStatus) {
      const view = renderIn(
        "en",
        <PromotionHero
          promotion={promotion}
          detail={null}
          locale="en"
          nowIso={NOW}
          amoeEnabled={false}
        />,
      );

      const shows = presentPromotion(promotion.status).countdownTarget !== null;
      const label = screen.queryByText(
        promotion.status === "SCHEDULED"
          ? enMessages.countdown.opensIn
          : enMessages.countdown.closesIn,
      );

      expect(label !== null, `cuenta atras inesperada en ${promotion.status}`).toBe(shows);
      view.unmount();
    }
  });

  it("no enlaza a unas Reglas Oficiales que no existen", () => {
    // DEC-012: sin version de reglas publicada, la interfaz lo dice en vez de
    // enlazar a un documento que devolveria un 404.
    renderIn(
      "en",
      <PromotionHero
        promotion={promotionWithoutRules}
        detail={null}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(
      screen.queryByRole("link", { name: enMessages.home.viewOfficialRules }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.home.rulesNotPublished)).toBeInTheDocument();
  });

  it("sin valor de premio declarado no deja una etiqueta con el hueco vacio", () => {
    // Es el estado REAL del backend hoy: no existe modelo de premio, porque el
    // valor de un premio es dato legalmente material. La interfaz tiene que
    // saber callarse, no pintar "Stated prize value" seguido de nada.
    renderIn(
      "en",
      <PromotionHero
        promotion={activePromotionWithoutPrize}
        detail={null}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(screen.queryByText(enMessages.home.prizeValueLabel)).not.toBeInTheDocument();
  });

  it("enlaza a las Reglas Oficiales de ESA promocion cuando existen", () => {
    const promotion = promotionInStatus("ACTIVE");
    renderIn(
      "es",
      <PromotionHero
        promotion={promotion}
        detail={null}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(screen.getByRole("link", { name: esMessages.home.viewOfficialRules })).toHaveAttribute(
      "href",
      `/official-rules?promotion=${promotion.slug}`,
    );
  });
});

/**
 * EL HERO DE DEC-042.
 *
 * Tres cosas que la composicion nueva puede romper y que mirar la pantalla no
 * detecta:
 *
 *   1. LA LINEA LEGAL. "No se requiere compra" es una afirmacion sobre las
 *      condiciones de participacion y solo puede escribirse cuando la promocion
 *      declara via gratuita. Copiar la linea de la referencia sin mirar el flag
 *      es el error mas facil de cometer aqui y el mas caro.
 *   2. EL VERBO DEL BOTON ROJO. Lleva a la MERCANCIA, asi que no puede decir
 *      "participar" ni "enter": comprar mercancia no es participar
 *      (`CLAUDE.md` seccion 1, DEC-042).
 *   3. EL UNIVERSO DE PARTICIPACIONES. Se pinta el tope que sirve el backend y
 *      no se deriva ninguna cifra de "quedan X".
 */
describe("PromotionHero, composicion de DEC-042", () => {
  it("sin via gratuita declarada NO dice que no se requiere compra", () => {
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <PromotionHero
          promotion={activePromotion}
          detail={activePromotionDetail}
          locale={locale}
          nowIso={NOW}
          amoeEnabled={false}
        />,
      );

      expect(screen.getByText(messages.home.hero.legalRules, { exact: false })).toBeInTheDocument();
      expect(screen.queryByText(messages.home.hero.legalAmoe, { exact: false })).toBeNull();

      // Y la red por el otro lado: ni el fragmento suelto. Si alguien
      // reescribiera la frase, esto seguiria detectando la afirmacion.
      const claim = locale === "en" ? "No purchase necessary" : "No se requiere compra";
      expect(document.body.textContent).not.toContain(claim);

      view.unmount();
    }
  });

  it("con via gratuita declarada si la dice, en los dos idiomas", () => {
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <PromotionHero
          promotion={activePromotion}
          detail={activePromotionDetail}
          locale={locale}
          nowIso={NOW}
          amoeEnabled
        />,
      );

      expect(screen.getByText(messages.home.hero.legalAmoe, { exact: false })).toBeInTheDocument();
      expect(screen.queryByText(messages.home.hero.legalRules, { exact: false })).toBeNull();

      view.unmount();
    }
  });

  it("la linea legal enlaza a las Reglas Oficiales de esa promocion", () => {
    renderIn(
      "es",
      <PromotionHero
        promotion={activePromotion}
        detail={activePromotionDetail}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(screen.getByRole("link", { name: esMessages.home.viewOfficialRules })).toHaveAttribute(
      "href",
      `/official-rules?promotion=${activePromotion.slug}`,
    );
  });

  it("el CTA rojo lleva a la tienda y no dice participar", () => {
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <PromotionHero
          promotion={activePromotion}
          detail={activePromotionDetail}
          locale={locale}
          nowIso={NOW}
          amoeEnabled={false}
        />,
      );

      const cta = screen.getByRole("link", { name: messages.home.hero.shopNow });
      expect(cta).toHaveAttribute("href", "/shop");
      // Es el rojo del sistema y no el oro de marca: el reparto de DEC-042 es
      // que rojo = accion de compra.
      expect(cta.className).toContain("bg-accent");

      const label = messages.home.hero.shopNow.toLowerCase();
      for (const forbidden of ["participar", "participa", "enter", "entries", "boleto"]) {
        expect(label, `${locale}: el CTA a la tienda no puede decir "${forbidden}"`).not.toContain(
          forbidden,
        );
      }

      view.unmount();
    }
  });

  it("pinta el TOPE del universo y ninguna otra cifra de participaciones", () => {
    const view = renderIn(
      "es",
      <PromotionHero
        promotion={activePromotion}
        detail={activePromotionDetail}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    const pool = activePromotionDetail.entry_pool;
    expect(pool, "el fixture protagonista declara universo").not.toBeNull();
    if (pool === null) return;

    expect(screen.getByText(/10,000/)).toBeInTheDocument();

    /*
     * NI LAS EMITIDAS NI LA RESTA (DEC-042 y DEC-044).
     *
     * El fixture SI sirve `issued`, y eso es lo que hace util esta
     * comprobacion: no se mide que el dato falte, se mide que estando
     * disponible no llegue al DOM. Pintarlo debajo del tope publicaria el
     * contador de restantes por implicacion, que es la misma urgencia
     * fabricada que DEC-042 excluye, hecha por el lector en vez de por el
     * cliente.
     */
    expect(pool.issued, "el fixture adversarial sirve la cifra de emitidas").not.toBeNull();
    const issued = (pool.issued ?? 0).toLocaleString("en-US");
    expect(document.body.textContent, "las emitidas no se pintan").not.toContain(issued);

    const remaining = (pool.cap - (pool.issued ?? 0)).toLocaleString("en-US");
    expect(document.body.textContent, "ni la resta").not.toContain(remaining);

    view.unmount();
  });

  it("la fotografia del premio se describe en el idioma de la pagina", () => {
    const { container } = renderIn(
      "es",
      <PromotionHero
        promotion={activePromotion}
        detail={activePromotionDetail}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    const image = container.querySelector("img");
    expect(image, "el hero pinta la imagen del premio que sirve el backend").not.toBeNull();

    const alt = activePromotionDetail.media?.alt;
    expect(alt, "la fotografia real declara texto alternativo").not.toBeNull();
    expect(image).toHaveAttribute("alt", alt?.["es-US"] ?? "");
    // Y en espanol, no en ingles: el `alt` es contenido dinamico localizado
    // (DEC-030) y se elige con la etiqueta del locale, no se traduce.
    expect(image?.getAttribute("alt")).not.toBe(alt?.["en-US"]);

    /*
     * La ruta que sirve el backend tiene que llegar a la imagen.
     *
     * No se compara con `===` porque el hero pinta con `next/image`: la `src`
     * final es la del optimizador (`/_next/image?url=...`), que ENVUELVE la
     * ruta original codificada. Lo que se comprueba es que la ruta servida es
     * la que viaja dentro, que es la propiedad que importa; comparar la cadena
     * entera solo ataria el test a como Next construye su URL.
     */
    const source = decodeURIComponent(image?.getAttribute("src") ?? "");
    expect(source).toContain(activePromotionDetail.media?.hero_url ?? "no-hay-imagen");
  });

  it("la fotografia es decorativa cuando el dato no la describe", () => {
    /*
     * La otra mitad del par. `PromotionMedia.alt` es nulable y significa
     * DECORATIVA -una ilustracion junto a un titular que ya nombra el premio no
     * aporta nada-, y esa rama tiene que seguir viva aunque hoy la promocion
     * protagonista traiga descripcion: el dia que una promocion no la traiga, un
     * `alt` ausente haria que un lector de pantalla leyera el nombre del fichero.
     */
    const media = activePromotionDetail.media;
    expect(media, "la promocion protagonista declara imagenes").not.toBeNull();
    if (media === null) return;

    const { container } = renderIn(
      "en",
      <PromotionHero
        promotion={activePromotion}
        detail={{ ...activePromotionDetail, media: { ...media, alt: null } }}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    // `alt=""` y no ausencia de atributo.
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("sin detalle se compone igual, sin imagen y sin inventar premio", () => {
    // El detalle es una SEGUNDA peticion y puede fallar sola. Que la portada se
    // caiga por eso convertiria un fallo de informacion adicional en una
    // pantalla rota.
    const { container } = renderIn(
      "en",
      <PromotionHero
        promotion={activePromotion}
        detail={null}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      activePromotion.title["en-US"],
    );
    expect(container.querySelector("img")).toBeNull();
    // Ni verbo de titular sin premio al que acompanar, ni linea de universo.
    expect(screen.queryByText(enMessages.home.hero.win)).toBeNull();
    expect(screen.queryByText(/entry pool of/i)).toBeNull();
  });
});

/**
 * EL ESTADO CONTENIDO DE DEC-044.
 *
 * La auditoria de copy de `security-integration` leyo el hero completo -"GANA",
 * premio gigante, boton rojo a la tienda, cuenta atras y chip de promocion
 * vigente- como una invitacion a comprar para participar, aunque ninguna de sus
 * frases lo diga. Anadir "no se requiere compra" no era la salida: con AMOE en
 * TBD seria inventar un requisito legal (CLAUDE.md #2). La salida es no
 * publicar la invitacion mientras no exista el documento que la respalda.
 *
 * Lo que estos tests protegen no es el aspecto de la pantalla: es que la
 * seguridad del copy DEJE DE SER DEPENDIENTE DE LOS DATOS. Hoy el hero completo
 * solo es correcto porque ninguna promocion real ha llegado a ACTIVE sin
 * reglas; a un `INSERT` de distancia dejaba de serlo, y nada fallaba.
 */
describe("PromotionHero sin Reglas Oficiales publicadas (DEC-044)", () => {
  it("una promocion ACTIVE sin reglas no publica la invitacion, en los dos idiomas", () => {
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <PromotionHero
          promotion={activePromotionWithoutRules}
          detail={activePromotionWithoutRulesDetail}
          locale={locale}
          nowIso={NOW}
          amoeEnabled={false}
        />,
      );

      // Ni el verbo del titular.
      expect(screen.queryByText(messages.home.hero.win), `verbo en ${locale}`).toBeNull();

      // Ni los chips: el de estado ("Abierta") ni el antetitulo ("Promocion
      // vigente"). Los dos funcionan como llamada encabezando un hero.
      expect(screen.queryByText(messages.home.eyebrow), `antetitulo en ${locale}`).toBeNull();
      expect(
        screen.queryByText(messages.promotionStatus.ACTIVE),
        `chip de estado en ${locale}`,
      ).toBeNull();

      // Ni la cuenta atras, que es el elemento de urgencia de la composicion.
      expect(
        screen.queryByText(messages.countdown.closesIn),
        `cuenta atras en ${locale}`,
      ).toBeNull();

      // Ni el universo de participaciones, que es una afirmacion sobre COMO
      // funciona la promocion.
      expect(screen.queryByText(/10,000/), `universo en ${locale}`).toBeNull();

      // Ni el boton de compra.
      expect(
        screen.queryByRole("link", { name: messages.home.hero.shopNow }),
        `CTA de compra en ${locale}`,
      ).toBeNull();

      view.unmount();
    }
  });

  it("ningun enlace a la tienda lleva el rojo de compra", () => {
    /*
     * La red por el otro lado, y la que de verdad importa: la anterior mira la
     * ETIQUETA del boton, y una etiqueta se reescribe. Esta mira el COLOR, que
     * es lo que DEC-042 reparte -rojo = accion de compra- y lo que hace que el
     * hero se lea como invitacion aunque el verbo cambie.
     */
    renderIn(
      "es",
      <PromotionHero
        promotion={activePromotionWithoutRules}
        detail={activePromotionWithoutRulesDetail}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    const toShop = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/shop");
    expect(toShop.length, "sigue habiendo camino a la tienda").toBeGreaterThan(0);

    for (const link of toShop) {
      expect(link.className, "el enlace a la tienda no puede ser el rojo de compra").not.toContain(
        "bg-accent",
      );
    }
  });

  it("dice que faltan las Reglas Oficiales y deja como unica accion la tienda", () => {
    for (const locale of ["en", "es"] as const) {
      const messages = locale === "en" ? enMessages : esMessages;
      const view = renderIn(
        locale,
        <PromotionHero
          promotion={activePromotionWithoutRules}
          detail={activePromotionWithoutRulesDetail}
          locale={locale}
          nowIso={NOW}
          amoeEnabled={false}
        />,
      );

      // `getByText` y no `queryAllByText`: ademas de estar, tiene que estar UNA
      // vez. El aviso subio al hero desde la banda de avisos, y dejarlo en los
      // dos sitios lo diria dos veces en la misma pantalla.
      expect(screen.getByText(messages.home.rulesNotPublished)).toBeInTheDocument();

      expect(screen.getByRole("link", { name: messages.home.hero.browseShop })).toHaveAttribute(
        "href",
        "/shop",
      );

      // Y sin enlace al documento, que devolveria un 404 (DEC-012).
      expect(screen.queryByRole("link", { name: messages.home.viewOfficialRules })).toBeNull();

      view.unmount();
    }
  });

  it("el premio y el titulo se siguen viendo", () => {
    // El estado contenido no es una pantalla vacia. Lo que se retira son las
    // afirmaciones; el premio y el titulo son dato del backend y no dicen nada
    // sobre las condiciones de participacion.
    const prize = activePromotionWithoutRulesDetail.prize;
    expect(prize, "el fixture adversarial declara premio").not.toBeNull();
    if (prize === null) return;

    const { container } = renderIn(
      "en",
      <PromotionHero
        promotion={activePromotionWithoutRules}
        detail={activePromotionWithoutRulesDetail}
        locale="en"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(prize.name["en-US"]);
    expect(heading).toHaveTextContent(activePromotionWithoutRules.title["en-US"]);
    expect(container.querySelector("img"), "la fotografia del premio se queda").not.toBeNull();
  });

  it("con la version de reglas declarada, el hero completo sigue intacto", () => {
    /*
     * La otra mitad del par. Sin esta comprobacion, un cambio que dejara el
     * estado contenido SIEMPRE encendido pasaria en verde: la portada en dev
     * -y en produccion- se quedaria sin hero y ningun test lo diria.
     */
    renderIn(
      "es",
      <PromotionHero
        promotion={activePromotion}
        detail={activePromotionDetail}
        locale="es"
        nowIso={NOW}
        amoeEnabled={false}
      />,
    );

    expect(screen.getByText(esMessages.home.hero.win)).toBeInTheDocument();
    expect(screen.getByText(esMessages.home.eyebrow)).toBeInTheDocument();
    expect(screen.getByText(esMessages.countdown.closesIn)).toBeInTheDocument();
    expect(screen.getByText(/10,000/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: esMessages.home.hero.shopNow })).toHaveAttribute(
      "href",
      "/shop",
    );
    expect(screen.queryByText(esMessages.home.rulesNotPublished)).toBeNull();
  });
});

describe("PromotionTimeline", () => {
  it("muestra el ciclo entero y marca el actual", () => {
    renderIn("en", <PromotionTimeline status="POTENTIAL_WINNER_REVIEW" />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(PROMOTION_LIFECYCLE.length);

    const current = items.filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(enMessages.promotionStatus.POTENTIAL_WINNER_REVIEW);
  });

  it("nombra los pasos en el idioma de la interfaz", () => {
    renderIn("es", <PromotionTimeline status="CLOSED" />);
    expect(screen.getByText(esMessages.promotionStatus.DRAW_PENDING)).toBeInTheDocument();
  });

  it("no pinta linea temporal para los estados que no recorren el ciclo", () => {
    // Una promocion cancelada con un recorrido a medias diria que sigue en
    // marcha; un borrador no ha empezado ninguno.
    for (const status of ["DRAFT", "CANCELLED"] as const) {
      const { container } = renderIn("en", <PromotionTimeline status={status} />);
      expect(container, status).toBeEmptyDOMElement();
    }
  });
});

describe("EntryOfferPanel (DEC-013 y DEC-032)", () => {
  const activePresentation = presentPromotion("ACTIVE");

  it("muestra el ratio que declara la promocion, sin calcular nada", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={baseEntryOffer}
        presentation={activePresentation}
        multipliersEnabled={false}
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(/5 entries per \$1\.00/)).toBeInTheDocument();
  });

  it("con el flag de multiplicadores apagado no queda ni rastro del 2X", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={activePresentation}
        multipliersEnabled={false}
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    // Ni la insignia ni la fecha de fin del periodo: una funcion desactivada no
    // deja restos a medias en el DOM.
    expect(screen.queryByText(/2×/)).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.entryOffer.governedNote)).toBeInTheDocument();
  });

  it("con el flag encendido y promocion abierta, anuncia el periodo", () => {
    renderIn(
      "es",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={activePresentation}
        multipliersEnabled
        rulesPublished
        locale="es"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(/2×/)).toBeInTheDocument();
  });

  it("un multiplicador fraccionario se imprime como fraccion, no como decimal", () => {
    // 3/2 NO puede pintarse como "1.5×": seria redondear una cifra que el motor
    // aplica exacta (DEC-010).
    renderIn(
      "en",
      <EntryOfferPanel
        offer={fractionalEntryOffer}
        presentation={activePresentation}
        multipliersEnabled
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(/3\/2×/)).toBeInTheDocument();
    expect(screen.queryByText(/1\.5/)).not.toBeInTheDocument();
  });

  it("no anuncia el multiplicador sobre una promocion cerrada aunque el flag este encendido", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={multipliedEntryOffer}
        presentation={presentPromotion("CLOSED")}
        multipliersEnabled
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.queryByText(/2×/)).not.toBeInTheDocument();
  });

  it("sin oferta declarada no inventa ninguna", () => {
    const { container } = renderIn(
      "en",
      <EntryOfferPanel
        offer={null}
        presentation={activePresentation}
        multipliersEnabled
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("un importe unitario roto no produce una cifra rota en pantalla", () => {
    renderIn(
      "en",
      <EntryOfferPanel
        offer={{ ...baseEntryOffer, unit_amount: { amount_minor: "no", currency: "USD" } }}
        presentation={activePresentation}
        multipliersEnabled={false}
        rulesPublished
        locale="en"
        timeZone="America/Chicago"
      />,
    );

    expect(screen.getByText(enMessages.entryOffer.ratioUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

/** Las cuatro modalidades de DEC-032, con su texto en cada idioma. */
const AMOE_TEXTS = [
  { mode: "ONLINE_FORM", en: enMessages.amoe.ONLINE_FORM, es: esMessages.amoe.ONLINE_FORM },
  {
    mode: "MAIL_IN_REVIEW",
    en: enMessages.amoe.MAIL_IN_REVIEW,
    es: esMessages.amoe.MAIL_IN_REVIEW,
  },
  { mode: "CODE", en: enMessages.amoe.CODE, es: esMessages.amoe.CODE },
  {
    mode: "EXTERNAL_INSTRUCTIONS",
    en: enMessages.amoe.EXTERNAL_INSTRUCTIONS,
    es: esMessages.amoe.EXTERNAL_INSTRUCTIONS,
  },
] as const;

describe("AmoeCallout (DEC-032)", () => {
  it("con la via gratuita apagada no renderiza absolutamente nada", () => {
    // Ocultar es aqui el estado deliberado: anunciar un metodo gratuito que no
    // esta configurado seria afirmar algo sobre las condiciones de
    // participacion, que es materia del abogado (CLAUDE.md #1).
    const { container } = renderIn("en", <AmoeCallout enabled={false} mode="ONLINE_FORM" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("cada modalidad del enum tiene su propio texto", () => {
    const seen = new Set<string>();

    for (const entry of AMOE_TEXTS) {
      const view = renderIn("en", <AmoeCallout enabled mode={entry.mode} />);

      expect(screen.getByText(entry.en), `falta el texto de ${entry.mode}`).toBeInTheDocument();
      seen.add(entry.en);
      view.unmount();
    }

    // Cuatro modalidades, cuatro textos distintos. Si dos coincidieran, el enum
    // no estaria sirviendo para nada.
    expect(seen.size).toBe(AMOE_TEXTS.length);
  });

  it("encendida sin modalidad publicada, lo dice en vez de elegir una", () => {
    renderIn("es", <AmoeCallout enabled mode={null} />);

    expect(screen.getByText(esMessages.amoe.modeNotPublished)).toBeInTheDocument();

    // Y no se cuela ninguna de las cuatro modalidades por la puerta de atras.
    for (const entry of AMOE_TEXTS) {
      expect(screen.queryByText(entry.es), entry.mode).not.toBeInTheDocument();
    }
  });
});
