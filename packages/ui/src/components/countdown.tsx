"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Cuenta atras hasta un instante.
 *
 * LO QUE ESTE COMPONENTE NO ES
 * ----------------------------
 * No es una fuente de verdad. Que el contador llegue a cero NO cierra la
 * promocion ni cambia su estado: el estado lo decide el backend y llega en el
 * contrato. El reloj del navegador puede estar desajustado horas o dias, y una
 * interfaz que decidiera por su cuenta que la promocion cerro estaria dando una
 * informacion legalmente sensible a partir de un dato en el que no se puede
 * confiar (CLAUDE.md #15).
 *
 * Cuando el contador llega a cero se muestra `completedLabel` y se deja de
 * contar. Lo que ocurra despues lo dira el servidor en la siguiente carga.
 *
 * POR QUE HAY UN `nowIso` Y NO SE USA `Date.now()` EN EL PRIMER RENDER
 * --------------------------------------------------------------------
 * El servidor y el navegador renderizan en instantes distintos. Si el primer
 * render usara el reloj local, el HTML del servidor y el del cliente diferirian
 * y React lanzaria un error de hidratacion. `nowIso` es el instante de
 * referencia que pasa el servidor: con el, el primer render coincide en ambos
 * lados. A partir de ahi el componente sigue con el reloj local.
 *
 * ACCESIBILIDAD
 * -------------
 * Los digitos que cambian cada segundo son `aria-hidden`. Una region viva que
 * anuncia un numero por segundo hace inutilizable la pagina con lector de
 * pantalla. En su lugar se expone `deadlineLabel`: el plazo ABSOLUTO, ya
 * formateado por el consumidor en la zona horaria legal de la promocion
 * (DEC-011). Es ademas mas util: una fecha concreta se puede apuntar.
 */

export interface CountdownParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** `true` cuando el instante objetivo ya paso. */
  readonly isComplete: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Descompone la distancia entre dos instantes.
 *
 * Funcion pura y exportada a proposito: la aritmetica de tiempo es donde se
 * cuelan los errores de un dia, y asi se puede probar sin renderizar nada ni
 * manipular relojes.
 *
 * Si alguno de los dos instantes no es valido, devuelve `isComplete: true` con
 * todo a cero: es la direccion segura del fallo, porque no exhibe una cuenta
 * atras inventada.
 */
export function computeCountdownParts(targetIso: string, nowIso: string): CountdownParts {
  const target = new Date(targetIso).getTime();
  const now = new Date(nowIso).getTime();

  if (Number.isNaN(target) || Number.isNaN(now)) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isComplete: true };
  }

  const remaining = target - now;
  if (remaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isComplete: true };
  }

  return {
    days: Math.floor(remaining / DAY),
    hours: Math.floor((remaining % DAY) / HOUR),
    minutes: Math.floor((remaining % HOUR) / MINUTE),
    seconds: Math.floor((remaining % MINUTE) / SECOND),
    isComplete: false,
  };
}

export interface CountdownUnitLabels {
  readonly days: string;
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
}

export interface CountdownProps {
  /** Instante objetivo, ISO-8601 en UTC, tal como llega del contrato. */
  readonly targetIso: string;
  /** Instante de referencia del primer render, generado en el servidor. */
  readonly nowIso: string;
  /** Etiquetas de las unidades, ya traducidas. */
  readonly unitLabels: CountdownUnitLabels;
  /**
   * Plazo absoluto ya formateado por el consumidor en la zona horaria legal de
   * la promocion. Es lo que se expone a tecnologia de asistencia.
   */
  readonly deadlineLabel: string;
  /** Texto mostrado cuando el plazo ya paso, ya traducido. */
  readonly completedLabel: ReactNode;
  /**
   * Tratamiento visual.
   *
   * `inline` es la cuenta atras discreta que acompana a un dato. `scoreboard`
   * es la de DEC-038: cuatro casillas grandes, digitos de marcador y filete
   * dorado. Se eligio una prop y no una clase del consumidor porque la
   * diferencia no es de tamano sino de ESTRUCTURA -la rejilla de cuatro
   * columnas iguales es la que impide que el marcador se descuadre cuando los
   * dias pasan de una cifra a dos.
   */
  readonly size?: "inline" | "scoreboard";
  readonly className?: string;
}

export function Countdown({
  targetIso,
  nowIso,
  unitLabels,
  deadlineLabel,
  completedLabel,
  size = "inline",
  className,
}: CountdownProps) {
  const [parts, setParts] = useState<CountdownParts>(() =>
    computeCountdownParts(targetIso, nowIso),
  );

  useEffect(() => {
    // El primer valor ya vino del render; a partir de aqui manda el reloj local.
    const tick = () => {
      setParts(computeCountdownParts(targetIso, new Date().toISOString()));
    };

    tick();
    const id = setInterval(tick, SECOND);
    return () => {
      clearInterval(id);
    };
  }, [targetIso]);

  if (parts.isComplete) {
    return (
      <p
        className={cn(
          "text-body-md font-medium text-text-muted",
          size === "scoreboard" &&
            "rounded-lg border border-border bg-surface-raised px-s5 py-s4 text-body-lg",
          className,
        )}
      >
        <time dateTime={targetIso}>{completedLabel}</time>
      </p>
    );
  }

  const scoreboard = size === "scoreboard";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {/* El plazo absoluto es lo unico que se anuncia. */}
      <span className="sr-only">
        <time dateTime={targetIso}>{deadlineLabel}</time>
      </span>

      <ul
        aria-hidden="true"
        className={cn(
          scoreboard
            ? // Cuatro columnas IGUALES. Con `flex-wrap`, el dia numero 100
              // ensancha su casilla y descuadra el marcador entero; con una
              // rejilla fija, la cifra crece dentro de su casilla.
              "grid w-full max-w-lg grid-cols-4 gap-2 sm:gap-3"
            : "flex flex-wrap items-end gap-3",
        )}
      >
        <CountdownUnit value={parts.days} label={unitLabels.days} scoreboard={scoreboard} />
        <CountdownUnit value={parts.hours} label={unitLabels.hours} scoreboard={scoreboard} />
        <CountdownUnit value={parts.minutes} label={unitLabels.minutes} scoreboard={scoreboard} />
        <CountdownUnit value={parts.seconds} label={unitLabels.seconds} scoreboard={scoreboard} />
      </ul>
    </div>
  );
}

function CountdownUnit({
  value,
  label,
  scoreboard,
}: {
  readonly value: number;
  readonly label: string;
  readonly scoreboard: boolean;
}) {
  if (scoreboard) {
    return (
      <li className="relative flex min-w-0 flex-col items-center overflow-hidden rounded-lg border border-border bg-surface-raised px-1 py-s3 sm:py-s4">
        {/* Filete dorado superior: es lo que convierte cuatro cajas grises en
            un marcador. Se compone con utilidades del preset y no con una clase
            de la aplicacion: este paquete no puede depender de CSS que viva en
            `apps/web`, o la primitiva se veria distinta segun quien la monte. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/60 to-transparent"
        />

        {/* `tabular-nums` evita que la caja cambie de ancho cada segundo. */}
        <span className="font-display text-display-md font-bold tabular-nums text-text sm:text-display-lg">
          {String(value).padStart(2, "0")}
        </span>
        <span className="mt-1 text-overline uppercase tracking-wide text-brand">{label}</span>
      </li>
    );
  }

  return (
    <li className="flex min-w-[3.25rem] flex-col items-center rounded-md border border-border bg-surface-raised px-3 py-2">
      <span className="font-display text-heading-md font-semibold tabular-nums text-text">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-overline uppercase text-text-subtle">{label}</span>
    </li>
  );
}
