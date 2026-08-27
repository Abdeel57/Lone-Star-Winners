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
import {
  isSafeExternalUrl,
  normalizeAmoeConfig,
  normalizeAmoeField,
  type NormalizedAmoeField,
} from "@/lib/amoe-config";
import { LOCALES, type Locale } from "@/i18n/locales";
import {
  AMOE_FIELD_TYPES,
  AMOE_MODES,
  type AmoeConfig,
  type AmoeFieldSpec,
  type AmoeMode,
} from "@/lib/api";
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

/** Los campos, tal como los recibe el formulario: ya normalizados. */
function fieldsOf(config: AmoeConfig): readonly NormalizedAmoeField[] {
  return normalizeAmoeConfig(config).fields;
}

describe("formulario de participacion gratuita", () => {
  it("pinta EXACTAMENTE los campos declarados, y ni uno mas", () => {
    const fields = fieldsOf(amoeOnlineFormConfig);
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
      expect(container.querySelector(`[name="${field.key}"]`), field.key).not.toBeNull();
    }

    // Nada que el backend no haya pedido. Se cuentan los controles con nombre
    // que no son los campos ocultos del propio formulario.
    const named = [...container.querySelectorAll("input[name], textarea[name], select[name]")]
      .map((element) => element.getAttribute("name"))
      .filter((name): name is string => name !== null)
      .filter((name) => !["locale", "promotion_slug", "promotion_id"].includes(name));

    expect(named.sort()).toEqual(fields.map((field) => field.key).sort());
  });

  it("el nombre del control es `key`, no la clave de etiqueta", () => {
    /*
     * Las dos existen y NO son la misma: `key` es como viaja el dato en el
     * payload y `label_key` es una clave de copy. Confundirlas produce un envio
     * con nombres que el backend rechaza -o, peor, uno que acepta con los datos
     * en el campo equivocado-.
     */
    const fields = fieldsOf(amoeOnlineFormConfig);
    const named = fields.find((field) => field.key !== field.labelKey);
    expect(named).toBeDefined();

    const { container } = renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    expect(container.querySelector(`[name="${named?.key ?? ""}"]`)).not.toBeNull();
    expect(container.querySelector(`[name="${named?.labelKey ?? ""}"]`)).toBeNull();
  });

  it("la modalidad de codigo pinta su unico campo", () => {
    const fields = fieldsOf(amoeCodeConfig);
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

  it("cada tipo del contrato produce su control, y ninguno se queda sin pintar", () => {
    // La lista se recorre ENTERA: un tipo nuevo en el contrato que nadie
    // conectara aqui pintaria un campo sin control o rompería el `switch`.
    const fields: readonly AmoeFieldSpec[] = AMOE_FIELD_TYPES.map((type) => ({
      key: type.toLowerCase(),
      type,
      required: true,
      label_key: "note",
      max_length: 50,
    }));

    const { container } = renderIn(
      "en",
      <AmoeForm
        locale="en"
        promotionSlug="gmc-2025"
        promotionId="pro_1"
        fields={fields.map(normalizeAmoeField)}
      />,
    );

    for (const type of AMOE_FIELD_TYPES) {
      const control = container.querySelector(`[name="${type.toLowerCase()}"]`);
      expect(control, type).not.toBeNull();
    }

    expect(container.querySelector('[name="textarea"]')?.tagName).toBe("TEXTAREA");
    expect(container.querySelector('[name="email"]')).toHaveAttribute("type", "email");
    expect(container.querySelector('[name="tel"]')).toHaveAttribute("type", "tel");
    expect(container.querySelector('[name="date"]')).toHaveAttribute("type", "date");
  });

  it("una clave de etiqueta desconocida no se muestra en crudo", () => {
    /*
     * PASA DE VERDAD: el valor por defecto de `label_key` en el backend es la
     * PROPIA CLAVE del payload, asi que una promocion sin descriptor de
     * presentacion manda claves que la interfaz no conoce. Ensenar
     * `participant_full_legal_name` a alguien que quiere participar gratis es
     * lo peor de las dos opciones.
     */
    const fields: readonly AmoeFieldSpec[] = [
      {
        key: "participant_full_legal_name",
        type: "TEXT",
        required: true,
        label_key: "participant_full_legal_name",
        max_length: 120,
      },
      { key: "mystery", type: "TEXT", required: false, label_key: "SOMETHING_NEW", max_length: 30 },
    ];

    const { container } = renderIn(
      "en",
      <AmoeForm
        locale="en"
        promotionSlug="gmc-2025"
        promotionId="pro_1"
        fields={fields.map(normalizeAmoeField)}
      />,
    );

    // Los dos caen en la etiqueta generica...
    expect(screen.getAllByText(enMessages.amoe.fields.fallback, { exact: false })).toHaveLength(2);

    // ...ninguna clave tecnica aparece en pantalla...
    expect(container.textContent).not.toContain("SOMETHING_NEW");
    expect(container.textContent).not.toContain("participant_full_legal_name");

    // ...y los campos SIGUEN enviandose: perderlos seria peor que etiquetarlos
    // mal, porque un envio incompleto lo rechaza el backend.
    expect(container.querySelector('[name="participant_full_legal_name"]')).not.toBeNull();
    expect(container.querySelector('[name="mystery"]')).not.toBeNull();
  });

  it("las claves que el backend sirve hoy tienen etiqueta humana en los dos idiomas", () => {
    /*
     * Las que documenta el contrato, SIN namespace. Se comprueba sobre la
     * pantalla y no indexando el diccionario: lo que importa es que ninguna
     * llegue al generico, porque entonces varios campos se llamarian igual y
     * nadie sabria cual rellenar.
     */
    const served = ["fullName", "email", "postalCode", "dateOfBirth", "code", "note"];

    const fields: readonly AmoeFieldSpec[] = served.map((labelKey, index) => ({
      key: `field_${index}`,
      type: "TEXT",
      required: true,
      label_key: labelKey,
      max_length: 100,
    }));

    for (const locale of LOCALES) {
      const messages = messagesFor(locale);

      const view = renderIn(
        locale,
        <AmoeForm
          locale={locale}
          promotionSlug="gmc-2025"
          promotionId="pro_1"
          fields={fields.map(normalizeAmoeField)}
        />,
      );

      // Ni una cae en el generico...
      expect(
        screen.queryByText(messages.amoe.fields.fallback, { exact: false }),
        `generico en ${locale}`,
      ).toBeNull();

      /*
       * ...y las seis etiquetas son DISTINTAS entre si. Es la comprobacion que
       * de verdad importa: si dos claves acabaran resolviendose al mismo texto,
       * quien rellena el formulario veria dos campos con el mismo nombre y no
       * sabria cual es cual. No se comprueba que la etiqueta no contenga la
       * clave -"code" se traduce como "Code" y "Note" como "Nota", y eso es
       * correcto-, sino que ninguna se pierda.
       */
      const labels = [...view.container.querySelectorAll("label")].map((label) =>
        (label.textContent ?? "").replace("*", "").trim(),
      );

      expect(labels, `etiquetas en ${locale}`).toHaveLength(served.length);
      expect(new Set(labels).size, `etiquetas distintas en ${locale}`).toBe(served.length);

      view.unmount();
    }
  });

  it("no impone ninguna validacion que el backend no haya declarado", () => {
    // Sin tope declarado: el campo se pinta sin `maxLength`, no con uno
    // inventado. `null` y ausente significan lo mismo (`normalizeAmoeField`).
    const fields: readonly NormalizedAmoeField[] = [
      { key: "full_name", type: "TEXT", required: true, labelKey: "fullName", maxLength: null },
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

  it("traslada el tope de caracteres tal como llega", () => {
    const fields = fieldsOf(amoeOnlineFormConfig);
    const withMax = fields.find((field) => field.maxLength !== null);
    expect(withMax).toBeDefined();

    const { container } = renderIn(
      "en",
      <AmoeForm locale="en" promotionSlug="gmc-2025" promotionId="pro_1" fields={fields} />,
    );

    expect(container.querySelector(`[name="${withMax?.key ?? ""}"]`)).toHaveAttribute(
      "maxLength",
      String(withMax?.maxLength),
    );
  });
});

describe("configuracion AMOE: las cinco situaciones", () => {
  it("apagada llega con todo en null MENOS la promocion por la que se pregunto", () => {
    expect(amoeDisabledConfig.enabled).toBe(false);
    expect(amoeDisabledConfig.mode).toBeNull();
    expect(amoeDisabledConfig.instructions).toBeNull();
    expect(amoeDisabledConfig.required_fields).toBeNull();
    expect(amoeDisabledConfig.external_url).toBeNull();

    /*
     * `promotion_id` VIAJA TAMBIEN CON LA VIA APAGADA y eso NO es una
     * incoherencia: no es un parametro de AMOE, es el dato con el que se
     * pregunto. Tratarlo como sospechoso llevaria a alguna pantalla a decir que
     * la configuracion esta corrupta cuando esta exactamente como debe.
     */
    expect(amoeDisabledConfig.promotion_id).not.toBeNull();
    expect(normalizeAmoeConfig(amoeDisabledConfig).enabled).toBe(false);
  });

  it("el envio postal declara campos y AUN ASI no pinta formulario", () => {
    /*
     * `required_fields` llega en LAS CUATRO modalidades: el dominio exige esas
     * claves en cualquier envio que entre por la API. Quien decide si hay
     * formulario es la MODALIDAD, no la presencia de campos.
     */
    expect(amoeMailInConfig.mode).toBe("MAIL_IN_REVIEW");
    expect(amoeMailInConfig.required_fields).not.toBeNull();
    expect(amoeExternalConfig.required_fields).not.toBeNull();
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
    expect(approved?.entries_awarded).not.toBeNull();

    renderIn("en", <AmoeSubmissionList submissions={amoeSubmissions} locale="en" />);

    expect(
      screen.getByText(formatEntryCount(approved?.entries_awarded ?? 0, "en"), { exact: false }),
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
    const declared = amoeOnlineFormConfig.required_fields ?? [];

    expect(normalized.enabled).toBe(true);
    expect(normalized.instructions).toEqual(amoeOnlineFormConfig.instructions);

    // Mismos campos, mismo ORDEN, mismos valores. La normalizacion cambia la
    // forma del objeto, no lo que se pide: uno de mas seria recogida de datos
    // que nadie autorizo y uno de menos, un envio que el backend rechaza.
    expect(normalized.fields.map((field) => field.key)).toEqual(declared.map((field) => field.key));
    expect(normalized.fields.map((field) => field.maxLength)).toEqual(
      declared.map((field) => field.max_length),
    );
    expect(normalized.fields.map((field) => field.type)).toEqual(
      declared.map((field) => field.type),
    );
  });

  it("un campo sin tipo, sin tope o sin `required` produce un control utilizable", () => {
    /*
     * La API los declara los tres obligatorios (HO-031), pero "los sirve hoy" no
     * es "no pueden faltar nunca": una promocion a medio configurar o un entorno
     * con otra version siguen pudiendo llegar asi. El campo tiene que PINTARSE
     * igual -perderlo es un envio incompleto- y sin inventarse un tope.
     */
    const incomplete = { key: "note", label_key: "note" } as unknown as AmoeFieldSpec;
    const normalized = normalizeAmoeField(incomplete);

    expect(normalized.type).toBe("TEXT");
    expect(normalized.maxLength).toBeNull();
    expect(normalized.required).toBe(false);
  });

  it("un tipo desconocido cae a TEXT en vez de descartar el campo", () => {
    const exotic = {
      key: "signature",
      type: "SIGNATURE",
      required: true,
      label_key: "note",
      max_length: 0,
    } as unknown as AmoeFieldSpec;

    const normalized = normalizeAmoeField(exotic);

    // TEXT transporta cualquier texto; descartar el campo produciria un envio
    // que el backend rechaza con `AMOE_PAYLOAD_INVALID`.
    expect(normalized.type).toBe("TEXT");

    // `maxLength="0"` impediria escribir en el campo: un tope inservible es
    // igual que no tener tope.
    expect(normalized.maxLength).toBeNull();
    expect(normalized.required).toBe(true);
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
