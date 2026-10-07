"use client";

import { computeCountdownParts } from "@lsw/ui";
import { useEffect, useState } from "react";

/**
 * Cuenta atras de UNA linea para la banda roja (DEC-082).
 *
 * POR QUE NO EL `Countdown` DE `@lsw/ui`
 * -------------------------------------
 * Aquel pinta cuatro casillas apiladas -cifra encima, unidad debajo- y en una
 * franja de una linea a 360px no cabe. Este usa la MISMA aritmetica
 * (`computeCountdownParts`, la funcion pura y probada) y la escribe como
 * "5d 03:12:45": se lee de un vistazo en los dos idiomas y no cambia de ancho
 * cada segundo (`tabular-nums`).
 *
 * Las reglas de aquel se mantienen:
 *
 * - **El primer render usa `nowIso` del servidor**, no el reloj local, para que
 *   el HTML del servidor y el del cliente coincidan.
 * - **Los digitos son `aria-hidden`.** Lo que se anuncia es el plazo ABSOLUTO
 *   (`deadlineLabel`) en la zona legal de la promocion: un lector de pantalla
 *   que leyera un numero por segundo haria la pagina inutilizable.
 * - **Llegar a cero no decide nada.** Se muestra `completedLabel` -tambien el
 *   plazo absoluto, que nunca miente- y lo que pase despues lo dira el servidor
 *   en la siguiente carga. El reloj del navegador puede estar desajustado.
 */
export function AnnouncementCountdown({
  targetIso,
  nowIso,
  daysUnit,
  deadlineLabel,
  completedLabel,
}: {
  readonly targetIso: string;
  readonly nowIso: string;
  /** Unidad de los dias, ya traducida ("d"). */
  readonly daysUnit: string;
  readonly deadlineLabel: string;
  readonly completedLabel: string;
}) {
  const [parts, setParts] = useState(() => computeCountdownParts(targetIso, nowIso));

  useEffect(() => {
    const tick = () => {
      setParts(computeCountdownParts(targetIso, new Date().toISOString()));
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
    };
  }, [targetIso]);

  if (parts.isComplete) {
    return <time dateTime={targetIso}>{completedLabel}</time>;
  }

  const clock = [parts.hours, parts.minutes, parts.seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");

  return (
    <>
      <span className="sr-only">
        <time dateTime={targetIso}>{deadlineLabel}</time>
      </span>
      <span
        aria-hidden="true"
        className="inline-block whitespace-nowrap rounded-sm bg-on-accent/15 px-1.5 tabular-nums"
      >
        {parts.days > 0 ? `${String(parts.days)}${daysUnit} ` : ""}
        {clock}
      </span>
    </>
  );
}
