import { ADMIN_CAPABILITIES, type AdminCapability, type SessionState } from "@/lib/api";

/**
 * Capacidades efectivas del actor que mira el panel.
 *
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 * ---------------------------------------
 * Esto decide QUE SE PINTA. No decide QUE SE PUEDE HACER. Quien autoriza es el
 * backend, en cada peticion, y responde 403; la interfaz pinta ese 403 como un
 * estado deliberado. Ocultar un enlace es cortesia -no mandar a nadie a una
 * pantalla que le va a rechazar-, nunca un control de acceso.
 *
 * Si algun dia alguien escribe aqui una comprobacion de la que dependa que un
 * dato sensible NO se muestre, sera un defecto: el dato ya habria viajado en la
 * respuesta y estaria en el HTML. Lo que no se puede ver no se pide.
 *
 * DE DONDE SALEN LAS CAPACIDADES, EN ORDEN
 * ----------------------------------------
 * 1. `session.capabilities`, si el backend las publica. Es la peticion abierta
 *    (ver `SessionState` en `src/lib/api/contract.ts`) y la unica respuesta
 *    correcta: el mapa rol -> capacidad ya existe y es autoritativo en
 *    `ROLE_CAPABILITIES` de `packages/security/src/permissions.ts`.
 * 2. [PROVISIONAL] el espejo local de mas abajo, mientras el campo no exista.
 */

/**
 * [PROVISIONAL] Espejo de `ROLE_CAPABILITIES` de `packages/security`.
 *
 * ESTE BLOQUE SE BORRA en cuanto `GET /auth/session` publique `capabilities`.
 * Existe por una limitacion concreta y temporal: `apps/web` no depende de
 * `@lsw/security` -es un paquete de servidor, y anadir la dependencia en este
 * hito estaba fuera de alcance- y sin el, el panel no sabria que enlaces pintar
 * para un rol.
 *
 * DOS SALVAGUARDAS, porque una segunda copia de una politica de autorizacion es
 * exactamente lo que `CLAUDE.md` seccion 4 llama "dos fuentes de verdad":
 *
 *   - Solo se consulta cuando el backend NO publica capacidades. En cuanto las
 *    publique, este mapa deja de ejecutarse aunque siga escrito.
 *   - Solo se listan las capacidades que el PANEL usa. No es una copia
 *     completa: `session.self.*`, `system.job.run` y las de `SYSTEM` no estan,
 *     porque ninguna pantalla depende de ellas, y una copia incompleta que se
 *     sabe incompleta es menos peligrosa que una que finge estar al dia.
 *
 * Los identificadores de rol son los de `ROLE_IDS`. `PARTICIPANT` no aparece: un
 * participante no tiene ninguna capacidad de panel, y su ausencia aqui es la que
 * hace que el panel no le ensene nada.
 */
const PROVISIONAL_ROLE_CAPABILITIES = new Map<string, readonly AdminCapability[]>(
  Object.entries({
    SUPPORT: [
      "dashboard.read",
      "promotion.read",
      "product.read",
      "participant.list",
      "participant.read",
      "pii.view.masked",
      "order.read",
      "entry.ledger.read",
      "amoe.review.read",
    ],

    PROMOTION_MANAGER: [
      "dashboard.read",
      "participant.list",
      "participant.read",
      "pii.view.masked",
      "order.read",
      "order.refund.initiate",
      "entry.ledger.read",
      "entry.adjust.create",
      "amoe.review.read",
      "amoe.review.approve",
      "amoe.review.reject",
      "product.read",
      "product.write",
      "product.publish",
      "promotion.read",
      "promotion.create",
      "promotion.update",
      "promotion.activate",
      "promotion.close",
      "rules.version.read",
      "rules.version.create",
      "flag.read",
      "reconciliation.read",
    ],

    COMPLIANCE_OFFICER: [
      "dashboard.read",
      "promotion.read",
      "product.read",
      "participant.list",
      "participant.read",
      "pii.view.masked",
      "pii.view.full",
      "order.read",
      "payment.webhook.read",
      "entry.ledger.read",
      "entry.adjust.approve",
      "participant.disqualify",
      "amoe.review.read",
      "amoe.review.approve",
      "amoe.review.reject",
      "rules.version.read",
      "rules.version.create",
      "rules.version.activate",
      "flag.read",
      "flag.update.legally_material",
      "reconciliation.read",
      "audit.read",
      "audit.integrity.verify",
      "rbac.admin.read",
      "export.snapshot.read",
      "export.snapshot.create",
      "export.snapshot.validate",
      "export.finalize",
      "draw.authorization.create",
      "draw.result.read",
      "winner.workflow.read",
    ],

    DRAW_OFFICER: [
      "dashboard.read",
      "flag.read",
      "promotion.read",
      "rules.version.read",
      "export.snapshot.read",
      "draw.initiate",
      "draw.result.read",
      "winner.workflow.read",
    ],

    EXPORT_OFFICER: [
      "dashboard.read",
      "flag.read",
      "promotion.read",
      "rules.version.read",
      "reconciliation.read",
      "export.snapshot.read",
      "export.snapshot.validate",
      "export.download",
      "export.deliver",
    ],

    SECURITY_ADMIN: [
      "dashboard.read",
      "rbac.admin.read",
      "flag.read",
      "flag.update",
      "audit.read",
      "audit.integrity.verify",
    ],
  } satisfies Record<string, readonly AdminCapability[]>),
);

function isAdminCapability(value: string): value is AdminCapability {
  return (ADMIN_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Capacidades del actor de una sesion.
 *
 * Una capacidad que el backend publique y la interfaz no conozca se IGNORA: no
 * hay pantalla que pintar para ella, y dejar de compilar contra una respuesta
 * legitima seria peor que no ensenar un enlace que todavia no existe.
 */
export function capabilitiesOf(session: SessionState): ReadonlySet<AdminCapability> {
  const published = session.capabilities;

  if (published !== undefined) {
    return new Set(published.filter(isAdminCapability));
  }

  /*
   * `Map` y no un objeto indexado, y no es estilo. `role` llega de la API: un
   * valor como `constructor` o `__proto__` sobre un objeto literal devuelve
   * algo que NO es un array, y el `for...of` de abajo lanzaria. Un `Map` no
   * tiene claves heredadas y devuelve `undefined` para cualquier cosa que no se
   * haya puesto en el. Es tambien lo que hace callar a
   * `security/detect-object-injection`, que aqui tenia razon.
   */
  const derived = new Set<AdminCapability>();
  for (const role of session.roles) {
    for (const capability of PROVISIONAL_ROLE_CAPABILITIES.get(role) ?? []) {
      derived.add(capability);
    }
  }

  return derived;
}

/** Si el backend resolvio las capacidades, o si vienen del espejo provisional. */
export function capabilitiesArePublished(session: SessionState): boolean {
  return session.capabilities !== undefined;
}

/**
 * Actor del panel: quien es y que puede hacer.
 *
 * Se construye UNA vez por render y se pasa hacia abajo. Recalcularlo en cada
 * componente funcionaria igual, pero abriria la puerta a que dos partes de la
 * misma pantalla resolvieran capacidades distintas.
 */
export interface AdminActor {
  readonly email: string;
  readonly roles: readonly string[];
  readonly capabilities: ReadonlySet<AdminCapability>;
  /** `false` mientras las capacidades salgan del espejo provisional. */
  readonly capabilitiesPublished: boolean;
}

export function toAdminActor(session: SessionState): AdminActor {
  return {
    email: session.email,
    roles: session.roles,
    capabilities: capabilitiesOf(session),
    capabilitiesPublished: capabilitiesArePublished(session),
  };
}

/** Si el actor tiene una capacidad concreta. */
export function can(actor: AdminActor, capability: AdminCapability): boolean {
  return actor.capabilities.has(capability);
}

/** Si el actor tiene AL MENOS UNA de varias. Lo que decide si un enlace se pinta. */
export function canAny(actor: AdminActor, capabilities: readonly AdminCapability[]): boolean {
  return capabilities.some((capability) => actor.capabilities.has(capability));
}
