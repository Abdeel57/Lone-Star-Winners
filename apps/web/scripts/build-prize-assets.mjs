#!/usr/bin/env node
/**
 * Recorta la fotografia del premio para el hero y para las tarjetas (DEC-042).
 *
 * POR QUE EXISTE ESTE SCRIPT
 * --------------------------
 * La fotografia que entrego el cliente esta encuadrada como FICHA DE
 * CONCESIONARIO, no como portada: la camioneta ocupa el centro y la derecha,
 * y por encima del techo aparecen el rotulo del concesionario y su toldo. En
 * una ficha de venta eso es normal; en un hero a sangre es la marca de OTRA
 * empresa flotando sobre el premio.
 *
 * El encuadre no se puede arreglar con `object-position`, y no por gusto sino
 * por geometria. El hueco del hero es casi CUADRADO -en escritorio es una
 * columna del 56% del ancho por toda la altura de la pantalla; en telefono es
 * una banda de 46svh a todo el ancho- y la fotografia es apaisada (4:3). Con
 * `object-fit: cover`, un lienzo mas estrecho que la imagen recorta A LO ANCHO
 * y muestra la altura ENTERA: el eje vertical de `object-position` no tiene
 * nada que repartir y no hace nada. Es decir, el rotulo sale en todos los
 * tamanos, se ponga lo que se ponga en la hoja de estilos.
 *
 * Asi que el rotulo se va con TIJERA, aqui, una vez, y de forma reproducible.
 *
 * QUE PRODUCE
 * -----------
 *   public/prizes/gmc-2025-hero.jpg     recorte del hero, sin el rotulo
 *   public/prizes/gmc-2025-square.jpg   recorte cuadrado, para tarjetas
 *
 * QUE NO HACE, Y ES LA PARTE IMPORTANTE
 * -------------------------------------
 * No genera pixeles. No hay IA, no hay reencuadre inventado, no hay relleno de
 * bordes y no hay escalado hacia arriba: el cliente entrego una fotografia
 * REAL de su camioneta y lo unico que se hace con ella es CORTAR y volver a
 * comprimir. Si algun dia hiciera falta mas resolucion, la unica via legitima
 * es que llegue una foto mas grande (ver `public/prizes/README.md`).
 *
 * USO
 * ---
 *   node scripts/build-prize-assets.mjs
 *
 * Hay que volver a ejecutarlo CADA VEZ que se sustituye la fotografia: los dos
 * recortes se versionan como ficheros y no se derivan en tiempo de ejecucion.
 * Si no se ejecuta, la costura de `src/mocks/fixtures/prize-photo.ts` sigue
 * sirviendo la fotografia original tal cual -recortada por CSS-, que es un
 * respaldo correcto aunque conserve el encuadre del concesionario.
 *
 * `sharp` no es dependencia declarada de esta app: llega al arbol a traves de
 * Next. El script lo localiza y, si no esta, lo dice y no hace nada, igual que
 * `build-brand-assets.mjs`.
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require --
 * Herramienta de construccion, no codigo servido. Las rutas salen de la
 * estructura del repositorio y de una lista literal de nombres declarada en
 * este mismo archivo; ninguna procede de entrada de usuario. */

import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONOREPO_ROOT = join(APP_DIR, "..", "..");
const PRIZES_DIR = join(APP_DIR, "public", "prizes");

/**
 * Nombres admitidos para la fotografia de origen, por orden de preferencia.
 *
 * Es la MISMA lista que `GMC_PRIZE_PHOTO_CANDIDATES` en
 * `src/mocks/fixtures/prize-photo.ts`, y esta repetida a proposito: aquel es
 * TypeScript de la aplicacion y esto es una herramienta que corre con Node
 * suelto. Si un dia divergen, el sintoma es visible -el script recorta un
 * fichero que la aplicacion no sirve, o al reves- y ambos listados llevan esta
 * nota.
 */
const SOURCE_CANDIDATES = ["gmc-2025.jpg", "gmc-2025.jpeg", "gmc-2025.png", "gmc-2025.webp"];

const OUT_HERO = join(PRIZES_DIR, "gmc-2025-hero.jpg");
const OUT_SQUARE = join(PRIZES_DIR, "gmc-2025-square.jpg");

/**
 * ALTURA QUE SE CORTA POR ARRIBA, EN FRACCION DE LA ALTURA DEL ORIGINAL.
 *
 * MEDIDO SOBRE LA FOTOGRAFIA ENTREGADA EL 2026-08-26 (960x720). En ella:
 *
 *   - el rotulo del concesionario ocupa la franja y ∈ [0, 95] en la mitad
 *     derecha, con el borde inferior en diagonal;
 *   - la antena de aleta del techo, que es lo mas alto de la camioneta, esta
 *     en y ≈ 95.
 *
 * 78/720 = 0.108 corta por debajo del texto del rotulo y deja todavia 17px de
 * aire sobre la antena. Cortar mas bajo decapita la camioneta; cortar mas alto
 * deja el nombre del concesionario legible sobre el premio.
 *
 * SI CAMBIA LA FOTOGRAFIA HAY QUE VOLVER A MEDIR. Esta fraccion no es una
 * constante universal: describe ESTA composicion.
 */
const HERO_TOP_TRIM = 0.108;

/**
 * Ventana del recorte cuadrado, en fracciones del original.
 *
 * El lado se expresa contra la ALTURA -es la dimension corta de una foto
 * apaisada- y la posicion contra el ancho y el alto. Medido, otra vez, sobre
 * la fotografia entregada: `left` 0.156 deja fuera la camioneta negra que
 * asoma por la izquierda, `top` 0.125 deja fuera el rotulo, y un lado de
 * 0.833 de la altura encuadra el frontal completo -parrilla, faro, rueda- que
 * es lo que identifica al vehiculo en una tarjeta pequena.
 */
const SQUARE_WINDOW = { left: 0.156, top: 0.125, side: 0.833 };

/**
 * Calidad JPEG de los recortes.
 *
 * 88 con codificacion progresiva: el original ya es un JPEG comprimido, asi
 * que subir mas solo reproduce sus propios artefactos con mas bits.
 */
const JPEG = { quality: 88, progressive: true, mozjpeg: true };

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Localiza `sharp`.
 *
 * Primero por resolucion normal; si falla, en el almacen de pnpm del monorepo,
 * donde vive como dependencia transitiva de Next. Devuelve `null` si no esta:
 * el script informa y termina sin error, porque los recortes ya versionados
 * siguen siendo validos. Mismo criterio y mismo codigo que
 * `build-brand-assets.mjs`.
 */
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    // Se busca en el almacen.
  }

  const store = join(MONOREPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;

  for (const candidate of readdirSync(store).filter((entry) => entry.startsWith("sharp@"))) {
    const entry = join(store, candidate, "node_modules", "sharp");
    if (!existsSync(entry)) continue;
    try {
      return require(entry);
    } catch {
      // Se prueba el siguiente.
    }
  }

  return null;
}

/** Primera fotografia de origen que exista, o `null`. */
function findSource() {
  for (const name of SOURCE_CANDIDATES) {
    const candidate = join(PRIZES_DIR, name);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

async function main() {
  const sharp = loadSharp();

  if (sharp === null) {
    log("[premio] sharp no esta disponible en este arbol.");
    log("[premio] los recortes versionados en public/prizes siguen siendo validos.");
    log(
      "[premio] para regenerarlos: pnpm --filter @lsw/web add -D sharp && node scripts/build-prize-assets.mjs",
    );
    return;
  }

  const source = findSource();

  if (source === null) {
    log("[premio] no hay fotografia del premio en public/prizes.");
    log("[premio] deja una con uno de estos nombres y vuelve a ejecutar:");
    log(`[premio]   ${SOURCE_CANDIDATES.join(", ")}`);
    log("[premio] mientras tanto, la aplicacion pinta la ilustracion de estudio.");
    return;
  }

  const meta = await sharp(source).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (width === 0 || height === 0) {
    throw new Error("La fotografia de origen no declara dimensiones.");
  }

  log(`[premio] origen ${source} (${String(width)}x${String(height)})`);

  if (width < 1600) {
    // Aviso, no error: la foto del cliente es la que hay y el sitio tiene que
    // funcionar con ella. Lo que no puede pasar es que nadie sepa que el hero
    // se esta escalando por encima de su resolucion nativa.
    log(
      `[premio] AVISO: ${String(width)}px de ancho. El hero a sangre en escritorio grande la ` +
        "escala por encima de su tamano nativo; una foto de 1920px o mas mejoraria la nitidez.",
    );
  }

  await mkdir(PRIZES_DIR, { recursive: true });

  // ---------------------------------------------------------------------
  // Hero: se corta la franja superior y se conserva TODO el ancho.
  //
  // El ancho no se toca porque el recorte horizontal lo hace ya el navegador
  // con `object-fit: cover`, y hacerlo tambien aqui le quitaria margen: cuanto
  // mas ancha llega la imagen, mas puede elegir la hoja de estilos que parte
  // de la camioneta ensena en cada tamano de pantalla.
  // ---------------------------------------------------------------------
  const heroTop = Math.round(height * HERO_TOP_TRIM);
  const heroHeight = height - heroTop;

  await sharp(source)
    .extract({ left: 0, top: heroTop, width, height: heroHeight })
    .jpeg(JPEG)
    .toFile(OUT_HERO);

  log(
    `[premio] escrito ${OUT_HERO} (${String(width)}x${String(heroHeight)}, ` +
      `recortados ${String(heroTop)}px por arriba)`,
  );

  // ---------------------------------------------------------------------
  // Cuadrado: ventana centrada en el frontal del vehiculo.
  // ---------------------------------------------------------------------
  const side = Math.min(width, height, Math.round(height * SQUARE_WINDOW.side));
  const squareLeft = Math.min(Math.round(width * SQUARE_WINDOW.left), width - side);
  const squareTop = Math.min(Math.round(height * SQUARE_WINDOW.top), height - side);

  await sharp(source)
    .extract({ left: squareLeft, top: squareTop, width: side, height: side })
    .jpeg(JPEG)
    .toFile(OUT_SQUARE);

  log(
    `[premio] escrito ${OUT_SQUARE} (${String(side)}x${String(side)}, ` +
      `desde (${String(squareLeft)}, ${String(squareTop)}))`,
  );
}

main().catch((error) => {
  log(`[premio] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
