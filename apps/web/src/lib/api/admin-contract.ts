import type {
  AmoeMode,
  CursorPage,
  EntryMultiplier,
  LocalizedText,
  ProductKind,
  PromotionStatus,
} from "./contract";

/**
 * [CONTRATO] Altas del panel: catalogo y promociones (seccion 12).
 *
 * VIVE EN SU PROPIO FICHERO Y NO EN `contract.ts` por una razon de trabajo en
 * paralelo, no de arquitectura: `contract.ts` lo reescribe otra sesion para
 * alinear el escaparate con la API real, y dos manos sobre el mismo fichero
 * a la vez es como se pierden ediciones. La regla de `index.ts` sigue intacta:
 * los componentes importan de alli y nunca de aqui.
 *
 * Estas formas NO son provisionales: son las que publica `docs/API_CONTRACT.md`
 * seccion 12, escritas contra rutas que ya responden en produccion.
 *
 * TRES COSAS QUE LA INTERFAZ NO PUEDE DECIDIR
 * -------------------------------------------
 * 1. `price_amount_minor` es CADENA, no numero: un importe en unidad menor
 *    puede superar el entero seguro de JavaScript. `null` significa que el
 *    producto aun no tiene variante, NO que sea gratis.
 * 2. Los dos idiomas son obligatorios en el alta (principio 4). No hay
 *    `optional` en `LocalizedText` y no hay fallback de uno al otro.
 * 3. El estado no viaja en el `PATCH`: publicar, programar, activar y cerrar
 *    son rutas aparte porque exigen otra capacidad y el autorizador decide por
 *    (metodo, camino) antes de leer el cuerpo.
 */

export type AdminProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export const ADMIN_PRODUCT_STATUSES: readonly AdminProductStatus[] = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
];

/**
 * Variante del panel (§13.6, DEC-053).
 *
 * NO HAY BORRADO: una variante se ARCHIVA. Un SKU vendido no puede desaparecer
 * del sistema, porque los pedidos que lo contienen tienen que poder explicarse
 * (principios #5 y #6).
 */
export interface AdminProductVariantRow {
  readonly id: string;
  readonly sku: string;
  /** `null` = variante unica sin nombre. Los dos idiomas cuando lo tiene. */
  readonly name: LocalizedText | null;
  /** Unidad menor como cadena (DEC-010). */
  readonly price_amount_minor: string | null;
  /** `null` = existencias no gestionadas, que NO es cero. */
  readonly stock_quantity: number | null;
  readonly status: AdminProductStatus;
  readonly image_url: string | null;
  readonly position?: number;
}

/** Alta de variante (§13.6). `sku` opcional: la API compone `<sku>-<n>`. */
export interface AdminProductVariantInput {
  readonly sku?: string;
  readonly name: LocalizedText;
  readonly price_amount_minor: number;
  readonly stock_quantity: number | null;
  readonly image_url?: string | null;
  readonly position?: number;
}

/** Edicion de variante (§13.6). Todos opcionales; `status` archiva. */
export interface AdminProductVariantPatch {
  readonly sku?: string;
  readonly name?: LocalizedText;
  readonly price_amount_minor?: number;
  readonly stock_quantity?: number | null;
  readonly image_url?: string | null;
  readonly position?: number;
  readonly status?: AdminProductStatus;
}

/** Producto tal como lo publica el panel: con su primera variante aplanada. */
export interface AdminProductRow {
  readonly id: string;
  readonly sku: string;
  readonly slug: string;
  readonly status: AdminProductStatus;
  /** ISO-4217, en mayusculas. */
  readonly currency: string;
  readonly name: LocalizedText;
  /** Unidad menor como cadena (DEC-010). `null` = sin variante todavia. */
  readonly price_amount_minor: string | null;
  /** `null` = existencias no gestionadas, que NO es lo mismo que cero. */
  readonly stock_quantity: number | null;
  readonly variant_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /**
   * Tipo de producto (§13.6, DEC-052). Opcional mientras la API no publique §13.
   *
   * Ausente NO significa mercancia: significa que no se sabe, y el formulario
   * lo dice en vez de preseleccionar una opcion que cambiaria la tasa que se
   * aplica a cada compra.
   */
  readonly kind?: ProductKind;
  /** Clave de categoria, o `null`. El nombre lo resuelve el catalogo. */
  readonly category_key?: string | null;
  readonly image_url?: string | null;
  /**
   * Todas las variantes (§13.6). `price_amount_minor`, `stock_quantity` y
   * `variant_id` de nivel producto siguen siendo LA PRIMERA, por compatibilidad
   * con el flujo de una sola variante.
   */
  readonly variants?: readonly AdminProductVariantRow[];
}

export type AdminProductPage = CursorPage<AdminProductRow>;

export interface AdminProductInput {
  readonly sku: string;
  readonly slug: string;
  readonly currency: string;
  readonly name: LocalizedText;
  readonly description: { readonly "es-US": string | null; readonly "en-US": string | null };
  /** Entero en unidad menor. Se manda como numero porque JSON no tiene enteros grandes. */
  readonly price_amount_minor: number;
  readonly stock_quantity: number | null;
  /** Obligatorio en §13.6. Opcional aqui mientras la API anterior lo ignore. */
  readonly kind?: ProductKind;
  readonly category_key?: string | null;
  readonly image_url?: string | null;
  /**
   * Variantes del alta (§13.6). Si falta, la API crea una `<sku>-1` sin nombre
   * con el precio y las existencias del nivel producto, como hasta ahora. Si
   * viene, esos dos campos del nivel producto se ignoran.
   */
  readonly variants?: readonly AdminProductVariantInput[];
}

export interface AdminProductPatch {
  readonly name?: LocalizedText;
  readonly price_amount_minor?: number;
  readonly stock_quantity?: number | null;
  readonly kind?: ProductKind;
  readonly category_key?: string | null;
  readonly image_url?: string | null;
}

/**
 * Categoria del catalogo en el panel (§13.6, DEC-053).
 *
 * Las ocho iniciales las siembra la migracion `0026` como DATOS -son catalogo
 * del negocio, no codigo- y el panel puede crear mas. El nombre viaja en los
 * dos idiomas (principio 4).
 */
export interface AdminProductCategoryRow {
  readonly key: string;
  readonly name: LocalizedText;
  readonly position: number;
}

export interface AdminProductCategoryListResponse {
  readonly items: readonly AdminProductCategoryRow[];
}

export interface AdminProductCategoryInput {
  /** `^[a-z0-9]+(-[a-z0-9]+)*$`. La API responde 409 si ya existe. */
  readonly key: string;
  readonly name: LocalizedText;
  readonly position: number;
}

export interface AdminPromotionRow {
  readonly id: string;
  readonly slug: string;
  /** Solo lo ve el equipo. El nombre publico va en `public_name`. */
  readonly internal_name: string;
  readonly status: PromotionStatus;
  /** Zona horaria IANA legal (DEC-011). No se edita despues de crear. */
  readonly legal_timezone: string;
  /** ISO-8601 UTC, o `null` mientras no se haya fijado. */
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  /** `null` significa que NO puede activarse todavia (DEC-012). */
  readonly active_rules_version_id: string | null;
  readonly public_name: LocalizedText;
  readonly created_at: string;
  readonly updated_at: string;
}

export type AdminPromotionPage = CursorPage<AdminPromotionRow>;

export interface AdminPromotionInput {
  readonly slug: string;
  readonly internal_name: string;
  readonly legal_timezone: string;
  readonly public_name: LocalizedText;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
}

export interface AdminPromotionPatch {
  readonly internal_name?: string;
  readonly public_name?: LocalizedText;
  readonly starts_at?: string | null;
  readonly ends_at?: string | null;
}

/**
 * Motivo de una transicion sensible.
 *
 * `reason_code` lo lee el AUTORIZADOR antes del handler, con la misma forma que
 * se persiste en la traza. Sin el, la respuesta es 403 -de la puerta- y no 422.
 */
export interface AdminReasonInput {
  readonly reason_code: string;
  readonly reason_text: string | null;
}

// ---------------------------------------------------------------------------
// Versiones de reglas, bonus, flags y transcripcion (§13.7 a §13.10, DEC-054)
// ---------------------------------------------------------------------------

/**
 * Alta de un borrador de version de reglas (§13.7).
 *
 * SIN NADA, la API compone una plantilla con TODAS las claves requeridas en
 * `"TBD"`. Ese es el estado honesto y es lo que el panel ofrece por defecto:
 * un borrador vacio dice que falta todo, y un borrador con valores por defecto
 * diria que algo esta decidido cuando no lo esta (CLAUDE.md #2).
 *
 * `clone_from_rules_version_id` copia `config` y documentos de otra version de
 * LA MISMA promocion. Es el camino normal: casi ningun cambio legal parte de
 * cero.
 */
export interface AdminRulesVersionInput {
  readonly clone_from_rules_version_id?: string;
  /** Objeto libre: su forma la fija el dominio legal, no el frontend. */
  readonly config?: Record<string, unknown>;
  readonly attorney_approval_reference?: string;
}

/**
 * Edicion de un borrador (§13.7). Solo `DRAFT`.
 *
 * `config` se manda ENTERO: la API lo valida por rebanadas y responde 422 con
 * la ruta de cada problema. El panel no completa ninguna clave ausente, y el
 * formulario dice explicitamente que un campo vacio viaja como `"TBD"` o como
 * `null` segun la clave.
 */
export interface AdminRulesVersionPatch {
  readonly config?: Record<string, unknown>;
  readonly attorney_approval_reference?: string | null;
  readonly effective_at?: string | null;
}

/** Documento de una version, por locale (§13.7, `PUT …/documents/:locale`). */
export interface AdminRulesDocumentInput {
  readonly title: string;
  readonly body: string;
  readonly is_legally_controlling: boolean;
  readonly is_informational_translation: boolean;
}

/**
 * Atajo "periodo bonus" (§13.8, DEC-054 punto 2).
 *
 * NO CREA UN OBJETO NUEVO: clona la version ACTIVE, le anade el periodo y la
 * activa. Es el gesto "5X durante 12 horas" expresado como lo que DEC-012 dice
 * que es -una version de reglas nueva, con su traza-, y por eso exige motivo y
 * step-up igual que activar.
 *
 * `multiplier` es una FRACCION (DEC-010). El panel ofrece 2X, 5X y 10X como
 * atajos y admite escribir numerador y denominador: los tres primeros son lo
 * que pidio el cliente, no un limite del sistema. El techo legal lo impone
 * `bonus_rules.max_multiplier` y lo comprueba la API (422).
 *
 * `conflict_strategy` viaja SOLO cuando la version activa no declara
 * `multipliers`: el motor falla en vez de desempatar por su cuenta, asi que hay
 * que decirla; no se asume ninguna.
 */
export interface AdminBonusPeriodInput extends AdminReasonInput {
  readonly multiplier: EntryMultiplier;
  /** ISO-8601 UTC. */
  readonly starts_at: string;
  readonly ends_at: string;
  /** `null` = todos los tipos de producto. */
  readonly product_kind_scope: readonly ProductKind[] | null;
  readonly sku_scope: readonly string[] | null;
  readonly conflict_strategy: string | null;
}

/**
 * Respuesta del atajo bonus (§13.8).
 *
 * `warnings` SE ENSENA TAL CUAL Y NO SE ESCONDE: con
 * `entry_multipliers_enabled` apagado, el bonus existe y NO aplica. Ocultar esa
 * advertencia dejaria a quien acaba de crear un 5X creyendo que esta activo.
 */
export interface AdminBonusPeriodResponse {
  readonly warnings?: readonly string[];
}

/**
 * Fila de `GET /admin/feature-flags` (§13.9, DEC-054 punto 3).
 *
 * `is_legally_material` NO lo decide el panel: lo publica el backend a partir
 * del catalogo de `packages/security`, y es lo que convierte un interruptor en
 * una accion que exige `flag.update.legally_material` y step-up. La pantalla lo
 * ADVIERTE antes de pulsar; quien autoriza sigue siendo el backend.
 *
 * `legal_dependency` es la clave de `docs/LEGAL_PENDING.md` de la que depende
 * el flag, cuando depende de alguna. Se pinta con su identificador: aqui el
 * identificador es lo util.
 */
export interface AdminFeatureFlagRow {
  readonly key: string;
  readonly enabled: boolean;
  readonly is_legally_material: boolean;
  readonly dec032_default?: boolean;
  readonly legal_dependency?: string | null;
  readonly updated_at?: string | null;
  /**
   * Solicitud de cambio PENDIENTE sobre este flag, o `null`
   * (HO-041, resolucion fase 1).
   *
   * Con una solicitud viva, el interruptor no se ofrece: habria dos gestos
   * compitiendo por el mismo valor y el segundo dejaria a alguien aprobando un
   * cambio que ya no es el actual. La pantalla dice que hay una pendiente y
   * lleva a la lista.
   */
  readonly pending_change_request_id?: string | null;
}

export interface AdminFeatureFlagsResponse {
  readonly items: readonly AdminFeatureFlagRow[];
  /**
   * Modalidad AMOE vigente, o `null`.
   *
   * SE LEE AQUI Y SE CAMBIA POR CONTROL DUAL. No tiene ruta de escritura propia
   * desde HO-041: `PATCH /admin/settings/amoe-mode` desaparecio y su sitio lo
   * ocupa una solicitud de cambio, igual que los flags legalmente materiales.
   */
  readonly amoe_mode: AmoeMode | null;
  /**
   * Solicitud de cambio PENDIENTE sobre la modalidad, o `null`.
   *
   * Mismo criterio que en cada flag: con una viva no se ofrece pedir otra, para
   * que nadie acabe aprobando un cambio que ya no es el actual.
   */
  readonly amoe_mode_pending_change_request_id?: string | null;
}

/**
 * Cuerpo de `PATCH /admin/feature-flags/:key` (§13.9, modificado por HO-041).
 *
 * SOLO PARA FLAGS NO MATERIALES. Sobre un flag legalmente material la API
 * responde **409 `FLAG_LEGALLY_MATERIAL`** con `details.use` apuntando a la
 * ruta correcta, y no toca nada. Que la capacidad de la ruta sea ESTATICA
 * -`flag.update`, siempre- es justo el punto: una ruta cuya capacidad dependiera
 * del cuerpo no se puede auditar mirando la tabla de rutas.
 */
export interface AdminFeatureFlagPatch extends AdminReasonInput {
  readonly enabled: boolean;
}

/**
 * Solicitud de cambio de un ajuste legalmente material
 * (HO-041, resolucion fase 1).
 *
 * ES EL MISMO PATRON QUE LOS AJUSTES DE PARTICIPACIONES, y por el mismo motivo:
 * encender `amoe_enabled` o apagar `entry_caps_enabled` cambia lo que la
 * plataforma afirma o aplica sobre las condiciones de participacion. DEC-032
 * pide segunda aprobacion para eso, y la respuesta correcta no era rebajar la
 * capacidad de la ruta sino construir el control dual.
 *
 * QUIEN PIDE NO PUEDE APROBAR. Lo garantizan el servicio Y una `CHECK` de la
 * tabla; la interfaz solo deshabilita el boton y lo explica. Si se llamara
 * igualmente, la respuesta es 409 `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` y se
 * pinta tal cual.
 */
export type AdminSettingKind = "FEATURE_FLAG" | "AMOE_MODE";

export type AdminSettingChangeStatus = "PENDING_APPROVAL" | "APPLIED" | "REJECTED";

export interface AdminSettingChangeRequest {
  readonly id: string;
  readonly setting_kind: AdminSettingKind;
  /** Clave del flag, o `amoe_mode`. */
  readonly setting_key: string;
  /**
   * Valor solicitado, TAL COMO LO GUARDA LA TABLA
   * (`{ enabled }` o `{ amoe_mode }`).
   *
   * Se declara opaco a proposito: su forma depende de `setting_kind`, y tiparlo
   * como union obligaria a estrechar en cada pantalla para pintar una linea. La
   * interfaz lee las dos claves que conoce y, si no reconoce ninguna, dice que
   * el valor no esta publicado en vez de pintar `[object Object]`.
   */
  readonly requested_value?: Readonly<Record<string, unknown>> | null;
  readonly status: AdminSettingChangeStatus;
  readonly reason_code?: string | null;
  readonly reason_text?: string | null;
  readonly requested_by_admin_user_id?: string | null;
  readonly requested_at?: string | null;
  readonly decided_by_admin_user_id?: string | null;
  readonly decided_at?: string | null;
  readonly decision_notes?: string | null;
  /**
   * `true` cuando la solicitud la hizo QUIEN MIRA LA PANTALLA (HO-041).
   *
   * Booleano y no el identificador de quien solicito: el panel solo necesita
   * saber si puede aprobar ESTA fila, y repartir identificadores de cuentas
   * administrativas por un listado es regalar el mapa del equipo.
   *
   * NO ES EL CONTROL. Lo aplican el servicio y una `CHECK` de la tabla, que
   * responden 409 `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN`; esto solo evita
   * mandar a alguien a firmar una decision que ya se sabe que va a rebotar.
   */
  readonly requested_by_me: boolean;
}

export interface AdminSettingChangeRequestPage {
  readonly items: readonly AdminSettingChangeRequest[];
  readonly next_cursor: string | null;
}

/**
 * Cuerpo de `POST /admin/settings/change-requests`.
 *
 * `enabled` para un flag, `amoe_mode` para la modalidad. Solo uno de los dos, y
 * la API responde 422 si el valor no encaja con `setting_kind`: no se manda el
 * par entero "por si acaso", porque una solicitud que llevara los dos no diria
 * que se esta pidiendo.
 */
export interface AdminSettingChangeRequestInput extends AdminReasonInput {
  readonly setting_kind: AdminSettingKind;
  readonly setting_key: string;
  readonly enabled?: boolean;
  readonly amoe_mode?: AmoeMode | null;
}

/** Cuerpo de aprobar o rechazar una solicitud. Motivo obligatorio y step-up. */
export interface AdminSettingChangeDecisionInput extends AdminReasonInput {
  readonly decision_notes?: string | null;
}

/**
 * Transcripcion de una ficha postal (§13.10, DEC-054 punto 4).
 *
 * `payload` ES OPACO A PROPOSITO, igual que en el envio del participante: su
 * forma la fija `required_fields` de la modalidad, que decide el abogado del
 * cliente. El formulario pinta EXACTAMENTE los campos declarados y manda
 * exactamente esos.
 *
 * `cards_in_envelope` mayor que `mail_in.max_cards_per_envelope` NO se rechaza
 * aqui ni alli: el envio entra MARCADO y va a revision. Que pasa con la tercera
 * ficha de un sobre es una pregunta abierta para el abogado
 * (`docs/LEGAL_PENDING.md`), y el sistema no la responde por su cuenta.
 */
export interface AdminAmoeTranscriptionInput {
  readonly promotion_id: string;
  readonly participant_email: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly envelope_reference?: string;
  readonly cards_in_envelope?: number;
}

export interface AdminAmoeTranscriptionResponse {
  readonly submission_id: string;
  readonly status: string;
  readonly participant_id: string;
  /** `true` cuando la ficha creo el participante (sin credenciales). */
  readonly participant_created: boolean;
}
