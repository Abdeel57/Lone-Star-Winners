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
// Catalogo
// ---------------------------------------------------------------------------

/**
 * [PROVISIONAL] Disponibilidad de una variante.
 *
 * Enum estable del backend; el copy es del frontend (DEC-022). `LOW_STOCK`
 * existe separado de `IN_STOCK` porque la interfaz avisa distinto, y
 * `UNAVAILABLE` separado de `OUT_OF_STOCK` porque "agotado" y "retirado de la
 * venta" no son lo mismo para quien mira la ficha.
 *
 * Aqui NO hay cantidad exacta de existencias a proposito: publicar el inventario
 * exacto es informacion de negocio que la ficha no necesita.
 */
export type VariantAvailability = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNAVAILABLE";

export const VARIANT_AVAILABILITIES: readonly VariantAvailability[] = [
  "IN_STOCK",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "UNAVAILABLE",
];

/** [PROVISIONAL] Variante comprable de un producto. */
export interface ProductVariant {
  readonly id: string;
  readonly sku: string;
  /** Nombre de la variante ("Talla M", "Size M"). Localizado (DEC-030). */
  readonly name: LocalizedText;
  readonly price: MoneyMinor;
  readonly availability: VariantAvailability;
  /**
   * Si la variante puede anadirse al carrito AHORA.
   *
   * Se manda aparte de `availability` porque no son la misma pregunta: una
   * variante puede estar en stock y no ser comprable (retirada, no publicada,
   * restringida). La interfaz no deduce una de la otra.
   */
  readonly is_purchasable: boolean;
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

/** [PROVISIONAL] Producto en el listado del catalogo. */
export interface ProductSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: LocalizedText;
  readonly summary: LocalizedText;
  /** Clave estable de categoria; el copy es del frontend (DEC-022). */
  readonly category_key: string;
  readonly image_url: string | null;
  /** Precio de la variante mas barata. */
  readonly price_from: MoneyMinor;
  /** Disponibilidad agregada del producto. */
  readonly availability: VariantAvailability;
  readonly entry_eligibility: ProductEntryEligibility | null;
}

/** [PROVISIONAL] Ficha completa de producto. */
export interface ProductDetail extends ProductSummary {
  readonly description: LocalizedText;
  readonly variants: readonly ProductVariant[];
  /** Informacion de envio, localizada. `null` si no esta configurada. */
  readonly shipping_note: LocalizedText | null;
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
 * [PROVISIONAL] Linea del carrito.
 *
 * `line_id` es la MISMA identidad que `line_id` en la cotizacion de entries.
 * Sin esa correspondencia, la interfaz no podria decir que linea concreta no es
 * elegible y tendria que dar el aviso a nivel de carrito entero.
 */
export interface CartLine {
  readonly line_id: string;
  readonly variant_id: string;
  readonly product_slug: string;
  readonly sku: string;
  readonly product_name: LocalizedText;
  readonly variant_name: LocalizedText;
  readonly image_url: string | null;
  readonly unit_price: MoneyMinor;
  readonly quantity: number;
  /** Total de linea CALCULADO POR EL BACKEND. El frontend no multiplica. */
  readonly line_total: MoneyMinor;
  readonly availability: VariantAvailability;
}

/** [PROVISIONAL] Carrito de servidor. */
export interface Cart {
  readonly id: string;
  /** Ultima modificacion del carrito. ISO-8601 UTC. */
  readonly updated_at: string;
  readonly items: readonly CartLine[];
  /** Subtotal CALCULADO POR EL BACKEND. */
  readonly subtotal: MoneyMinor;
  readonly item_count: number;
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
  readonly eligible_subtotal: MoneyMinor;
  readonly entries_before_caps: number;
  readonly final_entries: number;
  readonly eligible_items: readonly EntryQuoteEligibleItem[];
  readonly ineligible_items: readonly EntryQuoteIneligibleItem[];
  readonly applied_multipliers: readonly EntryQuoteAppliedMultiplier[];
  readonly applied_caps: readonly EntryQuoteAppliedCap[];
}

/**
 * [PROVISIONAL] Carrito con su cotizacion.
 *
 * `docs/API_CONTRACT.md` nombra `CartWithQuote` como respuesta de las cinco
 * rutas de carrito pero no publica su forma. Esta es la peticion del frontend.
 *
 * `entry_quote` es `null` cuando no hay promocion activa contra la que cotizar
 * -que es el mismo caso que devuelve `409 NO_ACTIVE_PROMOTION` en la ruta
 * dedicada-. Que sea nulable y no ausente es deliberado: obliga a cada pantalla
 * a decidir que dice cuando no hay cotizacion, en vez de dejar el hueco.
 */
export interface CartWithQuote {
  readonly cart: Cart;
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
