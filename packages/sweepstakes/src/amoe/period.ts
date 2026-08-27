/**
 * Cubos de periodo en la ZONA LEGAL de la promocion (DEC-011).
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO ES `date.toISOString().slice(0, 10)`
 * ---------------------------------------------------------------------------
 *
 * Porque eso cuenta dias en UTC. Si las Official Rules dicen "un envio por
 * persona y dia" y la promocion declara `America/Chicago`, un envio a las 19:30
 * hora local del lunes es ya martes en UTC. Con el corte en UTC, ese
 * participante puede enviar dos veces en el mismo dia legal -a las 19:30 y a
 * las 20:00- y ninguno de los dos cuenta como duplicado. El limite se salta sin
 * que nadie haga nada raro, todos los dias, a partir de las 18:00 o las 19:00
 * segun la epoca del ano.
 *
 * `Intl.DateTimeFormat` con `timeZone` resuelve tambien el horario de verano,
 * que es la otra mitad del problema y la que no se puede arreglar con un
 * desplazamiento fijo guardado en una columna.
 *
 * ---------------------------------------------------------------------------
 * EL CUBO ES UNA CADENA, NO UN INTERVALO
 * ---------------------------------------------------------------------------
 *
 * `2026-08-26`, `2026-W35`, `2026-08` o `PROMOTION`. Se compara por igualdad,
 * que es una operacion sin bordes ambiguos, en vez de por pertenencia a un
 * intervalo, que obliga a decidir en cada comparacion si los extremos son
 * abiertos o cerrados. Y se puede indexar y agrupar tal cual en SQL cuando el
 * adaptador real lo persista.
 */

import type { AmoeLimitPeriod } from "./config.js";

interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Descompone un instante en fecha local de una zona IANA.
 *
 * `formatToParts` en vez de `format` porque el orden y los separadores de
 * `format` dependen del locale, y aqui hace falta un dato, no un texto.
 */
function localDateParts(instant: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === "year") {
      year = Number.parseInt(part.value, 10);
    } else if (part.type === "month") {
      month = Number.parseInt(part.value, 10);
    } else if (part.type === "day") {
      day = Number.parseInt(part.value, 10);
    }
  }

  if (year === 0 || month === 0 || day === 0) {
    throw new RangeError(`No se pudo resolver la fecha local en la zona ${timeZone}.`);
  }
  return { year, month, day };
}

function pad2(value: number): string {
  return value.toString(10).padStart(2, "0");
}

/**
 * Numero de semana ISO-8601 de una fecha local.
 *
 * ISO y no "semanas desde el 1 de enero" porque ISO tiene una definicion
 * publica y verificable -la semana empieza el lunes y la semana 1 es la que
 * contiene el primer jueves del ano-, y un tercero que audite el limite tiene
 * que poder reproducir el mismo cubo sin leer este archivo.
 *
 * Se opera sobre `Date.UTC` de la fecha LOCAL ya resuelta: a esas alturas no
 * queda ninguna zona horaria en juego, solo aritmetica de calendario.
 */
function isoWeek(parts: LocalDateParts): { readonly year: number; readonly week: number } {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  // Domingo es 0 en JavaScript y 7 en ISO.
  const dayOfWeek = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  // Al jueves de la misma semana: el ano del jueves ES el ano ISO de la semana.
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek);
  const isoYear = utc.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDayOfWeek);
  const week =
    1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return { year: isoYear, week };
}

/**
 * Cubo al que pertenece un instante, en la zona legal de la promocion.
 *
 * `PROMOTION` devuelve una constante: el limite es sobre toda la promocion, asi
 * que todos los envios caen en el mismo cubo.
 */
export function periodBucket(instant: Date, timeZone: string, period: AmoeLimitPeriod): string {
  if (period === "PROMOTION") {
    return "PROMOTION";
  }

  const parts = localDateParts(instant, timeZone);

  switch (period) {
    case "DAY":
      return `${parts.year.toString(10)}-${pad2(parts.month)}-${pad2(parts.day)}`;
    case "MONTH":
      return `${parts.year.toString(10)}-${pad2(parts.month)}`;
    case "WEEK": {
      const { year, week } = isoWeek(parts);
      return `${year.toString(10)}-W${pad2(week)}`;
    }
    default: {
      const exhaustive: never = period;
      throw new RangeError(`Periodo desconocido: ${String(exhaustive)}`);
    }
  }
}
