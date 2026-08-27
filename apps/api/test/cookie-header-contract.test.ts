/**
 * LA CABECERA `Cookie` QUE REENVIA NEXT (HO-035).
 *
 * ---------------------------------------------------------------------------
 * QUE PROBLEMA FIJA ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * `apps/web` no es un navegador: es un SEGUNDO PROCESO (DEC-004) que reenvia la
 * sesion del visitante a la API. Lo hace con `cookies().toString()` de Next, y
 * eso NO produce una cabecera `Cookie` de RFC 6265, sino algo con forma de
 * `Set-Cookie`:
 *
 *   lsw_session=<token>; Path=/; lsw_dev_staff_actor=compliance%40example.com; Path=/
 *
 * Dos rarezas: pseudo-cookies `Path=/` intercaladas -atributos que solo
 * pertenecen a `Set-Cookie`- y valores percent-encoded.
 *
 * Hoy funciona porque `@fastify/cookie` tolera lo primero y decodifica lo
 * segundo. HO-035 pedia DECIDIR si eso es contrato o accidente. La decision es
 * (b): la API declara que ACEPTA esa forma, y este archivo la fija. Sin el, una
 * actualizacion de `@fastify/cookie` -o un cambio de su decodificador por
 * defecto- dejaria de encontrar la cookie y la API respondaria 401 a una
 * sesion valida, o peor, encontraria un valor a medio decodificar y atenderia a
 * la persona equivocada. Ese segundo sintoma ya ocurrio una vez, en el mock de
 * desarrollo de `apps/web`, y es indistinguible de "esa persona no tiene ese
 * permiso".
 *
 * ---------------------------------------------------------------------------
 * LO QUE **NO** DICE ESTE ARCHIVO
 * ---------------------------------------------------------------------------
 *
 * No dice que la forma de Next sea la unica admitida, ni que sea la preferida.
 * La forma NORMATIVA sigue siendo la del navegador -`name=value`, sin
 * atributos- y esta cubierta abajo con las mismas afirmaciones, para que
 * `apps/web` pueda pasarse a ella cuando quiera sin romper nada.
 *
 * Tampoco declara nada sobre cookies FIRMADAS: `app.ts` registra
 * `@fastify/cookie` sin secreto a proposito, porque el token ya es opaco y su
 * validez la decide la fila de `sessions`.
 */

import { describe, expect, it } from "vitest";
import { looksLikeSessionToken } from "@lsw/security";

import { createApp, type AppDependencies } from "../src/app.js";
import { CONTRACT_GENERATION_CONFIG } from "../src/config/contract-config.js";
import { cookieNameFor } from "../src/http/session-cookie.js";
import { createFakeRepositories } from "./support/in-memory-repositories.js";

const COOKIE_BASE = CONTRACT_GENERATION_CONFIG.session.cookieName;
const PARTICIPANT_COOKIE = cookieNameFor(COOKIE_BASE, "PARTICIPANT");
const STAFF_COOKIE = cookieNameFor(COOKIE_BASE, "STAFF");

/** Token con la forma exacta que exige `looksLikeSessionToken`: 43 caracteres. */
const PARTICIPANT_TOKEN = "p".repeat(43);
const STAFF_TOKEN = "s".repeat(43);

/**
 * Levanta la app REAL y devuelve las cookies tal como las ve un handler.
 *
 * Se captura desde el autorizador y no desde una ruta de prueba: es el punto
 * donde la API lee de verdad la cookie de sesion (`session-authorizer.ts`), asi
 * que lo que se observa aqui es exactamente lo que ese codigo va a encontrar.
 * Una ruta escrita para el test podria pasar mientras el camino real falla.
 */
async function cookiesSeenBy(header: string): Promise<Record<string, string | undefined>> {
  const dependencies = {
    config: CONTRACT_GENERATION_CONFIG,
    database: { role: "app", db: {}, pool: {}, close: () => Promise.resolve() },
    paymentProvider: { name: "none" },
    repositories: createFakeRepositories(),
  } as unknown as AppDependencies;

  const app = await createApp(dependencies);

  let captured: Record<string, string | undefined> = {};
  app.lswAuthorizer = ({ request }) => {
    captured = request.cookies;
    // Se deniega a proposito: lo que se mide es el PARSEO de la cabecera, no
    // la decision de autorizacion, y asi el caso no depende de que exista una
    // sesion en la base de datos.
    return { allowed: false, reason: "UNAUTHENTICATED" };
  };

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/cart",
    headers: { cookie: header },
  });

  // La ruta responde 401 porque el autorizador de arriba deniega. Que llegue a
  // responder confirma que la cabecera no rompio el pipeline.
  expect(response.statusCode).toBe(401);

  await app.close();
  return captured;
}

/**
 * La cabecera LITERAL que produce `cookies().toString()` de Next.
 *
 * Copiada de HO-035, con los nombres de cookie reales de la configuracion. Es
 * un literal y no algo construido con un helper a proposito: si algun dia
 * cambia la forma, este archivo tiene que fallar de manera evidente y obligar a
 * mirarla, no adaptarse solo.
 */
const NEXT_STYLE_HEADER =
  `${PARTICIPANT_COOKIE}=${PARTICIPANT_TOKEN}; Path=/; ` +
  `${STAFF_COOKIE}=${STAFF_TOKEN}; Path=/; ` +
  `lsw_dev_staff_actor=compliance%40example.com; Path=/`;

/** La misma informacion en la forma que manda un navegador (RFC 6265). */
const BROWSER_STYLE_HEADER =
  `${PARTICIPANT_COOKIE}=${PARTICIPANT_TOKEN}; ` +
  `${STAFF_COOKIE}=${STAFF_TOKEN}; ` +
  `lsw_dev_staff_actor=compliance%40example.com`;

describe("la API acepta la cabecera `Cookie` que reenvia Next (HO-035, decision b)", () => {
  it("encuentra las dos cookies de sesion entre las pseudo-cookies `Path=/`", async () => {
    const cookies = await cookiesSeenBy(NEXT_STYLE_HEADER);

    expect(cookies[PARTICIPANT_COOKIE]).toBe(PARTICIPANT_TOKEN);
    expect(cookies[STAFF_COOKIE]).toBe(STAFF_TOKEN);
  });

  it("el token sobrevive INTACTO al parseo, que es lo que `looksLikeSessionToken` exige", async () => {
    const cookies = await cookiesSeenBy(NEXT_STYLE_HEADER);

    // Sin esta comprobacion, un parser que devolviera el valor con un espacio
    // delante o a medio decodificar pasaria los casos anteriores y aun asi
    // haria que `presentedToken` no reconociera la sesion, con un 401 sobre una
    // sesion perfectamente valida.
    expect(looksLikeSessionToken(cookies[PARTICIPANT_COOKIE] ?? "")).toBe(true);
    expect(looksLikeSessionToken(cookies[STAFF_COOKIE] ?? "")).toBe(true);
  });

  it("decodifica los valores percent-encoded", async () => {
    const cookies = await cookiesSeenBy(NEXT_STYLE_HEADER);

    // El fallo que HO-035 describe: sin decodificar, el valor es
    // `compliance%40example.com`, no se encuentra a esa persona y se cae a un
    // actor de respaldo EN SILENCIO.
    expect(cookies.lsw_dev_staff_actor).toBe("compliance@example.com");
  });

  it("las pseudo-cookies quedan como una cookie mas, sin desplazar a ninguna real", async () => {
    const cookies = await cookiesSeenBy(NEXT_STYLE_HEADER);

    // `Path` se parsea como una cookie llamada `Path`. Es inerte -ningun nombre
    // de sesion puede llamarse asi- y lo que importa es lo que se afirma
    // despues: no pisa ni desplaza a las de verdad.
    expect(cookies.Path).toBe("/");
    expect(cookies[PARTICIPANT_COOKIE]).toBe(PARTICIPANT_TOKEN);
    expect(cookies[STAFF_COOKIE]).toBe(STAFF_TOKEN);
  });

  it("un valor con `;` codificado NO puede inyectar una cookie extra", async () => {
    // La otra mitad de la decision: la tolerancia de la API es segura mientras
    // el cliente CODIFIQUE. Si `apps/web` reenviara valores sin codificar, un
    // valor de cookie con `;` partiria la cabecera y anadiria cookies que nadie
    // envio. Aqui se comprueba que, codificado, eso no ocurre.
    const cookies = await cookiesSeenBy(
      `${PARTICIPANT_COOKIE}=${PARTICIPANT_TOKEN}; Path=/; ` +
        `benign=a%3B%20${STAFF_COOKIE}%3D${STAFF_TOKEN}; Path=/`,
    );

    expect(cookies.benign).toBe(`a; ${STAFF_COOKIE}=${STAFF_TOKEN}`);
    expect(cookies[STAFF_COOKIE]).toBeUndefined();
  });
});

describe("la forma NORMATIVA -la del navegador- sigue siendo equivalente", () => {
  it("produce exactamente las mismas cookies de sesion", async () => {
    const cookies = await cookiesSeenBy(BROWSER_STYLE_HEADER);

    expect(cookies[PARTICIPANT_COOKIE]).toBe(PARTICIPANT_TOKEN);
    expect(cookies[STAFF_COOKIE]).toBe(STAFF_TOKEN);
    expect(cookies.lsw_dev_staff_actor).toBe("compliance@example.com");
    // Y sin pseudo-cookies, porque el navegador no las manda.
    expect(cookies.Path).toBeUndefined();
  });

  it("una cabecera vacia no inventa ninguna cookie", async () => {
    const cookies = await cookiesSeenBy("");

    expect(cookies[PARTICIPANT_COOKIE]).toBeUndefined();
    expect(cookies[STAFF_COOKIE]).toBeUndefined();
  });
});
