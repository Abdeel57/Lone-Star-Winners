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
 * Los colores de MARCA -los oros, la tinta, el fondo- son tokens del sistema
 * escritos en hexadecimal, porque un SVG embebido como `data:` URI no ve las
 * custom properties del documento: se carga como documento independiente. El
 * hexadecimal es legitimo aqui; lo que no lo es -y era el hallazgo M4/F9 de la
 * revision- es que el hexadecimal DEJE de coincidir con el token que dice
 * representar. Cada constante lleva escrito el suyo.
 *
 * El grafito del cuerpo es la excepcion declarada: es color de ILUSTRACION, no
 * corresponde a ningun token y no debe corresponder a ninguno.
 */
const STUDIO = {
  /** Centro del fondo: blanco. `--lsw-color-light-surface`. */
  backdropNear: "#ffffff",
  /** Esquinas del fondo: gris calido. `--lsw-color-light-surface-sunken`. */
  backdropFar: "#f2eee6",
  /** Oro del filete. `--lsw-color-brand`. */
  goldMid: "#c9a227",
  /** `--lsw-color-focus`, el mas claro de los oros del sistema. */
  goldLight: "#f2d680",
  /** `--lsw-color-light-gold`, el oro de tinta. */
  goldDeep: "#7a6116",
  /**
   * Grafito del cuerpo de la pieza. Color de ilustracion, no token.
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

/* ===========================================================================
 * EL PREMIO (DEC-042)
 * ===========================================================================
 *
 * Todo lo de arriba es MERCANCIA: piezas pequenas, sobre estudio claro, porque
 * viven dentro de tarjetas blancas. Lo de aqui abajo es otra cosa y por eso no
 * reutiliza `studioSvg`: es EL PREMIO, va a sangre dentro del hero -que es
 * negro- y tiene que aguantar 1600 pixeles de ancho detras de un titular.
 *
 * Un estudio claro ahi seria un rectangulo blanco a media pagina; el hero
 * necesita lo contrario, un plato oscuro con una sola fuente de luz calida
 * detras del sujeto, que es como se fotografia un vehiculo.
 *
 * QUE ES Y QUE NO ES
 * ------------------
 * Es una ILUSTRACION de estudio, no una fotografia y no un modelo concreto:
 * silueta de pickup de doble cabina en grafito, con biseles dorados, faro
 * encendido, sombra de contacto y reflejo en el suelo. No lleva marca, ni
 * emblema, ni parrilla reconocible, y no debe llevarlos: cual es el premio lo
 * dice el dato (`PromotionPrize`) y lo aprueban las Official Rules, no este
 * dibujo.
 *
 * ES EL RESPALDO, NO EL DESTINO. En cuanto exista una fotografia real del
 * premio, el fixture la sirve y esto deja de verse: ver `prize-photo.ts` y
 * `apps/web/public/prizes/README.md`. Ningun componente cambia, porque ninguno
 * sabe de donde sale su imagen.
 *
 * DOS RECORTES, NO UNO ESCALADO
 * -----------------------------
 * `PromotionMedia` publica `hero_url` y `square_url` porque el mismo encuadre
 * no sirve para las dos cosas. Aqui se generan los dos con la MISMA geometria
 * de vehiculo y distinto lienzo: cambia el aire alrededor del sujeto, no el
 * sujeto. Recortar uno del otro en el navegador es lo que deja el vehiculo a
 * medias dentro de la tarjeta.
 */

/**
 * Paleta del plato oscuro.
 *
 * Mismo criterio que `STUDIO`: cada literal declara el token que representa, y
 * los colores de ilustracion -grafito, cristal, neumatico- se declaran como lo
 * que son, colores que no corresponden a ningun token y no deben corresponder.
 */
const PRIZE_STUDIO = {
  /** Centro del fondo. Un escalon por encima de `--lsw-color-surface-raised`. */
  backdropNear: "#1b1b22",
  /** Esquinas del fondo. `--lsw-color-surface-sunken`. */
  backdropFar: "#040405",
  /** Oro del filete. `--lsw-color-brand`. */
  goldMid: "#c9a227",
  /** `--lsw-color-focus`, el mas claro de los oros del sistema. */
  goldLight: "#f2d680",
  /** `--lsw-color-brand-active`. */
  goldWarm: "#f0d98a",
  /** Carroceria: grafito con luz cenital. Color de ilustracion. */
  bodyTop: "#5b5b68",
  bodyBottom: "#101016",
  /** Cristales. Mas frios que la carroceria, que es lo que los delata. */
  glassTop: "#39414f",
  glassBottom: "#12151c",
  /** Neumatico. Casi negro y no negro: el negro puro se come el contorno. */
  tyre: "#0b0b0e",
  /** Negro de sombras y vineta. `--lsw-color-overlay`. */
  ink: "#000000",
} as const;

/**
 * Geometria del vehiculo, en un lienzo propio de 1000 x 380.
 *
 * Se declara UNA vez y cada recorte la coloca con su escala. El frente mira a
 * la DERECHA. `groundY` es la linea de apoyo -donde tocan los neumaticos- y es
 * un dato y no un numero repetido, porque lo usan a la vez la sombra de
 * contacto, el eje del reflejo y el desvanecido de su mascara.
 */
const TRUCK = {
  groundY: 345,
  /** Centro de cada rueda. */
  wheels: [
    { cx: 200, cy: 273 },
    { cx: 810, cy: 273 },
  ],
  wheelRadius: 72,
  /**
   * Contorno de la carroceria.
   *
   * LAS PROPORCIONES SON LO QUE LA HACE MODERNA. La primera version tenia el
   * capo largo y bajo y el costado del cajon corto, y salia un coche de los
   * anos sesenta con caja detras. Un pickup actual es lo contrario: capo ALTO y
   * corto, cintura alta, costado de cajon profundo y cristales poco altos. Los
   * numeros que lo fijan son estos tres: la cintura a y=146, el bajo a y=288 y
   * el techo a y=48, es decir, 142 de chapa por 98 de cristal.
   *
   * Los dos arcos son los pasos de rueda y llevan `sweep-flag` 0 -curvan hacia
   * ARRIBA-: con 1 el arco pasaria por debajo y el paso de rueda seria una
   * joroba. El radio (95) es exactamente la mitad de la cuerda, es decir, una
   * semicircunferencia: es el arco mas alto que un radio puede dar entre esos
   * dos puntos, y hace falta que sea el mas alto para que el neumatico quepa
   * dentro de la aleta en vez de asomar por encima.
   */
  body:
    "M 30 288 L 28 244 L 24 148 L 392 144 L 398 58 L 412 50 L 655 48 " +
    "Q 672 48 680 58 L 722 136 L 760 133 L 900 122 " +
    "Q 936 120 940 142 L 950 240 L 962 248 L 958 292 L 905 288 " +
    "A 95 95 0 0 0 715 288 L 295 288 A 95 95 0 0 0 105 288 Z",
  /** Cabina acristalada, en una pieza. Los montantes van como filete. */
  glass: "M 414 66 L 414 136 L 712 136 L 678 62 Z",
  /**
   * Filetes: montante central, juntas de puerta, tiradores, nervio del costado,
   * canto del cajon y estribo. Trazo fino en oro, que es lo que convierte una
   * silueta plana en una carroceria con paneles.
   */
  trim:
    "M 545 64 L 545 136 " +
    "M 398 144 L 398 282 M 545 142 L 545 282 " +
    "M 448 174 L 492 174 M 596 172 L 640 172 " +
    "M 34 166 L 390 162 M 340 216 L 690 210 " +
    "M 330 284 L 560 282 M 912 200 L 946 203 M 912 222 L 948 225",
  /** Espejo retrovisor. Poca cosa, y lo que mas dice que es una camioneta. */
  mirror: "M 700 116 L 734 110 L 738 128 L 704 133 Z",
  /** Faro. Relleno de luz y no de grafito: es la unica pieza encendida. */
  headlight: "M 902 138 L 944 144 L 946 178 L 906 172 Z",
  /** Piloto trasero: vertical y alto, como el de un pickup actual. */
  taillight: "M 26 156 L 46 156 L 46 214 L 26 214 Z",
} as const;

/** Angulos de los radios de la llanta, en grados. Cinco, a 72. */
const SPOKE_ANGLES = [0, 72, 144, 216, 288] as const;

/**
 * Compone la escena del premio.
 *
 * La escala y el desplazamiento los pasa cada recorte: el vehiculo es el mismo
 * y lo que cambia es el aire a su alrededor.
 *
 * Igual que en `studioSvg`, los identificadores de los degradados se repiten
 * entre imagenes sin riesgo: cada `data:` URI es un documento independiente
 * cuando se carga desde un `<img>`.
 */
function prizeSvg({
  width,
  height,
  scale,
  offsetX,
  offsetY,
}: {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}): string {
  const n = (value: number): string => String(Math.round(value * 100) / 100);
  const ground = offsetY + TRUCK.groundY * scale;

  /** El vehiculo entero, para poder pintarlo dos veces: pieza y reflejo. */
  const vehicle = [
    // Penumbra: el contorno desenfocado, por debajo de todo lo demas.
    `<g filter="url(#soften)" fill="${PRIZE_STUDIO.ink}" fill-opacity="0.55">`,
    `<path d="${TRUCK.body}"/>`,
    `</g>`,

    `<path d="${TRUCK.body}" fill="url(#panel)" stroke="url(#bevel)" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="${TRUCK.glass}" fill="url(#glass)" stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.55" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="${TRUCK.trim}" fill="none" stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="${TRUCK.mirror}" fill="url(#panel)" stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.7" stroke-width="3" stroke-linejoin="round"/>`,

    // Reflejo especular de la arista superior: una linea de luz que recorre el
    // techo y otra el capo. Es lo que hace que el grafito parezca chapa.
    `<path d="M 412 52 L 655 50 Q 672 50 680 60" fill="none" stroke="${PRIZE_STUDIO.goldLight}" stroke-opacity="0.75" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M 766 132 L 898 122" fill="none" stroke="${PRIZE_STUDIO.goldLight}" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>`,

    `<path d="${TRUCK.taillight}" fill="${PRIZE_STUDIO.goldMid}" fill-opacity="0.35" stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.6" stroke-width="2"/>`,

    // Faro encendido: primero el halo, despues el cristal.
    `<ellipse cx="946" cy="162" rx="140" ry="92" fill="url(#beam)"/>`,
    `<path d="${TRUCK.headlight}" fill="url(#lamp)" stroke="${PRIZE_STUDIO.goldLight}" stroke-opacity="0.85" stroke-width="2.5" stroke-linejoin="round"/>`,

    // Ruedas al final, para que su contorno dorado quede por encima del paso.
    ...TRUCK.wheels.flatMap((wheel) => [
      `<circle cx="${String(wheel.cx)}" cy="${String(wheel.cy)}" r="${String(TRUCK.wheelRadius)}" fill="${PRIZE_STUDIO.tyre}" stroke="url(#bevel)" stroke-width="4"/>`,
      `<circle cx="${String(wheel.cx)}" cy="${String(wheel.cy)}" r="42" fill="url(#panel)" stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.85" stroke-width="3"/>`,
      `<g stroke="${PRIZE_STUDIO.goldMid}" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round">`,
      ...SPOKE_ANGLES.map((angle) => {
        const radians = (angle * Math.PI) / 180;
        return `<path d="M ${String(wheel.cx)} ${String(wheel.cy)} L ${n(wheel.cx + Math.cos(radians) * 36)} ${n(wheel.cy + Math.sin(radians) * 36)}"/>`;
      }),
      `</g>`,
    ]),
  ].join("");

  const placed = `<g transform="translate(${n(offsetX)} ${n(offsetY)}) scale(${n(scale)})">${vehicle}</g>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" role="presentation">`,

    `<defs>`,
    `<radialGradient id="plate" cx="0.56" cy="0.42" r="0.82">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.backdropNear}"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.backdropFar}"/>`,
    `</radialGradient>`,
    // Charco de luz calida detras del sujeto. Sobre negro puede ser generoso:
    // es lo que separa el vehiculo del fondo sin un contorno duro.
    `<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.goldWarm}" stop-opacity="0.42"/>`,
    `<stop offset="0.45" stop-color="${PRIZE_STUDIO.goldMid}" stop-opacity="0.16"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.goldMid}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<linearGradient id="panel" x1="0.2" y1="0" x2="0.55" y2="1">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.bodyTop}"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.bodyBottom}"/>`,
    `</linearGradient>`,
    `<linearGradient id="glass" x1="0" y1="0" x2="0.3" y2="1">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.glassTop}"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.glassBottom}"/>`,
    `</linearGradient>`,
    `<linearGradient id="bevel" x1="0" y1="0" x2="0.6" y2="1">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.goldLight}"/>`,
    `<stop offset="0.5" stop-color="${PRIZE_STUDIO.goldMid}"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.bodyBottom}"/>`,
    `</linearGradient>`,
    `<radialGradient id="lamp" cx="0.3" cy="0.35" r="0.9">`,
    `<stop offset="0" stop-color="#ffffff"/>`,
    `<stop offset="0.55" stop-color="${PRIZE_STUDIO.goldWarm}"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.goldMid}"/>`,
    `</radialGradient>`,
    `<radialGradient id="beam" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.goldWarm}" stop-opacity="0.5"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.goldWarm}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<radialGradient id="contact" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${PRIZE_STUDIO.ink}" stop-opacity="0.85"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.ink}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<filter id="soften" x="-20%" y="-20%" width="140%" height="140%">`,
    `<feGaussianBlur stdDeviation="14"/>`,
    `</filter>`,
    // Desvanecido del reflejo: opaco junto al suelo, nulo al llegar abajo.
    `<linearGradient id="fadeGradient" x1="0" y1="${n(ground)}" x2="0" y2="${String(height)}" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>`,
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>`,
    `</linearGradient>`,
    `<mask id="fade"><rect width="${String(width)}" height="${String(height)}" fill="url(#fadeGradient)"/></mask>`,
    // Vineta: cierra las esquinas para que la luz del centro parezca luz.
    `<radialGradient id="vignette" cx="0.5" cy="0.44" r="0.78">`,
    `<stop offset="0.42" stop-color="${PRIZE_STUDIO.ink}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${PRIZE_STUDIO.ink}" stop-opacity="0.72"/>`,
    `</radialGradient>`,
    `</defs>`,

    `<rect width="${String(width)}" height="${String(height)}" fill="url(#plate)"/>`,
    `<ellipse cx="${n(width * 0.52)}" cy="${n(ground - height * 0.2)}" rx="${n(width * 0.42)}" ry="${n(height * 0.36)}" fill="url(#pool)"/>`,

    // Reflejo en el suelo: el vehiculo volteado sobre la linea de apoyo y
    // desvanecido. Es el recurso que separa una ilustracion plana de una pieza
    // fotografiada sobre una superficie.
    `<g mask="url(#fade)" opacity="0.24">`,
    `<g transform="translate(0 ${n(ground * 2)}) scale(1 -1)">${placed}</g>`,
    `</g>`,

    // Sombra de contacto, entre el reflejo y la pieza.
    `<ellipse cx="${n(offsetX + 500 * scale)}" cy="${n(ground)}" rx="${n(430 * scale)}" ry="${n(34 * scale)}" fill="url(#contact)"/>`,

    placed,

    `<rect width="${String(width)}" height="${String(height)}" fill="url(#vignette)"/>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Recorte del premio para el HERO.
 *
 * NO ES 16:9, y la primera version si lo era. El error estaba en pensar en la
 * imagen y no en el HUECO: el hero no la pinta como una banda apaisada sino
 * dentro de una columna que ocupa el 56% del ancho y TODA la altura en
 * escritorio, y una franja a todo el ancho en telefono. Los dos huecos son casi
 * cuadrados -entre 0,9 y 1,1 de proporcion en las pantallas habituales- y
 * `object-cover` sobre un 16:9 ahi recorta cerca del 40% del ancho: el morro
 * del vehiculo, con el faro, se quedaba fuera en escritorio.
 *
 * Asi que el lienzo es 1300 x 1150 (1,13) y el vehiculo ocupa la franja central
 * en horizontal, entre x=262 y x=1129. Con eso sobrevive entero al recorte de
 * un hueco de hasta 0,88 de proporcion, que cubre todos los telefonos y los
 * escritorios de 16:9 y 16:10. Es tambien el encuadre que el README de
 * `public/prizes/` pide a quien traiga la fotografia real: sujeto centrado y
 * aire por los cuatro lados.
 *
 * YA NO ES EL RESPALDO DEL HERO (HO-041, hallazgo S-11). El hero filtra su
 * imagen con `safeImageUrl` y esa funcion rechaza `data:`, que es lo que esta
 * constante es. El respaldo pasa a ser una ruta de `public/prizes/`; ver
 * `GMC_PRIZE_HERO_FALLBACK`. Se conserva porque sigue siendo el ejemplo REAL de
 * `data:` URI con el que `image-sinks.test.tsx` comprueba que el hero lo
 * descarta: un literal inventado en el test probaria el validador, no el
 * sumidero.
 */
export const prizeTruckWideImage = prizeSvg({
  width: 1300,
  height: 1150,
  scale: 0.92,
  offsetX: 240,
  offsetY: 442,
});

/**
 * Recorte CUADRADO del premio, para tarjetas y listados.
 *
 * El vehiculo va a escala 1 y ocupa el ancho entero -su contorno vive entre
 * x=24 y x=962 del lienzo propio, asi que quedan margenes justos y ninguna
 * defensa cortada- y la linea de apoyo cae en el 65% de la altura. No esta
 * centrado: un lateral de vehiculo en un lienzo cuadrado deja aire por fuerza,
 * y ponerlo un poco por encima del centro es lo que convierte ese aire en el
 * fondo del plato y el hueco de abajo en el reflejo.
 */
export const prizeTruckSquareImage = prizeSvg({
  width: 1000,
  height: 1000,
  scale: 1,
  offsetX: 0,
  offsetY: 310,
});
