/**
 * Direccion de arte del catalogo de desarrollo (DEC-038, DEC-039).
 *
 * POR QUE EXISTE
 * --------------
 * `image_url` e `images` son campos del contrato, y con ambos vacios el
 * catalogo entero se ve como una rejilla de huecos con el texto "sin imagen".
 * Eso no prueba nada util: el caso sin imagen ya lo cubre
 * `productWithoutImages`, y el resto del tiempo lo que hay que poder mirar es
 * la maquetacion con imagen.
 *
 * QUE SON, EXACTAMENTE
 * --------------------
 * Composiciones SVG generadas aqui mismo y embebidas como `data:` URI: fondo de
 * estudio, la silueta en grafito con filete dorado, sombra de contacto y
 * reflejo. NO son fotografias ni pretenden parecerlo -no hay tejido, ni
 * costuras, ni etiquetas- pero tampoco son huecos: son arte dirigido, coherente
 * con la identidad, del mismo modo que el pie de pagina de desarrollo avisa de
 * que ningun dato de la pantalla es real.
 *
 * DEC-038 preve fotografia generada cuando haya creditos en el proveedor. Esto
 * es lo que hay hasta entonces, y esta escrito para que la sustitucion sea de
 * una linea: cuando lleguen las fotos, cada constante exportada pasa a ser una
 * ruta y NINGUN componente cambia, porque ninguno sabe de donde sale su imagen.
 * Ese es el motivo de que todas vivan en un unico modulo.
 *
 * ---------------------------------------------------------------------------
 * EL ESTUDIO ES CLARO (DEC-039)
 * ---------------------------------------------------------------------------
 * Hasta DEC-039 estas composiciones eran de estudio OSCURO, porque el sitio
 * entero era oscuro. DEC-039 lleva las secciones de mercancia a banda clara, y
 * una pieza sobre fondo casi negro dentro de una tarjeta blanca se ve como un
 * agujero negro recortado, no como un producto.
 *
 * HAY UN SOLO ESTUDIO, Y ES CLARO. La tentacion era mantener las dos versiones
 * y elegir segun la superficie, y esta descartada por una razon que no es
 * estetica: el contrato publica UN `image_url` por producto. Un catalogo real
 * tiene una foto por articulo, no una por color de fondo. Mantener dos aqui
 * haria que el mismo articulo se viera distinto en la tienda y en el carrito, y
 * ese es justo el tipo de ficcion que revienta el dia que llegan las fotos de
 * verdad.
 *
 * Consecuencia: las superficies oscuras que muestran mercancia -hoy solo la
 * miniatura del carrito- llevan el marco claro (`.lsw-studio-light`) alrededor
 * de la imagen. Un recorte de producto sobre blanco dentro de una tarjeta
 * oscura es lo normal en comercio electronico, y ademas destaca.
 *
 * POR QUE `data:` Y NO FICHEROS EN `public/`
 * ------------------------------------------
 * Un binario en el repositorio sobrevive a la fase de desarrollo y acaba
 * desplegado; una cadena dentro de un fixture se borra con el fixture. Y no
 * sale ni una peticion a un host externo, que es requisito del encargo.
 */

/**
 * Paleta del estudio.
 *
 * Los oros son los del sistema (`--lsw-color-brand` y sus vecinos) escritos en
 * hexadecimal porque un SVG embebido como `data:` URI no ve las custom
 * properties del documento: se carga como documento independiente.
 */
const STUDIO = {
  /** Centro del fondo: blanco. */
  backdropNear: "#ffffff",
  /** Esquinas del fondo: gris calido, el mismo family que `light-surface-sunken`. */
  backdropFar: "#eae4d9",
  /** Oro del filete. */
  goldMid: "#c9a227",
  goldLight: "#f0d98a",
  goldDeep: "#8a6f1c",
  /**
   * Grafito del cuerpo de la pieza.
   *
   * Sobre blanco el cuerpo tiene que ser OSCURO -es lo que hace de silueta- pero
   * no negro puro: un negro plano sobre blanco se lee como un recorte de papel.
   * El degradado de grafito a casi negro es lo que le da volumen.
   */
  bodyTop: "#4b4b57",
  bodyBottom: "#16161c",
  /** Tinta de las sombras. Es `--lsw-color-light-text`. */
  ink: "#0d0c0a",
} as const;

/**
 * Fondo del lienzo, en unidades del viewBox. El reflejo se desvanece desde la
 * linea de apoyo de cada pieza hasta aqui.
 */
const CANVAS = 800;

interface Composition {
  /**
   * Silueta principal: se rellena con el grafito y se perfila en oro. Debe ser
   * un camino cerrado o un rectangulo.
   */
  readonly body: string;
  /** Detalles de trazo fino (costuras, aperturas). Opcional. */
  readonly detail?: string;
  /**
   * Desplazamiento horizontal del charco de luz, en unidades del lienzo. Que no
   * este siempre centrado es lo que impide que las cinco imagenes parezcan la
   * misma foto con otra silueta.
   */
  readonly lightX: number;
  /**
   * Coordenada del borde inferior de la silueta: es la linea de apoyo, el eje
   * del reflejo y el centro de la sombra. Se declara por pieza y no se deduce
   * -no hay forma de medir un camino SVG sin renderizarlo- porque un eje
   * comun dejaria el reflejo despegado de las piezas mas cortas, que es
   * exactamente el detalle que delata una composicion falsa.
   */
  readonly baseY: number;
}

/**
 * Compone el `data:` URI.
 *
 * `encodeURIComponent` y no base64: el SVG queda legible en las herramientas de
 * desarrollo, pesa menos, y no hay que descodificar nada para ver que es una
 * ilustracion y no una foto.
 *
 * Los identificadores de los degradados se repiten entre imagenes a proposito:
 * cada `data:` URI es un DOCUMENTO independiente cuando se carga desde `<img>`,
 * asi que no pueden colisionar entre si.
 */
function studioSvg({ body, detail, lightX, baseY }: Composition): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="presentation">`,

    `<defs>`,
    // Fondo de estudio: blanco en el centro, gris calido en las esquinas. Es la
    // caida de luminosidad lo que convierte un rectangulo plano en una
    // superficie sobre la que algo esta apoyado.
    `<radialGradient id="bg" cx="0.5" cy="0.42" r="0.78">`,
    `<stop offset="0" stop-color="${STUDIO.backdropNear}"/>`,
    `<stop offset="1" stop-color="${STUDIO.backdropFar}"/>`,
    `</radialGradient>`,
    // Charco de luz calida detras de la pieza. Muy tenue: sobre blanco, el mismo
    // charco que funcionaba sobre negro deja una mancha amarilla.
    `<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${STUDIO.goldLight}" stop-opacity="0.2"/>`,
    `<stop offset="0.45" stop-color="${STUDIO.goldMid}" stop-opacity="0.09"/>`,
    `<stop offset="1" stop-color="${STUDIO.goldMid}" stop-opacity="0"/>`,
    `</radialGradient>`,
    // Cuerpo de la pieza: grafito con luz cenital.
    `<linearGradient id="body" x1="0.15" y1="0" x2="0.6" y2="1">`,
    `<stop offset="0" stop-color="${STUDIO.bodyTop}"/>`,
    `<stop offset="1" stop-color="${STUDIO.bodyBottom}"/>`,
    `</linearGradient>`,
    // Filete: oro que gira de claro a profundo, como un bisel.
    `<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${STUDIO.goldLight}"/>`,
    `<stop offset="0.45" stop-color="${STUDIO.goldMid}"/>`,
    `<stop offset="1" stop-color="${STUDIO.goldDeep}"/>`,
    `</linearGradient>`,
    // Sombra de apoyo.
    `<radialGradient id="floor" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${STUDIO.ink}" stop-opacity="0.3"/>`,
    `<stop offset="1" stop-color="${STUDIO.ink}" stop-opacity="0"/>`,
    `</radialGradient>`,
    // Sombra ambiental: el mismo contorno, desenfocado, por debajo de la pieza.
    // Sobre negro esta capa era un halo DORADO -la pieza emitia luz-; sobre
    // blanco eso no existe, y lo que hace falta es lo contrario: la penumbra
    // que cualquier objeto proyecta sobre la superficie que tiene detras.
    `<filter id="halo" x="-25%" y="-25%" width="150%" height="150%">`,
    `<feGaussianBlur stdDeviation="16"/>`,
    `</filter>`,
    // Desvanecido del reflejo: opaco junto al suelo, nulo al llegar abajo.
    `<linearGradient id="fadeGradient" x1="0" y1="${String(baseY)}" x2="0" y2="${String(CANVAS)}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/>`,
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>`,
    `</linearGradient>`,
    `<mask id="fade"><rect width="800" height="800" fill="url(#fadeGradient)"/></mask>`,
    `</defs>`,

    `<rect width="800" height="800" fill="url(#bg)"/>`,
    `<ellipse cx="${String(lightX)}" cy="380" rx="300" ry="300" fill="url(#pool)"/>`,

    // Reflejo en el suelo del estudio: la misma silueta, volteada sobre la
    // linea de apoyo y desvanecida. Es el recurso que separa una ilustracion
    // plana de una pieza fotografiada sobre una superficie. Sobre blanco va mas
    // discreto que sobre negro: aqui el reflejo compite con el fondo, no se
    // funde en el.
    `<g mask="url(#fade)">`,
    `<g transform="translate(0 ${String(baseY * 2)}) scale(1 -1)" opacity="0.16">`,
    `<g fill="url(#body)" stroke="url(#edge)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">${body}</g>`,
    `</g>`,
    `</g>`,

    `<ellipse cx="400" cy="${String(baseY)}" rx="215" ry="30" fill="url(#floor)"/>`,

    `<g filter="url(#halo)" fill="none" stroke="${STUDIO.ink}" stroke-opacity="0.1" stroke-width="14" stroke-linejoin="round" stroke-linecap="round">`,
    body,
    `</g>`,

    `<g fill="url(#body)" stroke="url(#edge)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">`,
    body,
    `</g>`,

    detail === undefined
      ? ``
      : `<g fill="none" stroke="${STUDIO.goldMid}" stroke-opacity="0.5" stroke-width="4" stroke-linecap="round">${detail}</g>`,

    `</svg>`,
  ].join("");

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TEE: Composition = {
  body: `<path d="M290 230 L215 285 L265 360 L305 330 L305 590 L495 590 L495 330 L535 360 L585 285 L510 230 L455 230 A55 45 0 0 1 345 230 Z"/>`,
  detail: `<path d="M345 232 A55 45 0 0 0 455 232"/>`,
  lightX: 400,
  baseY: 590,
};

const HOODIE: Composition = {
  body: `<path d="M290 240 L210 295 L262 372 L302 342 L302 600 L498 600 L498 342 L538 372 L590 295 L510 240 A110 90 0 0 0 290 240 Z"/>`,
  detail: `<path d="M400 250 L400 330"/><path d="M340 480 L460 480"/>`,
  lightX: 356,
  baseY: 600,
};

const MUG: Composition = {
  body: `<rect x="255" y="262" width="250" height="300" rx="24"/>`,
  detail: `<path d="M505 322 h52 a68 68 0 0 1 0 136 h-52" stroke-width="22" stroke-opacity="0.85"/><path d="M272 306 h216"/>`,
  lightX: 430,
  baseY: 562,
};

const CAP: Composition = {
  // La copa va achatada (rx 170 / ry 132) y no como media circunferencia: una
  // semicircunferencia perfecta se lee como bombin, no como gorra.
  body: `<path d="M230 470 a170 132 0 0 1 340 0 Z"/><path d="M570 470 h95 a26 26 0 0 1 0 52 H230 a26 26 0 0 1 0 -52 h340 Z"/>`,
  detail: `<path d="M400 344 v126"/>`,
  lightX: 400,
  baseY: 522,
};

const THROW: Composition = {
  body: `<rect x="215" y="255" width="370" height="290" rx="20"/>`,
  detail: `<path d="M215 352 h370"/><path d="M215 452 h370"/><path d="M332 255 v290"/><path d="M468 255 v290"/>`,
  lightX: 340,
  baseY: 545,
};

/** Camiseta. */
export const teeImage = studioSvg(TEE);

/** Sudadera. */
export const hoodieImage = studioSvg(HOODIE);

/** Taza. */
export const mugImage = studioSvg(MUG);

/** Gorra. */
export const capImage = studioSvg(CAP);

/** Manta. */
export const throwImage = studioSvg(THROW);

/**
 * Segunda vista de la camiseta.
 *
 * La ficha de producto admite galeria, y con una sola imagen no se ve nunca la
 * navegacion entre vistas. Es la misma silueta con la luz desplazada y sin el
 * detalle del cuello: basta para que la galeria tenga dos elementos
 * distinguibles sin parecer un error de duplicado.
 */
export const teeImageAlt = studioSvg({ body: TEE.body, lightX: 520, baseY: TEE.baseY });
