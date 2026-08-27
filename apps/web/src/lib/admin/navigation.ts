import type { AdminCapability } from "@/lib/api";

import { canAny, type AdminActor } from "./capabilities";

/**
 * Navegacion del panel, DECLARADA POR CAPACIDAD.
 *
 * No hay ninguna lista de "secciones de administrador" ni ningun `if
 * (esAdmin)`. Cada entrada declara que capacidades bastan para que tenga
 * sentido pintarla, y quien no las tiene sencillamente no la ve. Es la misma
 * regla que aplica `packages/security`: deny-by-default, sin comodines y sin un
 * rol que pueda todo.
 *
 * OCULTAR NO ES AUTORIZAR. Quien escriba la URL a mano llega igual, y la
 * pantalla le respondera con el 403 que devuelva el backend, pintado como
 * estado deliberado. Esta lista existe para no mandar a nadie a una puerta
 * cerrada, no para cerrarla.
 *
 * `capabilities` es "al menos una", no "todas". Ajustes lo necesita: quien
 * PROPONE (`entry.adjust.create`) y quien APRUEBA (`entry.adjust.approve`) son
 * personas distintas a proposito, y las dos tienen que poder entrar a la misma
 * pantalla para hacer cosas distintas dentro de ella.
 */
export interface AdminNavItem {
  /** Clave de copy bajo `admin.nav`. */
  readonly key: string;
  /** Ruta INTERNA del panel, sin `/admin` ni prefijo de idioma. */
  readonly path: string;
  readonly capabilities: readonly AdminCapability[];
}

export const ADMIN_NAV = [
  { key: "dashboard", path: "", capabilities: ["dashboard.read"] },
  { key: "promotions", path: "/promotions", capabilities: ["promotion.read"] },
  { key: "catalog", path: "/catalog", capabilities: ["product.read"] },
  { key: "orders", path: "/orders", capabilities: ["order.read"] },
  { key: "participants", path: "/participants", capabilities: ["participant.list"] },
  { key: "amoe", path: "/amoe", capabilities: ["amoe.review.read"] },
  {
    key: "adjustments",
    path: "/adjustments",
    capabilities: ["entry.adjust.create", "entry.adjust.approve"],
  },
  { key: "exports", path: "/exports", capabilities: ["export.snapshot.read"] },
  {
    key: "draw",
    path: "/draw",
    capabilities: ["draw.result.read", "draw.authorization.create", "draw.initiate"],
  },
  { key: "audit", path: "/audit", capabilities: ["audit.read"] },
] as const satisfies readonly AdminNavItem[];

export type AdminNavKey = (typeof ADMIN_NAV)[number]["key"];

/** Entradas que este actor puede ver. */
export function visibleNavFor(actor: AdminActor): readonly (typeof ADMIN_NAV)[number][] {
  return ADMIN_NAV.filter((item) => canAny(actor, item.capabilities));
}
