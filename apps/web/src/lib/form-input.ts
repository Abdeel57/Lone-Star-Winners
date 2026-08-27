import { isLocale, type Locale } from "@/i18n/locales";

/**
 * Lectura de campos de formulario en una Server Action.
 *
 * TODO LO QUE LLEGA DE UN FORMULARIO ES ENTRADA DE USUARIO, aunque lo haya
 * puesto nuestra propia pagina: un `<input type="hidden">` se edita con las
 * herramientas del navegador en cinco segundos. Por eso aqui no se confia en
 * ningun campo, ni siquiera en el locale.
 *
 * ESTA VALIDACION NO ES AUTORITATIVA. Comprueba que el formulario esta completo
 * y que los tipos son los que dice el contrato; el backend REVALIDA todo y es
 * quien decide. Que aqui pase no significa que sea valido, y por eso ninguna de
 * estas funciones contiene una regla de negocio ni una constante legal: no hay
 * longitudes minimas de contrasena -esa politica es de `packages/security`-, ni
 * edades, ni formatos de codigo postal, ni listas de estados.
 */

/**
 * Locale del formulario, validado.
 *
 * Viene en un campo oculto porque una Server Action no tiene acceso al segmento
 * de ruta. Se valida en vez de confiar, y un valor invalido devuelve `null`
 * para que quien llame decida -en vez de caer en un idioma por defecto y sacar
 * a alguien de su idioma sin decirselo.
 */
export function localeFrom(formData: FormData): Locale | null {
  const raw = formData.get("locale");
  if (typeof raw !== "string") return null;
  return isLocale(raw) ? raw : null;
}

/** Texto no vacio, con los espacios de los extremos recortados. */
export function textFrom(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Contrasena, SIN recortar.
 *
 * Un espacio al principio o al final de una contrasena es un caracter como
 * cualquier otro. Recortarlo cambiaria en silencio lo que alguien tecleo, y el
 * dia que se registrara con espacio y no pudiera entrar sin el, el fallo seria
 * imposible de explicar.
 */
export function secretFrom(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}

/** Casilla marcada. */
export function checkboxFrom(formData: FormData, field: string): boolean {
  return formData.get(field) !== null;
}

/**
 * Ruta interna de retorno, validada.
 *
 * ES UNA VALIDACION DE SEGURIDAD, no una comodidad. Un `?next=` que se acepte
 * sin comprobar convierte cualquier pantalla de inicio de sesion en un
 * redirector abierto: se enlaza desde un correo, la victima ve el dominio
 * correcto, inicia sesion, y acaba en otro sitio.
 *
 * Se acepta unicamente una ruta absoluta del propio sitio:
 *
 * - tiene que empezar por `/` ......... descarta `https://otro.example`;
 * - no puede empezar por `//` ......... `//otro.example` es una URL con
 *   protocolo relativo, y el navegador la trata como externa;
 * - no puede contener `\` ............. algunos navegadores lo normalizan a `/`,
 *   asi que `/\otro.example` acaba siendo `//otro.example`;
 * - no puede contener `:` antes del primer `/` interno, que descarta
 *   `javascript:` y demas esquemas.
 *
 * La ruta va SIN prefijo de idioma: se lo pone `redirect` de
 * `@/i18n/navigation`, que es el unico que sabe cual es (DEC-021).
 */
export function returnPathFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;

  const firstSegmentEnd = value.indexOf("/", 1);
  const firstSegment = firstSegmentEnd === -1 ? value.slice(1) : value.slice(1, firstSegmentEnd);
  if (firstSegment.includes(":")) return null;

  return value;
}
