import { cookies } from "next/headers";

import type { SessionContext } from "./api";

/**
 * Puente entre la sesion del navegador y la capa de API.
 *
 * POR QUE HACE FALTA
 * ------------------
 * Las rutas del carrito son `PARTICIPANT_SELF`: el backend identifica la sesion
 * por cookie. Pero quien llama a `apps/api` es el SERVIDOR de Next, no el
 * navegador (DEC-004: son dos procesos). En esa llamada la cookie del
 * participante no viaja sola; hay que reenviarla explicitamente, y hay que
 * devolver al navegador la que el backend emita.
 *
 * Sin la primera mitad, cada peticion pareceria una sesion nueva y el carrito
 * estaria siempre vacio. Sin la segunda, un carrito anonimo recien creado se
 * perderia en el siguiente render y el participante veria vaciarse el suyo
 * solo.
 *
 * LO QUE NO ESTA DECIDIDO
 * -----------------------
 * `docs/API_CONTRACT.md` dice "sesion (participante o anonima con cookie de
 * carrito)" y NO publica el nombre de la cookie, su duracion, ni sus atributos
 * (`SameSite`, `Secure`, `HttpOnly`). Tampoco esta el diseno de sesion, que
 * DEC-006 asigna a `packages/security`.
 *
 * Mientras eso no exista, aqui NO se inventa un nombre de cookie: se reenvia
 * la cabecera `Cookie` COMPLETA hacia la API y se propaga tal cual lo que la
 * API devuelva. El frontend no decide como se llama la sesion de nadie.
 */

/**
 * Contexto de sesion de SOLO LECTURA, para renderizar.
 *
 * No acepta `Set-Cookie`: Next prohibe escribir cookies durante el render de un
 * Server Component, y saltarse esa regla produce un error en tiempo de
 * ejecucion. Si el backend quiere crear un carrito, lo hara en la mutacion.
 */
export async function readSession(): Promise<SessionContext> {
  const store = await cookies();
  const header = store.toString();

  return { cookie: header.length === 0 ? null : header };
}

/**
 * Contexto de sesion para una Server Action, que SI puede escribir cookies.
 *
 * Se usa solo desde acciones (`"use server"`), que es el unico sitio donde Next
 * permite mutar el almacen de cookies.
 */
export async function mutableSession(): Promise<SessionContext> {
  const store = await cookies();
  const header = store.toString();

  return {
    cookie: header.length === 0 ? null : header,
    onSetCookie: (values) => {
      for (const value of values) {
        const parsed = parseSetCookie(value);
        if (parsed === null) continue;
        store.set(parsed.name, parsed.value, parsed.options);
      }
    },
  };
}

interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly options: {
    path?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "lax" | "strict" | "none";
  };
}

/**
 * Convierte una cabecera `Set-Cookie` en algo que el almacen de Next acepta.
 *
 * Deliberadamente PARCIAL y conservador. Solo se reconocen los atributos que
 * afectan a que la cookie llegue de vuelta y a que este protegida:
 *
 * - `Path`, `Max-Age`: alcance y duracion.
 * - `HttpOnly`, `Secure`, `SameSite`: proteccion. Se propagan tal como los
 *   manda el backend y NO se rellenan por defecto. Poner aqui un `SameSite` o
 *   un `Secure` que el backend no pidio seria que el frontend decidiera la
 *   politica de seguridad de la sesion, que no le corresponde (DEC-006), y
 *   ademas taparia el defecto si el backend olvidara ponerlos.
 *
 * `Expires` y `Domain` se ignoran a proposito: `Max-Age` cubre la duracion sin
 * depender del reloj del cliente, y un `Domain` reescrito por el frontend
 * podria ampliar el alcance de una cookie de sesion.
 */
function parseSetCookie(header: string): ParsedSetCookie | null {
  const segments = header.split(";");
  const first = segments[0];
  if (first === undefined) return null;

  const separator = first.indexOf("=");
  if (separator <= 0) return null;

  const name = first.slice(0, separator).trim();
  const value = first.slice(separator + 1).trim();
  if (name.length === 0) return null;

  const options: ParsedSetCookie["options"] = {};

  for (const segment of segments.slice(1)) {
    const [rawKey, ...rest] = segment.split("=");
    if (rawKey === undefined) continue;

    const key = rawKey.trim().toLowerCase();
    const attribute = rest.join("=").trim();

    switch (key) {
      case "path":
        options.path = attribute;
        break;
      case "max-age": {
        const seconds = Number.parseInt(attribute, 10);
        if (Number.isFinite(seconds)) options.maxAge = seconds;
        break;
      }
      case "httponly":
        options.httpOnly = true;
        break;
      case "secure":
        options.secure = true;
        break;
      case "samesite": {
        const mode = attribute.toLowerCase();
        if (mode === "lax" || mode === "strict" || mode === "none") options.sameSite = mode;
        break;
      }
      default:
        break;
    }
  }

  return { name, value, options };
}

/** Exportada solo para poder probar el parser sin montar una peticion de Next. */
export const __testing = { parseSetCookie };
