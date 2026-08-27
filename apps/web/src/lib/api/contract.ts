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
