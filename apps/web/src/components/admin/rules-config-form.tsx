"use client";

import { Alert, Button, Checkbox, FormField, Input, Select, Textarea } from "@lsw/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { FormError, LocaleField, useFieldError } from "@/components/auth-form-shell";
import type { Locale } from "@/i18n/locales";
import { IDLE, type ActionResult } from "@/lib/action-result";

/**
 * Redaccion de la `config` de una version de reglas (§13.2, §13.7, DEC-054).
 *
 * DOS VISTAS SOBRE EL MISMO OBJETO, Y NINGUNA ES UN ATAJO DE LA OTRA
 * -------------------------------------------------------------------
 * - **Estructurada**: un campo por clave, agrupadas como las agrupa el
 *   documento del abogado -limites, tasas, AMOE, multiplicadores, textos-. Es
 *   la que se usa a diario, y la que impide que alguien tenga que recordar la
 *   forma exacta de `purchase_entry_formula`.
 * - **JSON avanzada**: el objeto entero, editable. NO es "para expertos": es la
 *   unica superficie que puede escribir una clave que el formulario todavia no
 *   cubra, y las Official Rules van por su segundo borrador. Sin ella, cada
 *   clave nueva del abogado exigiria un despliegue del panel antes de poder
 *   configurarse.
 *
 * Las dos editan EL MISMO objeto en memoria y se envia entero, porque §13.7
 * pide el `config` completo: mandar solo lo que cambio dejaria al servidor
 * fusionando dos versiones de una configuracion que gobierna cuanto vale una
 * compra.
 *
 * NINGUNA CLAVE SE RELLENA SOLA
 * -----------------------------
 * Un campo vacio viaja como `"TBD"` -si la clave es un texto legal- o como
 * `null` -si es un numero o un bloque opcional-, y el formulario lo dice con
 * esas palabras encima de los campos. `"TBD"` es el estado HONESTO de una clave
 * legal sin resolver: bloquea la activacion (DEC-012) y eso es exactamente lo
 * que tiene que hacer. Un valor por defecto diria que algo esta decidido cuando
 * no lo esta (CLAUDE.md #2).
 *
 * LO QUE ESTE FORMULARIO NO VALIDA
 * --------------------------------
 * Casi todo. La API valida por rebanadas con los esquemas del dominio y
 * responde 422 con la ruta de cada problema; el trigger de DEC-012 decide si se
 * puede activar. Aqui solo se comprueba que el JSON PARSEE, porque un texto que
 * no parsea no puede viajar: el backend respondería sin `path` y quien opera se
 * quedaría sin saber en que linea se equivoco.
 */

/**
 * Campos estructurados, declarados como datos.
 *
 * `id` es a la vez la clave de copy (`admin.rules.fields.<id>`) y la identidad
 * del campo; `path` es la ruta dentro de `config`. Declararlos como lista -y no
 * como treinta bloques de JSX- es lo que permite que anadir una clave sea una
 * linea aqui y dos en los diccionarios, en vez de una reforma del formulario.
 *
 * `empty` dice QUE VIAJA cuando el campo se deja vacio, y es la decision mas
 * delicada de este archivo: `"TBD"` para las claves legales -bloquea la
 * activacion, que es lo correcto- y `null` para las que el dominio declara
 * nulables. Nunca un valor inventado.
 */
const FIELDS = [
  // --- Limites de participaciones
  {
    id: "perParticipantMax",
    path: "entry_limits.per_participant_max",
    kind: "number",
    empty: "null",
    group: "limits",
  },
  {
    id: "perOrderMax",
    path: "entry_limits.per_order_max",
    kind: "number",
    empty: "null",
    group: "limits",
  },

  // --- Tasa por tipo de producto (§13.1)
  {
    id: "merchandiseNumerator",
    path: "purchase_entry_formula.rates.MERCHANDISE.entries_per_amount_unit.numerator",
    kind: "number",
    empty: "null",
    group: "rates",
  },
  {
    id: "merchandiseDenominator",
    path: "purchase_entry_formula.rates.MERCHANDISE.entries_per_amount_unit.denominator",
    kind: "number",
    empty: "null",
    group: "rates",
  },
  {
    id: "merchandiseAmountUnit",
    path: "purchase_entry_formula.rates.MERCHANDISE.amount_unit_minor",
    kind: "text",
    empty: "null",
    group: "rates",
  },
  {
    id: "packageNumerator",
    path: "purchase_entry_formula.rates.ENTRY_PACKAGE.entries_per_amount_unit.numerator",
    kind: "number",
    empty: "null",
    group: "rates",
  },
  {
    id: "packageDenominator",
    path: "purchase_entry_formula.rates.ENTRY_PACKAGE.entries_per_amount_unit.denominator",
    kind: "number",
    empty: "null",
    group: "rates",
  },
  {
    id: "packageAmountUnit",
    path: "purchase_entry_formula.rates.ENTRY_PACKAGE.amount_unit_minor",
    kind: "text",
    empty: "null",
    group: "rates",
  },
  {
    id: "roundingPolicy",
    path: "purchase_entry_formula.rounding_policy",
    kind: "rounding",
    empty: "null",
    group: "rates",
  },
  {
    id: "formulaMode",
    path: "purchase_entry_formula.mode",
    kind: "text",
    empty: "null",
    group: "rates",
  },

  // --- Reembolsos y caducidad
  {
    id: "partialRefundRounding",
    path: "partial_refund_rounding_policy",
    kind: "text",
    empty: "TBD",
    group: "lifecycle",
  },
  {
    id: "entryExpiration",
    path: "entry_expiration",
    kind: "text",
    empty: "TBD",
    group: "lifecycle",
  },

  // --- AMOE postal (§13.2)
  { id: "amoeMode", path: "amoe.mode", kind: "amoeMode", empty: "null", group: "amoe" },
  {
    id: "amoeWindowStart",
    path: "amoe.submission_window.starts_at",
    kind: "text",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeWindowEnd",
    path: "amoe.submission_window.ends_at",
    kind: "text",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeEntriesPerSubmission",
    path: "amoe.entries_per_approved_submission",
    kind: "number",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeLimitMax",
    path: "amoe.limit.max_per_participant_per_period",
    kind: "number",
    empty: "null",
    group: "amoe",
  },
  { id: "amoeLimitPeriod", path: "amoe.limit.period", kind: "text", empty: "null", group: "amoe" },
  {
    id: "amoeDuplicatePolicy",
    path: "amoe.duplicate_policy",
    kind: "text",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeIdentityRequirements",
    path: "amoe.identity_requirements",
    kind: "list",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeCardsPerEnvelope",
    path: "amoe.mail_in.max_cards_per_envelope",
    kind: "number",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoePostmarkBy",
    path: "amoe.mail_in.postmark_by",
    kind: "text",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeReceivedBy",
    path: "amoe.mail_in.received_by",
    kind: "text",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeInstructionsEn",
    path: "amoe.instructions.en-US",
    kind: "textarea",
    empty: "null",
    group: "amoe",
  },
  {
    id: "amoeInstructionsEs",
    path: "amoe.instructions.es-US",
    kind: "textarea",
    empty: "null",
    group: "amoe",
  },

  // --- Multiplicadores y techo de bonificacion
  {
    id: "conflictStrategy",
    path: "multipliers.conflict_strategy",
    kind: "conflict",
    empty: "null",
    group: "multipliers",
  },
  {
    id: "bonusMaxNumerator",
    path: "bonus_rules.max_multiplier.numerator",
    kind: "number",
    empty: "null",
    group: "multipliers",
  },
  {
    id: "bonusMaxDenominator",
    path: "bonus_rules.max_multiplier.denominator",
    kind: "number",
    empty: "null",
    group: "multipliers",
  },
  {
    id: "bonusAppliesToKinds",
    path: "bonus_rules.applies_to_product_kinds",
    kind: "list",
    empty: "null",
    group: "multipliers",
  },
  {
    id: "bonusAppliesToAmoe",
    path: "bonus_rules.applies_to_amoe",
    kind: "boolean",
    empty: "null",
    group: "multipliers",
  },

  // --- Textos legales
  { id: "eligibility", path: "eligibility", kind: "textarea", empty: "TBD", group: "legal" },
  {
    id: "allowedJurisdictions",
    path: "allowed_jurisdictions",
    kind: "json",
    empty: "null",
    group: "legal",
  },
  { id: "minimumAge", path: "minimum_age", kind: "number", empty: "null", group: "legal" },
  {
    id: "promotionStartEndRules",
    path: "promotion_start_end_rules",
    kind: "textarea",
    empty: "TBD",
    group: "legal",
  },
  {
    id: "winnerDrawingMethod",
    path: "winner_drawing_method",
    kind: "textarea",
    empty: "TBD",
    group: "legal",
  },
  {
    id: "officialRulesDocument",
    path: "official_rules_document",
    kind: "text",
    empty: "TBD",
    group: "legal",
  },
  {
    id: "controllingLanguage",
    path: "controlling_language",
    kind: "text",
    empty: "TBD",
    group: "legal",
  },
] as const;

type FieldSpec = (typeof FIELDS)[number];
type FieldGroup = FieldSpec["group"];

const GROUPS: readonly FieldGroup[] = [
  "limits",
  "rates",
  "lifecycle",
  "amoe",
  "multipliers",
  "legal",
];

/** Politicas de redondeo que admite el motor. Es un enum del dominio, no legal. */
const ROUNDING_POLICIES = ["FLOOR", "CEIL", "HALF_UP", "HALF_DOWN", "HALF_EVEN"] as const;

/** Estrategias de conflicto entre multiplicadores. Tambien enum del dominio. */
const CONFLICT_STRATEGIES = ["HIGHEST_WINS", "STACK", "EXCLUSIVE", "PRIORITY_ORDER"] as const;

/** Modalidades AMOE (DEC-032). Cual es legal lo decide el abogado. */
const AMOE_MODE_VALUES = [
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
] as const;

export function RulesConfigForm({
  locale,
  action,
  promotionId,
  rulesVersionId,
  initialConfigJson,
  attorneyReference,
  editable,
}: {
  readonly locale: Locale;
  readonly action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>;
  readonly promotionId: string;
  readonly rulesVersionId: string;
  /** `config` de la version, ya serializado con sangria. */
  readonly initialConfigJson: string;
  readonly attorneyReference: string | null;
  /**
   * Si la version admite edicion (solo `DRAFT`).
   *
   * Con `false` los campos se pintan en solo lectura y no hay boton: sobre una
   * version `ACTIVE` la API responde 409 con el mensaje del trigger, y mandar a
   * alguien a rellenar un formulario para eso seria hacerle perder el trabajo.
   */
  readonly editable: boolean;
}) {
  const t = useTranslations("admin.rules");
  const tf = useTranslations("admin.rules.fields");
  const [state, formAction, pending] = useActionState(action, IDLE);
  const fieldError = useFieldError(state);

  const [advanced, setAdvanced] = useState(false);
  const [configText, setConfigText] = useState(initialConfigJson);
  const [parseError, setParseError] = useState(false);

  const config = parseConfig(configText);

  /** Escribe una ruta y vuelve a serializar. El objeto vive en el texto. */
  const update = (path: string, value: unknown): void => {
    if (config === null) return;

    const next = setPath(config, path, value);
    setConfigText(JSON.stringify(next, null, 2));
    setParseError(false);
  };

  return (
    <form action={formAction} className="flex flex-col gap-s5">
      <LocaleField locale={locale} />
      <input type="hidden" name="promotion_id" value={promotionId} />
      <input type="hidden" name="rules_version_id" value={rulesVersionId} />
      {/* EL OBJETO ENTERO VIAJA EN UN SOLO CAMPO. Las dos vistas editan el
          mismo texto, asi que da igual desde cual se haya escrito. */}
      <input type="hidden" name="config" value={configText} />

      <FormError result={state} />
      {state.status === "ok" ? <Alert tone="success">{t("saved")}</Alert> : null}

      {state.status === "error" && state.detail !== null ? (
        <Alert tone="danger" title={t("engineSaid")}>
          <p className="font-mono text-body-sm">{state.detail}</p>
        </Alert>
      ) : null}

      {/* LA REGLA DE LOS CAMPOS VACIOS, ARRIBA Y NO EN UNA AYUDA. Es lo que
          separa "no lo he escrito todavia" de "he decidido que no aplica". */}
      <Alert tone="info">{t("emptyValueNote")}</Alert>

      {!editable ? <Alert tone="warning">{t("readOnlyNote")}</Alert> : null}

      <div className="flex flex-wrap items-center gap-s3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdvanced(!advanced);
          }}
        >
          {advanced ? t("showStructured") : t("showAdvanced")}
        </Button>

        {config === null || parseError ? (
          <span className="text-body-sm text-danger-text">{t("jsonInvalid")}</span>
        ) : null}
      </div>

      {advanced || config === null ? (
        <FormField
          label={t("advancedLabel")}
          description={t("advancedHint")}
          error={fieldError("config")}
        >
          <Textarea
            name="config_editor"
            rows={20}
            spellCheck={false}
            value={configText}
            disabled={!editable}
            onChange={(event) => {
              setConfigText(event.target.value);
              setParseError(parseConfig(event.target.value) === null);
            }}
            className="font-mono"
          />
        </FormField>
      ) : (
        GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-s4 border-t border-border pt-s4">
            <legend className="lsw-eyebrow text-text-subtle">{groupLabel(t, group)}</legend>

            <div className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
              {FIELDS.filter((field) => field.group === group).map((field) => (
                <FormField
                  key={field.id}
                  label={tf(field.id)}
                  description={field.empty === "TBD" ? t("emptyIsTbd") : t("emptyIsNull")}
                  className={
                    field.kind === "textarea" || field.kind === "json" ? "sm:col-span-2" : ""
                  }
                >
                  <FieldControl
                    field={field}
                    value={readPath(config, field.path)}
                    editable={editable}
                    onChange={(value) => {
                      update(field.path, value);
                    }}
                  />
                </FormField>
              ))}
            </div>
          </fieldset>
        ))
      )}

      <FormField
        label={t("attorneyReferenceLabel")}
        description={t("attorneyReferenceHint")}
        error={fieldError("attorney_approval_reference")}
      >
        <Input
          name="attorney_approval_reference"
          defaultValue={attorneyReference ?? ""}
          disabled={!editable}
          autoComplete="off"
        />
      </FormField>

      {!editable ? null : (
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          disabled={config === null}
          className="w-full sm:w-auto sm:self-start"
        >
          {t("saveCta")}
        </Button>
      )}
    </form>
  );
}

/**
 * El control que corresponde a cada tipo de campo.
 *
 * Los enums -redondeo, estrategia de conflicto, modalidad AMOE- se pintan como
 * `<select>` porque son listas CERRADAS DEL DOMINIO y escribirlas a mano solo
 * produce un 422. Todo lo demas es texto: que valores son legales lo decide el
 * abogado, y una lista aqui seria inventar la respuesta.
 */
function FieldControl({
  field,
  value,
  editable,
  onChange,
}: {
  readonly field: FieldSpec;
  readonly value: unknown;
  readonly editable: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const t = useTranslations("admin.rules");

  const text = toText(value);

  if (field.kind === "boolean") {
    return (
      <Checkbox
        checked={value === true}
        disabled={!editable}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        label={t("booleanLabel")}
      />
    );
  }

  if (field.kind === "rounding" || field.kind === "conflict" || field.kind === "amoeMode") {
    const options =
      field.kind === "rounding"
        ? ROUNDING_POLICIES
        : field.kind === "conflict"
          ? CONFLICT_STRATEGIES
          : AMOE_MODE_VALUES;

    return (
      <Select
        value={text}
        disabled={!editable}
        onChange={(event) => {
          onChange(event.target.value === "" ? null : event.target.value);
        }}
      >
        <option value="">{t("enumUnset")}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }

  if (field.kind === "textarea" || field.kind === "json") {
    return (
      <Textarea
        rows={field.kind === "json" ? 4 : 3}
        spellCheck={field.kind !== "json"}
        value={text}
        disabled={!editable}
        onChange={(event) => {
          onChange(coerce(field, event.target.value));
        }}
        className={field.kind === "json" ? "font-mono" : ""}
      />
    );
  }

  return (
    <Input
      value={text}
      disabled={!editable}
      autoComplete="off"
      spellCheck={false}
      {...(field.kind === "number" ? { inputMode: "numeric" as const } : {})}
      onChange={(event) => {
        onChange(coerce(field, event.target.value));
      }}
    />
  );
}

function groupLabel(
  t: ReturnType<typeof useTranslations<"admin.rules">>,
  group: FieldGroup,
): string {
  switch (group) {
    case "limits":
      return t("groupLimits");
    case "rates":
      return t("groupRates");
    case "lifecycle":
      return t("groupLifecycle");
    case "amoe":
      return t("groupAmoe");
    case "multipliers":
      return t("groupMultipliers");
    case "legal":
      return t("groupLegal");
  }
}

/**
 * Convierte el texto tecleado al valor que viaja en `config`.
 *
 * EL VACIO ES LA DECISION IMPORTANTE: `"TBD"` para las claves legales -que
 * bloquea la activacion, y eso es correcto- y `null` para las nulables. Nunca
 * se omite la clave ni se inventa un valor.
 *
 * Un numero que no parsea se guarda como TEXTO tal cual, no se descarta: quien
 * escribe "diez" tiene que ver su error en el 422 de la API, no descubrir que
 * el campo se vacio solo.
 */
function coerce(field: FieldSpec, raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed.length === 0) return field.empty === "TBD" ? "TBD" : null;

  if (field.kind === "number") {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : trimmed;
  }

  if (field.kind === "list") {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (field.kind === "json") {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Se conserva el texto: la API lo rechazara con su ruta, que es mas util
      // que un campo que se borra solo al escribir mal una llave.
      return trimmed;
    }
  }

  return raw;
}

/** El valor de una ruta, como texto editable. */
function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function parseConfig(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Lee una ruta con puntos dentro de `config`.
 *
 * `amoe.instructions.en-US` funciona porque el separador es el punto y la
 * etiqueta BCP-47 no lo lleva. Una clave que lo llevara habria que leerla desde
 * la vista JSON, y por eso esa vista existe.
 */
function readPath(config: Record<string, unknown> | null, path: string): unknown {
  if (config === null) return undefined;

  let node: unknown = config;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    /*
     * `part` sale de las rutas declaradas en `FIELDS`, que es una constante
     * literal de este archivo: no hay ninguna cadena procedente de la peticion
     * ni de un fichero de terceros. La lectura ademas no muta nada.
     */
    // eslint-disable-next-line security/detect-object-injection
    node = (node as Record<string, unknown>)[part];
  }

  return node;
}

/**
 * Escribe una ruta devolviendo un objeto NUEVO.
 *
 * Sin mutar: el objeto vive serializado en el estado del formulario, y mutar el
 * que acaba de salir de `JSON.parse` funcionaria por casualidad hasta que
 * alguien lo memoizara.
 */
function setPath(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  if (head === undefined) return config;

  if (rest.length === 0) return { ...config, [head]: value };

  /*
   * Misma razon que en `readPath`: `head` procede de las rutas de `FIELDS`.
   * Y el objeto no se muta -se devuelve uno nuevo con la propagacion de
   * abajo-, asi que no hay prototipo que contaminar.
   */
  // eslint-disable-next-line security/detect-object-injection
  const current = config[head];
  const child =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};

  return { ...config, [head]: setPath(child, rest.join("."), value) };
}
