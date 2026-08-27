import type {
  AmoeConfig,
  AmoeFieldSpec,
  AmoeSubmission,
  AmoeSubmissionPage,
  AmoeSubmissionResponse,
} from "@/lib/api";

import { activePromotion } from "./promotions";

/**
 * Fixtures de la via gratuita de participacion.
 *
 * CINCO ESCENARIOS, PORQUE HAY CINCO PANTALLAS QUE PROBAR
 * -------------------------------------------------------
 * Las cuatro modalidades de DEC-032 exigen interfaces distintas -por eso
 * `amoe_mode` es un enum y no un booleano- y la quinta es la via APAGADA, que
 * es el estado por defecto y el unico que hoy es real.
 *
 * LAS INSTRUCCIONES DE ESTOS FIXTURES NO SON TEXTO LEGAL
 * ------------------------------------------------------
 * Y se nota a proposito: son descripciones de la FORMA que tendra el contenido,
 * no un procedimiento de participacion. El texto de verdad lo escribe el
 * abogado del cliente y lo publica el backend; si aqui hubiera una direccion
 * postal plausible o un limite concreto, acabaria copiado a produccion por
 * alguien con prisa (CLAUDE.md #1 y #2).
 *
 * LOS CAMPOS TAMPOCO SON UNA PROPUESTA DE QUE PEDIR. Existen para que la
 * interfaz pueda probar que pinta lo que le mandan y solo lo que le mandan.
 */

const PROMOTION_ID = activePromotion.id;

/** Via gratuita APAGADA: todo en `null`. Es el estado por defecto (DEC-032). */
export const amoeDisabledConfig: AmoeConfig = {
  enabled: false,
  mode: null,
  promotion_id: null,
  submission_window: { opens_at: null, closes_at: null },
  instructions: null,
  required_fields: null,
  external_url: null,
};

const onlineFormFields: readonly AmoeFieldSpec[] = [
  { name: "full_name", kind: "text", label_key: "fullName", required: true, max_length: 120 },
  { name: "email", kind: "email", label_key: "email", required: true, max_length: 254 },
  { name: "postal_code", kind: "text", label_key: "postalCode", required: true, max_length: 12 },
];

/** Formulario en linea. */
export const amoeOnlineFormConfig: AmoeConfig = {
  enabled: true,
  mode: "ONLINE_FORM",
  promotion_id: PROMOTION_ID,
  submission_window: {
    opens_at: "2026-09-01T05:00:00.000Z",
    closes_at: "2026-10-01T04:59:59.000Z",
  },
  instructions: {
    "en-US":
      "This text is served by the backend and rendered as it arrives. In production it is the approved wording that describes the free method of entry for this promotion.\n\nWhat is asked for, how often it can be used and what the limits are all come from the Official Rules.",
    "es-US":
      "Este texto lo sirve el backend y se renderiza tal como llega. En producción es la redacción aprobada que describe el método gratuito de participación de esta promoción.\n\nQué se pide, con qué frecuencia se puede usar y cuáles son los límites salen de las Reglas Oficiales.",
  },
  required_fields: onlineFormFields,
  external_url: null,
};

/**
 * Envio por correo postal.
 *
 * SIN CAMPOS Y SIN FORMULARIO, y esa ausencia es el fixture: la interfaz tiene
 * que renderizar instrucciones y NINGUN control de envio. Un boton aqui
 * sugeriria que se puede participar desde la web, que es lo contrario de lo que
 * dicen las instrucciones.
 */
export const amoeMailInConfig: AmoeConfig = {
  ...amoeOnlineFormConfig,
  mode: "MAIL_IN_REVIEW",
  required_fields: null,
  instructions: {
    "en-US":
      "This text is served by the backend. In production it carries the mailing address, the required format and the limits, exactly as the Official Rules state them.\n\nNothing on this page is written by the interface.",
    "es-US":
      "Este texto lo sirve el backend. En producción lleva la dirección postal, el formato exigido y los límites, exactamente como los fijan las Reglas Oficiales.\n\nNada de esta página lo escribe la interfaz.",
  },
};

/** Codigo. Un solo campo, publicado por el backend. */
export const amoeCodeConfig: AmoeConfig = {
  ...amoeOnlineFormConfig,
  mode: "CODE",
  required_fields: [
    { name: "code", kind: "code", label_key: "code", required: true, max_length: 16 },
  ],
  instructions: {
    "en-US":
      "This text is served by the backend. In production it explains how a code is obtained and how it is submitted, as set out in the Official Rules.",
    "es-US":
      "Este texto lo sirve el backend. En producción explica cómo se obtiene un código y cómo se envía, según las Reglas Oficiales.",
  },
};

/**
 * Instrucciones externas.
 *
 * El destino es `https:` a proposito: la interfaz descarta cualquier otro
 * esquema antes de pintarlo como enlace, y un fixture con `http:` haria que el
 * escenario probara el camino equivocado.
 */
export const amoeExternalConfig: AmoeConfig = {
  ...amoeOnlineFormConfig,
  mode: "EXTERNAL_INSTRUCTIONS",
  required_fields: null,
  external_url: "https://example.invalid/free-entry",
  instructions: {
    "en-US":
      "This text is served by the backend. In production it points to where the free method of entry is described, as set out in the Official Rules.",
    "es-US":
      "Este texto lo sirve el backend. En producción remite a donde se describe el método gratuito de participación, según las Reglas Oficiales.",
  },
};

/**
 * Caso defectuoso a proposito: encendida y sin modalidad.
 *
 * Ocurre de verdad -alguien enciende la funcion antes de que el abogado fije la
 * modalidad- y la interfaz tiene que decir que la via existe sin elegir una
 * pantalla por su cuenta.
 */
export const amoeEnabledWithoutModeConfig: AmoeConfig = {
  ...amoeOnlineFormConfig,
  mode: null,
  required_fields: null,
  instructions: null,
};

/**
 * Modalidad de formulario SIN campos publicados.
 *
 * Otro estado a medias real: la interfaz no puede componer un envio sin saber
 * que se pide, y tiene que decirlo en vez de mandar un payload vacio.
 */
export const amoeFormWithoutFieldsConfig: AmoeConfig = {
  ...amoeOnlineFormConfig,
  required_fields: [],
};

// ---------------------------------------------------------------------------
// Envios del participante
// ---------------------------------------------------------------------------

/**
 * Un envio de cada estado, incluido el retirado.
 *
 * EL RETIRADO SIGUE EN LA LISTA, y por eso esta aqui: retirar no borra
 * (principios #6 y #7). Un fixture sin envios cancelados dejaria sin probar el
 * unico camino en el que la interfaz podria hacer desaparecer una procedencia.
 *
 * `entries_granted` es `null` en los que no otorgaron nada, NO `0`: "todavia no
 * se sabe" y "ninguna" son afirmaciones distintas.
 */
export const amoeSubmissions: readonly AmoeSubmission[] = [
  {
    id: "amo_0000000000000001",
    promotion_id: PROMOTION_ID,
    status: "PENDING_REVIEW",
    submitted_at: "2026-09-12T15:04:00.000Z",
    decided_at: null,
    reason_key: null,
    entries_granted: null,
    cancellable: true,
  },
  {
    id: "amo_0000000000000002",
    promotion_id: PROMOTION_ID,
    status: "APPROVED",
    submitted_at: "2026-09-05T11:22:00.000Z",
    decided_at: "2026-09-06T09:10:00.000Z",
    reason_key: null,
    entries_granted: 200,
    cancellable: false,
  },
  {
    id: "amo_0000000000000003",
    promotion_id: PROMOTION_ID,
    status: "REJECTED",
    submitted_at: "2026-09-02T18:40:00.000Z",
    decided_at: "2026-09-03T08:00:00.000Z",
    reason_key: "DUPLICATE_SUBMISSION",
    entries_granted: null,
    cancellable: false,
  },
  {
    id: "amo_0000000000000004",
    promotion_id: PROMOTION_ID,
    status: "CANCELLED",
    submitted_at: "2026-08-28T12:00:00.000Z",
    decided_at: "2026-08-28T12:30:00.000Z",
    reason_key: null,
    entries_granted: null,
    cancellable: false,
  },
];

export const amoeSubmissionPage: AmoeSubmissionPage = {
  items: amoeSubmissions,
  next_cursor: null,
};

export const emptyAmoeSubmissionPage: AmoeSubmissionPage = { items: [], next_cursor: null };

/**
 * Respuesta a un envio con revision manual.
 *
 * `entries: null` no es un olvido: una modalidad con revision no otorga nada en
 * el momento del envio, y prometer una cifra antes de la revision seria afirmar
 * su resultado.
 */
export const amoePendingSubmissionResponse: AmoeSubmissionResponse = {
  submission_id: "amo_0000000000000005",
  status: "PENDING_REVIEW",
  entries: null,
};

/** Respuesta de una modalidad que otorga al instante. */
export const amoeApprovedSubmissionResponse: AmoeSubmissionResponse = {
  submission_id: "amo_0000000000000006",
  status: "APPROVED",
  entries: 200,
};
