/**
 * ============================================================================
 * CAPA DE TIPOS DE LA API - ALINEADA CON docs/API_CONTRACT.md
 * ============================================================================
 *
 * `docs/API_CONTRACT.md` ya esta poblado (1015 lineas, 52 endpoints) y ES LA
 * FUENTE DE VERDAD. Donde este archivo difiera del documento, gana el
 * documento. Este archivo no lo interpreta ni lo amplia en silencio: lo copia,
 * y marca de forma EXPLICITA lo que el documento todavia no describe.
 *
 * Dos categorias, y conviene no confundirlas:
 *
 * 1. `[CONTRATO]` .... la forma esta escrita en `docs/API_CONTRACT.md`. Si aqui
 *    hay una diferencia, es un defecto de este archivo.
 * 2. `[PROVISIONAL]` . el documento NOMBRA el recurso pero no publica su forma
 *    (`ProductSummary`, `ProductDetail`, `PromotionDetail`, `CartWithQuote`).
 *    La forma de aqui es una PETICION concreta a `backend`, no un acuerdo, y
 *    esta pedida en el informe del hito.
 *
 * Camino de salida, ya decidido (DEC-014)
 * ---------------------------------------
 * `backend` publica un OpenAPI 3.1 generado desde Zod y es propietario de
 * `packages/api-types`. Cuando exista, ESTE ARCHIVO SE BORRA y los tipos se
 * importan de alli. Por eso ningun componente importa de aqui directamente:
 * importan de `src/lib/api`, que es la unica capa que tendra que cambiar.
 *
 * Convenciones transversales que aqui se respetan al pie de la letra
 * ------------------------------------------------------------------
 * - DEC-010: el dinero viaja como CADENA de digitos en unidad menor. No es un
 *   detalle de estilo: un entero grande no sobrevive a `JSON.parse` sin riesgo
 *   de perder precision. Los multiplicadores son fracciones
 *   `{ numerator, denominator }`, jamas un decimal. Las cantidades de entries
 *   son enteros y los numeros de entry son cadenas.
 * - DEC-011: los instantes son ISO-8601 en UTC y cada promocion declara su
 *   `legal_timezone` IANA. Los deadlines los evalua el servidor.
 * - DEC-022 y DEC-031: el backend manda codigos estables (`code`, `reason_key`,
 *   `kind`) y el texto es del frontend. `code` es la clave canonica de
 *   traduccion; no hay `message_key`.
 * - DEC-029: el segmento de ruta (`en`, `es`) y la etiqueta BCP-47 (`en-US`,
 *   `es-US`) son identificadores distintos. Todo lo que viaja por la API usa la
 *   ETIQUETA.
 * - DEC-030: el contenido dinamico localizado viaja por locale desde el backend
 *   (`LocalizedText`), y el frontend no lo traduce jamas.
 * - DEC-032: lista canonica de feature flags en `snake_case` y `amoe_mode` como
 *   enum de cuatro modalidades.
 * - CLAUDE.md #2 y #14: ni una constante legal. Edades, estados elegibles,
 *   ratios y limites no aparecen en este archivo porque no le corresponden.
 */

/**
 * [CONTRATO] Dinero segun DEC-010.
 *
 * `amount_minor` es una CADENA de digitos con signo opcional, no un numero.
 * Cambiarlo a `number` reintroduciria exactamente la perdida de precision que
 * DEC-010 existe para evitar, y lo haria en silencio.
 */
export interface MoneyMinor {
  readonly amount_minor: string;
  readonly currency: string;
}

/**
 * [CONTRATO] Multiplicador como fraccion exacta (DEC-010).
 *
 * `{ numerator: 2, denominator: 1 }` y no `2`, y desde luego no `1.5`. Un
 * multiplicador fraccionario expresado como decimal es un redondeo esperando a
 * ocurrir sobre una cifra que tiene consecuencias legales.
 *
 * El frontend NO opera con estos dos numeros: los muestra. Quien multiplica es
 * el backend, y solo sobre el carrito de servidor (DEC-023).
 */
export interface EntryMultiplier {
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * [CONTRATO] Contenido dinamico localizado (DEC-030).
 *
 * TERCERA CATEGORIA de texto, con dueno propio. No es copy de producto (que es
 * del frontend, DEC-022) ni texto legalmente controlante (que viaja aparte con
 * sus banderas `is_legally_controlling` / `is_informational_translation`). Son
 * datos que un administrador teclea: titulo de promocion, nombre de premio,
 * descripcion de producto.
 *
 * Reparto de responsabilidades que impone DEC-030:
 *
 * - `backend` lo PERSISTE por locale y valida en publicacion que ningun idioma
 *   quede vacio. Por eso las dos claves son OBLIGATORIAS aqui: un opcional
 *   permitiria que el frontend recibiera un hueco y tuviera que improvisar.
 * - `frontend` lo RENDERIZA tal cual y NO LO TRADUCE JAMAS. No hay `t()` sobre
 *   estos valores, ni fallback de un idioma a otro que disfrace un dato
 *   incompleto (principio #4).
 *
 * Las claves son las ETIQUETAS de DEC-029 (`en-US`, `es-US`), no los segmentos
 * de ruta (`en`, `es`). Para elegir una, `pickLocalized` (`./localized.ts`) es
 * el unico camino: hace la conversion de segmento a etiqueta en un solo sitio.
 */
export interface LocalizedText {
  readonly "en-US": string;
  readonly "es-US": string;
}

/**
 * [CONTRATO] Pagina de un listado, paginada POR CURSOR.
 *
 * Nunca por offset. Con offset, una entrada nueva durante la paginacion
 * desplaza filas y el cliente ve duplicados o huecos. El cursor es OPACO: el
 * frontend lo transporta y no lo interpreta jamas.
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
}

/**
 * [CONTRATO] Estado de una promocion.
 *
 * Enum canonico de `@lsw/sweepstakes`, tal como lo publica
 * `docs/API_CONTRACT.md`. NUEVE estados en `SCREAMING_SNAKE_CASE`.
 *
 * ESTO CAMBIO EN ESTE HITO. La capa provisional anterior tenia seis estados en
 * minusculas (`upcoming`, `active`, `ended`, `administrator_processing`,
 * `winner_verification`, `completed`), inventados por `frontend` antes de que
 * el contrato existiera. El documento gana: los nombres son los del dominio, y
 * la interfaz se adapta a ellos y no al reves.
 *
 * - `DRAFT` .................... existe en el admin; no es publica.
 * - `SCHEDULED` ................ configurada y publicada, todavia no abierta.
 * - `ACTIVE` ................... abierta.
 * - `CLOSED` ................... cerrada; aun no ha empezado el proceso.
 * - `EXPORT_PREPARATION` ....... preparando la exportacion al administrador
 *   independiente (DEC-016).
 * - `DRAW_PENDING` ............. el sorteo esta en manos del administrador
 *   independiente (DEC-017, principio #10).
 * - `POTENTIAL_WINNER_REVIEW` .. hay ganador potencial y se esta verificando.
 * - `COMPLETED` ................ terminada.
 * - `CANCELLED` ................ cancelada. Fuera del ciclo normal.
 *
 * La transicion entre estados es del backend. La interfaz NUNCA la deduce del
 * reloj del navegador: la cuenta atras es decoracion sobre un estado que ya
 * viene decidido.
 */
export type PromotionStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "CLOSED"
  | "EXPORT_PREPARATION"
  | "DRAW_PENDING"
  | "POTENTIAL_WINNER_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export const PROMOTION_STATUSES: readonly PromotionStatus[] = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
  "CANCELLED",
];

/**
 * Ciclo de vida NORMAL de una promocion, en orden.
 *
 * `DRAFT` y `CANCELLED` quedan fuera a proposito: el primero no es publico y el
 * segundo no es un paso del recorrido sino su interrupcion. Pintarlos como dos
 * casillas mas de una linea temporal diria que toda promocion pasa por ellos.
 */
export const PROMOTION_LIFECYCLE: readonly PromotionStatus[] = [
  "SCHEDULED",
  "ACTIVE",
  "CLOSED",
  "EXPORT_PREPARATION",
  "DRAW_PENDING",
  "POTENTIAL_WINNER_REVIEW",
  "COMPLETED",
];

/**
 * [CONTRATO] Resumen de promocion.
 *
 * Copia literal de la seccion "Forma de `PromotionSummary`". Ni un campo mas.
 *
 * NOTA DE ALINEACION: la capa provisional anterior anadia aqui `entry_offer`,
 * que el contrato NO declara. Se ha movido a `PromotionDetail`, cuya forma el
 * documento todavia no publica, y se ha pedido a `backend` que decida donde
 * vive (ver informe del hito). Mientras tanto, la portada obtiene la oferta
 * pidiendo el detalle de la promocion activa, y no inventandose un campo.
 */
export interface PromotionSummary {
  readonly id: string;
  readonly slug: string;
  readonly status: PromotionStatus;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  /** Zona horaria IANA declarada por la promocion (DEC-011). */
  readonly legal_timezone: string;
  /** ISO-8601 en UTC. */
  readonly starts_at: string;
  /** ISO-8601 en UTC. */
  readonly ends_at: string;
  /**
   * Version de reglas vigente (DEC-012). `null` mientras no haya ninguna
   * ACTIVE: la interfaz debe poder representar ese caso sin inventarse nada.
   */
  readonly rules_version_id: string | null;
  /** Valor declarado del premio. `null` si aun no esta configurado. */
  readonly prize_value: MoneyMinor | null;
}

/**
 * [PROVISIONAL] Oferta de participaciones vigente de una promocion.
 *
 * TODO es dato del backend. Ni el ratio ni el multiplicador ni sus fechas
 * aparecen como constante en ninguna parte del frontend: son configuracion
 * derivada de las Official Rules (CLAUDE.md #3 y #14).
 *
 * El frontend NO multiplica: `base_entries_per_unit` y `multiplier` se muestran
 * como datos, y cualquier cifra concreta de participaciones para un carrito o
 * un pedido la produce el backend (DEC-023, requisito R13 de `security`).
 *
 * `docs/API_CONTRACT.md` todavia no publica este objeto en ninguna respuesta
 * publica. Es la peticion abierta mas importante de este hito: sin el, la
 * interfaz no puede decir que ofrece la promocion sin que alguien meta la mano
 * en el carrito primero.
 */
export interface EntryOffer {
  /** Participaciones que otorga cada `unit_amount`. Entero (DEC-010). */
  readonly base_entries_per_unit: number;
  /** Importe unitario al que se refiere `base_entries_per_unit`. */
  readonly unit_amount: MoneyMinor;
  /**
   * Multiplicador vigente como fraccion (DEC-010), o `null` si no hay ninguno.
   * Solo debe mostrarse si `entry_multipliers_enabled` esta encendido: el flag
   * gobierna la EXISTENCIA de la funcion, y el dato solo su valor.
   */
  readonly multiplier: EntryMultiplier | null;
  /** Inicio del periodo de multiplicador. ISO-8601 UTC, o `null`. */
  readonly multiplier_starts_at: string | null;
  /** Fin del periodo de multiplicador. ISO-8601 UTC, o `null`. */
  readonly multiplier_ends_at: string | null;
}

/** [PROVISIONAL] Premio declarado de una promocion. */
export interface PromotionPrize {
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  /** Valor declarado. `null` mientras no este configurado. */
  readonly declared_value: MoneyMinor | null;
}

/**
 * [PROVISIONAL] Imagenes de una promocion (DEC-042).
 *
 * PETICION ABIERTA A `backend`, no un acuerdo. `docs/API_CONTRACT.md` no
 * publica hoy ningun campo de media para una promocion, y sin el la unica forma
 * de que el hero enseñe el premio es que el frontend elija la imagen, que es
 * decir que el frontend decide como se ve un premio.
 *
 * DOS RECORTES Y NO UNO. La misma fotografia no sirve para las dos cosas: el
 * hero la pinta a sangre y apaisada -el sujeto tiene que caber en una franja
 * ancha- y una tarjeta la pinta cuadrada. Recortar una de la otra en el
 * navegador deja el sujeto fuera de encuadre la mitad de las veces. Cuando solo
 * haya una, `square_url` llega `null` y quien la necesite se queda sin ella, en
 * vez de enseñar la apaisada deformada.
 *
 * `alt` es LOCALIZADO (DEC-030) y NULABLE. `null` significa "decorativa": la
 * imagen acompana a un titular que ya dice lo mismo, y en ese caso el texto
 * alternativo correcto es la cadena vacia, no una descripcion que un lector de
 * pantalla leeria justo despues del titular. Que sea nulable obliga a decidirlo
 * en el dato, que es donde se sabe.
 */
export interface PromotionMedia {
  /** Recorte apaisado, para el hero. `null` si no hay imagen. */
  readonly hero_url: string | null;
  /** Recorte cuadrado, para tarjetas. `null` si no existe. */
  readonly square_url: string | null;
  /** Texto alternativo, o `null` si la imagen es decorativa. */
  readonly alt: LocalizedText | null;
}

/**
 * [PROVISIONAL] Universo de participaciones de una promocion (DEC-042).
 *
 * PETICION ABIERTA A `backend`. El cliente ha fijado para la promocion de la
 * GMC 2025 un universo total de 10,000 participaciones, y eso es CONFIGURACION
 * de la promocion -derivada de las Official Rules- y no un texto que la
 * interfaz pueda escribir (CLAUDE.md #3 y #14). Como el tope y su tratamiento
 * legal siguen en `docs/LEGAL_PENDING.md`, la interfaz lo presenta como dato de
 * las Reglas y nada mas.
 *
 * EL FRONTEND NO RESTA. `issued` viaja como cifra SERVIDA; no existe aqui un
 * campo `remaining` a proposito, y no se calcula: una cifra de "quedan X" es
 * exactamente el reclamo de urgencia que DEC-042 excluye, y ademas la produciria
 * el cliente a partir de dos numeros que pueden llegar desincronizados. Si algun
 * dia hay que enseñar restantes, lo publica el backend con su propio campo.
 *
 * Y DESDE DEC-044, `issued` TAMPOCO SE PINTA. No basta con no restar: pintar
 * `cap` e `issued` uno debajo del otro publica el contador de restantes POR
 * IMPLICACION, porque la resta la hace el lector. El campo se conserva en el
 * contrato -es dato del backend, y un panel de administracion lo necesitara-
 * pero ninguna pantalla publica lo lee. Lo unico que se ensena del universo es
 * el tope, como dato de las Reglas.
 *
 * `null` en `issued` mientras el backend no publique la cifra.
 */
export interface EntryPool {
  /** Tope total configurado de participaciones. Entero (DEC-010). */
  readonly cap: number;
  /** Participaciones emitidas hasta ahora, servidas por el backend. */
  readonly issued: number | null;
}

/**
 * [PROVISIONAL] Promocion completa.
 *
 * `docs/API_CONTRACT.md` nombra `PromotionDetail` como respuesta de
 * `GET /promotions/{slug}` pero no publica su forma. Estos tres campos son la
 * peticion del frontend, no un acuerdo.
 */
export interface PromotionDetail extends PromotionSummary {
  readonly prize: PromotionPrize | null;
  /**
   * Nombre del administrador independiente, si la promocion declara uno
   * (principio #10). `null` mientras no este contratado o publicado.
   *
   * No es texto localizado: es el nombre propio de una empresa y se escribe
   * igual en los dos idiomas.
   */
  readonly administrator_name: string | null;
  /** Oferta vigente, o `null` si la promocion no declara ninguna. */
  readonly entry_offer: EntryOffer | null;
  /**
   * Imagenes del premio (DEC-042). `null` si la promocion no declara ninguna,
   * que es el caso por defecto y el que la interfaz tiene que saber pintar.
   */
  readonly media: PromotionMedia | null;
  /**
   * Universo de participaciones (DEC-042). `null` si la promocion no declara
   * tope: no todas lo tienen, y un `0` significaria "ninguna participacion".
   */
  readonly entry_pool: EntryPool | null;
}

/** [CONTRATO] `GET /promotions` devuelve una pagina por cursor. */
export type PromotionListResponse = CursorPage<PromotionSummary>;

// ---------------------------------------------------------------------------
// Reglas Oficiales
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Documento de Reglas Oficiales en UN idioma.
 *
 * Es la EXCEPCION que reconoce DEC-022: el texto legalmente controlante viaja
 * desde el backend por locale, con sus banderas, y el frontend lo renderiza tal
 * cual. No se traduce, no se autotraduce, no se resume y no se hace fallback de
 * un idioma al otro.
 *
 * NOTA DE ALINEACION: la capa provisional anterior modelaba el cuerpo como
 * `sections: { heading, paragraphs[] }[]` para conservar estructura sin abrir
 * la puerta a HTML. El contrato publica `body` como una sola cadena y gana el
 * contrato. Se renderiza como TEXTO PLANO, partiendo en parrafos por lineas en
 * blanco: sigue sin haber `dangerouslySetInnerHTML` en ninguna parte, que era
 * lo unico innegociable de aquel diseno.
 *
 * Las dos banderas no son redundantes. Puede existir una promocion en la que el
 * abogado apruebe AMBAS versiones como controlantes, y puede existir el caso
 * -defectuoso, y hoy el real: el idioma controlante sigue en TBD- en el que
 * ninguna lo sea. La interfaz tiene que poder distinguirlos y decirlo, en vez
 * de suponer que el ingles siempre manda.
 */
export interface OfficialRulesDocumentContent {
  /** Etiqueta BCP-47 (DEC-029), no segmento de ruta. */
  readonly locale: string;
  readonly title: string;
  /** Texto plano. NUNCA se interpreta como marcado. */
  readonly body: string;
  readonly is_legally_controlling: boolean;
  readonly is_informational_translation: boolean;
}

/**
 * [CONTRATO] Version vigente de las Reglas Oficiales de una promocion.
 *
 * Copia literal de la respuesta de `GET /promotions/{slug}/official-rules`.
 *
 * NOTA DE ALINEACION: `version` es un ENTERO en el contrato, no una etiqueta de
 * texto como asumia la capa anterior. Y la respuesta NO trae `legal_timezone`:
 * la pantalla toma la zona de la promocion, que ya ha pedido, en vez de
 * formatear la fecha de entrada en vigor contra el reloj del navegador
 * (DEC-011).
 */
export interface OfficialRulesResponse {
  readonly rules_version_id: string;
  readonly version: number;
  /** Fecha de entrada en vigor. ISO-8601 UTC. */
  readonly effective_at: string;
  readonly documents: readonly OfficialRulesDocumentContent[];
}

// ---------------------------------------------------------------------------
// Disponibilidad (catalogo y carrito)
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Estado de existencias, en las DOS superficies que lo publican.
 *
 * UN SOLO TIPO PORQUE ES UN SOLO DATO
 * -----------------------------------
 * `docs/API_CONTRACT.md` publica el mismo objeto en la seccion 4 (variante del
 * catalogo) y en la seccion 5 (linea del carrito): el mismo enum estable de
 * tres valores, la misma columna `product_variants.stock_quantity` y **el mismo
 * predicado**, el que decide el `409 INSUFFICIENT_STOCK`. Declararlo dos veces
 * en el frontend invitaria a que las dos copias se separaran.
 *
 * LO QUE CAMBIA ES LA CANTIDAD POR LA QUE SE PREGUNTA
 * --------------------------------------------------
 * En el carrito, la de la linea; en el catalogo, UNA unidad, porque en la ficha
 * nadie ha elegido todavia cuantas quiere. De ahi que `OUT_OF_STOCK` signifique
 * cosas distintas de grado en cada sitio -"no caben las cinco que pediste" y
 * "no cabe ni una"- y que el copy tenga que ser cierto en los dos: por eso NO
 * dice "agotado".
 *
 * El umbral de `LOW_STOCK` no es un numero de negocio -nadie ha aprobado
 * ninguno y el principio 2 de `CLAUDE.md` prohibe inventarlo-: es la cantidad
 * preguntada. `null` en la columna significa existencias NO GESTIONADAS y da
 * `IN_STOCK`; `null` no es cero.
 *
 * NO responde "¿esta a la venta?". Esa es `is_purchasable`, sigue pendiente
 * (HO-017) y el contrato dice expresamente que no se deduce de esta.
 */
export type AvailabilityStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export const AVAILABILITY_STATUSES: readonly AvailabilityStatus[] = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
];

/**
 * [CONTRATO] Disponibilidad publicada. Hoy solo lleva `status`.
 *
 * Es un OBJETO y no una cadena a proposito: el dia que se decida publicar la
 * cantidad, el campo cabe dentro sin cambiar el tipo de lo ya publicado. Hoy
 * `quantity_available` NO EXISTE en ninguna de las dos superficies -HO-017
 * pidio expresamente que no se publicara- y por eso este tipo no lo declara ni
 * como opcional: un campo opcional aqui invitaria a escribir copy que promete
 * un numero que nunca llega.
 */
export interface Availability {
  readonly status: AvailabilityStatus;
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Variante de un producto.
 *
 * LO QUE LA API PUBLICA HOY son `id`, `sku`, `price` y `availability`
 * (`docs/API_CONTRACT.md` seccion 4). `name` sigue siendo una PETICION del
 * frontend -el selector de talla necesita una etiqueta y el contrato no publica
 * ninguna- y esta pedida en HO-019.
 *
 * LO QUE YA NO ESTA AQUI, Y POR QUE
 * ---------------------------------
 * - `is_purchasable`. "¿Esta a la venta?" NO es la misma pregunta que "¿hay
 *   existencias?", y por eso el contrato dice que **no se deduce** de
 *   `availability`. Pero tampoco esta implementado ni decidido: sigue pendiente
 *   en HO-017. Declararlo obligatorio hacia que la interfaz consumiera un campo
 *   que la respuesta real no trae, que es exactamente el defecto que HO-034
 *   encontro en el carrito. Mientras no se decida, la unica senal que la
 *   interfaz tiene es `availability.status`, y lo que dice es que no hay
 *   existencias, NO que el articulo este retirado.
 * - `stock_quantity`. El catalogo lo publicaba en crudo -y es anonimo- mientras
 *   el carrito, que va con sesion, deliberadamente no lo hacia. Se resolvio
 *   hacia la superficie que no filtra: hoy ninguna de las dos lo publica.
 */
export interface ProductVariant {
  readonly id: string;
  readonly sku: string;
  /** [PROVISIONAL] Nombre de la variante ("Talla M"). Pedido en HO-019. */
  readonly name: LocalizedText;
  readonly price: MoneyMinor;
  /** El MISMO objeto que la linea del carrito. Ver `Availability`. */
  readonly availability: Availability;
}

/**
 * [PROVISIONAL] Elegibilidad de un producto dentro de una promocion.
 *
 * ESTE OBJETO EXISTE POR UNA RESTRICCION EXPLICITA DEL CONTRATO. La seccion 4
 * de `docs/API_CONTRACT.md` dice, literalmente, que el catalogo NO declara
 * cuantas entries da un producto, porque la elegibilidad y la formula
 * pertenecen a la `PromotionRulesVersion` (DEC-012): si el numero viviera en el
 * producto, editar el catalogo cambiaria retroactivamente lo que significo una
 * compra pasada.
 *
 * Asi que aqui NO hay ninguna cifra de participaciones. Solo el resultado, ya
 * evaluado por el backend, de aplicar una version de reglas CONCRETA -y por eso
 * `evaluated_against_rules_version_id` es obligatorio- a un producto concreto.
 * Es una proyeccion de solo lectura con procedencia, no un atributo del
 * catalogo.
 *
 * `null` cuando no hay promocion activa contra la que evaluar.
 */
export interface ProductEntryEligibility {
  readonly promotion_id: string;
  readonly promotion_slug: string;
  /** Version de reglas contra la que se evaluo. Sin esto no hay procedencia. */
  readonly evaluated_against_rules_version_id: string;
  readonly is_eligible: boolean;
  /** Enum estable cuando no es elegible; el copy es del frontend (DEC-022). */
  readonly reason_key: string | null;
}

/**
 * Producto en el listado del catalogo.
 *
 * NO HAY DISPONIBILIDAD A NIVEL DE PRODUCTO, Y NO ES UN OLVIDO
 * -----------------------------------------------------------
 * La API publica `availability` POR VARIANTE y no publica ningun estado
 * agregado del producto (`docs/API_CONTRACT.md` seccion 4). Este tipo tenia uno
 * y la interfaz lo pintaba: era un campo que la respuesta real no trae.
 *
 * Un producto con cuatro tallas no tiene UN estado; tiene cuatro. Lo que la
 * interfaz necesita para la tarjeta -"¿se puede comprar algo de esto hoy?"- es
 * una AGREGACION DE PRESENTACION sobre las variantes que ya vienen en la
 * respuesta, y por eso vive en `@/lib/product-availability` y no aqui: es una
 * decision de como se ensena, no un dato del contrato.
 *
 * `variants` esta en el RESUMEN porque la API devuelve la misma forma en el
 * listado y en la ficha. La ficha no trae nada que el listado no traiga.
 *
 * Los campos marcados abajo siguen siendo PETICIONES del frontend (HO-019) y no
 * los publica ninguna ruta todavia.
 */
export interface ProductSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: LocalizedText;
  /** [PROVISIONAL] Resumen corto para la tarjeta. Pedido en HO-019. */
  readonly summary: LocalizedText;
  /** [PROVISIONAL] Clave estable de categoria; el copy es del frontend. */
  readonly category_key: string;
  /** [PROVISIONAL] Sin modelo de medios, como en el carrito. Pedido en HO-019. */
  readonly image_url: string | null;
  /** [PROVISIONAL] Precio de la variante mas barata. Pedido en HO-019. */
  readonly price_from: MoneyMinor;
  readonly variants: readonly ProductVariant[];
  /** [PROVISIONAL] Elegibilidad ya evaluada. Pedida en HO-019. */
  readonly entry_eligibility: ProductEntryEligibility | null;
}

/**
 * Ficha completa de producto.
 *
 * Misma forma que el resumen mas lo que solo se lee en la ficha. `description`
 * la publica la API en las dos rutas; `shipping_note` e `images` siguen siendo
 * peticiones del frontend (HO-019).
 */
export interface ProductDetail extends ProductSummary {
  readonly description: LocalizedText;
  /** [PROVISIONAL] Informacion de envio, localizada. Pedida en HO-019. */
  readonly shipping_note: LocalizedText | null;
  /** [PROVISIONAL] Galeria. Sin modelo de medios no hay fuente. */
  readonly images: readonly string[];
}

/** [CONTRATO] `GET /products` devuelve una pagina por cursor. */
export type ProductListResponse = CursorPage<ProductSummary>;

/** Filtros admitidos por `GET /products`. El cursor es opaco. */
export interface ProductListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly promotion_slug?: string;
  /**
   * [PROVISIONAL] Filtro por categoria. El contrato solo documenta `cursor`,
   * `limit` y `promotion_slug`; este parametro esta pedido a `backend`. Si el
   * backend lo ignora, la pantalla sigue funcionando: mostraria el catalogo
   * completo, que es degradar, no romper.
   */
  readonly category_key?: string;
}

// ---------------------------------------------------------------------------
// Carrito de servidor (DEC-023)
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Linea del carrito de servidor.
 *
 * COPIA LITERAL de `CartWithQuote.lines[]` tal como lo publica
 * `docs/API_CONTRACT.md` seccion 5. Esta interfaz llego a describir otra forma
 * -`line_id`, `product_name` + `variant_name`, `line_total`- que era la
 * PETICION del frontend y nunca fue lo que devuelve la ruta: la pantalla del
 * carrito no podia pintar ni una linea contra la API real (HO-034 punto 2, ya
 * senalado en HO-017).
 *
 * La regla que resuelve el desacuerdo es la 1 del contrato: GANA LO QUE EL
 * DOCUMENTO PUBLICA. `image_url` y `availability` estaban entre lo que el
 * frontend habia pedido y el documento no publicaba; la interfaz los degrado en
 * vez de inventarlos, y ahora que HO-017 los publica se declaran CON LA FORMA
 * QUE TIENEN -`availability` es un objeto, no una cadena- y no con la que el
 * frontend habia propuesto.
 *
 * `id` es la MISMA identidad que `line_id` en la cotizacion de entries -el
 * contrato lo dice explicitamente-. Sin esa correspondencia la interfaz no
 * podria decir QUE linea no es elegible y tendria que dar el aviso a nivel de
 * carrito entero.
 *
 * `name` es EL NOMBRE DEL PRODUCTO, no el de la variante: el backend lo compone
 * desde las traducciones del producto. La variante se distingue por `sku`, que
 * es lo unico que el contrato publica para diferenciarlas.
 */
export interface CartLine {
  readonly id: string;
  readonly variant_id: string;
  readonly product_slug: string;
  readonly sku: string;
  readonly name: LocalizedText;
  readonly quantity: number;
  readonly unit_price: MoneyMinor;
  /** Subtotal de linea CALCULADO POR EL BACKEND. El frontend no multiplica. */
  readonly line_subtotal: MoneyMinor;
  /**
   * Imagen de la linea. HOY ES SIEMPRE `null`, y el contrato lo dice: el
   * esquema no tiene ninguna tabla de medios y `backend` no inventa una para
   * rellenar el campo.
   *
   * El tipo es `string | null` y NO una URL absoluta: sin modelo de medios
   * nadie ha decidido si la referencia sera absoluta, relativa o de un CDN, y
   * declararlo aqui seria tomar esa decision de pasada.
   */
  readonly image_url: string | null;
  /**
   * Disponibilidad de ESTA CANTIDAD, no del articulo.
   *
   * Mismo tipo que la variante del catalogo (`Availability`), porque es el
   * mismo dato calculado con el mismo predicado. Lo que cambia es la cantidad
   * por la que se pregunta: aqui, la de la linea.
   */
  readonly availability: Availability;
}

/** [CONTRATO] Linea elegible de la cotizacion. */
export interface EntryQuoteEligibleItem {
  readonly line_id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly multiplier_ids: readonly string[];
}

/** [CONTRATO] Linea NO elegible de la cotizacion. */
export interface EntryQuoteIneligibleItem {
  readonly line_id: string;
  readonly sku: string;
  /** Enum estable. El copy es del frontend (DEC-022). */
  readonly reason_key: string;
}

/** [CONTRATO] Multiplicador aplicado, con su identidad. */
export interface EntryQuoteAppliedMultiplier extends EntryMultiplier {
  readonly id: string;
}

/** [CONTRATO] Tope aplicado a la cotizacion. */
export interface EntryQuoteAppliedCap {
  /** Enum estable (`PER_ORDER`, ...). El copy es del frontend (DEC-022). */
  readonly kind: string;
  readonly limit: number;
  readonly entries_before: number;
  readonly entries_after: number;
}

/**
 * [CONTRATO] Cotizacion de entries del carrito de servidor.
 *
 * Copia literal de la respuesta de `GET /cart/entry-quote`.
 *
 * TRES COSAS QUE LA INTERFAZ NO PUEDE HACER CON ESTO
 * --------------------------------------------------
 * 1. **No puede producirla.** La cotizacion se calcula sobre el carrito DEL
 *    SERVIDOR, nunca sobre una lista de items que mande el cliente (DEC-023).
 *    Por eso es un `GET` y no un `POST`: un `POST` sugeriria que el cliente
 *    aporta los items.
 * 2. **No puede recalcularla.** Ni sumar, ni multiplicar, ni aplicar el tope a
 *    mano, ni siquiera "para ir enseñando algo mientras llega". Requisito R13
 *    de `security`.
 * 3. **No puede presentarla como definitiva.** Es ORIENTATIVA hasta que la
 *    orden alcance el estado que las Official Rules definan como cualificante.
 *    Las entries las genera el backend al recibir la confirmacion de pago,
 *    NUNCA cuando el frontend llega a la pagina de exito.
 *
 * `entries_before_caps` y `final_entries` viajan los dos para que la pantalla
 * pueda explicar POR QUE una cifra bajo, en vez de enseñar un numero menor del
 * esperado sin justificacion.
 */
export interface EntryQuote {
  readonly promotion_id: string;
  readonly rules_version_id: string;
  readonly engine_version: number;
  /** Instante de evaluacion. ISO-8601 UTC. */
  readonly evaluated_at: string;
  readonly eligible_subtotal: MoneyMinor | null;
  readonly entries_before_caps: number;
  readonly final_entries: number;
  readonly eligible_items: readonly EntryQuoteEligibleItem[];
  readonly ineligible_items: readonly EntryQuoteIneligibleItem[];
  readonly applied_multipliers: readonly EntryQuoteAppliedMultiplier[];
  readonly applied_caps: readonly EntryQuoteAppliedCap[];
}

/**
 * [CONTRATO] Carrito de servidor CON su cotizacion.
 *
 * Respuesta de las CINCO rutas de carrito, y es PLANA: el carrito no viaja
 * anidado bajo una clave `cart`. `docs/API_CONTRACT.md` seccion 5 publica la
 * forma completa.
 *
 * TRES CAMPOS SON NULABLES Y CADA UNO DICE ALGO DISTINTO
 * -----------------------------------------------------
 * - `currency` y `subtotal` son `null` en un carrito VACIO: sin lineas no hay
 *   moneda que declarar. No son cero; son ausencia de importe.
 * - `entry_quote` es `null` cuando no hay promocion activa contra la que
 *   cotizar. Un carrito sigue siendo valido en el periodo entre promociones, y
 *   hacer fallar la lectura impediria hasta vaciarlo. Que sea nulable y no
 *   ausente es deliberado: obliga a cada pantalla a decidir que dice cuando no
 *   hay cotizacion, en vez de dejar el hueco.
 *
 * `id` vale `00000000-0000-0000-0000-000000000000` cuando el solicitante aun no
 * tiene carrito: leer no crea nada.
 *
 * `updated_at` es el CUARTO nulable y dice una tercera cosa: no hay fila de
 * carrito. Ver su campo.
 *
 * LO QUE SIGUE SIN PUBLICARSE
 * ---------------------------
 * `is_purchasable` por variante, que HO-017 pidio junto a estos y sigue
 * pendiente para el CATALOGO (seccion 4 del contrato). No se deduce de
 * `availability`: un articulo retirado de la venta es otra pregunta.
 */
export interface CartWithQuote {
  readonly id: string;
  /** ISO-4217. `null` en un carrito vacio. */
  readonly currency: string | null;
  /**
   * Instante de la ULTIMA MUTACION del carrito, lineas incluidas. ISO-8601 UTC.
   *
   * Lo pone el motor, no el reloj del proceso que responde. Vale `null` SOLO en
   * el carrito vacio sintetico: ahi no existe fila, y devolver `now()` seria
   * afirmar que un carrito inexistente acaba de cambiar. La interfaz lo pinta
   * como AUSENCIA -no como el 1 de enero de 1970, que es lo que produce
   * `new Date(null)`-.
   */
  readonly updated_at: string | null;
  /**
   * Suma de `quantity` de las lineas. Entero, `0` -nunca `null`- en un carrito
   * vacio.
   *
   * NO es el numero de lineas: dos unidades de la misma variante son una linea
   * y cuentan dos. Y no entra en ninguna aritmetica de participaciones; es una
   * cuenta de mercancia. La interfaz lo PINTA: contarlo en el cliente a partir
   * de `lines` daria otra cifra en cuanto el backend pagine las lineas.
   */
  readonly item_count: number;
  readonly lines: readonly CartLine[];
  /** Subtotal CALCULADO POR EL BACKEND. `null` en un carrito vacio. */
  readonly subtotal: MoneyMinor | null;
  readonly entry_quote: EntryQuote | null;
}

// ---------------------------------------------------------------------------
// Configuracion publica
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Modalidad de participacion gratuita (DEC-032).
 *
 * Es un ENUM y no un booleano porque cada modalidad exige una pantalla
 * distinta: un formulario en linea, instrucciones de envio postal, un codigo, o
 * una remision a instrucciones externas. Con un booleano la interfaz sabria que
 * existe una via gratuita pero no cual renderizar.
 *
 * No existe el valor `DISABLED`: si hay via AMOE lo responde `amoe_enabled` y
 * solo el. Cual es la modalidad legalmente valida lo decide el abogado del
 * cliente. El frontend solo sabe pintar la que le digan (CLAUDE.md #1 y #2).
 */
export type AmoeMode = "ONLINE_FORM" | "MAIL_IN_REVIEW" | "CODE" | "EXTERNAL_INSTRUCTIONS";

export const AMOE_MODES: readonly AmoeMode[] = [
  "ONLINE_FORM",
  "MAIL_IN_REVIEW",
  "CODE",
  "EXTERNAL_INSTRUCTIONS",
];

/**
 * [CONTRATO] Feature flags legalmente materiales (DEC-032).
 *
 * Lista canonica y cerrada, las 12 claves que publica `GET /config`.
 * `snake_case`, persistidos en base de datos (DEC-013), leidos EN EL SERVIDOR
 * en la misma peticion que el render, y nunca desde variables de entorno del
 * navegador.
 *
 * Al ser una union cerrada, cualquier discrepancia con el backend es un error
 * de compilacion y no un flag silenciosamente ignorado.
 *
 * `amoe_mode` NO esta aqui: es un enum, no un booleano, y viaja aparte.
 */
export type FeatureFlagKey =
  | "amoe_enabled"
  | "visible_entry_numbers_enabled"
  | "internal_draw_enabled"
  | "state_eligibility_enforcement_enabled"
  | "age_gate_enabled"
  | "entry_multipliers_enabled"
  | "entry_caps_enabled"
  | "entry_expiration_enabled"
  | "winner_publication_enabled"
  | "manual_adjustments_enabled"
  | "provisional_entries_enabled"
  | "dual_approval_for_sensitive_actions_enabled";

export const FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  "amoe_enabled",
  "visible_entry_numbers_enabled",
  "internal_draw_enabled",
  "state_eligibility_enforcement_enabled",
  "age_gate_enabled",
  "entry_multipliers_enabled",
  "entry_caps_enabled",
  "entry_expiration_enabled",
  "winner_publication_enabled",
  "manual_adjustments_enabled",
  "provisional_entries_enabled",
  "dual_approval_for_sensitive_actions_enabled",
];

/**
 * [CONTRATO] Configuracion publica del sitio (`GET /config`).
 *
 * Solo contiene lo que la interfaz necesita para decidir que pintar. Ninguna
 * regla legal: ni edad minima, ni estados elegibles, ni ratios.
 *
 * `feature_flags` se tipa como `Partial` a proposito aunque el contrato prometa
 * las 12: la interfaz tiene que sobrevivir a una respuesta incompleta cayendo
 * en el valor SEGURO de cada flag, no en `undefined`.
 */
export interface SiteConfigResponse {
  readonly feature_flags: Partial<Record<FeatureFlagKey, boolean>>;
  /**
   * Modalidad AMOE vigente. `null` cuando no hay ninguna configurada, que es lo
   * normal mientras `amoe_enabled` este apagado.
   */
  readonly amoe_mode: AmoeMode | null;
  /** Locales que el backend declara soportados, en etiquetas BCP-47. */
  readonly supported_locales: readonly string[];
  /**
   * [PROVISIONAL] Consentimientos que exige el alta.
   *
   * PETICION ADITIVA a `backend`, no una reescritura del contrato: el campo es
   * OPCIONAL, de modo que la respuesta que `docs/API_CONTRACT.md` publica hoy
   * -sin este campo- sigue siendo valida y la interfaz sigue funcionando.
   *
   * Ausente o vacio significa QUE NO SE PIDE NINGUNO, y el formulario de alta no
   * pinta ninguna casilla. Es deliberadamente esa la direccion segura: la
   * alternativa -que el frontend escriba de su cosecha un "acepto las Reglas
   * Oficiales" cuando el backend calla- seria inventar un requisito legal, que
   * es justo lo que CLAUDE.md #2 prohibe. Que existan consentimientos y cuales
   * sean lo decide el abogado del cliente y lo publica el backend.
   */
  readonly required_consents?: readonly ConsentRequirement[];
}

/**
 * [CONTRATO] Envelope de error global (DEC-022, DEC-031).
 *
 * DEC-031 elimina `message_key` del contrato: `code` ES la clave canonica de
 * traduccion. Tener dos campos con el mismo proposito solo garantizaba que
 * acabaran desincronizados. Aqui no hay `message_key`, ni `message_en`, ni
 * `message_es`: el backend manda un codigo y el texto es del frontend.
 *
 * `details` es siempre estructurado. Nunca prosa.
 */
export interface ApiErrorEnvelope {
  readonly error: {
    /** Enum estable. Es a la vez identificador de dominio y clave de copy. */
    readonly code: string;
    readonly details?: unknown;
    readonly request_id?: string;
  };
}

// ---------------------------------------------------------------------------
// Identidad (DEC-006, DEC-045) - seccion 10 de docs/API_CONTRACT.md
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Fase del ciclo de vida de una sesion.
 *
 * TRES ESTADOS, Y `MFA_PENDING` NO ES UNA VARIANTE DE `ACTIVE`. El documento lo
 * dice con estas palabras: es una sesion que ya paso la contrasena y "todavia
 * no vale para nada" salvo para completar el segundo factor. No es una pantalla
 * que se pueda saltar; es una sesion que AUN NO AUTENTICA.
 *
 * La consecuencia para la interfaz es concreta y hay que respetarla en cada
 * pantalla: `MFA_PENDING` NO da acceso a nada. El portal no se pinta, la
 * cabecera no ensena el menu de cuenta, y lo unico que se ofrece es completar
 * el segundo factor. Tratarlo como "casi dentro" seria abrir una puerta que el
 * backend tiene cerrada.
 */
export type SessionLifecycle = "ANONYMOUS" | "ACTIVE" | "MFA_PENDING";

export const SESSION_LIFECYCLES: readonly SessionLifecycle[] = [
  "ANONYMOUS",
  "ACTIVE",
  "MFA_PENDING",
];

/**
 * [CONTRATO] Audiencia de la sesion.
 *
 * UN SOLO SISTEMA DE IDENTIDAD, DOS POLITICAS (CLAUDE.md #4, DEC-006). No
 * existe `/admin/login`: participante y personal usan las mismas rutas, y lo
 * que cambia es la politica que decide el backend a partir de los roles -nombre
 * de cookie, `SameSite`, `Path`, TTL, inactividad y si el MFA es obligatorio-.
 *
 * El frontend NO decide nada de eso y no rellena ni un atributo de cookie: los
 * propaga tal como llegan (`session-server.ts`). Lo unico que hace con este
 * campo es saber a quien esta atendiendo.
 */
export type SessionScope = "PARTICIPANT" | "STAFF";

export const SESSION_SCOPES: readonly SessionScope[] = ["PARTICIPANT", "STAFF"];

/**
 * [CONTRATO] Estado de la sesion (`SessionState` de la seccion 10).
 *
 * Copia literal. Es la respuesta de `GET /auth/session`, de `POST /auth/login`
 * y de `POST /auth/mfa/verify`.
 *
 * `GET /auth/session` RESPONDE 200 SIEMPRE. Sin sesion devuelve `ANONYMOUS`, no
 * 401, y el documento explica por que: es lo que el frontend consulta en cada
 * render, y un 401 ahi obligaria a tratar el caso normal -un visitante- como un
 * error.
 *
 * QUE NO HAY AQUI, Y NO ES UN OLVIDO
 * ----------------------------------
 * No hay token. Ninguno. La sesion es opaca y vive en una cookie `httpOnly`; el
 * token son 43 caracteres base64url sin nada dentro, y toda la informacion esta
 * en la fila de `sessions`, que es lo que la hace revocable de verdad. Un campo
 * de token en esta interfaz seria la puerta de entrada a guardarlo en el
 * cliente, que es exactamente lo que DEC-006 prohibe.
 *
 * Tampoco hay nombre para mostrar, idioma preferido ni fecha de alta: eso es
 * PERFIL y viaja por `GET /me`, que sigue sin contrato. Esta respuesta contesta
 * "quien eres y en que estado esta tu sesion", no "como te llamas".
 *
 * `email_verified` SE PUBLICA COMO DATO Y NADA MAS. El propio contrato lo
 * subraya: que ese dato tenga consecuencias sobre las participaciones es una
 * decision legal que todavia no existe (`docs/LEGAL_PENDING.md`). La interfaz
 * ensena el estado y ofrece verificar; no afirma ninguna consecuencia.
 */
export interface SessionState {
  readonly authenticated: boolean;
  readonly state: SessionLifecycle;
  readonly scope: SessionScope;
  /** Correo de la sesion. Cadena vacia cuando es `ANONYMOUS`. */
  readonly email: string;
  readonly email_verified: boolean;
  /** Roles del contrato. Vacio para un participante sin rol de personal. */
  readonly roles: readonly string[];
  /**
   * [PROVISIONAL] Capacidades EFECTIVAS del actor (DEC-048).
   *
   * PETICION ADITIVA a `backend`, no una reescritura: el campo es OPCIONAL, de
   * modo que la respuesta que la seccion 10 publica hoy -sin el- sigue siendo
   * valida y el panel sigue funcionando.
   *
   * POR QUE SE PIDE. El mapa rol -> capacidad ya existe y es autoritativo:
   * `ROLE_CAPABILITIES` en `packages/security/src/permissions.ts`. Que el
   * frontend lo reimplemente es crear una segunda fuente de verdad de una
   * politica de AUTORIZACION, que es justo lo que prohibe `CLAUDE.md` seccion 4.
   * Resolverlo en el backend -donde ya esta- y publicar el resultado cuesta un
   * campo y elimina la divergencia por construccion.
   *
   * MIENTRAS NO EXISTA, el panel cae a un espejo local de esa matriz, marcado
   * como provisional en `src/lib/admin/capabilities.ts`. Ese espejo decide
   * unicamente QUE ENLACES SE PINTAN; quien decide que se puede hacer sigue
   * siendo el backend, que responde 403 y la interfaz lo pinta como estado
   * deliberado.
   *
   * Los valores son capacidades del contrato. Se tipa `string[]` y no
   * `AdminCapability[]` a proposito: el backend puede publicar una capacidad
   * que la interfaz todavia no conozca, y eso tiene que poder ignorarse en vez
   * de dejar de compilar contra una respuesta legitima.
   *
   * TODO(HO-031): el campo SIGUE SIN EXISTIR en la sesion que sirve la API. La
   * forma esperada cuando llegue, para que el espejo local se pueda borrar de
   * una vez y sin adivinar nada:
   *
   *   readonly capabilities: readonly string[];
   *
   * es decir, SIEMPRE PRESENTE y nunca `undefined` -asi "no publicado" y "sin
   * ninguna" dejan de ser el mismo valor-, y `[]` para un participante, que es
   * lo que hace que el panel no le ensene nada. Sirve UNICAMENTE para pintar;
   * jamas para autorizar: quien decide que se puede hacer es el backend, en cada
   * peticion, y responde 403.
   */
  readonly capabilities?: readonly string[];
}

/**
 * [CONTRATO] Respuesta de `POST /auth/logout`.
 *
 * Siempre 200 y siempre `{ ok: true }`, haya sesion o no. El documento razona
 * las dos mitades: un 401 al cerrar sesion no le sirve a nadie, y ademas
 * revelaria si la cookie presentada era valida.
 */
export interface LogoutResponse {
  readonly ok: boolean;
}

/**
 * [PROVISIONAL] Perfil del participante.
 *
 * SIGUE SIENDO PROVISIONAL aunque la seccion 10 ya sea contrato: esa seccion
 * publica la SESION, no el PERFIL. `GET /me` no esta en el documento, y el
 * nombre para mostrar, el idioma preferido y la fecha de alta tienen que salir
 * de algun sitio. Esta es la peticion concreta del frontend.
 *
 * Tampoco hay aqui fecha de nacimiento, estado de residencia ni edad. No es un
 * olvido: la elegibilidad la fijan las Official Rules y hoy sigue en
 * `docs/LEGAL_PENDING.md`. Pedir un dato personal que todavia no se sabe si
 * hace falta es recoger datos por si acaso (CLAUDE.md #2).
 */
export interface ParticipantProfile {
  readonly id: string;
  readonly email: string;
  /** Nombre para mostrar, o `null` si el participante no ha puesto ninguno. */
  readonly display_name: string | null;
  readonly email_verified: boolean;
  /**
   * Idioma preferido como ETIQUETA BCP-47 (DEC-029), o `null` si no ha elegido.
   *
   * Se tipa `string` y no la union de etiquetas: el backend puede soportar un
   * idioma que la interfaz todavia no tenga, y en ese caso hay que poder
   * tratarlo como no reconocido en vez de dejar de compilar.
   */
  readonly language_preference: string | null;
  /** Alta de la cuenta. ISO-8601 UTC. */
  readonly created_at: string;
}

/**
 * [PROVISIONAL] Consentimiento que el alta exige.
 *
 * ES LA PIEZA QUE IMPIDE HARDCODEAR LO LEGAL EN EL ALTA. La lista de casillas
 * que hay que marcar para registrarse -aceptar Reglas Oficiales, confirmar
 * elegibilidad, lo que el abogado decida- NO la decide el frontend: llega como
 * dato, cada una con su clave y su VERSION, y el formulario pinta las que le
 * manden y devuelve las que se marcaron.
 *
 * `text_key` es una clave de copy del frontend (DEC-022), no prosa del backend:
 * el texto se escribe en los dos diccionarios como todo lo demas. Si el backend
 * manda una clave que la interfaz no conoce, la casilla se pinta con un texto
 * generico que remite a las Reglas Oficiales -nunca con la clave en crudo- y
 * sigue siendo obligatoria.
 *
 * `version` viaja de vuelta al backend en el alta para que quede registrado QUE
 * version se acepto. Sin ella, aceptar las reglas es una afirmacion sin fecha.
 */
export interface ConsentRequirement {
  /** Identificador estable del consentimiento (`OFFICIAL_RULES`, ...). */
  readonly key: string;
  /** Version aceptada. Se devuelve tal cual en el alta. */
  readonly version: string;
  /** Clave de copy del frontend (DEC-022). */
  readonly text_key: string;
  /**
   * Si es obligatorio marcarlo para completar el alta. El backend REVALIDA: que
   * aqui llegue `false` no autoriza a la interfaz a decidir nada.
   */
  readonly required: boolean;
}

/** [PROVISIONAL] Consentimiento aceptado, tal como se envia en el alta. */
export interface ConsentAcceptance {
  readonly key: string;
  readonly version: string;
}

/**
 * [PROVISIONAL] Acuse de una accion que no devuelve recurso.
 *
 * Lo usan las cuatro rutas que SIGUEN EN TBD -registro, verificacion de correo,
 * restablecimiento de contrasena e inscripcion de MFA-, que son la fase
 * siguiente de identidad. No confundir con `LogoutResponse`, que si es contrato
 * y tiene otra forma (`{ ok: true }`): dos acuses distintos porque los publican
 * dos fases distintas, y unificarlos aqui seria inventarse la forma de la que
 * todavia no existe.
 */
export interface AcknowledgedResponse {
  readonly acknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Portal del participante (seccion 6 de docs/API_CONTRACT.md)
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Saldo de participaciones en una promocion.
 *
 * Copia literal de la respuesta de `GET /account/entry-summary`.
 *
 * COMPRA Y AMOE SON EL MISMO UNIVERSO (principio #9). `purchase_entries` y
 * `amoe_entries` son la PROCEDENCIA de un unico saldo, no dos saldos. La
 * interfaz los pinta como desglose y NO los suma: `active_entries` ya viene
 * calculado, y sumarlos aqui produciria una segunda cifra que puede discrepar
 * de la del backend en cuanto exista un tercer origen (un ajuste manual).
 *
 * El numero sale de la vista SQL de saldo, derivada del ledger. Nunca de un
 * contador editable (DEC-007).
 */
export interface EntrySummary {
  readonly promotion_id: string;
  readonly active_entries: number;
  readonly purchase_entries: number;
  readonly amoe_entries: number;
  /** Instante al que corresponde el saldo. ISO-8601 UTC. */
  readonly as_of: string;
}

/**
 * [CONTRATO] Movimiento del ledger del propio participante.
 *
 * Copia literal de un elemento de `GET /account/entry-transactions`.
 *
 * `quantity_delta` puede ser NEGATIVO, y ese es justamente el punto: una
 * devolucion es una FILA NUEVA con delta de signo contrario, no la desaparicion
 * de la original (DEC-007, principios #6 y #7). La interfaz tiene que saber
 * pintar el signo, y no puede ofrecer ninguna forma de ocultar un movimiento.
 *
 * `type`, `source_type` y `reason_key` son ENUMS ESTABLES cuyo copy es del
 * frontend (DEC-022). El contrato nombra `PURCHASE_EARNED`, `PURCHASE` y
 * `ORDER_QUALIFIED` como ejemplos pero NO cierra la lista, asi que se tipan
 * `string` y se traducen con el patron de lista explicita mas generico: un
 * valor nuevo produce una frase util, nunca una clave tecnica en pantalla.
 */
export interface EntryTransaction {
  readonly id: string;
  readonly type: string;
  readonly source_type: string;
  /** Entero con signo (DEC-010). Negativo en las correcciones. */
  readonly quantity_delta: number;
  readonly reason_key: string;
  /** Instante en que el movimiento surte efecto. ISO-8601 UTC. */
  readonly effective_at: string;
  /** Transaccion que este movimiento revierte, o `null`. */
  readonly reverses_transaction_id: string | null;
}

export type EntryTransactionPage = CursorPage<EntryTransaction>;

/**
 * [CONTRATO] Rango de numeros asignado al participante.
 *
 * Copia literal de un elemento de `GET /account/entry-numbers`.
 *
 * LOS NUMEROS SON CADENAS, jamas numeros (DEC-010). `LSW26-000450001` no es un
 * entero, y aunque lo fuera, un identificador que se formatea con separador de
 * miles deja de ser el identificador.
 *
 * Toda la ruta esta detras de `visible_entry_numbers_enabled`, apagado. Con el
 * flag apagado el backend responde 404 -los rangos se asignan igual, para que
 * sean reconstruibles hacia atras, pero no se muestran-, asi que la interfaz NO
 * pide este recurso salvo que el flag este encendido.
 *
 * AVISO que el contrato repite y aqui se repite tambien: la secuencia de
 * numeros NO es el algoritmo del sorteo. Que existan numeros no autoriza a
 * sortear sobre ellos (DEC-017, principio #11).
 */
export interface EntryBatch {
  readonly batch_id: string;
  readonly quantity: number;
  /** Primer numero del rango. CADENA (DEC-010). */
  readonly first_number: string;
  /** Ultimo numero del rango. CADENA (DEC-010). */
  readonly last_number: string;
}

export type EntryBatchPage = CursorPage<EntryBatch>;

/**
 * [PROVISIONAL] Estado de un pedido.
 *
 * El contrato nombra `OrderSummary` y `OrderDetail` como respuestas de la
 * seccion 6 pero no publica su forma. Este enum es la peticion del frontend.
 *
 * `CHARGEBACK` existe separado de `REFUNDED` porque no son lo mismo para quien
 * mira su pedido -uno lo pidio el participante y el otro su banco- y porque las
 * Official Rules pueden tratarlos distinto.
 */
export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PAID"
  | "FULFILLED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "CHARGEBACK";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "FULFILLED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
];

/**
 * [PROVISIONAL] Estado de las participaciones asociadas a un pedido.
 *
 * ES UN CAMPO APARTE DE `status` A PROPOSITO. Que el pedido este pagado y que
 * las participaciones esten otorgadas no son la misma afirmacion y no ocurren
 * en el mismo instante: las entries se generan cuando la orden alcanza el
 * estado que las Official Rules definan como cualificante, a partir de la
 * confirmacion del proveedor de pago, y NUNCA cuando el navegador llega a una
 * pagina de exito. Si la interfaz dedujera una cosa de la otra, prometeria en
 * la pagina de confirmacion algo que el backend todavia no ha dicho.
 *
 * - `NOT_APPLICABLE` ......... el pedido no esta asociado a ninguna promocion.
 * - `PENDING_QUALIFICATION` .. hay promocion, pero el backend aun no ha
 *   otorgado nada.
 * - `GRANTED` ................ otorgadas.
 * - `PARTIALLY_REVERSED` ..... otorgadas y revertidas en parte.
 * - `REVERSED` ............... revertidas por completo.
 */
export type OrderEntryState =
  "NOT_APPLICABLE" | "PENDING_QUALIFICATION" | "GRANTED" | "PARTIALLY_REVERSED" | "REVERSED";

export const ORDER_ENTRY_STATES: readonly OrderEntryState[] = [
  "NOT_APPLICABLE",
  "PENDING_QUALIFICATION",
  "GRANTED",
  "PARTIALLY_REVERSED",
  "REVERSED",
];

/** [PROVISIONAL] Pedido en el listado del participante. */
export interface OrderSummary {
  readonly id: string;
  /** Numero visible del pedido. Es una CADENA: no se formatea como cifra. */
  readonly order_number: string;
  readonly status: OrderStatus;
  /** Instante del pedido. ISO-8601 UTC. */
  readonly placed_at: string;
  /** Total CALCULADO POR EL BACKEND. */
  readonly total: MoneyMinor;
  readonly item_count: number;
  /** Promocion a la que quedo asociado, o `null`. */
  readonly promotion_id: string | null;
  readonly entry_state: OrderEntryState;
  /**
   * Participaciones VIGENTES de este pedido, servidas por el backend.
   *
   * `null` mientras no haya cifra -pedido pendiente, o sin promocion-. No es
   * `0`: que no se sepa todavia y que sean cero son dos afirmaciones distintas
   * delante de alguien que acaba de comprar.
   */
  readonly entries_granted: number | null;
}

/** [PROVISIONAL] Linea de un pedido. */
export interface OrderLine {
  readonly line_id: string;
  readonly sku: string;
  readonly product_slug: string;
  readonly product_name: LocalizedText;
  readonly variant_name: LocalizedText;
  readonly image_url: string | null;
  readonly quantity: number;
  readonly unit_price: MoneyMinor;
  /** Total de linea CALCULADO POR EL BACKEND. */
  readonly line_total: MoneyMinor;
}

/**
 * [PROVISIONAL] Direccion postal.
 *
 * SIN NINGUNA REGLA DE JURISDICCION. No hay lista de estados, ni validacion de
 * codigo postal, ni pais por defecto: la elegibilidad territorial la fijan las
 * Official Rules y sigue en `docs/LEGAL_PENDING.md`. La interfaz recoge lo que
 * el participante escribe y el backend valida (CLAUDE.md #2 y #14).
 *
 * `region` y no `state`: el nombre del campo tampoco debe presuponer que la
 * subdivision territorial se llama estado en toda jurisdiccion cubierta.
 */
export interface PostalAddress {
  readonly full_name: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string;
  readonly postal_code: string;
  readonly country: string;
}

/**
 * [PROVISIONAL] Traza del calculo de participaciones que produjo un pedido.
 *
 * El contrato la describe con estas palabras: `entry_calculation` con
 * `rules_version_id`, `engine_version` y el desglose que se persistio en el
 * `EntryCalculationSnapshot`. Es lo que permite responder por que esta compra
 * genero 37 entries y no 36 meses despues, cuando el catalogo y las reglas ya
 * han cambiado.
 *
 * Los campos son los mismos que los de `EntryQuote` porque describen lo mismo
 * -una evaluacion de las reglas- pero NO es el mismo objeto: una cotizacion es
 * orientativa y se recalcula, y un snapshot es historico e inmutable. Se
 * declara aparte para que nadie use uno donde va el otro.
 */
export interface EntryCalculationSnapshot {
  readonly rules_version_id: string;
  readonly engine_version: number;
  /** Instante de la evaluacion persistida. ISO-8601 UTC. */
  readonly evaluated_at: string;
  readonly eligible_subtotal: MoneyMinor;
  readonly entries_before_caps: number;
  readonly final_entries: number;
  readonly eligible_items: readonly EntryQuoteEligibleItem[];
  readonly ineligible_items: readonly EntryQuoteIneligibleItem[];
  readonly applied_multipliers: readonly EntryQuoteAppliedMultiplier[];
  readonly applied_caps: readonly EntryQuoteAppliedCap[];
}

/** [PROVISIONAL] Detalle de un pedido. */
export interface OrderDetail extends OrderSummary {
  readonly items: readonly OrderLine[];
  readonly subtotal: MoneyMinor;
  /** Envio, o `null` si todavia no esta determinado. */
  readonly shipping_total: MoneyMinor | null;
  /** Impuestos, o `null` si todavia no estan determinados. */
  readonly tax_total: MoneyMinor | null;
  readonly shipping_address: PostalAddress | null;
  /** Traza del calculo, o `null` si el pedido no ha generado ninguna. */
  readonly entry_calculation: EntryCalculationSnapshot | null;
}

export type OrderPage = CursorPage<OrderSummary>;

// ---------------------------------------------------------------------------
// Checkout (adaptador agnostico de proveedor de pago)
// ---------------------------------------------------------------------------

/**
 * [PROVISIONAL] Como se cobra.
 *
 * EL PROVEEDOR DE PAGO NO ESTA DECIDIDO. Es un DEC pendiente del usuario, y
 * hasta que exista no puede haber en el frontend ni una linea que presuponga
 * Stripe, Shopify Payments ni ningun otro. Por eso el checkout se modela como
 * un ADAPTADOR: el backend dice como se cobra y la interfaz sabe pintar las dos
 * formas que existen en el mercado.
 *
 * - `hosted_redirect` .... el proveedor tiene su propia pagina. Se sale del
 *   sitio, se paga alli y se vuelve a la URL de retorno. Implementada.
 * - `embedded_component` . el proveedor da un componente que se monta dentro de
 *   la pagina. Es el punto de extension: la rama existe y esta documentada,
 *   pero no se implementa contra un proveedor imaginario.
 *
 * Ninguna de las dos implica que el navegador vea nunca un numero de tarjeta:
 * en la primera no pasa por aqui, y en la segunda lo recoge el componente del
 * proveedor dentro de su propio contexto.
 */
export type CheckoutMode = "hosted_redirect" | "embedded_component";

export const CHECKOUT_MODES: readonly CheckoutMode[] = ["hosted_redirect", "embedded_component"];

/**
 * [PROVISIONAL] Apertura de una sesion de pago.
 *
 * `client_config` es DELIBERADAMENTE OPACO. Cada proveedor necesita cosas
 * distintas -una URL, una clave publicable, un identificador de sesion- y
 * tiparlo aqui obligaria a elegir proveedor, que es exactamente la decision que
 * no esta tomada. La interfaz solo lee las claves que necesita la modalidad que
 * sabe pintar, y comprueba su tipo en tiempo de ejecucion antes de usarlas.
 *
 * `order_draft_id` identifica el BORRADOR de pedido. No es el pedido: el pedido
 * lo crea el backend cuando el pago se confirma, y hasta entonces no hay nada
 * que ensenar en el historial.
 */
export interface CheckoutSessionResponse {
  /** Nombre del proveedor, para poder decirlo y para la traza. */
  readonly provider: string;
  readonly mode: CheckoutMode;
  readonly client_config: Record<string, unknown>;
  readonly order_draft_id: string;
}

/**
 * [PROVISIONAL] Estado de una sesion de pago.
 *
 * LA INTERFAZ NO DECIDE SI SE HA PAGADO. La pagina de retorno recibe del
 * proveedor unos parametros en la URL y NO se los cree: pregunta al backend,
 * que es quien ha recibido -o no- el webhook firmado. Un `?outcome=paid` en la
 * barra de direcciones lo escribe cualquiera.
 */
export type CheckoutSessionStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "FAILED";

export const CHECKOUT_SESSION_STATUSES: readonly CheckoutSessionStatus[] = [
  "PENDING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
];

/** [PROVISIONAL] Respuesta de `GET /checkout/sessions/{order_draft_id}`. */
export interface CheckoutSessionState {
  readonly order_draft_id: string;
  readonly status: CheckoutSessionStatus;
  /**
   * Pedido resultante, o `null` mientras no exista. Que sea nulable con
   * `status: "COMPLETED"` es posible y hay que saber pintarlo: el pago puede
   * estar confirmado y el pedido tardar un instante en materializarse.
   */
  readonly order_id: string | null;
}

// ---------------------------------------------------------------------------
// AMOE - via gratuita de participacion (seccion 7 de docs/API_CONTRACT.md)
// ---------------------------------------------------------------------------

/**
 * [CONTRATO parcial] Ventana de envio de participaciones gratuitas.
 *
 * Las dos fechas son ISO-8601 UTC y pueden ser `null`: una modalidad puede no
 * declarar apertura, cierre, o ninguna de las dos. La interfaz NO deduce de
 * ellas si la ventana esta abierta -eso lo decide el backend y lo dice
 * rechazando el envio con `AMOE_WINDOW_CLOSED`-; solo las muestra.
 *
 * Que el reloj del navegador no decida esto es DEC-011 aplicado al caso mas
 * caro: una ventana que el navegador cree abierta y el backend cerrada produce
 * un formulario que se rellena entero para acabar rechazado.
 */
export interface AmoeSubmissionWindow {
  readonly opens_at: string | null;
  readonly closes_at: string | null;
}

/**
 * [CONTRATO] Tipo de un campo del formulario AMOE (`docs/API_CONTRACT.md` 11.3).
 *
 * MAYUSCULAS, y no es cosmetico: son los valores que sirve la API
 * (`AMOE_FIELD_TYPES` del dominio). El enum del cable se escribe una vez y se
 * compara sin normalizar; un `toLowerCase()` de cortesia en el camino seria el
 * sitio donde un valor nuevo del backend se convertiria en silencio en otro
 * conocido.
 *
 * Gobierna QUE control se pinta y que teclado abre un telefono. No gobierna
 * ninguna validacion legal: no hay aqui longitudes minimas, ni formatos de
 * codigo postal, ni edades. El backend revalida y es quien decide.
 */
export type AmoeFieldType = "TEXT" | "EMAIL" | "TEL" | "TEXTAREA" | "DATE" | "CODE";

export const AMOE_FIELD_TYPES: readonly AmoeFieldType[] = [
  "TEXT",
  "EMAIL",
  "TEL",
  "TEXTAREA",
  "DATE",
  "CODE",
];

/**
 * [CONTRATO] Campo que el formulario AMOE tiene que pedir.
 *
 * ES LA PIEZA QUE IMPIDE QUE EL FRONTEND INVENTE EL FORMULARIO. Que datos se
 * piden para participar sin comprar es materia de las Official Rules
 * (CLAUDE.md #1 y #2): la interfaz pinta EXACTAMENTE los campos que llegan en
 * `required_fields`, en el orden que llegan, y ni uno mas. Un formulario con un
 * campo de mas es recogida de datos personales que nadie autorizo; con uno de
 * menos, un envio que el backend rechazara con `AMOE_PAYLOAD_INVALID`.
 *
 * `key` es el nombre con el que el dato viaja en el `payload` del envio, y sale
 * de `identity_requirements` una a una y en ese orden. NO es la etiqueta.
 *
 * `label_key` es una CLAVE DE COPY DEL FRONTEND (DEC-022), no prosa del
 * backend, exactamente igual que `ConsentRequirement.text_key`. Llega SIN
 * namespace (`fullName`, `postalCode`, `code`) y su valor por defecto en el
 * backend es la propia `key`, asi que una promocion sin descriptor de
 * presentacion manda claves que la interfaz no conoce. Ese caso NO es un error:
 * el campo se pinta con una etiqueta generica -nunca con la clave en crudo- y
 * se sigue enviando, porque perder el campo seria peor que etiquetarlo mal.
 */
export interface AmoeFieldSpec {
  /** Nombre del campo tal como viaja en el `payload`. */
  readonly key: string;
  readonly type: AmoeFieldType;
  /** El backend REVALIDA: que aqui llegue `false` no decide nada. */
  readonly required: boolean;
  /** Clave de copy del frontend (DEC-022), sin namespace. */
  readonly label_key: string;
  /**
   * Tope de caracteres que acepta el transporte. SIEMPRE presente -el dominio
   * pone 500 cuando la configuracion no declara otro-. Se traslada al control
   * como `maxLength` para que el navegador ayude, nunca como validacion propia.
   *
   * La interfaz lo normaliza igualmente en `@/lib/amoe-config`: un campo que
   * llegara sin el tiene que producir un control sin tope, no un `maxLength`
   * inventado ni una pantalla rota.
   */
  readonly max_length: number;
}

/**
 * [CONTRATO] Configuracion AMOE vigente
 * (`GET /promotions/{slug}/amoe-config`, `docs/API_CONTRACT.md` 11.3).
 *
 * DOS INTERRUPTORES, Y NO SON EL MISMO:
 *
 * - `enabled` dice si la via gratuita EXISTE. Es el reflejo de `amoe_enabled`
 *   (DEC-032). Apagado, todo lo demas llega en `null` SALVO `promotion_id` -que
 *   no es un parametro de AMOE, sino el dato con el que se pregunto- y la
 *   interfaz muestra un estado deliberado -"esta promocion no ofrece via
 *   gratuita"- que remite a las Reglas Oficiales. No es un error y no es una
 *   pantalla a medias.
 * - `mode` dice QUE interfaz renderizar. Es enum y no booleano precisamente
 *   porque las cuatro modalidades exigen pantallas distintas (DEC-032).
 *
 * EL CASO INTERMEDIO ES REAL: `enabled: true` con `mode: null` significa que
 * alguien encendio la funcion antes de que se publicara la modalidad. La
 * interfaz lo dice y no elige una por su cuenta.
 *
 * `instructions` ES CONTENIDO LEGALMENTE CONTROLANTE y se renderiza TAL CUAL,
 * como las Official Rules: es la excepcion de DEC-022. El frontend no redacta
 * ni una linea de las instrucciones postales, del formato del sobre, de los
 * limites por periodo ni de la direccion. Si el backend calla, la pantalla
 * remite al documento en vez de rellenar el hueco.
 */
export interface AmoeConfig {
  readonly enabled: boolean;
  readonly mode: AmoeMode | null;
  /**
   * Promocion a la que pertenece.
   *
   * VIAJA TAMBIEN CON LA VIA APAGADA, y por eso NO es senal de incoherencia
   * encontrarlo relleno junto a `enabled: false`: la ruta se pide por `slug` y
   * el envio se dirige por identificador, asi que sin este campo haria falta
   * cruzar dos peticiones para saber a que promocion se pregunto.
   */
  readonly promotion_id: string | null;
  readonly submission_window: AmoeSubmissionWindow;
  /** Texto controlante en los dos idiomas, o `null`. */
  readonly instructions: LocalizedText | null;
  /**
   * Campos que exige la modalidad, o `null`.
   *
   * LLEGAN EN LAS CUATRO MODALIDADES, no solo en `ONLINE_FORM`: el dominio
   * exige esas claves en cualquier envio que entre por la API, asi que la
   * respuesta las publica siempre que la via este encendida. QUE MODALIDAD
   * PINTA UN FORMULARIO LO DECIDE LA INTERFAZ (`AmoeModePanel`), no la
   * presencia de esta lista: unas instrucciones postales con campos declarados
   * siguen siendo un envio por correo, y un boton ahi sugeriria lo contrario.
   */
  readonly required_fields: readonly AmoeFieldSpec[] | null;
  /**
   * Destino externo, o `null`. Lo usa `EXTERNAL_INSTRUCTIONS`.
   *
   * El backend ya lo valida al leer la configuracion -solo `https:`, y una
   * promocion con otro esquema se rompe con `409 AMOE_CONFIG_INVALID` en vez de
   * llegar a un navegador-. La interfaz LO VUELVE A VALIDAR antes de pintarlo
   * como enlace, y esa duplicidad es deliberada: un `javascript:` renderizado
   * como `href` es ejecucion de codigo de terceros en la pagina, y el precio de
   * comprobarlo dos veces es una llamada a `new URL`.
   */
  readonly external_url: string | null;
}

/**
 * [PROVISIONAL] Estado de un envio AMOE.
 *
 * CINCO ESTADOS, y la lista incluye a proposito los dos nombres que hoy conviven
 * en la documentacion: `docs/API_CONTRACT.md` publica `SUBMITTED` como respuesta
 * de creacion, y la revision de este hito pidio `PENDING_REVIEW`. Aceptar los
 * dos cuesta una entrada de union y evita que un cambio de nombre en el backend
 * deje la pantalla sin saber que pintar. Cuando el backend cierre cual es, se
 * borra el otro.
 */
export type AmoeSubmissionStatus =
  "SUBMITTED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED";

export const AMOE_SUBMISSION_STATUSES: readonly AmoeSubmissionStatus[] = [
  "SUBMITTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

/**
 * [CONTRATO] Respuesta a un envio AMOE
 * (`POST /promotions/{promotion_id}/amoe-submissions`).
 *
 * EL CAMPO SE LLAMA `entries_awarded` EN LAS TRES FORMAS AMOE -esta respuesta,
 * el listado del participante y la cola de revision-. No es `entries` ni
 * `entries_granted`; `entries_granted` es de `OrderSummary` y ahi se queda.
 * Tener dos nombres para la misma cifra segun quien la mire es como se acaba
 * pintando `undefined` en la pantalla de alguien que participo sin comprar.
 *
 * Puede ser `null` y ESO NO ES UN OLVIDO: una modalidad con revision manual no
 * otorga participaciones en el momento del envio, y prometer una cifra que
 * todavia no existe seria afirmar algo sobre el resultado de una revision que
 * no ha ocurrido. Solo se muestra cuando el backend la manda.
 *
 * La aprobacion crea una TRANSACCION DEL LEDGER con `source_type: "AMOE"`.
 * Nunca incrementa un contador (DEC-007, principio #9).
 */
export interface AmoeSubmissionResponse {
  readonly submission_id: string;
  readonly status: AmoeSubmissionStatus;
  /** Participaciones otorgadas, cuando la modalidad las otorga al instante. */
  readonly entries_awarded: number | null;
}

/**
 * [PROVISIONAL] Envio AMOE del propio participante
 * (`GET /account/amoe-submissions`).
 *
 * `reason_key` es un ENUM ESTABLE cuyo copy es del frontend (DEC-022). Se tipa
 * `string` porque la lista no esta cerrada: un motivo nuevo tiene que producir
 * una frase util, jamas una clave tecnica en pantalla.
 *
 * `cancellable` LO DECIDE EL BACKEND. La interfaz no deduce de un estado si un
 * envio se puede retirar -eso depende de la ventana, de la modalidad y de las
 * Official Rules- y por eso el dato viaja explicito.
 *
 * TODO(HO-031): la API nombra el identificador `submission_id` en las tres
 * formas AMOE, no `id`. Aqui sigue siendo `id` porque `decided_at`,
 * `reason_key` y `cancellable` -que la respuesta publicada tampoco trae- siguen
 * siendo peticiones abiertas a `backend`, y renombrar la mitad de una forma que
 * todavia se va a cerrar entera solo repartiria el cambio en dos pasadas.
 * Cuando esos tres campos se cierren, esta interfaz se alinea de una vez.
 */
export interface AmoeSubmission {
  readonly id: string;
  readonly promotion_id: string;
  readonly status: AmoeSubmissionStatus;
  /** ISO-8601 UTC. */
  readonly submitted_at: string;
  /** [PROVISIONAL] Instante de la decision, o `null` si sigue en revision. */
  readonly decided_at: string | null;
  /** [PROVISIONAL] Motivo del rechazo, como clave estable. `null` si no lo hubo. */
  readonly reason_key: string | null;
  /** Participaciones otorgadas por este envio, o `null`. */
  readonly entries_awarded: number | null;
  /** [PROVISIONAL] Si el backend admite retirarlo. */
  readonly cancellable: boolean;
}

export type AmoeSubmissionPage = CursorPage<AmoeSubmission>;

// ---------------------------------------------------------------------------
// Panel de administracion (seccion 8 de docs/API_CONTRACT.md, DEC-048)
// ---------------------------------------------------------------------------

/**
 * [CONTRATO] Capacidades del panel.
 *
 * LAS CAPACIDADES SON DATOS, NO RAMAS DE CODIGO. En todo el panel la pregunta
 * es "este actor tiene esta capacidad", jamas "este actor es administrador":
 * no existe un rol que pueda todo, y `packages/security` lo dice con esas
 * palabras (deny-by-default, sin comodines).
 *
 * Esta union es la de la columna `Authorization` de la seccion 8 del contrato,
 * mas el dominio de exportacion y sorteo, que es de `security-integration` y
 * todavia no tiene seccion propia. Al ser cerrada, una capacidad que el backend
 * invente y el frontend no conozca deja de compilar en vez de pintar un enlace
 * a una pantalla que nadie puede abrir.
 *
 * LO QUE ESTA LISTA NO ES: una politica de autorizacion. Decide QUE SE PINTA,
 * no QUE SE PUEDE HACER. El backend revalida cada peticion y responde 403; la
 * interfaz pinta ese 403 como un estado deliberado, no como un fallo.
 */
export type AdminCapability =
  | "dashboard.read"
  | "promotion.read"
  | "promotion.create"
  | "promotion.update"
  | "promotion.activate"
  | "promotion.close"
  | "rules.version.read"
  | "rules.version.create"
  | "rules.version.activate"
  | "product.read"
  | "product.write"
  | "product.publish"
  | "participant.list"
  | "participant.read"
  | "participant.disqualify"
  | "pii.view.masked"
  | "pii.view.full"
  | "order.read"
  | "order.refund.initiate"
  | "entry.ledger.read"
  | "entry.adjust.create"
  | "entry.adjust.approve"
  | "amoe.review.read"
  | "amoe.review.approve"
  | "amoe.review.reject"
  | "payment.webhook.read"
  | "reconciliation.read"
  | "flag.read"
  | "flag.update"
  | "flag.update.legally_material"
  | "audit.read"
  | "audit.integrity.verify"
  | "export.snapshot.read"
  | "export.snapshot.create"
  | "export.snapshot.validate"
  | "export.finalize"
  | "export.download"
  | "export.deliver"
  | "draw.authorization.create"
  | "draw.initiate"
  | "draw.result.read"
  | "winner.workflow.read"
  | "rbac.admin.read";

export const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  "dashboard.read",
  "promotion.read",
  "promotion.create",
  "promotion.update",
  "promotion.activate",
  "promotion.close",
  "rules.version.read",
  "rules.version.create",
  "rules.version.activate",
  "product.read",
  "product.write",
  "product.publish",
  "participant.list",
  "participant.read",
  "participant.disqualify",
  "pii.view.masked",
  "pii.view.full",
  "order.read",
  "order.refund.initiate",
  "entry.ledger.read",
  "entry.adjust.create",
  "entry.adjust.approve",
  "amoe.review.read",
  "amoe.review.approve",
  "amoe.review.reject",
  "payment.webhook.read",
  "reconciliation.read",
  "flag.read",
  "flag.update",
  "flag.update.legally_material",
  "audit.read",
  "audit.integrity.verify",
  "export.snapshot.read",
  "export.snapshot.create",
  "export.snapshot.validate",
  "export.finalize",
  "export.download",
  "export.deliver",
  "draw.authorization.create",
  "draw.initiate",
  "draw.result.read",
  "winner.workflow.read",
  "rbac.admin.read",
];

/**
 * [CONTRATO] Cifras de cabecera del panel (`GET /admin/dashboard`, seccion 11.7).
 *
 * NINGUNA SE CALCULA AQUI. Son lecturas: el saldo vivo del ledger, cuantos
 * envios AMOE esperan revision, cuantos ajustes esperan segunda aprobacion.
 * Que la suma de dos de ellas de una tercera es coincidencia del fixture, no
 * una relacion que la interfaz pueda usar (DEC-023, requisito R13).
 *
 * TODAS SE REFIEREN AL MISMO INSTANTE, `as_of`. No son seis lecturas tomadas a
 * ratos, y por eso el instante es un campo y se pinta.
 *
 * `null` NO ES CERO, Y HAY DOS MOTIVOS DISTINTOS PARA UN `null`
 * ------------------------------------------------------------
 * 1. `promotion_id` y `promotion_status` son `null` cuando no hay ninguna
 *    promocion `ACTIVE`. Los conteos entonces no se acotan por promocion.
 * 2. `active_entries` y `participants` son cifras DEL LEDGER, y
 *    `dashboard.read` no las cubre: se pueblan solo si el actor tiene ADEMAS
 *    `entry.ledger.read`. Sin esa capacidad llegan `null`, que significa "no
 *    publicado" y no "cero".
 *
 * Pintar un `0` en cualquiera de los dos casos seria una afirmacion distinta y
 * falsa: "no hay participaciones activas" en vez de "no puedo decirtelo".
 *
 * `participants` cuenta participantes CON SALDO ACTIVO distinto de cero en la
 * promocion. No es el censo de cuentas registradas, y la etiqueta de la pantalla
 * tiene que decirlo.
 */
export interface AdminDashboard {
  readonly promotion_id: string | null;
  readonly promotion_status: PromotionStatus | null;
  /** Participaciones activas de la promocion. Entero (DEC-010). */
  readonly active_entries: number | null;
  readonly participants: number | null;
  readonly orders_last_24h: number | null;
  readonly amoe_pending_review: number | null;
  readonly adjustments_pending_approval: number | null;
  /** Instante al que corresponden las cifras. ISO-8601 UTC. */
  readonly as_of: string;
}

/**
 * [PROVISIONAL] Estado de una version de reglas (DEC-012).
 *
 * Tres estados y una transicion con cerrojo. `DRAFT` a `ACTIVE` es la unica que
 * importa aqui, y esta bloqueada mientras quede una clave requerida en estado
 * provisional o `TBD`.
 */
export type RulesVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export const RULES_VERSION_STATUSES: readonly RulesVersionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
];

/**
 * [PROVISIONAL] Version de reglas con el VEREDICTO DEL VALIDADOR DE ACTIVACION
 * (DEC-012).
 *
 * `missing_keys` ES LA PIEZA IMPORTANTE DE TODO ESTE OBJETO. DEC-012 dice que
 * una promocion no transiciona a `ACTIVE` mientras exista una clave requerida
 * en estado provisional o `TBD`, y que el validador "devuelve la lista de claves
 * faltantes". Esa lista se pinta: sin ella, el boton de activar estaria gris
 * sin decir por que, y la respuesta a "por que no puedo activar" seria mirar
 * logs.
 *
 * `activatable` lo decide EL BACKEND y no se deriva de `missing_keys.length`.
 * Puede haber mas condiciones que las claves -una promocion ya activa, una
 * ventana cerrada- y deducirlo aqui seria reimplementar el cerrojo en el
 * frontend, que es exactamente lo que DEC-012 quiere que viva en un solo sitio.
 *
 * Las claves son IDENTIFICADORES ESTABLES (`minimum_age`, `eligible_states`,
 * ...), no prosa: el copy es del frontend (DEC-022) y una clave sin traducir se
 * muestra con una etiqueta generica mas su identificador tecnico, porque aqui
 * el identificador SI le sirve a quien opera.
 */
export interface AdminRulesVersion {
  readonly id: string;
  readonly version: number;
  readonly status: RulesVersionStatus;
  /** ISO-8601 UTC, o `null` mientras siga en borrador. */
  readonly effective_at: string | null;
  readonly created_at: string;
  /** Claves requeridas que siguen provisionales o en `TBD` (DEC-012). */
  readonly missing_keys: readonly string[];
  /** Veredicto del validador de activacion. Lo decide el backend. */
  readonly activatable: boolean;
}

export type AdminRulesVersionPage = CursorPage<AdminRulesVersion>;

/** [PROVISIONAL] Fila del listado de promociones del panel. */
export interface AdminPromotionRow {
  readonly id: string;
  readonly slug: string;
  readonly status: PromotionStatus;
  readonly title: LocalizedText;
  readonly legal_timezone: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly rules_version_id: string | null;
  /** Version de reglas vigente, ya resuelta. `null` si no hay ninguna. */
  readonly active_rules_version: number | null;
}

export type AdminPromotionPage = CursorPage<AdminPromotionRow>;

/** [PROVISIONAL] Fila del catalogo en el panel. */
export interface AdminProductRow {
  readonly id: string;
  readonly slug: string;
  readonly title: LocalizedText;
  readonly published: boolean;
  readonly variant_count: number;
  readonly price: MoneyMinor;
  readonly updated_at: string;
}

export type AdminProductPage = CursorPage<AdminProductRow>;

/**
 * [CONTRATO] Fila del listado de pedidos en el panel (seccion 11.7).
 *
 * La fila NO publica lineas ni direccion de envio, y no es que la pantalla no
 * las pinte: no viajan. Repartir PII a granel para una tabla que no la usa no es
 * aceptable, y el esquema de la respuesta lo impide por construccion.
 */
export interface AdminOrderRow {
  readonly id: string;
  readonly order_number: string;
  readonly status: OrderStatus;
  readonly entry_state: OrderEntryState;
  readonly placed_at: string;
  readonly total: MoneyMinor;
  /**
   * Correo del comprador, SIEMPRE ENMASCARADO (`a***@dominio`).
   *
   * No depende de la capacidad del actor: `order.read` es "ver pedidos", no una
   * capacidad de PII. El enmascarado lo hace el BACKEND -si el correo completo
   * viajara y el frontend lo tapara al pintarlo, el dato estaria en el HTML y en
   * la pestana de red de todos modos-.
   *
   * CADENA VACIA significa cuenta ANONIMIZADA: no hay correo. Es una afirmacion
   * distinta de `a***@dominio` -hay correo y esta oculto- y la pantalla tiene
   * que distinguirlas, o un hueco se leera como un dato corrupto.
   */
  readonly participant_email: string;
  readonly participant_id: string;
}

export type AdminOrderPage = CursorPage<AdminOrderRow>;

/**
 * [CONTRATO] Fila del listado de participantes en el panel (seccion 11.7).
 *
 * `disqualified` lo resuelve el backend con un `EXISTS` sobre las
 * descalificaciones, no con una columna: una columna seria una segunda fuente de
 * verdad sobre un hecho que ya esta registrado con su motivo, su actor y su
 * instante.
 */
export interface AdminParticipantRow {
  readonly id: string;
  /**
   * Correo, SIEMPRE ENMASCARADO en esta ruta (`a***@dominio`).
   *
   * CADENA VACIA significa cuenta ANONIMIZADA: no hay correo que ocultar. Las
   * dos cosas se pintan distinto a proposito.
   */
  readonly email: string;
  readonly display_name: string | null;
  readonly created_at: string;
  readonly disqualified: boolean;
  /**
   * `true` cuando el backend ha ocultado el PII de esta fila.
   *
   * EN ESTA RUTA ES SIEMPRE `true`, tenga el actor la capacidad que tenga: la
   * forma sin enmascarar vive detras de `pii.view.full`, en una RUTA APARTE
   * (`/admin/participants/{id}/pii`) que exige segundo factor reciente y motivo.
   * Que sea otra ruta y no un parametro es deliberado: un `?pii=full` dejaria al
   * cliente elegir con que permiso se le juzga.
   *
   * Se publica como DATO y no se deduce en la interfaz: asi la pantalla puede
   * decir por que ve un correo a medias en vez de parecer que el dato esta
   * corrupto. Que hoy sea constante no autoriza a darlo por supuesto.
   */
  readonly pii_masked: boolean;
}

export type AdminParticipantPage = CursorPage<AdminParticipantRow>;

/**
 * [CONTRATO parcial] Envio AMOE en la cola de revision del panel
 * (`docs/API_CONTRACT.md` 11.3).
 *
 * LA COLA PROYECTA EL EFECTO DE LA DECISION, Y LAS TRES CIFRAS LAS CALCULA EL
 * MOTOR. Quien aprueba tiene que ver antes, cambio y despues antes de causarlo,
 * y el panel no puede producir ninguna de las tres: el saldo esta en el ledger y
 * la cantidad la fija la version de reglas DEL ENVIO, no la vigente hoy. Restar
 * o sumar aqui seria una segunda implementacion del motor sobre datos parciales
 * (DEC-023, requisito R13), que es lo que detecta `no-client-entry-math`.
 *
 * NO SON ACUMULATIVAS ENTRE FILAS: cada una contesta "si apruebo ESTA".
 */
export interface AdminAmoeSubmission {
  readonly id: string;
  readonly promotion_id: string;
  readonly participant_id: string;
  readonly participant_email: string;
  readonly status: AmoeSubmissionStatus;
  readonly submitted_at: string;
  /**
   * [PROVISIONAL] Datos enviados, TAL COMO LLEGAN.
   *
   * OPCIONAL, y el documento dice por que: la cola "lleva `participant_id`
   * interno; nunca el payload", porque contiene PII y un listado de revision no
   * es el sitio donde repartirla. Se declara igualmente -no se borra- porque la
   * pantalla tiene que saber pintarlo el dia que exista una lectura autorizada
   * de un envio concreto; mientras tanto se dice que no esta publicado, en vez
   * de ensenar un hueco que parece un envio vacio.
   *
   * Mapa opaco a proposito: su forma la fija `required_fields` de la modalidad,
   * que decide el abogado del cliente, y tiparlo aqui seria fijar en el frontend
   * que se pide para participar gratis (CLAUDE.md #2). Se renderiza como TEXTO,
   * nunca como marcado: lo escribio un desconocido.
   */
  readonly payload?: Readonly<Record<string, string>>;
  /**
   * Participaciones que ya genero este envio, o `null` mientras no las haya.
   * Mismo nombre que en las otras dos formas AMOE.
   */
  readonly entries_awarded: number | null;
  /**
   * Saldo del participante ANTES de la decision. SIEMPRE numero: un
   * participante sin filas tiene cero, que es un saldo conocido y no un hueco.
   */
  readonly entries_before: number;
  /**
   * Cantidad que otorgaria la aprobacion, y saldo resultante.
   *
   * `null` -las dos- cuando la version de reglas del envio ya no declara AMOE
   * legible: la aprobacion fallaria, y una cifra que no se va a cumplir es peor
   * que ninguna. La pantalla marca entonces el "despues" como no publicado.
   */
  readonly entries_if_approved: number | null;
  readonly entries_after_if_approved: number | null;
}

export type AdminAmoeSubmissionPage = CursorPage<AdminAmoeSubmission>;

/**
 * [PROVISIONAL] Estado de un ajuste manual de participaciones.
 *
 * `PENDING_APPROVAL` es el estado normal recien creado, no una excepcion:
 * `entry.adjust.create` y `entry.adjust.approve` son capacidades DISTINTAS a
 * proposito, y el contrato lo razona en una linea que conviene no perder: un
 * ajuste que se aprueba a si mismo es una edicion del ledger con otro nombre.
 */
export type AdjustmentStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "APPLIED";

export const ADJUSTMENT_STATUSES: readonly AdjustmentStatus[] = [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "APPLIED",
];

/**
 * [PROVISIONAL] Ajuste manual de participaciones.
 *
 * `created_by_actor_id` y `approved_by_actor_id` viajan los dos porque la
 * segunda aprobacion tiene que poder COMPROBARSE en pantalla: sin los dos
 * identificadores, "lo aprobo otra persona" es una promesa y no un hecho
 * verificable por quien mira la cola.
 */
export interface AdminAdjustment {
  readonly id: string;
  readonly promotion_id: string;
  readonly participant_id: string;
  readonly participant_email: string;
  readonly status: AdjustmentStatus;
  /** Entero CON SIGNO (DEC-010). Negativo en las correcciones a la baja. */
  readonly quantity_delta: number;
  readonly reason_key: string;
  /** Nota libre de quien lo propuso. Se renderiza como texto plano. */
  readonly reason_note: string | null;
  readonly created_at: string;
  readonly created_by_actor_id: string;
  readonly created_by_actor_email: string;
  readonly approved_at: string | null;
  readonly approved_by_actor_id: string | null;
  readonly approved_by_actor_email: string | null;
}

export type AdminAdjustmentPage = CursorPage<AdminAdjustment>;

/**
 * [CONTRATO] Sentido de un ajuste manual.
 *
 * DOS CAMPOS -sentido y cantidad POSITIVA- y no un entero con signo, porque asi
 * lo pide la API. Tiene su logica: `DEBIT` es una decision que se toma, no un
 * caracter que se teclea delante de una cifra, y un menos que se pierde al
 * copiar y pegar convierte una resta en una suma sin que nada falle.
 */
export type AdjustmentDirection = "CREDIT" | "DEBIT";

export const ADJUSTMENT_DIRECTIONS: readonly AdjustmentDirection[] = ["CREDIT", "DEBIT"];

/**
 * [CONTRATO] Peticion de previsualizacion
 * (`POST /admin/entry-adjustments/preview`, `docs/API_CONTRACT.md` 11.4).
 *
 * `quantity` es POSITIVA siempre; el sentido lo lleva `direction`.
 */
export interface AdjustmentPreviewRequest {
  readonly promotion_id: string;
  readonly participant_id: string;
  readonly direction: AdjustmentDirection;
  readonly quantity: number;
}

/**
 * [CONTRATO] Previsualizacion de un ajuste
 * (`POST /admin/entry-adjustments/preview`).
 *
 * ES LA PETICION MAS IMPORTANTE DE TODO EL PANEL, y la razon es concreta: la
 * confirmacion de una mutacion sensible tiene que ensenar antes, delta y
 * despues, y EL FRONTEND NO PUEDE CALCULAR EL DESPUES. Sumar `before` y
 * `proposed_delta` seria una segunda implementacion del motor de participaciones
 * viviendo en la interfaz -el "antes" sale del predicado de saldo de DEC-034,
 * que decide que filas cuentan al corte y cuales han caducado-, que es lo que
 * prohiben DEC-023 y el requisito R13 de `security`, y lo que la red
 * `no-client-entry-math.test.ts` detecta y hace fallar.
 *
 * Asi que el despues lo publica quien sabe calcularlo. La ruta es de SOLO
 * LECTURA pese a ser `POST`: no crea fila de ledger, ni expediente, ni evento de
 * auditoria, y se puede llamar mil veces. Es `POST` unicamente porque el cuerpo
 * lleva un identificador de participante, y en un `GET` viajaria en la URL, que
 * acaba en registros de acceso y en historiales de navegador.
 *
 * CON `manual_adjustments_enabled` APAGADO RESPONDE 404, igual que crear: la
 * funcion no existe para nadie, y un 403 sugeriria que existe y que a este
 * operador no se le deja usarla.
 */
export interface AdjustmentPreview {
  /** Saldo activo al instante de la lectura. Cero es un saldo, no un vacio. */
  readonly before: number;
  /** Con signo: exactamente el que llevaria la fila del ledger (DEC-010). */
  readonly proposed_delta: number;
  /** Saldo resultante, CALCULADO POR EL BACKEND. */
  readonly after: number;
  /**
   * Si el debito dejaria el saldo negativo.
   *
   * Es LITERALMENTE la misma funcion que rechaza el ajuste al aplicarlo, no una
   * reimplementacion, para que no exista una previsualizacion en verde seguida
   * de un rechazo. La interfaz bloquea el envio cuando llega `true`: no es el
   * control -el backend rechaza igual- pero evita mandar a alguien a firmar una
   * accion que ya se sabe que va a fallar.
   */
  readonly would_make_balance_negative: boolean;
  /** Si el backend exige segunda aprobacion para este ajuste (DEC-032). */
  readonly requires_second_approval: boolean;
  /**
   * Instante de la foto, ISO-8601 UTC.
   *
   * VIAJA PORQUE UN SALDO NO ES UN HECHO PERMANENTE: entre la previsualizacion y
   * la solicitud puede entrar una compra o una descalificacion, y sin el
   * instante una pantalla abierta media hora parece hablar del presente.
   */
  readonly as_of: string;
}

/**
 * [PROVISIONAL] Estado de un snapshot de exportacion (DEC-016).
 *
 * `FINALIZED` es el punto sin retorno: a partir de ahi el contenido no cambia y
 * es lo que se le entrega al third-party administrator. Quien lo finaliza y
 * quien se lo lleva son personas distintas (`export.finalize` frente a
 * `export.download`), y por eso son dos capacidades.
 */
export type ExportSnapshotStatus =
  "DRAFT" | "VALIDATING" | "VALIDATED" | "FINALIZED" | "DELIVERED" | "FAILED";

export const EXPORT_SNAPSHOT_STATUSES: readonly ExportSnapshotStatus[] = [
  "DRAFT",
  "VALIDATING",
  "VALIDATED",
  "FINALIZED",
  "DELIVERED",
  "FAILED",
];

/** [PROVISIONAL] Snapshot de exportacion al administrador independiente. */
export interface AdminExportSnapshot {
  readonly id: string;
  readonly promotion_id: string;
  readonly status: ExportSnapshotStatus;
  readonly created_at: string;
  readonly finalized_at: string | null;
  /** Filas del dataset. No es una cifra de participaciones. */
  readonly row_count: number | null;
  /**
   * Huella del contenido finalizado. Se muestra ENTERA y monoespaciada: sirve
   * para que un tercero compare lo que recibio con lo que se genero, y una
   * huella truncada no sirve para eso.
   */
  readonly checksum: string | null;
  /** Version de reglas bajo la que se corto el dataset (DEC-012). */
  readonly rules_version_id: string | null;
}

export type AdminExportSnapshotPage = CursorPage<AdminExportSnapshot>;

/**
 * [PROVISIONAL] Aprobacion individual de una autorizacion de sorteo.
 *
 * `approvals` es una LISTA y no un contador porque la segunda aprobacion tiene
 * que ser de OTRO ACTOR, y eso solo se puede comprobar viendo quienes
 * aprobaron. Un contador diria "2 de 2" sin decir si son dos personas.
 */
export interface DrawApproval {
  readonly actor_id: string;
  readonly actor_email: string;
  readonly approved_at: string;
}

export type DrawAuthorizationStatus = "PENDING_APPROVAL" | "AUTHORIZED" | "REVOKED" | "CONSUMED";

export const DRAW_AUTHORIZATION_STATUSES: readonly DrawAuthorizationStatus[] = [
  "PENDING_APPROVAL",
  "AUTHORIZED",
  "REVOKED",
  "CONSUMED",
];

/** [PROVISIONAL] Autorizacion de sorteo (DEC-017, principio #11). */
export interface AdminDrawAuthorization {
  readonly id: string;
  readonly promotion_id: string;
  readonly status: DrawAuthorizationStatus;
  readonly created_at: string;
  readonly created_by_actor_id: string;
  readonly created_by_actor_email: string;
  readonly approvals: readonly DrawApproval[];
  /** Aprobaciones que exige el backend. Dato, no constante del frontend. */
  readonly required_approvals: number;
  /** Snapshot finalizado sobre el que se sortearia. `null` si no hay. */
  readonly export_snapshot_id: string | null;
  /**
   * Condiciones de DEC-017 que todavia no se cumplen, como claves estables. Se
   * pintan igual que `missing_keys` de una version de reglas: quien opera tiene
   * que poder leer POR QUE no se puede sortear.
   */
  readonly blocking_conditions: readonly string[];
}

export type AdminDrawAuthorizationPage = CursorPage<AdminDrawAuthorization>;

/**
 * [CONTRATO] Evento de auditoria (DEC-007, seccion 11.7).
 *
 * SOLO LECTURA, y no por convencion: no existe endpoint que edite o borre una
 * fila de auditoria, el rol de base de datos de la aplicacion no tiene el
 * privilegio, y un trigger lanza excepcion aunque lo tuviera. La interfaz no
 * ofrece ninguna accion sobre una fila.
 *
 * LO QUE NO VIENE, Y NO ES UN OLVIDO
 * ----------------------------------
 * `before`, `after`, `reason_text`, `source_ip` y `user_agent` ni siquiera se
 * seleccionan en la consulta: los tres primeros son material interno y los dos
 * ultimos huella de conexion. Ninguna pantalla puede pedirlos.
 *
 * El orden y el cursor van por `sequence_no` -el orden TOTAL de escritura- y no
 * por `occurred_at`: con empates, la paginacion se saltaria uno de los dos
 * hechos, y en una traza de auditoria un hecho que nadie llega a ver es
 * exactamente el fallo que la traza existe para impedir.
 */
export interface AdminAuditEvent {
  readonly id: string;
  /** ISO-8601 UTC. */
  readonly occurred_at: string;
  /** `HUMAN` o `SYSTEM`. Distinguirlos es el punto de la traza. */
  readonly actor_type: string;
  /** Identificador INTERNO del actor. Es lo unico que la tabla guarda de el. */
  readonly actor_id: string | null;
  /**
   * SIEMPRE `null`, y por eso ninguna pantalla lo pinta.
   *
   * La tabla de auditoria guarda `actor_id`, y su propia documentacion dice
   * "nunca un correo ni un nombre"; resolverlo en la lectura meteria en la traza
   * justo el dato que la escritura decidio no guardar. El campo existe en la
   * respuesta -esta en el esquema- y se declara aqui para que nadie lo
   * reintroduzca creyendo que falta.
   */
  readonly actor_email: string | null;
  readonly actor_roles: readonly string[];
  /** Capacidad ejercida, como clave estable. */
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly promotion_id: string | null;
  readonly reason_key: string | null;
  readonly request_id: string | null;
}

export type AdminAuditEventPage = CursorPage<AdminAuditEvent>;
