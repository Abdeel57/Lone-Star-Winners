/**
 * El principal ESTRECHADO al participante.
 *
 * `RequestPrincipal` es una union: un participante autenticado o una sesion
 * anonima con carrito. Casi todos los handlers del portal necesitan la primera
 * rama, y necesitan `participantId`.
 *
 * Escribir `principal.participantId` sobre la union no compila, y la solucion
 * comoda -un `as` en cada handler- convertiria una comprobacion real en una
 * afirmacion. Este alias existe para que la comprobacion se escriba UNA vez, en
 * el `requireParticipant` de cada modulo, y el compilador se encargue del resto.
 */

import type { RequestPrincipal } from "./principal.js";

export type ParticipantPrincipal = Extract<RequestPrincipal, { kind: "PARTICIPANT" }>;
