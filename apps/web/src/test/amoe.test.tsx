import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", async () => {
  const { createElement } = await import("react");

  return {
    usePathname: () => "/amoe",
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

const IDLE_RESULT = {
  status: "idle" as const,
  code: null,
  requestId: null,
  field: null,
  retryAfterSeconds: null,
};

vi.mock("@/lib/amoe-actions", () => ({
  submitAmoeAction: () => Promise.resolve(IDLE_RESULT),
  cancelAmoeAction: () => Promise.resolve(IDLE_RESULT),
}));

import { AmoeCallout } from "@/components/amoe-callout";
import { AmoeForm } from "@/components/amoe-form";
import { AmoeSubmissionList } from "@/components/amoe-submission-list";
import { formatEntryCount } from "@/i18n/formatters";
import { isSafeExternalUrl, normalizeAmoeConfig } from "@/lib/amoe-config";
import { LOCALES, type Locale } from "@/i18n/locales";
import { AMOE_MODES, type AmoeConfig, type AmoeFieldSpec, type AmoeMode } from "@/lib/api";
import {
  amoeCodeConfig,
  amoeDisabledConfig,
  amoeEnabledWithoutModeConfig,
  amoeExternalConfig,
  amoeMailInConfig,
  amoeOnlineFormConfig,
  amoeSubmissions,
} from "@/mocks/fixtures/amoe";

import enMessages from "../../messages/en-US.json";
import esMessages from "../../messages/es-US.json";

/**
 * VIA GRATUITA DE PARTICIPACION (FE-M6).
 *
 * LAS DOS REDES QUE IMPORTAN AQUI
 * -------------------------------
 * 1. **El formulario no inventa ni un campo.** Que datos se piden para
 *    participar sin comprar lo fijan las Official Rules; la interfaz pinta
 *    EXACTAMENTE los que llegan en `required_fields` y ni uno mas. Un campo de
 *    mas es recogida de datos personales que nadie autorizo (CLAUDE.md #2).
 * 2. **Con la via apagada no se anuncia nada.** Ni un aviso, ni un
 *    "proximamente", ni la linea "no se requiere compra". Anunciar un metodo
 *    gratuito que no esta configurado es afirmar algo sobre las condiciones de
 *    participacion, que es materia del abogado del cliente (CLAUDE.md #1).
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

describe("el aviso de la via gratuita depende del flag, no del modo", () => {
  it("con la via apagada no renderiza NADA, en los dos idiomas", () => {
    for (const locale of LOCALES) {
      const { container } = renderIn(locale, <AmoeCallout enabled={false} mode="ONLINE_FORM" />);

      // Ni un hueco. Ocultar es aqui el estado deliberado.
      expect(container.textContent, `aviso en ${locale}`).toBe("");
    }
  });

  it("con la via encendida hay un texto por modalidad, y son distintos", () => {
    const seen = new Set<string>();

    /*
     * El texto de cada modalidad se resuelve con un `switch` exhaustivo y no
     * indexando el diccionario con `enMessages.amoe[mode]`: una clave que llega
     * de una variable sobre un objeto es la forma habitual de acabar leyendo
     * `constructor`, y ademas asi anadir una quinta modalidad al enum deja de
     * compilar aqui en vez de fallar en tiempo de ejecucion.
     */
    const textFor = (mode: AmoeMode): string => {
      switch (mode) {
        case "ONLINE_FORM":
          return enMessages.amoe.ONLINE_FORM;
        case "MAIL_IN_REVIEW":
          return enMessages.amoe.MAIL_IN_REVIEW;
        case "CODE":
          return enMessages.amoe.CODE;
        case "EXTERNAL_INSTRUCTIONS":
          return enMessages.amoe.EXTERNAL_INSTRUCTIONS;
      }
    };

    for (const mode of AMOE_MODES) {
      const view = renderIn("en", <AmoeCallout enabled mode={mode} />);
      const text = screen.getByText(textFor(mode));

      expect(text).toBeInTheDocument();
      seen.add(textFor(mode));
      view.unmount();
    }

    // Cuatro modalidades, cuatro textos. Si dos coincidieran, el enum daria
    // igual y podria haber sido un booleano.
    expect(seen.size).toBe(AMOE_MODES.length);
  });

  it("encendida sin modalidad, lo dice en vez de elegir una", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      const view = renderIn(locale, <AmoeCallout enabled mode={null} />);

      expect(screen.getByText(messages.amoe.modeNotPublished)).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("formulario de participacion gratuita", () => {
  it("pinta EXACTAMENTE los campos declarados, y ni uno mas", () => {
    const fields = amoeOnlineFormConfig.required_fields ?? [];
    expect(fields.length).toBeGreaterThan(0);

    const { container } = renderIn(
      "en",
      <AmoeForm
        locale="en"
        promotionSlug="gmc-2025"
        promotionId={amoeOnlineFormConfig.promotion_id ?? ""}
        fields={fields}
      />,
    );

    for (const field of fields) {
      expect(container.querySelector(`[name="${field.name}"]`), field.name).not.toBeNull();
    }

    // Nada que el backend no haya pedido. Se cuentan los controles con nombre
    // que no son los campos ocultos del propio formulario.
    const named = [...container.querySelectorAll("input[name], textarea[name], select[name]")]
      .map((element) => element.getAttribute("name"))
      .filter((name): name is string => name !== null)
      .filter((name) => !["locale", "promotion_slug", "promotion_id"].includes(name));

    expect(named.sort()).toEqual(fields.map((field) => field.name).sort());
  });

  it("la modalidad de codigo pinta su unico campo", () => {
    const fields = amoeCodeConfig.required_fields ?? [];
    expect(fields).toHaveLength(1);

    const { container } = renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    const code = container.querySelector('[name="code"]');
    expect(code).not.toBeNull();
    // `type="number"` incrementaria con la rueda del raton y admitiria notacion
    // cientifica. Un codigo no es una cifra.
    expect(code).toHaveAttribute("type", "text");
  });

  it("una clave de etiqueta desconocida no se muestra en crudo", () => {
    const fields: readonly AmoeFieldSpec[] = [
      { name: "mystery", kind: "text", label_key: "SOMETHING_NEW", required: true },
    ];

    renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    // Se pinta con la etiqueta generica, y el campo SIGUE enviandose: perderlo
    // seria peor que etiquetarlo mal.
    expect(screen.getByText(enMessages.amoe.fields.fallback, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("SOMETHING_NEW")).toBeNull();
  });

  it("no impone ninguna validacion que el backend no haya declarado", () => {
    const fields: readonly AmoeFieldSpec[] = [
      { name: "full_name", kind: "text", label_key: "fullName", required: true },
    ];

    const { container } = renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    const input = container.querySelector('[name="full_name"]');

    // Sin `maxLength` porque el backend no lo declaro, y sin `pattern` nunca:
    // una restriccion del cliente que no coincida con la del backend rechaza
    // participaciones validas en la unica via que no exige comprar.
    expect(input).not.toHaveAttribute("maxLength");
    expect(input).not.toHaveAttribute("pattern");
    expect(input).not.toHaveAttribute("minLength");
  });

  it("traslada el tope de caracteres SOLO cuando el backend lo declara", () => {
    const fields = amoeOnlineFormConfig.required_fields ?? [];
    const withMax = fields.find((field) => field.max_length !== undefined);
    expect(withMax).toBeDefined();

    const { container } = renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    expect(container.querySelector(`[name="${withMax?.name ?? ""}"]`)).toHaveAttribute(
      "maxLength",
      String(withMax?.max_length),
    );
  });
});

describe("configuracion AMOE: las cinco situaciones", () => {
  it("apagada llega con todo en null", () => {
    expect(amoeDisabledConfig.enabled).toBe(false);
    expect(amoeDisabledConfig.mode).toBeNull();
    expect(amoeDisabledConfig.instructions).toBeNull();
    expect(amoeDisabledConfig.required_fields).toBeNull();
    expect(amoeDisabledConfig.external_url).toBeNull();
    expect(amoeDisabledConfig.promotion_id).toBeNull();
  });

  it("el envio postal NO declara campos: no se envia desde la web", () => {
    expect(amoeMailInConfig.mode).toBe("MAIL_IN_REVIEW");
    expect(amoeMailInConfig.required_fields).toBeNull();
    expect(amoeMailInConfig.instructions).not.toBeNull();
  });

  it("las instrucciones externas apuntan a https, nunca a otro esquema", () => {
    // Un destino con otro esquema renderizado como `href` es ejecucion de
    // codigo de terceros en la pagina.
    expect(amoeExternalConfig.external_url?.startsWith("https://")).toBe(true);
  });

  it("encendida sin modalidad es un estado real y esta cubierto", () => {
    expect(amoeEnabledWithoutModeConfig.enabled).toBe(true);
    expect(amoeEnabledWithoutModeConfig.mode).toBeNull();
  });

  it("las instrucciones vienen COMPLETAS en los dos idiomas", () => {
    for (const config of [amoeOnlineFormConfig, amoeMailInConfig, amoeCodeConfig]) {
      expect(config.instructions?.["en-US"].length ?? 0).toBeGreaterThan(0);
      expect(config.instructions?.["es-US"].length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("envios del participante", () => {
  it("un envio retirado SIGUE en la lista", () => {
    // Retirar no borra (principios #6 y #7): un envio que desapareciera dejaria
    // un saldo sin explicacion.
    const cancelled = amoeSubmissions.find((submission) => submission.status === "CANCELLED");
    expect(cancelled).toBeDefined();

    renderIn("en", <AmoeSubmissionList submissions={amoeSubmissions} locale="en" />);

    expect(screen.getByText(enMessages.amoe.status.CANCELLED)).toBeInTheDocument();
  });

  it("los cuatro estados se distinguen, en los dos idiomas", () => {
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      const view = renderIn(
        locale,
        <AmoeSubmissionList submissions={amoeSubmissions} locale={locale} />,
      );

      expect(screen.getByText(messages.amoe.status.PENDING_REVIEW)).toBeInTheDocument();
      expect(screen.getByText(messages.amoe.status.APPROVED)).toBeInTheDocument();
      expect(screen.getByText(messages.amoe.status.REJECTED)).toBeInTheDocument();
      expect(screen.getByText(messages.amoe.status.CANCELLED)).toBeInTheDocument();

      view.unmount();
    }
  });

  it("la cifra otorgada se pinta tal como llega, y `null` no es cero", () => {
    const approved = amoeSubmissions.find((submission) => submission.status === "APPROVED");
    expect(approved?.entries_granted).not.toBeNull();

    renderIn("en", <AmoeSubmissionList submissions={amoeSubmissions} locale="en" />);

    expect(
      screen.getByText(formatEntryCount(approved?.entries_granted ?? 0, "en"), { exact: false }),
    ).toBeInTheDocument();

    // Los que no otorgaron nada NO muestran un cero: "todavia no se sabe" y
    // "ninguna" son afirmaciones distintas.
    expect(screen.queryByText(/: 0$/)).toBeNull();
  });

  it("solo se ofrece retirar lo que el backend declara retirable", () => {
    // La interfaz no deduce del estado si un envio se puede retirar: depende de
    // la ventana, de la modalidad y de las Official Rules.
    renderIn("en", <AmoeSubmissionList submissions={amoeSubmissions} locale="en" />);

    const cancellable = amoeSubmissions.filter((submission) => submission.cancellable);
    expect(cancellable.length).toBeGreaterThan(0);

    expect(screen.getAllByRole("button", { name: enMessages.amoe.account.cancelCta })).toHaveLength(
      cancellable.length,
    );
  });

  it("un motivo de rechazo desconocido no se muestra en crudo", () => {
    const withUnknownReason = [
      { ...amoeSubmissions[2]!, id: "amo_x", reason_key: "SOMETHING_NEW" },
    ];

    renderIn("en", <AmoeSubmissionList submissions={withUnknownReason} locale="en" />);

    expect(screen.getByText(enMessages.amoe.rejection.fallback)).toBeInTheDocument();
    expect(screen.queryByText("SOMETHING_NEW")).toBeNull();
  });
});

/**
 * EL CONMUTADOR DE ESCENARIO DE LA API SIMULADA.
 *
 * No prueba la interfaz: prueba el mock. Existe porque `LSW_DEV_AMOE` tiene que
 * mover DOS respuestas a la vez -`/config` y `/promotions/:slug/amoe-config`- y
 * moverlas por separado dejaria a la pantalla sabiendo que existe una via
 * gratuita y sin saber cual renderizar, que es el estado a medias que DEC-032
 * evita. Un fallo ahi se veria como "encendi la via y no sale el formulario",
 * que es de los sintomas mas caros de diagnosticar.
 */
describe("escenario AMOE del servidor de desarrollo", () => {
  it("mueve la configuracion publica y la AMOE a la vez", async () => {
    const { createMockApiHandler } = await import("@/mocks/dev-server");
    const base = new URL("http://127.0.0.1:4000/api/v1");

    const previous = process.env.LSW_DEV_AMOE;
    process.env.LSW_DEV_AMOE = "CODE";

    try {
      const handler = createMockApiHandler(base);

      const config = await collect(handler, "/api/v1/config");
      const amoe = await collect(handler, "/api/v1/promotions/gmc-2025/amoe-config");

      // El flag encendido y la modalidad, en la MISMA lectura.
      expect(config.feature_flags.amoe_enabled).toBe(true);
      expect(config.amoe_mode).toBe("CODE");

      // Y la configuracion de la promocion, coherente con ella.
      expect(amoe.enabled).toBe(true);
      expect(amoe.mode).toBe("CODE");
    } finally {
      if (previous === undefined) delete process.env.LSW_DEV_AMOE;
      else process.env.LSW_DEV_AMOE = previous;
    }
  });

  it("sin la variable sirve la via APAGADA, que es el estado real de hoy", async () => {
    const { createMockApiHandler } = await import("@/mocks/dev-server");
    const base = new URL("http://127.0.0.1:4000/api/v1");

    const previous = process.env.LSW_DEV_AMOE;
    delete process.env.LSW_DEV_AMOE;

    try {
      const handler = createMockApiHandler(base);
      const config = await collect(handler, "/api/v1/config");

      expect(config.feature_flags.amoe_enabled).toBe(false);
      expect(config.amoe_mode).toBeNull();
    } finally {
      if (previous !== undefined) process.env.LSW_DEV_AMOE = previous;
    }
  });
});

/** Ejecuta el manejador contra una ruta y devuelve el JSON de la respuesta. */
function collect(
  handler: (request: never, response: never) => void,
  path: string,
): Promise<{
  readonly feature_flags: Record<string, boolean>;
  readonly amoe_mode: string | null;
  readonly enabled: boolean;
  readonly mode: string | null;
}> {
  return new Promise((resolve) => {
    const chunks: string[] = [];

    const request = {
      url: path,
      method: "GET",
      headers: {},
      resume: () => undefined,
      on: (event: string, listener: (value?: unknown) => void) => {
        if (event === "end") listener();
      },
    };

    const response = {
      writeHead: () => undefined,
      end: (payload: string) => {
        chunks.push(payload);
        resolve(JSON.parse(chunks.join("")) as never);
      },
    };

    handler(request as never, response as never);
  });
}

/**
 * RESISTENCIA A UNA RESPUESTA QUE NO TRAE LOS CAMPOS OPCIONALES.
 *
 * POR QUE EXISTE ESTE BLOQUE
 * --------------------------
 * El backend acaba de publicar `GET /promotions/{slug}/amoe-config` y su forma
 * NO coincide con la que este frontend pidio: no trae `instructions`,
 * `required_fields`, `promotion_id` ni `external_url` (queda como handoff del
 * hito). Mientras las dos formas convergen, la interfaz tiene que degradar a su
 * estado deliberado, no caerse: la via gratuita es la unica que no exige
 * comprar nada, y una pantalla rota ahi es lo peor que puede pasar.
 *
 * El fallo concreto que se evita: `config.instructions === null` deja pasar un
 * `undefined` por la rama del "si hay valor", y `pickLocalized(undefined)`
 * lanza. Se prueba sobre la funcion PURA y no montando el panel, porque el
 * panel es un componente de servidor y `getTranslations` no existe dentro de
 * Vitest.
 */
describe("configuracion AMOE incompleta", () => {
  /** La forma que publica hoy el backend: sin los cuatro campos opcionales. */
  const asBackendPublishesIt = {
    enabled: true,
    mode: "ONLINE_FORM",
    submission_window: { opens_at: null, closes_at: null },
  } as unknown as AmoeConfig;

  it("un campo AUSENTE se trata igual que uno nulo", () => {
    const normalized = normalizeAmoeConfig(asBackendPublishesIt);

    // Ninguno de estos accesos puede devolver `undefined`: es lo que impide que
    // `pickLocalized` reciba algo que no sabe leer.
    expect(normalized.instructions).toBeNull();
    expect(normalized.promotionId).toBeNull();
    expect(normalized.externalUrl).toBeNull();
    expect(normalized.fields).toEqual([]);
  });

  it("la via apagada se normaliza sin perder su significado", () => {
    const normalized = normalizeAmoeConfig(amoeDisabledConfig);

    expect(normalized.enabled).toBe(false);
    expect(normalized.mode).toBeNull();
    expect(normalized.fields).toEqual([]);
  });

  it("un `enabled` que no sea booleano estricto se resuelve como APAGADA", () => {
    // Si el backend no dice si la via existe, la unica respuesta segura es que
    // no existe: anunciar un metodo gratuito no configurado seria afirmar algo
    // sobre las condiciones de participacion (CLAUDE.md #1 y #2).
    for (const value of [undefined, null, "true", 1]) {
      const config = { ...amoeOnlineFormConfig, enabled: value } as unknown as AmoeConfig;
      expect(normalizeAmoeConfig(config).enabled, String(value)).toBe(false);
    }
  });

  it("una ventana ausente no rompe la lectura de sus dos extremos", () => {
    const config = { enabled: true, mode: "CODE" } as unknown as AmoeConfig;
    const normalized = normalizeAmoeConfig(config);

    expect(normalized.opensAt).toBeNull();
    expect(normalized.closesAt).toBeNull();
  });

  it("los campos declarados se conservan tal cual cuando SI vienen", () => {
    const normalized = normalizeAmoeConfig(amoeOnlineFormConfig);

    expect(normalized.enabled).toBe(true);
    expect(normalized.fields).toEqual(amoeOnlineFormConfig.required_fields);
    expect(normalized.instructions).toEqual(amoeOnlineFormConfig.instructions);
  });
});

describe("destino externo", () => {
  it("solo acepta https", () => {
    expect(isSafeExternalUrl("https://example.invalid/free-entry")).toBe(true);

    // Un `href` con otro esquema es ejecucion de codigo de terceros en la
    // pagina, y el destino lo escribe quien configura la promocion.
    expect(isSafeExternalUrl("http://example.invalid")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeExternalUrl("no es una url")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
  });
});
