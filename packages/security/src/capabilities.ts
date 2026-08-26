/**
 * Catalogo de capacidades (permisos) de Lone Star Winners.
 *
 * Una capacidad es la unidad minima de autorizacion. El identificador sigue el
 * patron `dominio.recurso.accion` y es ESTABLE: se persiste en la matriz de
 * roles, aparece en `docs/API_CONTRACT.md` (DEC-015) y queda escrito en cada
 * `AuditEvent`. Renombrar una capacidad es un cambio de contrato.
 *
 * Deny-by-default (DEC-015): una ruta sin capacidad declarada no arranca. Este
 * catalogo es el vocabulario; el registro de rutas vive en `apps/api` y
 * pertenece a `backend`.
 *
 * Los metadatos no son decorativos. `requiresStepUp` implementa DEC-006,
 * `requiresSecondApproval` implementa la separacion de funciones de DEC-017, y
 * `emitsAuditEvent` marca lo que un tercero debe poder reconstruir despues.
 */

import { type FeatureFlagKey } from "./flags.js";

export const CAPABILITY_DOMAINS = [
  "session",
  "participant",
  "pii",
  "order",
  "product",
  "payment",
  "entry",
  "amoe",
  "promotion",
  "rules",
  "flag",
  "export",
  "draw",
  "winner",
  "audit",
  "rbac",
  "reconciliation",
  "dashboard",
  "tpa",
  "system",
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

/**
 * `ROUTINE`  - operacion ordinaria.
 * `SENSITIVE`- toca dinero, PII o configuracion; se audita siempre.
 * `CRITICAL` - influye en quien gana o en la evidencia que ve un tercero.
 */
export type Sensitivity = "ROUTINE" | "SENSITIVE" | "CRITICAL";

export interface CapabilityDefinition {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly sensitivity: Sensitivity;
  /** DEC-006: re-autenticacion con MFA reciente (<= 5 min) antes de ejecutar. */
  readonly requiresStepUp: boolean;
  /** Motivo obligatorio, que se guarda en el `AuditEvent`. */
  readonly requiresReason: boolean;
  /** Segunda aprobacion de un actor DISTINTO dentro de un TTL. */
  readonly requiresSecondApproval: boolean;
  /** Emite `AuditEvent`. Toda capacidad no rutinaria debe emitirlo. */
  readonly emitsAuditEvent: boolean;
  /** Accede a datos personales identificables. */
  readonly touchesPii: boolean;
  /**
   * Feature flag persistido (DEC-013) que ademas condiciona la capacidad, o
   * `null` si no depende de ninguno.
   *
   * DEC-032 cerro `HO-003` y fijo el vocabulario, asi que el flag ya se puede
   * NOMBRAR. Antes esto era un booleano suelto, y un booleano no le dice a
   * `apps/api` QUE flag consultar: el identificador habria acabado escrito a
   * mano en cada handler, que es justo el hardcoding que prohibe el principio
   * #14. `authorize()` sigue exigiendo que alguien lo haya consultado; lo que
   * cambia es que ahora se sabe cual.
   */
  readonly featureFlagKey: FeatureFlagKey | null;
  /**
   * Derivado de `featureFlagKey`, nunca independiente. Se conserva porque es la
   * columna que siembra `packages/database`, y porque dos campos que pueden
   * contradecirse acaban contradiciendose.
   */
  readonly dependsOnFeatureFlag: boolean;
  /** Entrada de `docs/LEGAL_PENDING.md` de la que depende, si aplica. */
  readonly legalDependency: string | null;
  readonly notes: string;
}

interface CapabilityOptions {
  readonly requiresStepUp?: boolean;
  readonly requiresReason?: boolean;
  readonly requiresSecondApproval?: boolean;
  readonly emitsAuditEvent?: boolean;
  readonly touchesPii?: boolean;
  readonly featureFlag?: FeatureFlagKey;
  readonly legalDependency?: string;
}

function define(
  id: string,
  domain: CapabilityDomain,
  sensitivity: Sensitivity,
  notes: string,
  options: CapabilityOptions = {},
): CapabilityDefinition {
  return Object.freeze({
    id,
    domain,
    sensitivity,
    notes,
    requiresStepUp: options.requiresStepUp ?? false,
    requiresReason: options.requiresReason ?? false,
    requiresSecondApproval: options.requiresSecondApproval ?? false,
    // Por defecto se audita todo lo que no sea rutinario. Para dejar de
    // auditar algo hay que escribirlo explicitamente, y eso se ve en revision.
    emitsAuditEvent: options.emitsAuditEvent ?? sensitivity !== "ROUTINE",
    touchesPii: options.touchesPii ?? false,
    featureFlagKey: options.featureFlag ?? null,
    dependsOnFeatureFlag: options.featureFlag !== undefined,
    legalDependency: options.legalDependency ?? null,
  });
}

export const CAPABILITIES = Object.freeze({
  // ---------------------------------------------------------------------
  // Participante sobre si mismo. La frontera importante es el sufijo `.self`:
  // una capacidad `.self` NUNCA autoriza a leer los datos de otra persona.
  // ---------------------------------------------------------------------
  "session.self.read": define("session.self.read", "session", "ROUTINE", "Ver su propia sesion."),
  "session.self.revoke": define(
    "session.self.revoke",
    "session",
    "ROUTINE",
    "Cerrar sus propias sesiones.",
  ),
  "participant.self.read": define(
    "participant.self.read",
    "participant",
    "ROUTINE",
    "Ver su propio perfil.",
    { touchesPii: true },
  ),
  "participant.self.update": define(
    "participant.self.update",
    "participant",
    "ROUTINE",
    "Editar su propio perfil.",
    { touchesPii: true, emitsAuditEvent: true },
  ),
  "entry.self.read": define(
    "entry.self.read",
    "entry",
    "ROUTINE",
    "Ver su propio historial de entries. Nunca el de otro participante.",
  ),
  "order.self.read": define("order.self.read", "order", "ROUTINE", "Ver sus propios pedidos."),
  "amoe.self.submit": define(
    "amoe.self.submit",
    "amoe",
    "SENSITIVE",
    "Enviar una participacion sin compra. El metodo exacto lo fijan las Official Rules.",
    { featureFlag: "amoe_enabled", legalDependency: "AMOE" },
  ),

  // ---------------------------------------------------------------------
  // Personal: lectura
  // ---------------------------------------------------------------------
  "participant.list": define(
    "participant.list",
    "participant",
    "SENSITIVE",
    "Listar y buscar participantes.",
    { touchesPii: true },
  ),
  "participant.read": define(
    "participant.read",
    "participant",
    "SENSITIVE",
    "Ver la ficha de un participante.",
    { touchesPii: true },
  ),
  "pii.view.masked": define(
    "pii.view.masked",
    "pii",
    "SENSITIVE",
    "Ver datos personales enmascarados (ultimos digitos, dominio de correo).",
    { touchesPii: true },
  ),
  "pii.view.full": define(
    "pii.view.full",
    "pii",
    "CRITICAL",
    "Ver datos personales completos. Minimizacion: solo cuando la tarea concreta lo exige.",
    { requiresStepUp: true, requiresReason: true, touchesPii: true },
  ),
  "pii.export": define(
    "pii.export",
    "pii",
    "CRITICAL",
    "Extraer datos personales fuera del sistema.",
    {
      requiresStepUp: true,
      requiresReason: true,
      requiresSecondApproval: true,
      touchesPii: true,
    },
  ),
  "dashboard.read": define(
    "dashboard.read",
    "dashboard",
    "ROUTINE",
    "Entrar al panel y ver sus agregados de cabecera. No devuelve PII ni cifras del ledger: la reconciliacion vive detras de reconciliation.read.",
  ),
  "promotion.read": define(
    "promotion.read",
    "promotion",
    "ROUTINE",
    "Ver promociones desde el panel, incluidas las que estan en DRAFT. La vista publica del storefront NO usa esta capacidad: es una ruta PUBLIC que solo expone promociones ya activas.",
  ),
  "product.read": define(
    "product.read",
    "product",
    "ROUTINE",
    "Ver el catalogo desde el panel, incluidos borradores y archivados. El storefront publico tampoco usa esta capacidad.",
  ),
  "order.read": define(
    "order.read",
    "order",
    "SENSITIVE",
    "Ver pedidos de cualquier participante.",
  ),
  "entry.ledger.read": define(
    "entry.ledger.read",
    "entry",
    "SENSITIVE",
    "Leer el ledger de entries de cualquier participante.",
  ),
  "reconciliation.read": define(
    "reconciliation.read",
    "reconciliation",
    "SENSITIVE",
    "Ver el informe de reconciliacion. Las cifras las produce el backend, nunca el cliente.",
  ),
  "audit.read": define("audit.read", "audit", "SENSITIVE", "Leer la traza de auditoria."),
  "audit.integrity.verify": define(
    "audit.integrity.verify",
    "audit",
    "SENSITIVE",
    "Ejecutar la verificacion de la hash chain (DEC-008).",
  ),

  // ---------------------------------------------------------------------
  // Dinero, entries y correcciones. DEC-007: toda correccion es una fila
  // nueva con delta de signo contrario. Aqui no existe "editar" ni "borrar".
  // ---------------------------------------------------------------------
  "order.refund.initiate": define(
    "order.refund.initiate",
    "order",
    "SENSITIVE",
    "Iniciar un reembolso. Genera la reversal correspondiente en el ledger.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "payment.webhook.read": define(
    "payment.webhook.read",
    "payment",
    "SENSITIVE",
    "Inspeccionar los webhooks de pago ya persistidos y su resultado de proceso. Reprocesar sin poder leer seria operar a ciegas sobre dinero.",
  ),
  "payment.webhook.replay": define(
    "payment.webhook.replay",
    "payment",
    "SENSITIVE",
    "Reprocesar un webhook ya persistido. DEC-009: la idempotencia la garantiza la base de datos, no este permiso.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "entry.adjust.create": define(
    "entry.adjust.create",
    "entry",
    "CRITICAL",
    "Proponer un ajuste manual de entries. Nunca se aplica solo: exige aprobacion de otro actor.",
    {
      requiresStepUp: true,
      requiresReason: true,
      requiresSecondApproval: true,
      featureFlag: "manual_adjustments_enabled",
    },
  ),
  "entry.adjust.approve": define(
    "entry.adjust.approve",
    "entry",
    "CRITICAL",
    "Aprobar un ajuste manual propuesto por OTRO actor.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "entry.reversal.create": define(
    "entry.reversal.create",
    "entry",
    "CRITICAL",
    "Registrar la reversal de un refund o chargeback. Normalmente la ejecuta SYSTEM desde un webhook verificado.",
    { requiresReason: true },
  ),
  "participant.disqualify": define(
    "participant.disqualify",
    "participant",
    "CRITICAL",
    "Descalificar a un participante. DEC-007: se registra, no se borra nada.",
    { requiresStepUp: true, requiresReason: true, legalDependency: "ELIGIBILITY" },
  ),

  // ---------------------------------------------------------------------
  // Catalogo de mercancia.
  //
  // Aqui no hay ninguna capacidad sobre entries, igual que `products` no tiene
  // ninguna columna de entries: que una compra genere participaciones lo decide
  // la `PromotionRulesVersion` (DEC-012), nunca el producto.
  // ---------------------------------------------------------------------
  "product.write": define(
    "product.write",
    "product",
    "SENSITIVE",
    "Crear y editar productos, variantes y traducciones. No cambia lo que se puede comprar: eso es product.publish.",
  ),
  "product.publish": define(
    "product.publish",
    "product",
    "SENSITIVE",
    "Cambiar el estado de un producto o variante: publicar, retirar, archivar. Se separa de product.write porque es lo unico que altera la mercancia realmente adquirible durante una promocion viva.",
  ),

  // ---------------------------------------------------------------------
  // AMOE
  // ---------------------------------------------------------------------
  "amoe.review.read": define(
    "amoe.review.read",
    "amoe",
    "SENSITIVE",
    "Ver la cola de revision de participaciones AMOE.",
    { touchesPii: true },
  ),
  "amoe.review.approve": define(
    "amoe.review.approve",
    "amoe",
    "CRITICAL",
    "Aprobar una participacion AMOE y generar su entry.",
    { requiresReason: true, featureFlag: "amoe_enabled", legalDependency: "AMOE" },
  ),
  "amoe.review.reject": define(
    "amoe.review.reject",
    "amoe",
    "CRITICAL",
    "Rechazar una participacion AMOE. El motivo es obligatorio y el historico se conserva.",
    { requiresReason: true, featureFlag: "amoe_enabled", legalDependency: "AMOE" },
  ),

  // ---------------------------------------------------------------------
  // Promocion y reglas (DEC-012). Cero constantes legales en codigo.
  // ---------------------------------------------------------------------
  "promotion.create": define("promotion.create", "promotion", "SENSITIVE", "Crear una promocion."),
  "promotion.update": define(
    "promotion.update",
    "promotion",
    "SENSITIVE",
    "Editar una promocion que todavia no esta activa.",
  ),
  "promotion.activate": define(
    "promotion.activate",
    "promotion",
    "CRITICAL",
    "Activar una promocion. DEC-012: se bloquea si queda una clave legal en TBD.",
    { requiresStepUp: true, requiresReason: true, legalDependency: "OFFICIAL_RULES" },
  ),
  "promotion.close": define(
    "promotion.close",
    "promotion",
    "CRITICAL",
    "Cerrar la promocion. DEC-011: el deadline se evalua en el servidor contra la timezone legal.",
    { requiresStepUp: true, requiresReason: true, legalDependency: "OFFICIAL_RULES" },
  ),
  "rules.version.read": define(
    "rules.version.read",
    "rules",
    "SENSITIVE",
    "Leer una version de reglas, incluidas las que estan en DRAFT. Sensible porque un borrador es texto legal todavia no aprobado por el abogado del cliente, y porque un tercero debe poder reconstruir quien consulto que version antes de un corte.",
  ),
  "rules.version.create": define(
    "rules.version.create",
    "rules",
    "SENSITIVE",
    "Crear una version de reglas en DRAFT.",
  ),
  "rules.version.activate": define(
    "rules.version.activate",
    "rules",
    "CRITICAL",
    "Activar una version de reglas aprobada por el abogado del cliente.",
    { requiresStepUp: true, requiresReason: true, legalDependency: "OFFICIAL_RULES" },
  ),
  "flag.read": define("flag.read", "flag", "ROUTINE", "Leer el estado de los feature flags."),
  "flag.update": define(
    "flag.update",
    "flag",
    "SENSITIVE",
    "Cambiar un feature flag no legalmente material.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "flag.update.legally_material": define(
    "flag.update.legally_material",
    "flag",
    "CRITICAL",
    "Cambiar un flag legalmente material (AMOE, numeros visibles, publicacion de ganador, sorteo interno).",
    {
      requiresStepUp: true,
      requiresReason: true,
      requiresSecondApproval: true,
      legalDependency: "OFFICIAL_RULES",
    },
  ),

  // ---------------------------------------------------------------------
  // Export al third-party administrator (DEC-016).
  // Quien declara el snapshot correcto y quien se lo lleva son personas
  // distintas: si fueran la misma, "lo revise yo mismo" seria toda la
  // evidencia disponible.
  // ---------------------------------------------------------------------
  "export.snapshot.read": define(
    "export.snapshot.read",
    "export",
    "SENSITIVE",
    "Listar snapshots y leer su manifiesto: estado, corte, version de reglas, recuentos y hash. No descarga el contenido, que es export.download. Sin ella, DRAW_OFFICER no podria ni siquiera saber sobre que snapshot va a sortear.",
  ),
  "export.snapshot.create": define(
    "export.snapshot.create",
    "export",
    "SENSITIVE",
    "Generar un snapshot en DRAFT. Funcion pura del corte y de la version de reglas.",
  ),
  "export.snapshot.validate": define(
    "export.snapshot.validate",
    "export",
    "SENSITIVE",
    "Ejecutar la reconciliacion previa a finalizar. Los errores criticos bloquean.",
  ),
  "export.finalize": define(
    "export.finalize",
    "export",
    "CRITICAL",
    "Finalizar el snapshot: a partir de aqui es inmutable y su hash es evidencia.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "export.download": define(
    "export.download",
    "export",
    "CRITICAL",
    "Descargar un export finalizado. Cada acceso deja AuditEvent.",
    { requiresStepUp: true, requiresReason: true, touchesPii: true },
  ),
  "export.deliver": define(
    "export.deliver",
    "export",
    "CRITICAL",
    "Entregar el export al administrador externo por el canal configurado.",
    { requiresStepUp: true, requiresReason: true, touchesPii: true },
  ),
  "tpa.config.read": define(
    "tpa.config.read",
    "tpa",
    "SENSITIVE",
    "Leer la configuracion del administrador externo: destino, esquema y version. NUNCA devuelve credenciales; los secretos viven fuera del repositorio y no se exponen por API.",
  ),
  "tpa.config.update": define(
    "tpa.config.update",
    "tpa",
    "CRITICAL",
    "Configurar el adaptador del third-party administrator (destino, credenciales, esquema).",
    { requiresStepUp: true, requiresReason: true, legalDependency: "TPA" },
  ),

  // ---------------------------------------------------------------------
  // Sorteo interno (DEC-017). Existir no es lo mismo que estar autorizado:
  // estas capacidades no bastan por si solas. Hacen falta los cinco cerrojos.
  // ---------------------------------------------------------------------
  "draw.authorization.create": define(
    "draw.authorization.create",
    "draw",
    "CRITICAL",
    "Registrar una DrawAuthorization con referencia al documento de aprobacion. Sin ella el sorteo devuelve 403 aunque el flag este activo.",
    {
      requiresStepUp: true,
      requiresReason: true,
      featureFlag: "internal_draw_enabled",
      legalDependency: "INTERNAL_DRAW",
    },
  ),
  "draw.initiate": define(
    "draw.initiate",
    "draw",
    "CRITICAL",
    "Iniciar un sorteo sobre un snapshot FINALIZED cuyo hash se recalcula en el momento.",
    {
      requiresStepUp: true,
      requiresReason: true,
      requiresSecondApproval: true,
      featureFlag: "internal_draw_enabled",
      legalDependency: "INTERNAL_DRAW",
    },
  ),
  "draw.result.read": define(
    "draw.result.read",
    "draw",
    "SENSITIVE",
    "Consultar el registro inmutable de un sorteo.",
  ),

  // ---------------------------------------------------------------------
  // Ganador potencial. Seleccionado no es ganador: es candidato pendiente de
  // verificacion.
  // ---------------------------------------------------------------------
  "winner.workflow.read": define(
    "winner.workflow.read",
    "winner",
    "SENSITIVE",
    "Ver el expediente de un ganador potencial.",
    { touchesPii: true },
  ),
  "winner.status.update": define(
    "winner.status.update",
    "winner",
    "CRITICAL",
    "Avanzar el estado de verificacion. Sustituir a un seleccionado exige motivo y conserva el historico.",
    { requiresStepUp: true, requiresReason: true, legalDependency: "WINNER_VERIFICATION" },
  ),
  "winner.publish": define(
    "winner.publish",
    "winner",
    "CRITICAL",
    "Publicar un ganador confirmado. Nunca automatico.",
    {
      requiresStepUp: true,
      requiresReason: true,
      requiresSecondApproval: true,
      touchesPii: true,
      featureFlag: "winner_publication_enabled",
      legalDependency: "WINNER_PUBLICATION",
    },
  ),

  // ---------------------------------------------------------------------
  // Cuentas, roles y sistema
  // ---------------------------------------------------------------------
  "rbac.admin.read": define(
    "rbac.admin.read",
    "rbac",
    "SENSITIVE",
    "Listar cuentas de personal y sus roles vigentes. Es la evidencia con la que se le demuestra a un tercero que la separacion de funciones se cumplio de verdad, y no solo que estaba configurada.",
    { touchesPii: true },
  ),
  "rbac.admin.create": define(
    "rbac.admin.create",
    "rbac",
    "CRITICAL",
    "Crear una cuenta de personal. DEC-006: MFA obligatoria desde el primer acceso.",
    { requiresStepUp: true, requiresReason: true },
  ),
  "rbac.role.assign": define(
    "rbac.role.assign",
    "rbac",
    "CRITICAL",
    "Asignar o retirar roles. Es la via mas corta para saltarse cualquier otro control, asi que exige segunda aprobacion.",
    { requiresStepUp: true, requiresReason: true, requiresSecondApproval: true },
  ),
  "session.read.any": define(
    "session.read.any",
    "session",
    "SENSITIVE",
    "Listar las sesiones vivas de cualquier usuario. Sin ella, session.revoke.any obligaria a revocar a ciegas.",
    { touchesPii: true },
  ),
  "session.revoke.any": define(
    "session.revoke.any",
    "session",
    "SENSITIVE",
    "Revocar la sesion de cualquier usuario. DEC-006: las sesiones son opacas y revocables.",
    { requiresReason: true },
  ),
  "system.job.run": define(
    "system.job.run",
    "system",
    "SENSITIVE",
    "Ejecutar trabajos del sistema (verificador de integridad, sellado diario, reconciliacion).",
  ),
} as const);

export type CapabilityId = keyof typeof CAPABILITIES;

export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITIES) as CapabilityId[]);

export function isCapabilityId(value: string): value is CapabilityId {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value);
}

export function getCapability(id: CapabilityId): CapabilityDefinition {
  return CAPABILITIES[id];
}
