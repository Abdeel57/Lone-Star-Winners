#!/usr/bin/env node
/**
 * Recorta el logo de marca para fondo oscuro (DEC-038).
 *
 * POR QUE EXISTE ESTE SCRIPT
 * --------------------------
 * El original que entrego el cliente (`brand/logo.jpeg`) es un JPEG con FONDO
 * BLANCO. Colocado tal cual sobre el negro del sitio, aparece como un rectangulo
 * blanco alrededor del logo. Hace falta un recorte con transparencia, y hacerlo
 * a mano en un editor deja un binario en el repositorio que nadie sabe
 * reproducir. Esto lo reproduce.
 *
 * QUE PRODUCE
 * -----------
 *   public/brand/lsw-mark.png   estrella coronada, fondo transparente
 *   src/app/icon.png            la misma marca sobre placa negra (favicon)
 *
 * QUE NO PRODUCE, Y POR QUE
 * -------------------------
 * El logotipo COMPLETO no se exporta. En el original, "LSW" y "LONE STAR" son
 * NEGROS con filete dorado: sobre el negro del sitio, "LONE STAR" desaparece.
 * Recolorearlo seria alterar el logo, asi que el bloque tipografico se compone
 * con la tipografia de marca (ver `src/components/brand-lockup.tsx`), que ademas
 * escala sin halos a cualquier tamano. La estrella coronada -la parte que no es
 * tipografia- si viene del fichero original.
 *
 * COMO SE QUITA EL BLANCO
 * -----------------------
 * NO con un chroma-key global: el aro de la corona tiene un brillo casi blanco
 * en el interior de la figura, y un umbral global lo agujerearia. Se hace un
 * relleno por inundacion desde los bordes, que solo alcanza el fondo, y despues
 * dos pasadas de erosion del halo que deja la compresion JPEG en el contorno.
 *
 * USO
 * ---
 *   node scripts/build-brand-assets.mjs
 *
 * `sharp` no es dependencia declarada de esta app: llega al arbol a traves de
 * Next. El script lo localiza y, si no esta, lo dice y no hace nada. Los PNG
 * resultantes se versionan, de modo que ni el build ni CI ejecutan esto.
 */

/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename, security/detect-non-literal-require --
 * Herramienta de construccion, no codigo servido. Los indices que aqui se
 * calculan son coordenadas de pixel derivadas de las dimensiones de la propia
 * imagen -nunca de entrada de usuario- sobre buffers tipados de tamano fijo, y
 * las rutas salen de la estructura del repositorio. Se desactiva en bloque, con
 * este motivo, en vez de repetir seis directivas dentro de los bucles. */

import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONOREPO_ROOT = join(APP_DIR, "..", "..");

const SOURCE = join(APP_DIR, "brand", "logo.jpeg");
const OUT_MARK = join(APP_DIR, "public", "brand", "lsw-mark.png");
const OUT_ICON = join(APP_DIR, "src", "app", "icon.png");

/**
 * Region del original que ocupa la estrella coronada.
 *
 * El lienzo tiene tres bloques separados por franjas de blanco puro: la
 * estrella (arriba), "LSW" y el texto. La franja vacia esta hacia el 64% de la
 * altura; se corta ahi y despues se recorta al contenido real, asi que el valor
 * no tiene que ser exacto, solo caer dentro de la franja.
 */
const MARK_BOTTOM_FRACTION = 0.645;

/** Un pixel cuenta como fondo si es casi blanco y casi neutro. */
const BACKGROUND_LUMA = 232;
const BACKGROUND_SATURATION = 22;

/** Umbral, mas estricto, para comerse el halo JPEG del contorno. */
const HALO_LUMA = 226;
const HALO_SATURATION = 30;
const HALO_PASSES = 2;

/**
 * Lado del PNG de la marca.
 *
 * 512 es el doble del mayor tamano al que se usa (76px en el pie), asi que
 * cubre pantallas de alta densidad con margen. Mas grande solo anadiria peso al
 * repositorio: `next/image` sirve la escala que cada hueco necesita.
 */
const MARK_SIZE = 512;

/** Lado del favicon y ancho de su filete dorado, en pixeles del propio icono. */
const ICON_SIZE = 512;
const ICON_PADDING = 44;
const ICON_PLATE = "#0a0a0b";
const ICON_BORDER = "#c9a227";

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Localiza `sharp`.
 *
 * Primero por resolucion normal; si falla, en el almacen de pnpm del monorepo,
 * donde vive como dependencia transitiva de Next. Devuelve `null` si no esta:
 * el script informa y termina sin error, porque los PNG ya versionados siguen
 * siendo validos.
 */
function loadSharp() {
  try {
    return require("sharp");
  } catch {
    // Se busca en el almacen.
  }

  const store = join(MONOREPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(store)) return null;

  const candidates = readdirSync(store).filter((entry) => entry.startsWith("sharp@"));

  for (const candidate of candidates) {
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

/** `true` si el pixel es indistinguible del fondo blanco del original. */
function isBackground(r, g, b, luma, saturation) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return min >= luma && max - min <= saturation;
}

/**
 * Vacia el fondo por inundacion desde los cuatro bordes.
 *
 * Muta `data` (RGBA). Solo toca lo que este CONECTADO con el borde, que es la
 * unica definicion de "fondo" que no confunde un brillo interior con un hueco.
 */
function floodFillBackground(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index] === 1) return;

    const offset = index * 4;
    if (
      !isBackground(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        BACKGROUND_LUMA,
        BACKGROUND_SATURATION,
      )
    ) {
      return;
    }

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;

    data[index * 4 + 3] = 0;

    const x = index % width;
    const y = (index - x) / width;

    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

/**
 * Se come el halo blanco del contorno.
 *
 * Un pixel opaco, casi blanco y neutro, que toca un pixel ya transparente, es
 * borde comprimido y no dibujo: pasa a transparente. Dos pasadas bastan para el
 * halo que deja un JPEG de esta resolucion; mas empezaria a comerse el filete
 * dorado.
 */
function erodeHalo(data, width, height) {
  for (let pass = 0; pass < HALO_PASSES; pass++) {
    const doomed = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const offset = index * 4;
        if (data[offset + 3] === 0) continue;
        if (
          !isBackground(
            data[offset],
            data[offset + 1],
            data[offset + 2],
            HALO_LUMA,
            HALO_SATURATION,
          )
        ) {
          continue;
        }

        const touchesVoid =
          (x > 0 && data[(index - 1) * 4 + 3] === 0) ||
          (x < width - 1 && data[(index + 1) * 4 + 3] === 0) ||
          (y > 0 && data[(index - width) * 4 + 3] === 0) ||
          (y < height - 1 && data[(index + width) * 4 + 3] === 0);

        if (touchesVoid) doomed.push(offset);
      }
    }

    if (doomed.length === 0) return;
    for (const offset of doomed) data[offset + 3] = 0;
  }
}

/** Caja que contiene todo lo que quedo opaco. `null` si no quedo nada. */
function opaqueBounds(data, width, height) {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  if (right < 0 || bottom < 0) return null;
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function main() {
  const sharp = loadSharp();

  if (sharp === null) {
    log("[brand] sharp no esta disponible en este arbol.");
    log("[brand] los PNG versionados en public/brand y src/app siguen siendo validos.");
    log(
      "[brand] para regenerarlos: pnpm --filter @lsw/web add -D sharp && node scripts/build-brand-assets.mjs",
    );
    return;
  }

  if (!existsSync(SOURCE)) {
    throw new Error(`No se encuentra el logo original en ${SOURCE}`);
  }

  const source = sharp(SOURCE);
  const meta = await source.metadata();
  const sourceHeight = meta.height ?? 0;
  const sourceWidth = meta.width ?? 0;

  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new Error("El logo original no declara dimensiones.");
  }

  const cropHeight = Math.round(sourceHeight * MARK_BOTTOM_FRACTION);

  const { data, info } = await source
    .extract({ left: 0, top: 0, width: sourceWidth, height: cropHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);

  floodFillBackground(pixels, info.width, info.height);
  erodeHalo(pixels, info.width, info.height);

  const bounds = opaqueBounds(pixels, info.width, info.height);
  if (bounds === null) throw new Error("El recorte dejo la imagen vacia: revisa los umbrales.");

  log(
    `[brand] marca recortada a ${String(bounds.width)}x${String(bounds.height)} ` +
      `(origen ${String(sourceWidth)}x${String(sourceHeight)})`,
  );

  const keyed = sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).extract(bounds);

  await mkdir(dirname(OUT_MARK), { recursive: true });
  await keyed
    .clone()
    .resize({
      width: MARK_SIZE,
      height: MARK_SIZE,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toFile(OUT_MARK);

  log(`[brand] escrito ${OUT_MARK}`);

  // Favicon: la misma marca sobre placa negra con filete dorado. Sin placa, la
  // estrella (negra) se pierde en una pestana de tema oscuro.
  const inner = ICON_SIZE - ICON_PADDING * 2;
  const markForIcon = await keyed
    .clone()
    .resize({
      width: inner,
      height: inner,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(ICON_SIZE)}" height="${String(ICON_SIZE)}">` +
      `<rect x="8" y="8" width="${String(ICON_SIZE - 16)}" height="${String(ICON_SIZE - 16)}" rx="96" ` +
      `fill="${ICON_PLATE}" stroke="${ICON_BORDER}" stroke-width="12"/>` +
      `</svg>`,
  );

  await mkdir(dirname(OUT_ICON), { recursive: true });
  await sharp(plate)
    .composite([{ input: markForIcon, left: ICON_PADDING, top: ICON_PADDING }])
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toFile(OUT_ICON);

  log(`[brand] escrito ${OUT_ICON}`);
}

main().catch((error) => {
  log(`[brand] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
