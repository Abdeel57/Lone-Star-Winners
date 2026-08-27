"use server";

import { headers } from "next/headers";
/*
 * UNICA EXCEPCION DE TODA LA APLICACION A DEC-021, y esta razonada.
 *
 * El `redirect` de `@/i18n/navigation` antepone el prefijo de idioma, que es lo
 * correcto para toda ruta interna y lo que la regla de ESLint protege. Aqui el
 * destino es una URL ABSOLUTA DE OTRO DOMINIO -la del proveedor de pago- y ese
 * prefijo la convertiria en una ruta rota de nuestro sitio.
 *
 * La vuelta si conserva el idioma: `returnUrlFor` compone la URL de retorno con
 * `getPathname`, que si sabe de prefijos.
 */
// eslint-disable-next-line no-restricted-imports -- redireccion a un dominio externo; ver arriba
import { redirect as externalRedirect } from "next/navigation";

import { getPathname } from "@/i18n/navigation";
import { createCheckoutSession, type PostalAddress } from "@/lib/api";

import { fromFailure, invalid, type ActionResult } from "./action-result";
import { localeFrom, textFrom } from "./form-input";
import { mutableSession } from "./session-server";

/**
 * Apertura del pago.
 *
 * EL PROVEEDOR DE PAGO ES UN ADAPTADOR, NO UNA DEPENDENCIA
 * --------------------------------------------------------
 * En este archivo no aparece el nombre de ningun proveedor real, y no puede
 * aparecer: la eleccion es un DEC pendiente del usuario. El backend responde
 * COMO se cobra -`hosted_redirect` o `embedded_component`- y la interfaz sabe
 * recorrer la primera y decirlo cuando le manden la segunda.
 *
 * EL NAVEGADOR NO VE UNA TARJETA EN NINGUN MOMENTO
 * ------------------------------------------------
 * En `hosted_redirect` los datos de pago se teclean en el dominio del
 * proveedor. Aqui no se recoge, no se transporta y no se registra ni un digito.
 *
 * AQUI NO SE CALCULA NADA
 * -----------------------
 * El cuerpo que se manda NO lleva lineas, ni importes, ni participaciones:
 * lleva la direccion de envio y la URL de retorno. Que se cobra sale del
 * carrito que el backend ya tiene (DEC-023). Si el cliente aportara los items,
 * aportaria tambien los precios.
 */

/**
 * Direccion de envio tal como llega del formulario.
 *
 * SIN NINGUNA REGLA DE JURISDICCION. No hay lista de estados elegibles, ni
 * formato de codigo postal, ni pais por defecto: la elegibilidad territorial la
 * fijan las Official Rules y sigue en `docs/LEGAL_PENDING.md`. Lo unico que se
 * comprueba es que los campos que el formulario marca como obligatorios no
 * lleguen vacios, y el backend valida lo demas (CLAUDE.md #2 y #14).
 */
function addressFrom(formData: FormData): PostalAddress | { readonly missing: string } {
  const required = ["full_name", "line1", "city", "region", "postal_code", "country"] as const;

  for (const field of required) {
    if (textFrom(formData, field) === null) return { missing: field };
  }

  return {
    full_name: textFrom(formData, "full_name") ?? "",
    line1: textFrom(formData, "line1") ?? "",
    line2: textFrom(formData, "line2"),
    city: textFrom(formData, "city") ?? "",
    region: textFrom(formData, "region") ?? "",
    postal_code: textFrom(formData, "postal_code") ?? "",
    country: textFrom(formData, "country") ?? "",
  };
}

/**
 * URL absoluta a la que el proveedor devuelve el navegador.
 *
 * Se compone con las cabeceras de LA PETICION EN CURSO y no con una variable de
 * entorno: el sitio se sirve en varios origenes -desarrollo, preproduccion,
 * produccion- y una constante mandaria a alguien de vuelta al sitio equivocado.
 *
 * El prefijo de idioma lo pone `getPathname` de `@/i18n/navigation` (DEC-021).
 * Componerlo a mano aqui es exactamente como se pierde el idioma en el unico
 * salto de la sesion que sale del sitio y vuelve.
 */
async function returnUrlFor(locale: Parameters<typeof getPathname>[0]["locale"]): Promise<string> {
  const requestHeaders = await headers();

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");

  const path = getPathname({ href: "/checkout/return", locale });

  return `${protocol}://${host}${path}`;
}

/**
 * Lee una cadena de `client_config`.
 *
 * `client_config` es opaco a proposito -cada proveedor necesita cosas
 * distintas- asi que lo que salga de ahi se comprueba en tiempo de ejecucion.
 * El tipo dice `unknown` y aqui se verifica de verdad.
 */
function stringFrom(config: Record<string, unknown>, key: string): string | null {
  // `key` sale de una constante literal de este archivo, nunca de la respuesta
  // ni de ninguna entrada de usuario: no hay superficie de inyeccion.
  // eslint-disable-next-line security/detect-object-injection
  const value = config[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Comprueba que un destino de redireccion es una URL absoluta http(s).
 *
 * La URL la manda nuestro propio backend, pero se comprueba igual: un
 * `javascript:` en un `redirect` es una ejecucion de codigo, y el coste de la
 * comprobacion son cuatro lineas.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function startCheckoutAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const locale = localeFrom(formData);
  if (locale === null) return invalid("VALIDATION_FAILED");

  const address = addressFrom(formData);
  if ("missing" in address) return invalid("FIELD_REQUIRED", address.missing);

  const session = await mutableSession();
  const result = await createCheckoutSession(
    { shipping_address: address, return_url: await returnUrlFor(locale) },
    locale,
    session,
  );

  if (!result.ok) return fromFailure(result.error);

  const { mode, client_config: config } = result.data;

  if (mode === "hosted_redirect") {
    const target = stringFrom(config, "redirect_url");

    // En positivo (HO-027): que hace falta para redirigir, no que casos lo
    // impiden. Un `--fix` que colapse esto en un `?.` cambiaria el sentido sin
    // que se note al leerlo.
    const usable = target !== null && isHttpUrl(target);

    if (!usable) {
      // El backend dijo "redirige" y no dijo a donde. Es un defecto suyo, y hay
      // que poder verlo: mejor un mensaje con referencia que una pantalla en
      // blanco donde alguien espera pagar.
      return invalid("PAYMENT_PROVIDER_UNAVAILABLE");
    }

    /*
     * `redirect` de `next/navigation` y NO el de `@/i18n/navigation`. Es la
     * unica excepcion de toda la aplicacion a DEC-021, y esta justificada: el
     * destino es una URL ABSOLUTA de otro dominio -el del proveedor de pago- y
     * el `redirect` con idioma le pondria delante un prefijo `/es`, que
     * convertiria la URL del proveedor en una ruta rota de nuestro sitio.
     *
     * La vuelta si conserva el idioma: `returnUrlFor` compone la URL de retorno
     * con `getPathname`, que si sabe de prefijos.
     */
    externalRedirect(target);
  }

  /*
   * `embedded_component`: PUNTO DE EXTENSION DOCUMENTADO.
   *
   * La rama existe, y lo que hace es decirlo. Implementarla exige un proveedor
   * concreto -su script, su componente, su ciclo de vida- y el proveedor no
   * esta elegido. Montar aqui un formulario de tarjeta propio seria la
   * alternativa peor: pondria datos de pago dentro de nuestro dominio, que es
   * justo lo que las dos modalidades del adaptador evitan.
   *
   * Cuando haya proveedor, este `return` se sustituye por el montaje de su
   * componente y NO cambia nada mas de este archivo ni de la pantalla.
   */
  return invalid("CHECKOUT_MODE_UNSUPPORTED");
}
