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
  /*
   * INTERRUPTORES (§13.9, DEC-054 punto 3).
   *
   * SU ROTULO NO PUEDE SER "AJUSTES", que es como nacio: la entrada de al lado
   * -`/adjustments`- se llama asi en espanol, y el menu quedaba con dos
   * "Ajustes" seguidos llevando a dos pantallas que no tienen nada que ver. En
   * ingles el par era "Settings" y "Adjustments" y no chocaba, que es por lo
   * que el problema solo se ve mirando el menu en espanol. Ver
   * `admin.nav.flags`.
   *
   * Basta `flag.read` para VERLA: quien puede leer el estado de los flags puede
   * entrar. Cambiar algo exige otra capacidad -y los legalmente materiales,
   * ademas, segunda aprobacion-, y eso lo decide cada bloque dentro de la
   * pantalla. Exigir aqui la de escritura dejaria sin poder consultar el estado
   * a quien solo tiene lectura, que es la mitad de los motivos para entrar.
   */
  { key: "flags", path: "/flags", capabilities: ["flag.read"] },
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
