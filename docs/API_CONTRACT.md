# API_CONTRACT.md

**Fuente de verdad compartida entre `frontend` y `backend`** para todas las
APIs de Lone Star Winners.

## Reglas

1. **Un agente no debe asumir una API que no esté documentada aquí.**
   Si el frontend necesita un endpoint inexistente, abre un handoff en
   `docs/AGENT_HANDOFF.md`; no lo inventa ni lo mockea como definitivo.
2. El **owner** de un endpoint es quien lo implementa y mantiene. Nadie más
   cambia su forma sin handoff.
3. **Ningún cambio de API es silencioso.** Modificar request, response,
   códigos de error o autorización obliga a actualizar esta entrada.
4. Un cambio incompatible con lo ya implementado requiere además una entrada
   en `docs/DECISIONS.md`.
5. **No se crean APIs alternativas** para evitar coordinarse.
6. Los ejemplos de request/response **no contienen datos reales** ni secretos.
7. `Status: PROPOSED` significa que el frontend puede diseñar contra el
   contrato, pero **no** asumir que existe.
8. **El campo `Authorization:` es obligatorio** en toda entrada (DEC-015), con
   el nombre exacto del permiso del catálogo de `@lsw/security`. Un test de
   contrato compara `apps/api/openapi/route-manifest.json` contra este
   documento y falla en CI si una ruta existe en código y no aquí.

## Estados

- `PROPOSED` — acordado en papel, aún no implementado.
- `IMPLEMENTED` — existe en el backend y respeta este contrato.
- `TESTED` — cubierto por pruebas y revisado por `security-integration`.

---

## Plantilla

```text
Method:
Endpoint:

Purpose:

Authentication:

Request:

Response:

Errors:

Authorization:

Owner:

Status:
PROPOSED / IMPLEMENTED / TESTED
```

---

# Convenciones transversales

Estas convenciones aplican a **todos** los endpoints y no se repiten en cada
entrada.

## Prefijo y versión

Toda ruta cuelga de `/api/v1/`. La base la publica el backend por
`API_BASE_URL`; el frontend nunca la compone a mano.

`apps/api` corre como proceso separado de `apps/web` (DEC-004). El frontend
consume por HTTP, incluso desde el servidor.

## Autorización (DEC-015)

Los valores admitidos en `Authorization:` son tres, y solo tres:

| Valor                          | Significado                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `PUBLIC`                       | Sin sesión. La ruta debe justificar por escrito por qué lo es, en el código.    |
| `PARTICIPANT_SELF`             | Sesión de participante; la ruta solo devuelve recursos del propio participante. |
| `<dominio>.<recurso>.<acción>` | Capacidad exacta del catálogo de `@lsw/security` (DEC-027).                     |

El registro central de `apps/api` es **deny-by-default**: una ruta sin
autorización declarada **no arranca el proceso**.

Ojo con el vocabulario del catálogo: es `rules.version.read` (no
`rules_version.read`), y `product.write` / `product.publish` son capacidades
distintas (editar una ficha no es decidir qué se puede comprar).

## Errores (DEC-022, DEC-031)

Envelope único, en todas las rutas y en todos los códigos:

```json
{
  "error": {
    "code": "PROMOTION_NOT_FOUND",
    "details": { "slug": "example-promotion" },
    "request_id": "01JC000000000000000000EXAMPLE"
  }
}
```

- `code` **es la clave canónica de traducción**. No existe `message_key`, ni
  `message_en`, ni `message_es`.
- `details` es siempre estructurado. **Nunca prosa.**
- El copy en ambos idiomas pertenece a `frontend` (`messages/en-US.json` y
  `messages/es-US.json`).

Códigos transversales: `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`STEP_UP_REQUIRED` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (422),
`RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).

## Dinero y entries (DEC-010)

**Nunca coma flotante.**

- Dinero: `{ "amount_minor": "1999", "currency": "USD" }`. El importe viaja
  como **cadena de dígitos**, no como número: un entero grande no sobrevive a
  `JSON.parse` sin riesgo de perder precisión.
- Cantidades de entries: entero.
- Multiplicadores: `{ "numerator": 2, "denominator": 1 }`.
- Números de entry: **cadena** (`"LSW26-000450001"`), jamás número.

## Tiempo (DEC-011)

Todo instante es ISO-8601 en UTC (`2026-09-15T12:00:00.000Z`). Cada promoción
declara además su `legal_timezone` IANA, y **los deadlines los evalúa el
servidor** contra esa zona. El navegador nunca es fuente de verdad.

## Texto (DEC-022, DEC-030)

Tres categorías, con tres dueños distintos:

1. **Copy de producto** — vive en los diccionarios de `frontend`. El backend
   manda códigos.
2. **Contenido dinámico localizado** — títulos, nombres de premio,
   descripciones de producto. Viaja por locale desde el backend:
   `{ "en-US": "...", "es-US": "..." }`. Ambas claves obligatorias.
   `frontend` lo renderiza tal cual y **no lo traduce jamás**.
3. **Texto legalmente controlante** — Official Rules y disclaimers. Viaja con
   `is_legally_controlling` e `is_informational_translation`, y se renderiza
   literalmente.

## Locale

Cabecera `Accept-Language` con la **etiqueta completa** (`en-US`, `es-US`), no
el segmento de ruta (`en`, `es`) — DEC-029.

## Paginación

Por **cursor**, nunca por offset: con offset, una entrada nueva durante la
paginación desplaza filas y el cliente ve duplicados o huecos.

```json
{ "items": [], "next_cursor": "opaque-string-or-null" }
```

Parámetros: `?cursor=<opaque>&limit=<1..100>`. El cursor es opaco: el cliente
no lo interpreta.

---

# Endpoints

## Estado de esta sección

Poblada por `backend` resolviendo `HO-016` y reconciliando las listas P0 de
`frontend` y `backend` (`HO-005`).

**Hay 15 rutas `IMPLEMENTED`** tras el hito B3: las tres de infraestructura,
la configuración pública, las cuatro de storefront (promociones y catálogo) y
las cinco del carrito de servidor con su cotización de entries. Todo lo demás
sigue en `PROPOSED`: acordado en papel, para que `frontend` diseñe contra ello,
y **no asumible como existente**.

`IMPLEMENTED` **no es** `TESTED`: significa que existe en el backend y respeta
este contrato, con pruebas propias de `backend`. La revisión de
`security-integration` es lo que las mueve a `TESTED`.

### Aviso sobre las rutas del carrito

Las cinco rutas de carrito están implementadas y probadas, y **hoy devuelven
`401 UNAUTHENTICATED`**. No es un fallo: un carrito pertenece a alguien, y quien
resuelve esa identidad —participante o sesión anónima— es `packages/security`
(DEC-006). `apps/api` declara el puerto (`lswPrincipalResolver`) y su valor por
defecto no conoce a nadie.

Inventar una cookie de carrito propia en `apps/api` las habría hecho funcionar
antes creando un segundo sistema de sesión, que es lo que prohíbe `CLAUDE.md`
sección 4. En cuanto `packages/security` sustituya ese puerto, las rutas
funcionan sin tocar una línea de este contrato.

### Índice de rutas implementadas

Con el **camino tal y como lo declara el código** (`:slug`, no `{slug}`). Las
entradas detalladas de más abajo usan la notación OpenAPI `{slug}`, que es la
misma ruta escrita de otra forma; esta tabla es la que permite comparar el
documento contra `apps/api/openapi/route-manifest.json` sin interpretar el
markdown, y es lo que verifica el test de contrato de DEC-015.

| Método | Camino                                  | Authorization      |
| ------ | --------------------------------------- | ------------------ |
| GET    | /api/v1/config                          | `PUBLIC`           |
| GET    | /api/v1/promotions                      | `PUBLIC`           |
| GET    | /api/v1/promotions/active               | `PUBLIC`           |
| GET    | /api/v1/promotions/:slug                | `PUBLIC`           |
| GET    | /api/v1/promotions/:slug/official-rules | `PUBLIC`           |
| GET    | /api/v1/products                        | `PUBLIC`           |
| GET    | /api/v1/products/:slug                  | `PUBLIC`           |
| GET    | /api/v1/cart                            | `PARTICIPANT_SELF` |
| POST   | /api/v1/cart/items                      | `PARTICIPANT_SELF` |
| PATCH  | /api/v1/cart/items/:item_id             | `PARTICIPANT_SELF` |
| DELETE | /api/v1/cart/items/:item_id             | `PARTICIPANT_SELF` |
| GET    | /api/v1/cart/entry-quote                | `PARTICIPANT_SELF` |
| POST   | /api/v1/auth/login                      | `PUBLIC`           |
| POST   | /api/v1/auth/mfa/verify                 | `PUBLIC`           |
| GET    | /api/v1/auth/session                    | `PUBLIC`           |
| POST   | /api/v1/auth/logout                     | `PUBLIC`           |

Las tres de infraestructura (`/api/v1/health`, `/api/v1/health/ready`,
`/api/v1/openapi.json`) están documentadas más abajo y exentas de ese gate por
etiqueta `meta`: no las consume `frontend`.

### Aviso sobre `amount_minor`

Es **cadena de dígitos**, no número, en todas las rutas ya implementadas
(DEC-010). El contrato provisional de `apps/web` (`src/lib/api/contract.ts`)
lo declara como `number`; esa divergencia hay que resolverla en el frontend, no
aquí, y desaparece cuando se consuman los tipos generados del OpenAPI (DEC-014).

---

## 1. Infraestructura (`meta`)

Estas rutas no las consume `frontend`: las consulta el orquestador. Se listan
para que el documento describa la superficie completa.

```text
Method: GET
Endpoint: /api/v1/health

Purpose:
Liveness. "El proceso responde." NO consulta la base de datos a propósito: si
lo hiciera, un incidente de PostgreSQL provocaría que el orquestador reiniciara
procesos sanos y empeorara la caída.

Authentication: ninguna

Request: sin parámetros

Response: 200 { "status": "ok" }

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/health/ready

Purpose:
Readiness. "Puedo atender tráfico." Sí comprueba la base de datos.

Authentication: ninguna

Request: sin parámetros

Response:
200 | 503 { "status": "ready" | "degraded", "checks": [{ "name": "database", "ok": true }] }

Devuelve el nombre de cada comprobación y si pasó. Nunca el detalle del fallo:
un healthcheck es el endpoint que cualquiera puede consultar, y por tanto el
peor sitio para dar pistas.

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/openapi.json

Purpose:
Documento OpenAPI 3.1 generado desde los esquemas Zod (DEC-014). No es una API
documentada por este contrato: ES este contrato en forma legible por máquina.

Authentication: ninguna

Request: sin parámetros

Response: 200 documento OpenAPI 3.1

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

---

## 2. Configuración pública

```text
Method: GET
Endpoint: /api/v1/config

Purpose:
Feature flags legalmente materiales y modalidad AMOE vigente, leídos en
servidor (DEC-013). Es lo que decide QUÉ renderiza la interfaz.

Authentication: ninguna

Request: sin parámetros

Response: 200
{
  "feature_flags": {
    "amoe_enabled": false,
    "visible_entry_numbers_enabled": false,
    "internal_draw_enabled": false,
    "state_eligibility_enforcement_enabled": false,
    "age_gate_enabled": false,
    "entry_multipliers_enabled": false,
    "entry_caps_enabled": false,
    "entry_expiration_enabled": false,
    "winner_publication_enabled": false,
    "manual_adjustments_enabled": false,
    "provisional_entries_enabled": false,
    "dual_approval_for_sensitive_actions_enabled": true
  },
  "amoe_mode": null,
  "supported_locales": ["en-US", "es-US"]
}

Las 12 claves son las de DEC-032. `amoe_mode` es un enum
(`ONLINE_FORM` | `MAIL_IN_REVIEW` | `CODE` | `EXTERNAL_INSTRUCTIONS`) o `null`
cuando todavía no hay modalidad elegida. NO existe el valor `DISABLED`: si hay
vía AMOE lo responde `amoe_enabled` y solo él.

Esta respuesta NO se cachea. Un flag legalmente material que se apaga en el
admin tiene que apagarse en la siguiente petición.

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

---

## 3. Storefront: promociones

```text
Method: GET
Endpoint: /api/v1/promotions

Purpose:
Listado de promociones visibles al público.

Authentication: ninguna

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [PromotionSummary], "next_cursor": null }

Errors: VALIDATION_FAILED (422) si el cursor o el límite no son válidos

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/active

Purpose:
La promoción activa, para la portada.

Authentication: ninguna

Request: sin parámetros

Response: 200 PromotionSummary

Errors:
404 NOT_FOUND cuando no hay ninguna promoción activa.

NOTA PARA `frontend`: ese 404 NO es un error. Es un estado normal del negocio
-el periodo entre promociones- y debe renderizarse como estado vacío, no como
fallo.

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}

Purpose:
Detalle de una promoción.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200 PromotionDetail

Errors:
404 PROMOTION_NOT_FOUND. Aquí el 404 SÍ es significativo: la ruta apunta a un
slug concreto, así que debe acabar en la página 404.

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/official-rules

Purpose:
Texto legalmente controlante de la versión de reglas vigente (DEC-012,
excepción de DEC-022).

Authentication: ninguna

Request: `slug` en la ruta

Response: 200
{
  "rules_version_id": "uuid",
  "version": 1,
  "effective_at": "2026-09-01T05:00:00.000Z",
  "documents": [
    {
      "locale": "en-US",
      "title": "...",
      "body": "...",
      "is_legally_controlling": true,
      "is_informational_translation": false
    }
  ]
}

`frontend` renderiza este texto TAL CUAL. No lo traduce, no lo autotraduce y no
hace fallback de un idioma al otro. Puede no haber ningún documento marcado
como controlante: el idioma controlante sigue en `TBD`
(`docs/LEGAL_PENDING.md`), y el sistema no lo adivina.

Errors: 404 PROMOTION_NOT_FOUND, 404 RULES_VERSION_NOT_FOUND

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

### Forma de `PromotionSummary`

```json
{
  "id": "uuid",
  "slug": "example-promotion",
  "status": "ACTIVE",
  "title": { "en-US": "...", "es-US": "..." },
  "summary": { "en-US": "...", "es-US": "..." },
  "legal_timezone": "America/Chicago",
  "starts_at": "2026-09-01T05:00:00.000Z",
  "ends_at": "2026-10-01T05:00:00.000Z",
  "rules_version_id": "uuid",
  "prize_value": { "amount_minor": "5000000", "currency": "USD" }
}
```

`status` usa el enum canónico de `@lsw/sweepstakes`: `DRAFT`, `SCHEDULED`,
`ACTIVE`, `CLOSED`, `EXPORT_PREPARATION`, `DRAW_PENDING`,
`POTENTIAL_WINNER_REVIEW`, `COMPLETED`, `CANCELLED`.

`rules_version_id` y `prize_value` pueden ser `null` mientras no haya versión
de reglas activa o premio configurado. La interfaz debe poder representar ese
caso sin inventarse nada.

**`prize_value` es `null` SIEMPRE hoy.** No existe todavía ninguna tabla de
premios ni ninguna clave de premio en `PromotionRulesVersion`, y el valor de un
premio es un dato legalmente material que nadie ha aprobado (principio 2). El
campo se sirve para que `frontend` no tenga que cambiar de forma cuando exista.
Modelar el premio requiere una decisión previa: es un handoff abierto, no un
olvido de implementación.

`DRAFT` **no sale nunca** al público: `GET /promotions` la omite y
`GET /promotions/{slug}` devuelve `PROMOTION_NOT_FOUND`. El resto de estados sí,
`CANCELLED` incluido: una promoción que estuvo publicada y se canceló tiene que
poder explicarse, y hacerla desaparecer dejaría un enlace roto sin motivo.

El cursor de `GET /promotions` ordena por `slug`. Es opaco: no se interpreta.

### Forma de `PromotionDetail`

`PromotionSummary` más un objeto `rules_version`, que puede ser `null`:

```json
{
  "rules_version": {
    "id": "uuid",
    "version": 1,
    "effective_at": "2026-09-01T05:00:00.000Z",
    "has_controlling_document": false
  }
}
```

`has_controlling_document` puede ser `false` con documentos publicados: el
idioma controlante sigue en `TBD` (`docs/LEGAL_PENDING.md`) y el sistema no lo
adivina.

---

## 4. Storefront: catálogo

```text
Method: GET
Endpoint: /api/v1/products

Purpose:
Catálogo de mercancía elegible.

Authentication: ninguna

Request: ?cursor=<opaque>&limit=<1..100>&promotion_slug=<slug>

Response: 200 { "items": [ProductSummary], "next_cursor": null }

Cada producto trae `name` y `description` como contenido localizado (DEC-030) y
sus variantes con precio en unidad menor.

IMPORTANTE: el catálogo NO declara cuántas entries da un producto. La
elegibilidad y la fórmula pertenecen a la `PromotionRulesVersion` (DEC-012). Si
el número de entries viviera en el producto, editar el catálogo cambiaría
retroactivamente lo que significó una compra pasada.

Errors: VALIDATION_FAILED (422)

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/products/{slug}

Purpose:
Ficha de producto con sus variantes.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200 ProductDetail

Errors: 404 PRODUCT_NOT_FOUND

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

### Forma de `ProductSummary` y `ProductDetail`

Son **la misma forma**. La ficha no devuelve nada que el listado no devuelva, y
mantener dos formas casi iguales sólo produce que una se quede atrás:

```json
{
  "id": "uuid",
  "sku": "LSW-TEE",
  "slug": "example-tee",
  "name": { "en-US": "...", "es-US": "..." },
  "description": { "en-US": "...", "es-US": "..." },
  "currency": "USD",
  "variants": [
    {
      "id": "uuid",
      "sku": "LSW-TEE-M",
      "price": { "amount_minor": "2500", "currency": "USD" },
      "availability": { "status": "IN_STOCK" }
    }
  ]
}
```

`description` puede ser `null`.

**`availability` sustituye a `stock_quantity` (HO-017).** El catálogo ya **no
publica el inventario exacto**. Estas dos rutas son **anónimas** y publicaban
`stock_quantity` en crudo mientras el carrito —que va con sesión— deliberadamente
no lo publicaba: una de las dos superficies estaba mal, y se resuelve hacia la
que **no filtra** información de negocio, que es además lo que HO-017 pedía.

Es **el mismo objeto** que la línea del carrito (sección 5): mismo enum estable
de tres valores, misma columna `product_variants.stock_quantity` y **el mismo
predicado**, el que decide el `409 INSUFFICIENT_STOCK` —`fitsStock`, hoy en
`apps/api/src/services/availability.ts`, importado por el catálogo y por las dos
mutaciones del carrito, para que no existan dos definiciones de "hay
existencias"—. La única diferencia es **la cantidad por la que se pregunta**: en
el carrito es la de la línea; aquí es **una unidad**, porque en la ficha nadie ha
elegido todavía cuántas quiere. La pregunta del catálogo es, literalmente, "¿se
puede comprar una unidad?":

| stock de la variante   | `status`       | significado                                  |
| ---------------------- | -------------- | -------------------------------------------- |
| no gestionado (`null`) | `IN_STOCK`     | nada limita la compra; **`null` no es cero** |
| `0` o menos            | `OUT_OF_STOCK` | añadir la primera unidad devolvería `409`    |
| exactamente `1`        | `LOW_STOCK`    | queda justo la unidad por la que se pregunta |
| mayor que `1`          | `IN_STOCK`     | queda margen                                 |

`null` sigue significando "existencias no gestionadas": esa variante da
`IN_STOCK` y se puede añadir al carrito en cualquier cantidad admitida. El
umbral de `LOW_STOCK` **no es un número de negocio** —nadie ha aprobado ninguno
y el principio 2 de `CLAUDE.md` prohíbe inventarlo—: es la cantidad preguntada,
igual que en la sección 5.

`availability` es un **objeto** y no una cadena, por el mismo motivo que allí:
el día que se decida publicar la cantidad, el campo cabe dentro sin cambiar el
tipo de lo ya publicado. Hoy **sólo** lleva `status`; `quantity_available` no se
publica en ninguna de las dos superficies.

`is_purchasable` —"¿está a la venta?", que no es la misma pregunta que "¿hay
existencias?"— **sigue pendiente** (HO-017) y **no** se deduce de `availability`:
una variante retirada o no publicada puede tener existencias de sobra. Cuando se
decida, se documenta aquí antes de implementarse.

Sólo salen productos y variantes en `ACTIVE`. El parámetro `promotion_slug` que
figuraba en la propuesta **no está implementado**: la elegibilidad no vive en el
catálogo (DEC-012), así que filtrar por promoción exigiría que el listado
aplicase reglas legales, que es justo lo que este endpoint no debe hacer. El
cursor ordena por `slug`.

---

## 5. Carrito de servidor (DEC-023)

**El carrito vive en el servidor.** La cotización de entries se calcula sobre
el carrito del servidor, nunca sobre una lista de ítems enviada por el cliente:
en un producto donde una cifra de entries mal calculada es un problema legal,
la traza de qué se cotizó y cuándo vale más que la simplicidad.

Todas las rutas de esta sección devuelven **`CartWithQuote`**:

```json
{
  "id": "uuid",
  "currency": "USD",
  "updated_at": "2026-09-15T12:00:00.000Z",
  "item_count": 2,
  "lines": [
    {
      "id": "uuid",
      "variant_id": "uuid",
      "product_slug": "example-tee",
      "sku": "LSW-TEE-M",
      "name": { "en-US": "...", "es-US": "..." },
      "quantity": 2,
      "unit_price": { "amount_minor": "2500", "currency": "USD" },
      "line_subtotal": { "amount_minor": "5000", "currency": "USD" },
      "image_url": null,
      "availability": { "status": "IN_STOCK" }
    }
  ],
  "subtotal": { "amount_minor": "5000", "currency": "USD" },
  "entry_quote": null
}
```

- `subtotal` es **dinero**; `entry_quote` son **entries**. No son lo mismo y no
  se derivan uno del otro.
- `entry_quote` es `null` cuando no hay promoción activa. Un carrito sigue
  siendo válido en el periodo entre promociones: se puede comprar mercancía sin
  que haya nada que cotizar, y hacer fallar `GET /cart` impediría hasta vaciarlo.
- `currency` y `subtotal` son `null` en un carrito vacío: sin líneas no hay
  moneda que declarar.
- `id` es `00000000-0000-0000-0000-000000000000` cuando el solicitante no tiene
  carrito. **Leer no crea nada**: un `GET` que insertara una fila haría que cada
  rastreador dejara un carrito vacío en la base de datos.

**`updated_at`, `item_count`, `image_url` y `availability` (HO-017).**

- `updated_at` es el instante de la **última mutación del carrito, líneas
  incluidas**. ISO-8601 UTC. Existe por el motivo que dio `frontend` y que no es
  cosmético: comparado con `entry_quote.evaluated_at` es lo que permite saber
  que la cifra de entries en pantalla **ya no corresponde al carrito**. Lo pone
  el motor —`carts_set_updated_at` sobre la fila y `cart_items_touch_cart`
  (migración `0025`) cuando cambian las líneas—, nunca el reloj del proceso que
  responde. Vale `null` **sólo** en el carrito vacío sintético: ahí no existe
  fila, y devolver `now()` sería afirmar que un carrito inexistente acaba de
  cambiar.
- `item_count` es la **suma de `quantity`** de las líneas, entero. No es el
  número de líneas: dos unidades de la misma variante son una línea y cuentan
  dos. Vale `0` —nunca `null`— en un carrito vacío: contar cero cosas es cero.
  No entra en ninguna aritmética de entries; es una cuenta de mercancía.
- `image_url` es hoy **siempre `null`**, y se publica igualmente. El esquema
  **no tiene ninguna tabla de medios** —no existe `media`, `product_media` ni
  `variant_media`, ni ninguna columna de imagen en `products` o
  `product_variants`— y `backend` no inventa una para rellenar un campo. Se
  declara nulable para que `frontend` deje de degradar su tipo y pinte su
  marcador de posición sabiendo por qué. Su tipo es `string | null` y **no**
  `url`: sin modelo de medios nadie ha decidido si la referencia será absoluta,
  relativa o de un CDN, y fijarlo aquí sería tomar esa decisión de pasada.
- `availability` es un **objeto**, no una cadena: `{ "status": ... }`. Hoy sólo
  lleva `status`. **No publica la cantidad exacta de existencias**: HO-017 lo
  pide expresamente y ninguna decisión de `docs/DECISIONS.md` autoriza lo
  contrario. Que sea objeto y no cadena permite añadir el campo el día que se
  decida, sin cambiar el tipo de lo ya publicado.

`availability.status` sale de `product_variants.stock_quantity` —**la misma
columna que decide el `409 INSUFFICIENT_STOCK`**, nunca de una segunda lectura
del inventario— y de la cantidad de **esa** línea:

| stock de la variante   | `status`       | significado                                               |
| ---------------------- | -------------- | --------------------------------------------------------- |
| no gestionado (`null`) | `IN_STOCK`     | nada limita esta línea; `null` no es cero                 |
| menor que `quantity`   | `OUT_OF_STOCK` | la línea ya **no cabe**: pedir esa cantidad daría `409`   |
| igual a `quantity`     | `LOW_STOCK`    | se lleva exactamente lo que queda; no cabe una unidad más |
| mayor que `quantity`   | `IN_STOCK`     | queda margen                                              |

El umbral de `LOW_STOCK` es **la propia línea** y no un número. Lo habitual
sería "quedan menos de N", pero ese N es una constante de negocio que nadie ha
aprobado, y el principio 2 de `CLAUDE.md` prohíbe inventarla. La definición de
arriba no inventa nada: sale entera de la comparación que ya decide el `409`.

`status` es un **enum estable**; el copy es de `frontend` (DEC-022).
`OUT_OF_STOCK` significa "esta cantidad no se puede servir hoy", que puede
querer decir "quedan 3 y pediste 5": la etiqueta que se enseñe es decisión de
`frontend`, no de la API.

`availability` **no** responde "¿está a la venta?". Una variante retirada o no
publicada es otra pregunta —la que HO-017 llama `is_purchasable`—, sigue pedida
para el catálogo (sección 4) y **no** se deduce de ésta.

- Una variante aparece **como máximo una vez** por carrito. Añadir la misma
  variante dos veces **suma cantidad**; no duplica la línea.
- Un carrito tiene **una sola moneda**. Mezclarlas devuelve
  `409 CART_CURRENCY_MISMATCH`; lo impone además un trigger.
- `quantity` está acotada a `1..10000` por línea. No es un límite legal —los
  topes de entries son otra cosa y viven en la `PromotionRulesVersion`—: es un
  límite operativo.

```text
Method: GET
Endpoint: /api/v1/cart

Purpose:
Carrito vigente de la sesión, con su cotización de entries.

Authentication: sesión (participante o anónima con cookie de carrito)

Request: sin parámetros

Response: 200 CartWithQuote

Errors: ninguno propio; un carrito inexistente devuelve uno vacío

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/cart/items

Purpose:
Añadir una variante al carrito.

Authentication: sesión

Request: { "variant_id": "uuid", "quantity": 1 }

Response: 200 CartWithQuote

Errors:
404 PRODUCT_NOT_FOUND, 409 VARIANT_NOT_PURCHASABLE, 409 INSUFFICIENT_STOCK,
422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: PATCH
Endpoint: /api/v1/cart/items/{item_id}

Purpose:
Cambiar la cantidad de una línea.

Authentication: sesión

Request: { "quantity": 3 }

Response: 200 CartWithQuote

Errors: 404 CART_ITEM_NOT_FOUND, 409 INSUFFICIENT_STOCK, 422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: DELETE
Endpoint: /api/v1/cart/items/{item_id}

Purpose:
Quitar una línea.

Authentication: sesión

Request: `item_id` en la ruta

Response: 200 CartWithQuote

Errors: 404 CART_ITEM_NOT_FOUND

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/cart/entry-quote

Purpose:
Cotización de entries del carrito de servidor, con desglose auditable.

Resuelve el conflicto de nombres de `HO-005`: `frontend` proponía
`POST /entries/quote` y `backend` `POST /api/v1/entry-quotes/cart`. Gana un
`GET` sobre el carrito, porque DEC-023 ya hace del carrito el recurso y una
cotización es una LECTURA derivada de él. Un `POST` sugeriría que el cliente
aporta los ítems, que es justo lo que DEC-023 descarta.

Authentication: sesión

Request: sin cuerpo

Response: 200
{
  "promotion_id": "uuid",
  "rules_version_id": "uuid",
  "engine_version": 1,
  "evaluated_at": "2026-09-15T12:00:00.000Z",
  "eligible_subtotal": { "amount_minor": "3000", "currency": "USD" },
  "entries_before_caps": 30,
  "final_entries": 25,
  "eligible_items": [
    { "line_id": "...", "sku": "...", "quantity": 3, "multiplier_ids": ["labor-day-2x"] }
  ],
  "ineligible_items": [{ "line_id": "...", "sku": "...", "reason_key": "PRODUCT_NOT_ELIGIBLE" }],
  "applied_multipliers": [
    { "id": "labor-day-2x", "numerator": 2, "denominator": 1 }
  ],
  "applied_caps": [
    { "kind": "PER_ORDER", "limit": 25, "entries_before": 30, "entries_after": 25 }
  ]
}

`reason_key` y `kind` son enums estables; el copy es de `frontend` (DEC-022).

Esta cifra es ORIENTATIVA hasta que la orden alcance el estado que las Official
Rules definan como cualificante. Las entries las genera el backend al recibir
la confirmación de pago, NUNCA cuando el frontend llega a la página de éxito.

PRECISIONES DE LA IMPLEMENTACIÓN

- `eligible_subtotal` es `null` cuando el carrito está vacío: sin líneas no hay
  moneda que declarar. `entries_before_caps` y `final_entries` valen `0`.
- `line_id` es el identificador de la línea del carrito de servidor
  (`cart_items.id`), el mismo que devuelve `CartWithQuote`. Permite casar la
  cotización con la línea sin que el cliente aporte nada.
- Sin carrito, la respuesta es la cotización de un carrito vacío, no un 404: la
  respuesta correcta a "cuántas entries genera mi carrito" cuando no hay carrito
  es "cero", y así el frontend recibe igualmente la promoción y la versión de
  reglas vigentes.
- `applied_multipliers` sólo aparece con `entry_multipliers_enabled` encendido;
  `applied_caps`, con `entry_caps_enabled` (DEC-032). Con los flags apagados
  ambas listas van vacías.
- `engine_version` es la versión del motor de cálculo, no la del paquete. Junto
  con `rules_version_id` es lo que hace reproducible la cifra (DEC-007).

**NO HAY FORMA DE ENVIAR ÍTEMS.** Es un `GET` sin cuerpo, y los parámetros de
query se ignoran. Está cubierto por un test que lo intenta.

Errors:
409 NO_ACTIVE_PROMOTION, 409 CALCULATION_CONFIG_INVALID,
409 MULTIPLIER_CONFLICT_UNRESOLVED, 409 CURRENCY_MISMATCH,
409 RESULT_EXCEEDS_SAFE_RANGE

Los tres últimos los emite el motor de cálculo y viajan con su propio `code`
(DEC-031). `MULTIPLIER_CONFLICT_UNRESOLVED` significa que la configuración
declara `EXCLUSIVE` y dos periodos se solapan: el motor **falla en vez de
desempatar por su cuenta**, y eso se corrige en la configuración legal, no en el
cliente.

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

### Fórmulas de cálculo admitidas (motor `engine_version: 1`)

La fórmula la fija `PromotionRulesVersion.purchase_entry_formula` (DEC-012). El
motor admite cuatro modos y **cada uno declara su propia `rounding_policy`**
(`FLOOR` | `CEIL` | `HALF_UP` | `HALF_DOWN` | `HALF_EVEN`), obligatoria y sin
valor por defecto:

| Modo                        | Campos                                               |
| --------------------------- | ---------------------------------------------------- |
| `FIXED_PER_ORDER`           | `entries`                                            |
| `FIXED_PER_PRODUCT`         | `entries_per_unit`                                   |
| `ENTRIES_PER_CURRENCY_UNIT` | `amount_unit_minor`, `entries_per_amount_unit`       |
| `TIERED_BY_AMOUNT`          | `tiers[] { id, min_eligible_amount_minor, entries }` |

`partial_refund_rounding_policy` es la política de **otra** operación —cómo se
prorratea una devolución parcial— y ya no gobierna el cálculo base.

`entries_per_amount_unit` es un par de enteros `{ numerator, denominator }`
(DEC-010), nunca un decimal. `TIERED_BY_AMOUNT` aplica el escalón **más alto**
cuyo umbral no supere el subtotal elegible, y los escalones **no se acumulan**;
la traza lo registra en `tier_selection` y `applied_tier_id`.

Esta tabla describe lo que el motor **puede** expresar. Cuál se usa lo decide el
abogado del cliente: hoy `purchase_entry_formula` sigue en `TBD`
(`docs/LEGAL_PENDING.md`) y ninguna promoción puede activarse sin resolverla.

---

## 6. Portal del participante

```text
Method: GET
Endpoint: /api/v1/account/entry-summary

Purpose:
Saldo de entries del participante en una promoción, con su procedencia.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>

Response: 200
{
  "promotion_id": "uuid",
  "active_entries": 15,
  "purchase_entries": 12,
  "amoe_entries": 3,
  "as_of": "2026-09-15T12:00:00.000Z"
}

Compra y AMOE conviven en el MISMO universo elegible conservando su procedencia
(principio 9). Nunca son dos saldos separados.

El número sale de la vista SQL de saldo, que deriva del ledger. Nunca de un
contador editable.

Errors: 404 PROMOTION_NOT_FOUND

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-transactions

Purpose:
Historial del ledger del propio participante, incluidas las correcciones.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{
  "items": [
    {
      "id": "uuid",
      "type": "PURCHASE_EARNED",
      "source_type": "PURCHASE",
      "quantity_delta": 10,
      "reason_key": "ORDER_QUALIFIED",
      "effective_at": "2026-09-10T12:00:00.000Z",
      "reverses_transaction_id": null
    }
  ],
  "next_cursor": null
}

Una devolución aparece como una FILA NUEVA con delta negativo, no como la
desaparición de la original. El participante puede ver qué pasó y cuándo.

`reason_key` es un enum estable. NUNCA prosa: el copy es de `frontend`.

Errors: 404 PROMOTION_NOT_FOUND

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-numbers

Purpose:
Rangos de números asignados al participante ("mis números").

Authentication: sesión de participante

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{
  "items": [
    {
      "batch_id": "uuid",
      "quantity": 11000,
      "first_number": "LSW26-000450001",
      "last_number": "LSW26-000461000"
    }
  ],
  "next_cursor": null
}

Los números viajan como CADENA, jamás como número (DEC-010).

Detrás del flag `visible_entry_numbers_enabled`, apagado. Con el flag apagado
devuelve 404: los rangos se asignan igual -para que sean reconstruibles hacia
atrás- pero no se muestran.

AVISO: la secuencia de números NO es el algoritmo del sorteo. Que existan
números no autoriza a sortear sobre ellos (DEC-017).

Errors: 404 NOT_FOUND cuando el flag está apagado

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/orders

Purpose:
Pedidos del propio participante.

Authentication: sesión de participante

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [OrderSummary], "next_cursor": null }

Errors: ninguno propio

Authorization: order.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/orders/{order_id}

Purpose:
Detalle de un pedido, con la traza del cálculo de entries que produjo.

Authentication: sesión de participante

Request: `order_id` en la ruta

Response: 200 OrderDetail, incluyendo `entry_calculation` con
`rules_version_id`, `engine_version` y el desglose que se persistió en el
`EntryCalculationSnapshot`.

Es lo que permite responder "por qué esta compra generó 37 entries y no 36"
meses después, cuando el catálogo y las reglas ya han cambiado.

Errors: 404 ORDER_NOT_FOUND

Authorization: order.self.read

Owner: backend

Status: PROPOSED
```

---

## 7. AMOE

Toda esta sección está detrás del flag `amoe_enabled`, apagado, y de una
modalidad `amoe_mode` que sigue sin elegir (`docs/LEGAL_PENDING.md` →
"AMOE mechanism"). Con el flag apagado, estos endpoints devuelven 404.

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/amoe-config

Purpose:
Qué modalidad AMOE está vigente y qué exige, para decidir qué interfaz
renderizar.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200
{
  "enabled": false,
  "mode": null,
  "submission_window": { "opens_at": null, "closes_at": null },
  "instructions": { "en-US": "...", "es-US": "..." }
}

`mode` es un enum precisamente porque las cuatro modalidades exigen pantallas
distintas; un booleano no permitiría decidir cuál renderizar.

Las instrucciones son contenido legalmente controlante: se renderizan tal cual.

Errors: 404 PROMOTION_NOT_FOUND, 404 NOT_FOUND si `amoe_enabled` está apagado

Authorization: PUBLIC

Owner: backend

Status: PROPOSED
```

```text
Method: POST
Endpoint: /api/v1/promotions/{promotion_id}/amoe-submissions

Purpose:
Enviar una participación sin compra.

Authentication: sesión de participante

Request: forma dependiente de `amoe_mode`. Se cierra cuando el abogado fije la
modalidad; documentarla ahora sería inventar un requisito legal.

Response: 201 { "submission_id": "uuid", "status": "SUBMITTED" }

Una participación aprobada genera entries del MISMO tipo que una compra, con
`source_type: "AMOE"`. Un solo universo, con procedencia (principio 9).

La aprobación crea una transacción del ledger. Nunca incrementa un contador.

Errors:
404 NOT_FOUND si `amoe_enabled` está apagado
409 AMOE_WINDOW_CLOSED
409 AMOE_LIMIT_REACHED
409 AMOE_DUPLICATE_SUBMISSION
422 VALIDATION_FAILED

Authorization: amoe.self.submit

Owner: backend

Status: PROPOSED
```

---

## 8. Admin

Superficie aislada y protegida. Toda ruta exige sesión administrativa con MFA
(DEC-006); las marcadas con step-up exigen además re-autenticación reciente.

| Method | Endpoint                                                 | Authorization            | Status      |
| ------ | -------------------------------------------------------- | ------------------------ | ----------- |
| GET    | `/api/v1/admin/dashboard`                                | `dashboard.read`         | IMPLEMENTED |
| GET    | `/api/v1/admin/promotions`                               | `promotion.read`         | PROPOSED    |
| POST   | `/api/v1/admin/promotions`                               | `promotion.create`       | PROPOSED    |
| PATCH  | `/api/v1/admin/promotions/{promotion_id}`                | `promotion.update`       | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/activate`       | `promotion.activate`     | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/close`          | `promotion.close`        | PROPOSED    |
| GET    | `/api/v1/admin/promotions/{promotion_id}/rules-versions` | `rules.version.read`     | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/rules-versions` | `rules.version.create`   | PROPOSED    |
| POST   | `/api/v1/admin/rules-versions/{id}/activate`             | `rules.version.activate` | PROPOSED    |
| GET    | `/api/v1/admin/products`                                 | `product.read`           | PROPOSED    |
| POST   | `/api/v1/admin/products`                                 | `product.write`          | PROPOSED    |
| POST   | `/api/v1/admin/products/{product_id}/publish`            | `product.publish`        | PROPOSED    |
| GET    | `/api/v1/admin/participants`                             | `participant.list`       | IMPLEMENTED |
| GET    | `/api/v1/admin/participants/{id}`                        | `participant.read`       | IMPLEMENTED |
| POST   | `/api/v1/admin/participants/{id}/disqualify`             | `participant.disqualify` | PROPOSED    |
| GET    | `/api/v1/admin/orders`                                   | `order.read`             | IMPLEMENTED |
| POST   | `/api/v1/admin/orders/{id}/refund`                       | `order.refund.initiate`  | PROPOSED    |
| GET    | `/api/v1/admin/entry-transactions`                       | `entry.ledger.read`      | PROPOSED    |
| POST   | `/api/v1/admin/entry-adjustments`                        | `entry.adjust.create`    | PROPOSED    |
| POST   | `/api/v1/admin/entry-adjustments/preview`                | `entry.adjust.create`    | IMPLEMENTED |
| POST   | `/api/v1/admin/entry-adjustments/{id}/approve`           | `entry.adjust.approve`   | PROPOSED    |
| GET    | `/api/v1/admin/amoe-submissions`                         | `amoe.review.read`       | PROPOSED    |
| POST   | `/api/v1/admin/amoe-submissions/{id}/approve`            | `amoe.review.approve`    | PROPOSED    |
| POST   | `/api/v1/admin/amoe-submissions/{id}/reject`             | `amoe.review.reject`     | PROPOSED    |
| GET    | `/api/v1/admin/payment-webhooks`                         | `payment.webhook.read`   | PROPOSED    |
| POST   | `/api/v1/admin/payment-webhooks/{id}/replay`             | `payment.webhook.replay` | PROPOSED    |
| GET    | `/api/v1/admin/reconciliation`                           | `reconciliation.read`    | PROPOSED    |
| GET    | `/api/v1/admin/feature-flags`                            | `flag.read`              | PROPOSED    |
| PATCH  | `/api/v1/admin/feature-flags/{key}`                      | `flag.update`            | PROPOSED    |

Notas que no caben en la tabla y que importan:

- **Cambiar un flag legalmente material** exige además
  `flag.update.legally_material`, step-up y **motivo obligatorio**. El motivo no
  es documentación: la base de datos rechaza el cambio sin él.
- **`entry.adjust.create` y `entry.adjust.approve` son capacidades distintas a
  propósito.** Un ajuste que se aprueba a sí mismo es una edición del ledger con
  otro nombre.
- Ningún endpoint de admin edita ni borra una transacción del ledger. **No
  existe tal endpoint y no puede existir**: el rol de base de datos de la
  aplicación no tiene el privilegio, y un trigger lanza excepción aunque lo
  tuviera (DEC-007). Una corrección es siempre una fila nueva.
- El dominio de **exportación y sorteo** (`export.*`, `draw.*`, `winner.*`) es
  de `security-integration` y se documentará en su propia sección cuando exista.
  `backend` produce el dataset; el formato, la firma y la entrega son de
  `security` (DEC-016). Ningún endpoint de sorteo se implementa sin las cinco
  condiciones de DEC-017.

---

## 9. Webhooks de pago

```text
Method: POST
Endpoint: /api/v1/webhooks/payments/{provider}

Purpose:
Recepción de eventos del proveedor de pago.

Authentication:
Verificación de FIRMA sobre el cuerpo crudo. No hay sesión. Es la razón por la
que `apps/api` es un proceso Fastify separado (DEC-004): las API routes de Next
no garantizan acceso al cuerpo sin parsear, y sin cuerpo crudo la firma no se
puede verificar.

Request: cuerpo crudo del proveedor + cabecera de firma

Response: 200 { "received": true }

El evento se persiste ANTES de procesarse, con `UNIQUE (provider,
provider_event_id)`. Un reintento del proveedor choca contra esa restricción y
es un no-op: no es un `if` en el código, que perdería bajo concurrencia.

Las entries se generan al alcanzar el estado cualificante configurado, no
cuando el frontend llega a una página de éxito.

Errors: 401 cuando la firma no verifica; 202 cuando el evento ya se conocía

Authorization: PUBLIC

Justificación de que sea PUBLIC: el llamante es el proveedor de pago, que no
tiene sesión. La autenticación es criptográfica, sobre la firma del cuerpo.

Owner: backend

Status: PROPOSED
```

---

# Qué NO está en este contrato, y por qué

- **Autenticación y sesión.** DEC-006 asigna ese diseño a `packages/security`.
  Las rutas de login, MFA y step-up las documenta ese agente.
- **Exportación al third-party administrator y sorteo.** DEC-016 y DEC-017.
  Propiedad de `security-integration`.
- **La forma exacta del envío AMOE.** Depende de la modalidad, que sigue en
  `TBD`. Documentarla ahora sería inventar un requisito legal.
- **Cualquier constante legal.** Edades mínimas, jurisdicciones, ratios,
  deadlines y topes NO aparecen en este documento. Viajan como datos desde
  `PromotionRulesVersion` (DEC-012).

---

## 10. Autenticación (DEC-006, DEC-045)

**Estado:** `IMPLEMENTED` para las cuatro rutas de abajo. Inscripción de MFA,
registro de participante, verificación de email y restablecimiento de
contraseña siguen en `TBD`: son la fase siguiente.

### Un solo sistema, dos políticas

`CLAUDE.md` §4 prohíbe dos sistemas de autenticación y DEC-006 lo repite. **No
existe `/admin/login`.** Participante y personal usan estas mismas rutas; lo
que cambia es la política que decide `audienceForRoles` a partir de los roles:

|              | `PARTICIPANT` | `STAFF`         |
| ------------ | ------------- | --------------- |
| Cookie       | `<base>`      | `<base>_staff`  |
| `SameSite`   | `Lax`         | `Strict`        |
| `Path`       | `/`           | `/admin`        |
| TTL absoluto | 14 días       | 8 horas         |
| Inactividad  | —             | 15 min          |
| MFA          | no            | **obligatorio** |

Los nombres llevan sufijo distinto para que una sesión de escaparate y una de
panel coexistan en el mismo navegador. Sin eso, entrar al panel cerraría la
sesión de la tienda y al revés, y el síntoma —"me desloguea solo"— sería muy
difícil de atribuir.

La fuente de esta tabla es `SESSION_POLICIES` en `packages/security`; aquí solo
se refleja. Si divergen, manda el código.

### El token es opaco

43 caracteres `base64url` (`[A-Za-z0-9_-]`). **No es un JWT y no se decodifica:
no lleva nada dentro.** Toda la información de la sesión vive en la fila de
`sessions`, que es lo que la hace revocable de verdad. La base de datos guarda
solo el hash SHA-256 del token.

### `SessionState`

```json
{
  "authenticated": true,
  "state": "ACTIVE",
  "scope": "STAFF",
  "email": "persona@ejemplo.invalid",
  "email_verified": true,
  "roles": ["CATALOG_MANAGER"]
}
```

`state` es `ANONYMOUS`, `ACTIVE` o **`MFA_PENDING`**. Este último es el estado
de una sesión de personal que ya pasó la contraseña y **todavía no vale para
nada** salvo para completar el segundo factor. No es una pantalla que se pueda
saltar: es una sesión que aún no autentica.

### `POST /api/v1/auth/login`

`Authorization: PUBLIC` — es la ruta que se usa antes de tener sesión.

Cuerpo: `{ "email": string, "password": string }`.

Respuestas: `200` `SessionState` · `401` credenciales inválidas · `423` cuenta
bloqueada, con `retry_after_seconds` · `422` cuerpo inválido.

**No distingue "no existe" de "contraseña incorrecta".** Ambos devuelven `401`
y consumen el mismo trabajo criptográfico, porque la diferencia de tiempo sería
medible desde fuera y convertiría el login en un enumerador de correos
registrados —que en un sweepstakes es una lista de participantes.

Cinco fallos consecutivos bloquean 15 minutos. El bloqueo es **temporal** a
propósito: uno permanente convertiría el formulario en una forma de dejar fuera
a cualquiera cuyo correo se conozca.

### `POST /api/v1/auth/mfa/verify`

`Authorization: PUBLIC` — la sesión existe pero está en `MFA_PENDING`, así que
exigir sesión válida aquí sería circular.

Cuerpo: `{ "code": string }` (seis dígitos; se aceptan espacios).

Respuestas: `200` `SessionState` con `state: "ACTIVE"` · `401` código inválido,
caducado o **ya usado**.

**Un código no vale dos veces**, ni siquiera dentro de su ventana de 30
segundos. El consumo de la ventana es atómico en el motor.

### `GET /api/v1/auth/session`

`Authorization: PUBLIC`. **Sin sesión devuelve `200` con `ANONYMOUS`, no
`401`**: es lo que consulta el frontend en cada render y un 401 ahí obligaría a
tratar el caso normal como error.

### `POST /api/v1/auth/logout`

`Authorization: PUBLIC`. Idempotente: siempre `200 { "ok": true }`, haya sesión
o no. Un 401 al cerrar sesión no le sirve a nadie y además revelaría si la
cookie presentada era válida.

**Revoca en base de datos además de borrar la cookie.** Borrar solo la cookie
dejaría el token vivo para quien lo hubiera copiado.

### La cabecera `Cookie` que reenvía `apps/web`

`apps/web` no es un navegador: es un segundo proceso (DEC-004) que reenvía la
sesión del visitante. Lo hace con `cookies().toString()` de Next, que **no
produce una cabecera `Cookie` de RFC 6265**, sino algo con forma de
`Set-Cookie`:

    lsw_session=<token>; Path=/; lsw_dev_staff_actor=compliance%40example.com; Path=/

Dos rarezas: pseudo-cookies `Path=/` intercaladas —atributos que solo
pertenecen a `Set-Cookie`— y valores percent-encoded.

**La API acepta esa forma** (HO-035, opción b; DEC-050). No porque sea la
preferida ni porque no pudiera rechazarla —un 400 ante una `Cookie` que no
cumple RFC 6265 sería legítimo—, sino porque rechazarla rompería a un cliente
que controlamos, la forma es demostrablemente inocua, y declarar y vigilar lo
que se acepta cuesta menos que obligar a cada cliente a normalizar. Es una
tolerancia medida, con un test que la fija; no una renuncia a imponer. Lo fija
`apps/api/test/cookie-header-contract.test.ts`, que levanta la app real y
comprueba, sobre la cabecera literal: que ambas cookies de sesión se encuentran
entre las pseudo-cookies, que el token sobrevive intacto —lo exige
`looksLikeSessionToken`—, que los valores se decodifican, que las
pseudo-cookies no desplazan a ninguna cookie real y que un `;` codificado no
inyecta una cookie extra. Sin ese test, una actualización de `@fastify/cookie`
respondería 401 a una sesión válida, o peor, devolvería un valor a medio
decodificar y atendería a la persona equivocada: ese segundo síntoma ya ocurrió
una vez, en el mock de desarrollo de `apps/web`, y es indistinguible de "esa
persona no tiene ese permiso".

**La forma normativa sigue siendo la del navegador** —`name=value`, sin
atributos— y está cubierta por el mismo test con las mismas afirmaciones. Si
`apps/web` pasa a construir la cabecera desde `cookies().getAll()`, no rompe
nada. Lo que **no** cambia con ello es la dependencia del decodificador:
`getAll()` devuelve valores decodificados y reenviarlos exige
`encodeURIComponent`, así que el percent-decoding se ejerce igual. Esa
codificación en origen no es opcional: sin ella, un valor de cookie con `;`
partiría la cabecera e inyectaría cookies que nadie envió.

### Lo que NO está aquí, y por qué

- **Inscripción de MFA, registro, verificación de email y reset de
  contraseña.** Fase siguiente.
- **Si la verificación de email condiciona ganar participaciones.** Depende de
  `docs/LEGAL_PENDING.md` ("Email verification before earning entries", `TBD`).
  El campo `email_verified` se publica como dato; **que ese dato tenga
  consecuencias es una decisión legal que aún no existe**.

---

# 11. Comercio, Portal, AMOE, Ajustes, Sorteo y Exportación (hito B5)

> **Cómo llegó esta sección aquí.** El reparto pedía que `backend` entregara
> estas secciones como texto para que el Team Lead las pegara. No fue posible
> dejarlas fuera del documento: el gate de DEC-015
> (`tests/security/src/contract/api-contract.test.ts`) exige que **toda** ruta
> del manifiesto aparezca aquí, así que con las rutas en código y las entradas
> fuera, el workspace queda en rojo. Se añaden **al final**, en bloque, para no
> tocar la sección 10, que edita la sesión paralela. Si el Lead prefiere pegarlas
> él, `git checkout docs/API_CONTRACT.md` revierte este bloque entero.

## Índice de rutas de este hito

Con el camino tal y como lo declara el código (`:slug`, no `{slug}`), que es lo
que compara el test de contrato contra `apps/api/openapi/route-manifest.json`.

| Método | Camino                                                                              | Authorization               |
| ------ | ----------------------------------------------------------------------------------- | --------------------------- |
| POST   | /api/v1/checkout/session                                                            | `PARTICIPANT_SELF`          |
| GET    | /api/v1/checkout/sessions/:order_draft_id                                           | `PARTICIPANT_SELF`          |
| GET    | /api/v1/account/orders                                                              | `order.self.read`           |
| GET    | /api/v1/account/orders/:order_id                                                    | `order.self.read`           |
| POST   | /api/v1/webhooks/payments/:provider                                                 | `PUBLIC`                    |
| GET    | /api/v1/account/entry-summary                                                       | `entry.self.read`           |
| GET    | /api/v1/account/entry-transactions                                                  | `entry.self.read`           |
| GET    | /api/v1/account/entry-numbers                                                       | `entry.self.read`           |
| GET    | /api/v1/account/award-holds                                                         | `entry.self.read`           |
| GET    | /api/v1/me                                                                          | `participant.self.read`     |
| PATCH  | /api/v1/me                                                                          | `participant.self.update`   |
| GET    | /api/v1/promotions/:slug/amoe-config                                                | `PUBLIC`                    |
| POST   | /api/v1/promotions/:promotion_id/amoe-submissions                                   | `amoe.self.submit`          |
| GET    | /api/v1/account/amoe-submissions                                                    | `PARTICIPANT_SELF`          |
| GET    | /api/v1/admin/amoe-submissions                                                      | `amoe.review.read`          |
| POST   | /api/v1/admin/amoe-submissions/:submission_id/approve                               | `amoe.review.approve`       |
| POST   | /api/v1/admin/amoe-submissions/:submission_id/reject                                | `amoe.review.reject`        |
| GET    | /api/v1/admin/entry-adjustments                                                     | `entry.ledger.read`         |
| POST   | /api/v1/admin/entry-adjustments                                                     | `entry.adjust.create`       |
| POST   | /api/v1/admin/entry-adjustments/preview                                             | `entry.adjust.create`       |
| POST   | /api/v1/admin/entry-adjustments/:adjustment_id/approve                              | `entry.adjust.approve`      |
| POST   | /api/v1/admin/entry-adjustments/:adjustment_id/reject                               | `entry.adjust.approve`      |
| POST   | /api/v1/admin/participants/:participant_id/disqualify                               | `participant.disqualify`    |
| POST   | /api/v1/admin/orders/:order_id/refund                                               | `order.refund.initiate`     |
| GET    | /api/v1/admin/payment-webhooks                                                      | `payment.webhook.read`      |
| POST   | /api/v1/admin/payment-webhooks/:event_id/replay                                     | `payment.webhook.replay`    |
| GET    | /api/v1/admin/promotions/:promotion_id/draw-authorizations                          | `draw.result.read`          |
| POST   | /api/v1/admin/promotions/:promotion_id/draw-authorizations                          | `draw.authorization.create` |
| POST   | /api/v1/admin/promotions/:promotion_id/draw-authorizations/:authorization_id/revoke | `draw.authorization.create` |
| POST   | /api/v1/admin/draws                                                                 | `draw.initiate`             |
| GET    | /api/v1/admin/draws                                                                 | `draw.result.read`          |
| GET    | /api/v1/admin/promotions/:promotion_id/potential-winners                            | `winner.workflow.read`      |
| POST   | /api/v1/admin/potential-winners/:potential_winner_id/status                         | `winner.status.update`      |
| POST   | /api/v1/admin/promotions/:promotion_id/export-snapshots                             | `export.snapshot.create`    |
| GET    | /api/v1/admin/promotions/:promotion_id/export-snapshots                             | `export.snapshot.read`      |
| GET    | /api/v1/admin/export-snapshots/:snapshot_id                                         | `export.snapshot.read`      |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/validate                                | `export.snapshot.validate`  |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/finalize                                | `export.finalize`           |
| GET    | /api/v1/admin/export-snapshots/:snapshot_id/download                                | `export.download`           |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/deliver                                 | `export.deliver`            |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/results                                 | `winner.status.update`      |
| GET    | /api/v1/admin/dashboard                                                             | `dashboard.read`            |
| GET    | /api/v1/admin/orders                                                                | `order.read`                |
| GET    | /api/v1/admin/orders/:order_id                                                      | `order.read`                |
| GET    | /api/v1/admin/participants                                                          | `participant.list`          |
| GET    | /api/v1/admin/participants/:participant_id                                          | `participant.read`          |
| GET    | /api/v1/admin/participants/:participant_id/pii                                      | `pii.view.full`             |
| GET    | /api/v1/admin/audit-events                                                          | `audit.read`                |

**Todas están `IMPLEMENTED`**, con dos matices que importan y que se detallan en
cada bloque: las rutas de comercio dependen de un proveedor de pago que sigue sin
elegir (`CLAUDE.md` §7) y responden `503 PAYMENT_PROVIDER_NOT_CONFIGURED`; las de
sorteo y de finalización de export dependen de `@lsw/tpa` y `@lsw/audit`, que
`apps/api` todavía no tiene como dependencia, y responden `409` con código propio
en vez de improvisar.

---

## 11.1 Comercio

```text
Method: POST
Endpoint: /api/v1/checkout/session

Purpose:
Congelar el carrito de servidor en un pedido DRAFT y abrir una sesión de pago.

Authentication: sesión de participante

Request:
{
  "shipping_address": {
    "full_name": "...", "line1": "...", "line2": null,
    "city": "...", "region": "...", "postal_code": "...", "country": "US"
  },
  "return_url": "https://example.test/checkout/return"
}

`region`, no `state`: el nombre del campo no debe presuponer que la subdivisión
territorial se llama estado en toda jurisdicción cubierta. NO hay validación de
jurisdicción: la elegibilidad territorial la fijan las Official Rules y sigue en
docs/LEGAL_PENDING.md.

Response: 201
{
  "provider": "mock",
  "mode": "hosted_redirect",
  "client_config": { "redirect_url": "https://..." },
  "order_draft_id": "uuid"
}

`client_config` es DELIBERADAMENTE OPACO: cada proveedor necesita cosas distintas
y tiparlo obligaría a elegir proveedor, que es la decisión que no está tomada.
`mode` es `hosted_redirect` o `embedded_component`.

El pedido se crea en DRAFT ANTES de llamar al proveedor: es lo que da el
`order_draft_id` y lo que permite reintentar sin duplicar el cobro. Las líneas se
congelan aquí -SKU, nombre, precio y elegibilidad-: el precio que vale es el que
el participante vio al pulsar, no el que hubiera cuando el proveedor liquide.

Errors:
409 CART_EMPTY
503 PAYMENT_PROVIDER_NOT_CONFIGURED (hoy, siempre: el proveedor sigue sin elegir)
422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/checkout/sessions/{order_draft_id}

Purpose:
Estado de una sesión de pago.

Authentication: sesión de participante

Request: `order_draft_id` en la ruta

Response: 200
{ "order_draft_id": "uuid", "status": "PENDING", "order_id": null }

LA INTERFAZ NO DECIDE SI SE HA PAGADO. La página de retorno recibe del proveedor
unos parámetros en la URL y no se los cree: pregunta aquí, que es donde se ha
recibido -o no- el webhook firmado. Un `?outcome=paid` lo escribe cualquiera.

`order_id` es null mientras el pedido siga en DRAFT: hasta entonces no hay nada
que enseñar en el historial.

Errors: 404 ORDER_NOT_FOUND

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/webhooks/payments/{provider}

Purpose:
Recepción de eventos del proveedor de pago.

Authentication:
Verificación de FIRMA sobre el cuerpo CRUDO, antes de parsear. `apps/api`
instala un parser que entrega el Buffer intacto solo en esta ruta: un JSON
reserializado -aunque sea equivalente- ya no coincide con la firma.

Request: cuerpo crudo del proveedor + cabecera de firma

Response: 200 { "received": true } | 202 { "received": true }

202 significa que ese evento ya estaba procesado o lo está procesando otra
entrega simultánea. Es 2xx a propósito: un 4xx haría que el proveedor
reintentara en bucle.

Un manejador que falla también devuelve 200: el evento queda persistido en FAILED
y visible en GET /admin/payment-webhooks. Un 5xx solo conseguiría que el
proveedor reintentara contra el mismo fallo.

Errors:
401 UNAUTHENTICATED (firma inválida, o proveedor distinto del montado)
409 WEBHOOK_DIGEST_MISMATCH (mismo provider_event_id, cuerpo distinto)

Authorization: PUBLIC

Justificación de que sea PUBLIC: el llamante es el proveedor de pago, que no
tiene sesión. La autenticación es criptográfica, sobre la firma del cuerpo.

Owner: backend

Status: IMPLEMENTED
```

---

## 11.2 Portal del participante

Las rutas de esta sección se sirven **del ledger**, nunca de un contador.
`GET /account/entry-summary` devuelve un solo saldo con desglose por procedencia
-compra, AMOE, ajuste, sistema- porque compra y AMOE conviven en el MISMO
universo elegible (principio 9). Dos saldos separados dejarían de sumar en cuanto
hubiera una devolución.

```text
Method: GET
Endpoint: /api/v1/account/entry-summary

Purpose: saldo del participante en una promoción, con procedencia.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>

Response: 200
{
  "promotion_id": "uuid",
  "active_entries": 15, "purchase_entries": 12, "amoe_entries": 3,
  "admin_entries": 0, "system_entries": 0,
  "as_of": "2026-09-15T12:00:00.000Z"
}

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

PROMOTION_NOT_OPERATIONAL distingue "no existe" de "existe pero no tiene versión
de reglas activa o ventana": son informaciones distintas y la segunda es
accionable para operaciones.

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-transactions

Purpose: historial del ledger propio, correcciones incluidas.

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{ "items": [ { "id", "type", "source_type", "quantity_delta", "reason_key",
              "effective_at", "expires_at", "reverses_transaction_id" } ],
  "next_cursor": null }

Una devolución aparece como FILA NUEVA con delta negativo, no como la
desaparición de la original.

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-numbers

Purpose: rangos de números asignados ("mis números").

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{ "items": [ { "batch_id", "quantity", "first_number", "last_number" } ],
  "next_cursor": null }

Los números viajan como CADENA, jamás como número (DEC-010).

Detrás del flag visible_entry_numbers_enabled, apagado: con el flag apagado
devuelve 404, y con él encendido pero sin secuencia inicializada devuelve
409 ENTRY_NUMBER_FORMAT_NOT_CONFIGURED en vez de inventar un prefijo.

AVISO: la secuencia NO es el algoritmo del sorteo (DEC-017).

Errors: 404 NOT_FOUND; 409 ENTRY_NUMBER_FORMAT_NOT_CONFIGURED

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/award-holds

Purpose:
Concesiones RETENIDAS: pedidos que ya calificaron y cuyas participaciones esperan
a que se cumpla una condición del participante -hoy, la verificación del correo,
y solo si las Official Rules la exigen-.

Request: ?promotion_id=<uuid>

Response: 200
{ "items": [ { "id", "order_id", "promotion_id", "reason",
              "qualified_at", "held_at" } ], "next_cursor": null }

Es lo que explica un entry_state PENDING_QUALIFICATION que no avanza. Se sirve
aparte y no como un sexto valor del enum: frontend declara cinco y añadir uno
sería un cambio de contrato.

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/orders

Purpose: pedidos del propio participante.

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [OrderSummary], "next_cursor": null }

OrderSummary = { id, order_number, status, placed_at, total, item_count,
promotion_id, entry_state, entries_granted }.

`status` es la PROYECCIÓN del vocabulario de frontend
(PENDING_PAYMENT | PAID | FULFILLED | CANCELLED | REFUNDED |
PARTIALLY_REFUNDED | CHARGEBACK) derivada de las cuatro máquinas internas.
`entry_state` es un campo APARTE
(NOT_APPLICABLE | PENDING_QUALIFICATION | GRANTED | PARTIALLY_REVERSED |
REVERSED) y se DERIVA del ledger en cada lectura: no hay columna que lo guarde.

`entries_granted` es null -no 0- mientras no haya cifra.

Authorization: order.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/orders/{order_id}

Purpose: detalle de un pedido, con la traza del cálculo de entries.

Response: 200 OrderDetail = OrderSummary + { items, subtotal, shipping_total,
tax_total, shipping_address, entry_calculation }.

`entry_calculation` es { rules_version_id, engine_version, evaluated_at,
final_entries, trace } leído del EntryCalculationSnapshot persistido, con la
versión de motor de ESE movimiento y no la vigente hoy.

Errors: 404 ORDER_NOT_FOUND

Authorization: order.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/me

Purpose: perfil del participante autenticado.

Response: 200 { id, email, display_name, email_verified, language_preference,
created_at }

SIN fecha de nacimiento, estado de residencia ni edad. No es un olvido: la
elegibilidad la fijan las Official Rules y sigue en docs/LEGAL_PENDING.md.

Authorization: participant.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: PATCH
Endpoint: /api/v1/me

Purpose: cambiar nombre para mostrar e idioma preferido.

Request: { "display_name": "..." | null, "language_preference": "es-US" }

Solo esos dos campos. El correo NO se cambia por aquí: cambiarlo invalida la
verificación, y la verificación puede ser condición para acumular
participaciones. `language_preference` está acotado a en-US | es-US (DEC-021);
la RESPUESTA lo declara string porque el backend podría soportar un idioma que la
interfaz aún no tenga.

Response: 200 ParticipantProfile

Errors: 422 VALIDATION_FAILED

Authorization: participant.self.update

Owner: backend

Status: IMPLEMENTED
```

---

## 11.3 AMOE

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/amoe-config

Purpose: qué modalidad AMOE está vigente y qué exige.

Response: 200
{
  "enabled": false, "promotion_id": "<uuid>", "mode": null,
  "submission_window": { "opens_at": null, "closes_at": null },
  "identity_requirements": [],
  "required_fields": null,
  "instructions": null,
  "external_url": null,
  "entries_per_approved_submission": null, "requires_review": null,
  "max_per_participant_per_period": null, "limit_period": null
}

Con la vía encendida, los cuatro campos nuevos:

  promotion_id      la promoción por la que se preguntó. VIAJA TAMBIÉN CON LA VÍA
                    APAGADA: no es un parámetro de AMOE, es el dato con el que se
                    preguntó. La ruta se pide por slug y el envío se dirige por
                    identificador.

  required_fields   [{ key, type, required, label_key, max_length }] o null.
                    Se deriva UNA A UNA de identity_requirements, en ese orden.
                    ES LA PIEZA QUE IMPIDE QUE EL FRONTEND INVENTE EL FORMULARIO:
                    la interfaz pinta exactamente esos campos y ni uno más. Uno de
                    más es recogida de datos personales que nadie autorizó; uno de
                    menos, un envío que el backend rechaza con AMOE_PAYLOAD_INVALID.
                    type: TEXT | EMAIL | TEL | TEXTAREA | DATE | CODE. Gobierna qué
                    control se pinta; ninguna validación legal. label_key es una
                    clave de copy del frontend (DEC-022), sin namespace, no prosa
                    del backend. Se sirve en LAS CUATRO modalidades: el dominio
                    exige esas claves en cualquier envío que entre por la API.

  instructions      { "en-US", "es-US" } o null. EXCEPCIÓN CONSCIENTE A DEC-022:
                    aquí el backend SÍ publica prosa, porque es texto LEGALMENTE
                    CONTROLANTE (dirección postal, formato del sobre, plazos) que
                    escribe el abogado en PromotionRulesVersion.config. Se renderiza
                    tal cual, como las Reglas Oficiales. Los DOS locales son
                    obligatorios (DEC-021). null = no publicadas: la pantalla remite
                    al documento; nadie rellena ese hueco.

  external_url      destino de EXTERNAL_INSTRUCTIONS, o null. SOLO https:, validado
                    al leer la configuración. Un javascript: escrito en la
                    configuración rompe la promoción (409 AMOE_CONFIG_INVALID) en vez
                    de llegar a un navegador.

Origen: PromotionRulesVersion.config.amoe (DEC-012). Bloque opcional
identity_fields: { "<clave>": { type?, label_key?, max_length? } }, solo
presentación. Sin descriptor: type TEXT, label_key = la clave del payload,
max_length 500. Un descriptor de una clave que NO está en identity_requirements
no añade ningún campo.

Con el flag apagado responde enabled: false y NADA MÁS salvo promotion_id: si la
vía no existe, sus parámetros tampoco son asunto de nadie.

Errors: 404 PROMOTION_NOT_FOUND; 409 AMOE_CONFIG_INVALID

Authorization: PUBLIC

Justificación de que sea PUBLIC: la vía SIN COMPRA tiene que ser visible sin
cuenta. Exigir sesión para saber cómo participar gratis convertiría la cuenta en
un requisito de participación, que es justo lo que AMOE existe para evitar.

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/promotions/{promotion_id}/amoe-submissions

Purpose: enviar una participación sin compra.

Request: { "payload": { "<clave>": "<texto>" } }

`payload` es un mapa de clave a TEXTO: las cuatro modalidades piden datos
distintos y cuál aplica lo dirá el abogado. Las claves obligatorias las declara
identity_requirements.

Response: 201
{ "submission_id", "promotion_id", "status", "mode", "submitted_at",
  "entries_awarded" }

Una participación aprobada genera entries del MISMO tipo que una compra, con
source_type AMOE. La aprobación crea una transacción del ledger; nunca incrementa
un contador.

Errors:
404 NOT_FOUND (flag apagado)
409 AMOE_WINDOW_CLOSED
409 AMOE_LIMIT_REACHED
409 AMOE_DUPLICATE_SUBMISSION
409 AMOE_CONFIG_INVALID
422 VALIDATION_FAILED

Authorization: amoe.self.submit

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/amoe-submissions

Purpose: envíos AMOE del propio participante.

Request: ?promotion_id=<uuid>

Response: 200 { "items": [AmoeSubmission], "next_cursor": null }

NO devuelve el payload: contiene datos personales y el participante ya sabe lo
que envió. Lo que necesita es el ESTADO.

Authorization: PARTICIPANT_SELF

No existe capacidad de LECTURA de los envíos propios en el catálogo
(amoe.self.submit es de escritura). Se declara como recurso propio del
participante -que es lo que es- en vez de reutilizar una capacidad de escritura
para leer, o de inventar una que nadie podría conceder.

Owner: backend

Status: IMPLEMENTED
```

| Método | Endpoint                                       | Authorization         | Notas                                                                                                                                            |
| ------ | ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/admin/amoe-submissions?promotion_id=` | `amoe.review.read`    | Cola de revisión. Lleva `participant_id` interno; nunca el payload. Añade `entries_before`, `entries_if_approved` y `entries_after_if_approved`. |
| POST   | `/api/v1/admin/amoe-submissions/{id}/approve`  | `amoe.review.approve` | `reason_key` obligatorio (HO-034.1). Cantidad según la versión de reglas **del envío**, no la vigente hoy.                                       |
| POST   | `/api/v1/admin/amoe-submissions/{id}/reject`   | `amoe.review.reject`  | `reason_key` obligatorio. Un rechazo NO consume cuota del límite.                                                                                |

---

- **La cola proyecta el efecto de la decisión, calculado por el motor.** Quien
  aprueba tiene que ver antes, cambio y después, y el panel no puede producir
  ninguna de las tres: el saldo está en el ledger y la cantidad la fija la versión
  de reglas DEL ENVÍO. Restar en el cliente sería una segunda implementación del
  motor. `entries_before` siempre trae número (cero es un saldo conocido);
  `entries_if_approved` y `entries_after_if_approved` son `null` cuando esa versión
  de reglas ya no declara AMOE legible: la aprobación fallaría, y una cifra que no
  se va a cumplir es peor que ninguna. NO son acumulativas entre filas: cada una
  contesta "si apruebo ESTA".
- **El campo de participaciones se llama `entries_awarded` en las TRES formas
  AMOE** (respuesta de envío, listado del participante y cola de revisión). No es
  `entries` ni `entries_granted`; `entries_granted` es de `OrderSummary` y ahí se
  queda.

## 11.4 Ajustes, descalificación, devoluciones y webhooks

| Método | Endpoint                                       | Authorization            | Step-up |
| ------ | ---------------------------------------------- | ------------------------ | ------- |
| GET    | `/api/v1/admin/entry-adjustments`              | `entry.ledger.read`      | no      |
| POST   | `/api/v1/admin/entry-adjustments`              | `entry.adjust.create`    | sí      |
| POST   | `/api/v1/admin/entry-adjustments/{id}/approve` | `entry.adjust.approve`   | sí      |
| POST   | `/api/v1/admin/entry-adjustments/{id}/reject`  | `entry.adjust.approve`   | sí      |
| POST   | `/api/v1/admin/participants/{id}/disqualify`   | `participant.disqualify` | sí      |
| POST   | `/api/v1/admin/orders/{id}/refund`             | `order.refund.initiate`  | sí      |
| GET    | `/api/v1/admin/payment-webhooks`               | `payment.webhook.read`   | no      |
| POST   | `/api/v1/admin/payment-webhooks/{id}/replay`   | `payment.webhook.replay` | sí      |

Notas que no caben en la tabla y que importan:

- **`entry.adjust.create` y `entry.adjust.approve` se comprueban tres veces**: el
  autorizador de la ruta, `AdjustmentService.approve` y el CHECK
  `adjustments_approver_differs` de la migración 0022. Las dos primeras se pueden
  saltar cambiando código; la tercera no.
- **Aprobar un ajuste lleva cuerpo, como rechazarlo**:
  `{ reason_key, notes? }`, con `reason_key` en la forma
  `^[A-Z][A-Z0-9_]{2,63}# API_CONTRACT.md

**Fuente de verdad compartida entre `frontend` y `backend`** para todas las
APIs de Lone Star Winners.

## Reglas

1. **Un agente no debe asumir una API que no esté documentada aquí.**
   Si el frontend necesita un endpoint inexistente, abre un handoff en
   `docs/AGENT_HANDOFF.md`; no lo inventa ni lo mockea como definitivo.
2. El **owner** de un endpoint es quien lo implementa y mantiene. Nadie más
   cambia su forma sin handoff.
3. **Ningún cambio de API es silencioso.** Modificar request, response,
   códigos de error o autorización obliga a actualizar esta entrada.
4. Un cambio incompatible con lo ya implementado requiere además una entrada
   en `docs/DECISIONS.md`.
5. **No se crean APIs alternativas** para evitar coordinarse.
6. Los ejemplos de request/response **no contienen datos reales** ni secretos.
7. `Status: PROPOSED` significa que el frontend puede diseñar contra el
   contrato, pero **no** asumir que existe.
8. **El campo `Authorization:` es obligatorio** en toda entrada (DEC-015), con
   el nombre exacto del permiso del catálogo de `@lsw/security`. Un test de
   contrato compara `apps/api/openapi/route-manifest.json` contra este
   documento y falla en CI si una ruta existe en código y no aquí.

## Estados

- `PROPOSED` — acordado en papel, aún no implementado.
- `IMPLEMENTED` — existe en el backend y respeta este contrato.
- `TESTED` — cubierto por pruebas y revisado por `security-integration`.

---

## Plantilla

```text
Method:
Endpoint:

Purpose:

Authentication:

Request:

Response:

Errors:

Authorization:

Owner:

Status:
PROPOSED / IMPLEMENTED / TESTED
```

---

# Convenciones transversales

Estas convenciones aplican a **todos** los endpoints y no se repiten en cada
entrada.

## Prefijo y versión

Toda ruta cuelga de `/api/v1/`. La base la publica el backend por
`API_BASE_URL`; el frontend nunca la compone a mano.

`apps/api` corre como proceso separado de `apps/web` (DEC-004). El frontend
consume por HTTP, incluso desde el servidor.

## Autorización (DEC-015)

Los valores admitidos en `Authorization:` son tres, y solo tres:

| Valor                          | Significado                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `PUBLIC`                       | Sin sesión. La ruta debe justificar por escrito por qué lo es, en el código.    |
| `PARTICIPANT_SELF`             | Sesión de participante; la ruta solo devuelve recursos del propio participante. |
| `<dominio>.<recurso>.<acción>` | Capacidad exacta del catálogo de `@lsw/security` (DEC-027).                     |

El registro central de `apps/api` es **deny-by-default**: una ruta sin
autorización declarada **no arranca el proceso**.

Ojo con el vocabulario del catálogo: es `rules.version.read` (no
`rules_version.read`), y `product.write` / `product.publish` son capacidades
distintas (editar una ficha no es decidir qué se puede comprar).

## Errores (DEC-022, DEC-031)

Envelope único, en todas las rutas y en todos los códigos:

```json
{
  "error": {
    "code": "PROMOTION_NOT_FOUND",
    "details": { "slug": "example-promotion" },
    "request_id": "01JC000000000000000000EXAMPLE"
  }
}
```

- `code` **es la clave canónica de traducción**. No existe `message_key`, ni
  `message_en`, ni `message_es`.
- `details` es siempre estructurado. **Nunca prosa.**
- El copy en ambos idiomas pertenece a `frontend` (`messages/en-US.json` y
  `messages/es-US.json`).

Códigos transversales: `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`STEP_UP_REQUIRED` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (422),
`RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).

## Dinero y entries (DEC-010)

**Nunca coma flotante.**

- Dinero: `{ "amount_minor": "1999", "currency": "USD" }`. El importe viaja
  como **cadena de dígitos**, no como número: un entero grande no sobrevive a
  `JSON.parse` sin riesgo de perder precisión.
- Cantidades de entries: entero.
- Multiplicadores: `{ "numerator": 2, "denominator": 1 }`.
- Números de entry: **cadena** (`"LSW26-000450001"`), jamás número.

## Tiempo (DEC-011)

Todo instante es ISO-8601 en UTC (`2026-09-15T12:00:00.000Z`). Cada promoción
declara además su `legal_timezone` IANA, y **los deadlines los evalúa el
servidor** contra esa zona. El navegador nunca es fuente de verdad.

## Texto (DEC-022, DEC-030)

Tres categorías, con tres dueños distintos:

1. **Copy de producto** — vive en los diccionarios de `frontend`. El backend
   manda códigos.
2. **Contenido dinámico localizado** — títulos, nombres de premio,
   descripciones de producto. Viaja por locale desde el backend:
   `{ "en-US": "...", "es-US": "..." }`. Ambas claves obligatorias.
   `frontend` lo renderiza tal cual y **no lo traduce jamás**.
3. **Texto legalmente controlante** — Official Rules y disclaimers. Viaja con
   `is_legally_controlling` e `is_informational_translation`, y se renderiza
   literalmente.

## Locale

Cabecera `Accept-Language` con la **etiqueta completa** (`en-US`, `es-US`), no
el segmento de ruta (`en`, `es`) — DEC-029.

## Paginación

Por **cursor**, nunca por offset: con offset, una entrada nueva durante la
paginación desplaza filas y el cliente ve duplicados o huecos.

```json
{ "items": [], "next_cursor": "opaque-string-or-null" }
```

Parámetros: `?cursor=<opaque>&limit=<1..100>`. El cursor es opaco: el cliente
no lo interpreta.

---

# Endpoints

## Estado de esta sección

Poblada por `backend` resolviendo `HO-016` y reconciliando las listas P0 de
`frontend` y `backend` (`HO-005`).

**Hay 15 rutas `IMPLEMENTED`** tras el hito B3: las tres de infraestructura,
la configuración pública, las cuatro de storefront (promociones y catálogo) y
las cinco del carrito de servidor con su cotización de entries. Todo lo demás
sigue en `PROPOSED`: acordado en papel, para que `frontend` diseñe contra ello,
y **no asumible como existente**.

`IMPLEMENTED` **no es** `TESTED`: significa que existe en el backend y respeta
este contrato, con pruebas propias de `backend`. La revisión de
`security-integration` es lo que las mueve a `TESTED`.

### Aviso sobre las rutas del carrito

Las cinco rutas de carrito están implementadas y probadas, y **hoy devuelven
`401 UNAUTHENTICATED`**. No es un fallo: un carrito pertenece a alguien, y quien
resuelve esa identidad —participante o sesión anónima— es `packages/security`
(DEC-006). `apps/api` declara el puerto (`lswPrincipalResolver`) y su valor por
defecto no conoce a nadie.

Inventar una cookie de carrito propia en `apps/api` las habría hecho funcionar
antes creando un segundo sistema de sesión, que es lo que prohíbe `CLAUDE.md`
sección 4. En cuanto `packages/security` sustituya ese puerto, las rutas
funcionan sin tocar una línea de este contrato.

### Índice de rutas implementadas

Con el **camino tal y como lo declara el código** (`:slug`, no `{slug}`). Las
entradas detalladas de más abajo usan la notación OpenAPI `{slug}`, que es la
misma ruta escrita de otra forma; esta tabla es la que permite comparar el
documento contra `apps/api/openapi/route-manifest.json` sin interpretar el
markdown, y es lo que verifica el test de contrato de DEC-015.

| Método | Camino                                  | Authorization      |
| ------ | --------------------------------------- | ------------------ |
| GET    | /api/v1/config                          | `PUBLIC`           |
| GET    | /api/v1/promotions                      | `PUBLIC`           |
| GET    | /api/v1/promotions/active               | `PUBLIC`           |
| GET    | /api/v1/promotions/:slug                | `PUBLIC`           |
| GET    | /api/v1/promotions/:slug/official-rules | `PUBLIC`           |
| GET    | /api/v1/products                        | `PUBLIC`           |
| GET    | /api/v1/products/:slug                  | `PUBLIC`           |
| GET    | /api/v1/cart                            | `PARTICIPANT_SELF` |
| POST   | /api/v1/cart/items                      | `PARTICIPANT_SELF` |
| PATCH  | /api/v1/cart/items/:item_id             | `PARTICIPANT_SELF` |
| DELETE | /api/v1/cart/items/:item_id             | `PARTICIPANT_SELF` |
| GET    | /api/v1/cart/entry-quote                | `PARTICIPANT_SELF` |
| POST   | /api/v1/auth/login                      | `PUBLIC`           |
| POST   | /api/v1/auth/mfa/verify                 | `PUBLIC`           |
| GET    | /api/v1/auth/session                    | `PUBLIC`           |
| POST   | /api/v1/auth/logout                     | `PUBLIC`           |

Las tres de infraestructura (`/api/v1/health`, `/api/v1/health/ready`,
`/api/v1/openapi.json`) están documentadas más abajo y exentas de ese gate por
etiqueta `meta`: no las consume `frontend`.

### Aviso sobre `amount_minor`

Es **cadena de dígitos**, no número, en todas las rutas ya implementadas
(DEC-010). El contrato provisional de `apps/web` (`src/lib/api/contract.ts`)
lo declara como `number`; esa divergencia hay que resolverla en el frontend, no
aquí, y desaparece cuando se consuman los tipos generados del OpenAPI (DEC-014).

---

## 1. Infraestructura (`meta`)

Estas rutas no las consume `frontend`: las consulta el orquestador. Se listan
para que el documento describa la superficie completa.

```text
Method: GET
Endpoint: /api/v1/health

Purpose:
Liveness. "El proceso responde." NO consulta la base de datos a propósito: si
lo hiciera, un incidente de PostgreSQL provocaría que el orquestador reiniciara
procesos sanos y empeorara la caída.

Authentication: ninguna

Request: sin parámetros

Response: 200 { "status": "ok" }

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/health/ready

Purpose:
Readiness. "Puedo atender tráfico." Sí comprueba la base de datos.

Authentication: ninguna

Request: sin parámetros

Response:
200 | 503 { "status": "ready" | "degraded", "checks": [{ "name": "database", "ok": true }] }

Devuelve el nombre de cada comprobación y si pasó. Nunca el detalle del fallo:
un healthcheck es el endpoint que cualquiera puede consultar, y por tanto el
peor sitio para dar pistas.

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/openapi.json

Purpose:
Documento OpenAPI 3.1 generado desde los esquemas Zod (DEC-014). No es una API
documentada por este contrato: ES este contrato en forma legible por máquina.

Authentication: ninguna

Request: sin parámetros

Response: 200 documento OpenAPI 3.1

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

---

## 2. Configuración pública

```text
Method: GET
Endpoint: /api/v1/config

Purpose:
Feature flags legalmente materiales y modalidad AMOE vigente, leídos en
servidor (DEC-013). Es lo que decide QUÉ renderiza la interfaz.

Authentication: ninguna

Request: sin parámetros

Response: 200
{
  "feature_flags": {
    "amoe_enabled": false,
    "visible_entry_numbers_enabled": false,
    "internal_draw_enabled": false,
    "state_eligibility_enforcement_enabled": false,
    "age_gate_enabled": false,
    "entry_multipliers_enabled": false,
    "entry_caps_enabled": false,
    "entry_expiration_enabled": false,
    "winner_publication_enabled": false,
    "manual_adjustments_enabled": false,
    "provisional_entries_enabled": false,
    "dual_approval_for_sensitive_actions_enabled": true
  },
  "amoe_mode": null,
  "supported_locales": ["en-US", "es-US"]
}

Las 12 claves son las de DEC-032. `amoe_mode` es un enum
(`ONLINE_FORM` | `MAIL_IN_REVIEW` | `CODE` | `EXTERNAL_INSTRUCTIONS`) o `null`
cuando todavía no hay modalidad elegida. NO existe el valor `DISABLED`: si hay
vía AMOE lo responde `amoe_enabled` y solo él.

Esta respuesta NO se cachea. Un flag legalmente material que se apaga en el
admin tiene que apagarse en la siguiente petición.

Errors: ninguno propio

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

---

## 3. Storefront: promociones

```text
Method: GET
Endpoint: /api/v1/promotions

Purpose:
Listado de promociones visibles al público.

Authentication: ninguna

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [PromotionSummary], "next_cursor": null }

Errors: VALIDATION_FAILED (422) si el cursor o el límite no son válidos

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/active

Purpose:
La promoción activa, para la portada.

Authentication: ninguna

Request: sin parámetros

Response: 200 PromotionSummary

Errors:
404 NOT_FOUND cuando no hay ninguna promoción activa.

NOTA PARA `frontend`: ese 404 NO es un error. Es un estado normal del negocio
-el periodo entre promociones- y debe renderizarse como estado vacío, no como
fallo.

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}

Purpose:
Detalle de una promoción.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200 PromotionDetail

Errors:
404 PROMOTION_NOT_FOUND. Aquí el 404 SÍ es significativo: la ruta apunta a un
slug concreto, así que debe acabar en la página 404.

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/official-rules

Purpose:
Texto legalmente controlante de la versión de reglas vigente (DEC-012,
excepción de DEC-022).

Authentication: ninguna

Request: `slug` en la ruta

Response: 200
{
  "rules_version_id": "uuid",
  "version": 1,
  "effective_at": "2026-09-01T05:00:00.000Z",
  "documents": [
    {
      "locale": "en-US",
      "title": "...",
      "body": "...",
      "is_legally_controlling": true,
      "is_informational_translation": false
    }
  ]
}

`frontend` renderiza este texto TAL CUAL. No lo traduce, no lo autotraduce y no
hace fallback de un idioma al otro. Puede no haber ningún documento marcado
como controlante: el idioma controlante sigue en `TBD`
(`docs/LEGAL_PENDING.md`), y el sistema no lo adivina.

Errors: 404 PROMOTION_NOT_FOUND, 404 RULES_VERSION_NOT_FOUND

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

### Forma de `PromotionSummary`

```json
{
  "id": "uuid",
  "slug": "example-promotion",
  "status": "ACTIVE",
  "title": { "en-US": "...", "es-US": "..." },
  "summary": { "en-US": "...", "es-US": "..." },
  "legal_timezone": "America/Chicago",
  "starts_at": "2026-09-01T05:00:00.000Z",
  "ends_at": "2026-10-01T05:00:00.000Z",
  "rules_version_id": "uuid",
  "prize_value": { "amount_minor": "5000000", "currency": "USD" }
}
```

`status` usa el enum canónico de `@lsw/sweepstakes`: `DRAFT`, `SCHEDULED`,
`ACTIVE`, `CLOSED`, `EXPORT_PREPARATION`, `DRAW_PENDING`,
`POTENTIAL_WINNER_REVIEW`, `COMPLETED`, `CANCELLED`.

`rules_version_id` y `prize_value` pueden ser `null` mientras no haya versión
de reglas activa o premio configurado. La interfaz debe poder representar ese
caso sin inventarse nada.

**`prize_value` es `null` SIEMPRE hoy.** No existe todavía ninguna tabla de
premios ni ninguna clave de premio en `PromotionRulesVersion`, y el valor de un
premio es un dato legalmente material que nadie ha aprobado (principio 2). El
campo se sirve para que `frontend` no tenga que cambiar de forma cuando exista.
Modelar el premio requiere una decisión previa: es un handoff abierto, no un
olvido de implementación.

`DRAFT` **no sale nunca** al público: `GET /promotions` la omite y
`GET /promotions/{slug}` devuelve `PROMOTION_NOT_FOUND`. El resto de estados sí,
`CANCELLED` incluido: una promoción que estuvo publicada y se canceló tiene que
poder explicarse, y hacerla desaparecer dejaría un enlace roto sin motivo.

El cursor de `GET /promotions` ordena por `slug`. Es opaco: no se interpreta.

### Forma de `PromotionDetail`

`PromotionSummary` más un objeto `rules_version`, que puede ser `null`:

```json
{
  "rules_version": {
    "id": "uuid",
    "version": 1,
    "effective_at": "2026-09-01T05:00:00.000Z",
    "has_controlling_document": false
  }
}
```

`has_controlling_document` puede ser `false` con documentos publicados: el
idioma controlante sigue en `TBD` (`docs/LEGAL_PENDING.md`) y el sistema no lo
adivina.

---

## 4. Storefront: catálogo

```text
Method: GET
Endpoint: /api/v1/products

Purpose:
Catálogo de mercancía elegible.

Authentication: ninguna

Request: ?cursor=<opaque>&limit=<1..100>&promotion_slug=<slug>

Response: 200 { "items": [ProductSummary], "next_cursor": null }

Cada producto trae `name` y `description` como contenido localizado (DEC-030) y
sus variantes con precio en unidad menor.

IMPORTANTE: el catálogo NO declara cuántas entries da un producto. La
elegibilidad y la fórmula pertenecen a la `PromotionRulesVersion` (DEC-012). Si
el número de entries viviera en el producto, editar el catálogo cambiaría
retroactivamente lo que significó una compra pasada.

Errors: VALIDATION_FAILED (422)

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/products/{slug}

Purpose:
Ficha de producto con sus variantes.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200 ProductDetail

Errors: 404 PRODUCT_NOT_FOUND

Authorization: PUBLIC

Owner: backend

Status: IMPLEMENTED
```

### Forma de `ProductSummary` y `ProductDetail`

Son **la misma forma**. La ficha no devuelve nada que el listado no devuelva, y
mantener dos formas casi iguales sólo produce que una se quede atrás:

```json
{
  "id": "uuid",
  "sku": "LSW-TEE",
  "slug": "example-tee",
  "name": { "en-US": "...", "es-US": "..." },
  "description": { "en-US": "...", "es-US": "..." },
  "currency": "USD",
  "variants": [
    {
      "id": "uuid",
      "sku": "LSW-TEE-M",
      "price": { "amount_minor": "2500", "currency": "USD" },
      "availability": { "status": "IN_STOCK" }
    }
  ]
}
```

`description` puede ser `null`.

**`availability` sustituye a `stock_quantity` (HO-017).** El catálogo ya **no
publica el inventario exacto**. Estas dos rutas son **anónimas** y publicaban
`stock_quantity` en crudo mientras el carrito —que va con sesión— deliberadamente
no lo publicaba: una de las dos superficies estaba mal, y se resuelve hacia la
que **no filtra** información de negocio, que es además lo que HO-017 pedía.

Es **el mismo objeto** que la línea del carrito (sección 5): mismo enum estable
de tres valores, misma columna `product_variants.stock_quantity` y **el mismo
predicado**, el que decide el `409 INSUFFICIENT_STOCK` —`fitsStock`, hoy en
`apps/api/src/services/availability.ts`, importado por el catálogo y por las dos
mutaciones del carrito, para que no existan dos definiciones de "hay
existencias"—. La única diferencia es **la cantidad por la que se pregunta**: en
el carrito es la de la línea; aquí es **una unidad**, porque en la ficha nadie ha
elegido todavía cuántas quiere. La pregunta del catálogo es, literalmente, "¿se
puede comprar una unidad?":

| stock de la variante   | `status`       | significado                                  |
| ---------------------- | -------------- | -------------------------------------------- |
| no gestionado (`null`) | `IN_STOCK`     | nada limita la compra; **`null` no es cero** |
| `0` o menos            | `OUT_OF_STOCK` | añadir la primera unidad devolvería `409`    |
| exactamente `1`        | `LOW_STOCK`    | queda justo la unidad por la que se pregunta |
| mayor que `1`          | `IN_STOCK`     | queda margen                                 |

`null` sigue significando "existencias no gestionadas": esa variante da
`IN_STOCK` y se puede añadir al carrito en cualquier cantidad admitida. El
umbral de `LOW_STOCK` **no es un número de negocio** —nadie ha aprobado ninguno
y el principio 2 de `CLAUDE.md` prohíbe inventarlo—: es la cantidad preguntada,
igual que en la sección 5.

`availability` es un **objeto** y no una cadena, por el mismo motivo que allí:
el día que se decida publicar la cantidad, el campo cabe dentro sin cambiar el
tipo de lo ya publicado. Hoy **sólo** lleva `status`; `quantity_available` no se
publica en ninguna de las dos superficies.

`is_purchasable` —"¿está a la venta?", que no es la misma pregunta que "¿hay
existencias?"— **sigue pendiente** (HO-017) y **no** se deduce de `availability`:
una variante retirada o no publicada puede tener existencias de sobra. Cuando se
decida, se documenta aquí antes de implementarse.

Sólo salen productos y variantes en `ACTIVE`. El parámetro `promotion_slug` que
figuraba en la propuesta **no está implementado**: la elegibilidad no vive en el
catálogo (DEC-012), así que filtrar por promoción exigiría que el listado
aplicase reglas legales, que es justo lo que este endpoint no debe hacer. El
cursor ordena por `slug`.

---

## 5. Carrito de servidor (DEC-023)

**El carrito vive en el servidor.** La cotización de entries se calcula sobre
el carrito del servidor, nunca sobre una lista de ítems enviada por el cliente:
en un producto donde una cifra de entries mal calculada es un problema legal,
la traza de qué se cotizó y cuándo vale más que la simplicidad.

Todas las rutas de esta sección devuelven **`CartWithQuote`**:

```json
{
  "id": "uuid",
  "currency": "USD",
  "updated_at": "2026-09-15T12:00:00.000Z",
  "item_count": 2,
  "lines": [
    {
      "id": "uuid",
      "variant_id": "uuid",
      "product_slug": "example-tee",
      "sku": "LSW-TEE-M",
      "name": { "en-US": "...", "es-US": "..." },
      "quantity": 2,
      "unit_price": { "amount_minor": "2500", "currency": "USD" },
      "line_subtotal": { "amount_minor": "5000", "currency": "USD" },
      "image_url": null,
      "availability": { "status": "IN_STOCK" }
    }
  ],
  "subtotal": { "amount_minor": "5000", "currency": "USD" },
  "entry_quote": null
}
```

- `subtotal` es **dinero**; `entry_quote` son **entries**. No son lo mismo y no
  se derivan uno del otro.
- `entry_quote` es `null` cuando no hay promoción activa. Un carrito sigue
  siendo válido en el periodo entre promociones: se puede comprar mercancía sin
  que haya nada que cotizar, y hacer fallar `GET /cart` impediría hasta vaciarlo.
- `currency` y `subtotal` son `null` en un carrito vacío: sin líneas no hay
  moneda que declarar.
- `id` es `00000000-0000-0000-0000-000000000000` cuando el solicitante no tiene
  carrito. **Leer no crea nada**: un `GET` que insertara una fila haría que cada
  rastreador dejara un carrito vacío en la base de datos.

**`updated_at`, `item_count`, `image_url` y `availability` (HO-017).**

- `updated_at` es el instante de la **última mutación del carrito, líneas
  incluidas**. ISO-8601 UTC. Existe por el motivo que dio `frontend` y que no es
  cosmético: comparado con `entry_quote.evaluated_at` es lo que permite saber
  que la cifra de entries en pantalla **ya no corresponde al carrito**. Lo pone
  el motor —`carts_set_updated_at` sobre la fila y `cart_items_touch_cart`
  (migración `0025`) cuando cambian las líneas—, nunca el reloj del proceso que
  responde. Vale `null` **sólo** en el carrito vacío sintético: ahí no existe
  fila, y devolver `now()` sería afirmar que un carrito inexistente acaba de
  cambiar.
- `item_count` es la **suma de `quantity`** de las líneas, entero. No es el
  número de líneas: dos unidades de la misma variante son una línea y cuentan
  dos. Vale `0` —nunca `null`— en un carrito vacío: contar cero cosas es cero.
  No entra en ninguna aritmética de entries; es una cuenta de mercancía.
- `image_url` es hoy **siempre `null`**, y se publica igualmente. El esquema
  **no tiene ninguna tabla de medios** —no existe `media`, `product_media` ni
  `variant_media`, ni ninguna columna de imagen en `products` o
  `product_variants`— y `backend` no inventa una para rellenar un campo. Se
  declara nulable para que `frontend` deje de degradar su tipo y pinte su
  marcador de posición sabiendo por qué. Su tipo es `string | null` y **no**
  `url`: sin modelo de medios nadie ha decidido si la referencia será absoluta,
  relativa o de un CDN, y fijarlo aquí sería tomar esa decisión de pasada.
- `availability` es un **objeto**, no una cadena: `{ "status": ... }`. Hoy sólo
  lleva `status`. **No publica la cantidad exacta de existencias**: HO-017 lo
  pide expresamente y ninguna decisión de `docs/DECISIONS.md` autoriza lo
  contrario. Que sea objeto y no cadena permite añadir el campo el día que se
  decida, sin cambiar el tipo de lo ya publicado.

`availability.status` sale de `product_variants.stock_quantity` —**la misma
columna que decide el `409 INSUFFICIENT_STOCK`**, nunca de una segunda lectura
del inventario— y de la cantidad de **esa** línea:

| stock de la variante   | `status`       | significado                                               |
| ---------------------- | -------------- | --------------------------------------------------------- |
| no gestionado (`null`) | `IN_STOCK`     | nada limita esta línea; `null` no es cero                 |
| menor que `quantity`   | `OUT_OF_STOCK` | la línea ya **no cabe**: pedir esa cantidad daría `409`   |
| igual a `quantity`     | `LOW_STOCK`    | se lleva exactamente lo que queda; no cabe una unidad más |
| mayor que `quantity`   | `IN_STOCK`     | queda margen                                              |

El umbral de `LOW_STOCK` es **la propia línea** y no un número. Lo habitual
sería "quedan menos de N", pero ese N es una constante de negocio que nadie ha
aprobado, y el principio 2 de `CLAUDE.md` prohíbe inventarla. La definición de
arriba no inventa nada: sale entera de la comparación que ya decide el `409`.

`status` es un **enum estable**; el copy es de `frontend` (DEC-022).
`OUT_OF_STOCK` significa "esta cantidad no se puede servir hoy", que puede
querer decir "quedan 3 y pediste 5": la etiqueta que se enseñe es decisión de
`frontend`, no de la API.

`availability` **no** responde "¿está a la venta?". Una variante retirada o no
publicada es otra pregunta —la que HO-017 llama `is_purchasable`—, sigue pedida
para el catálogo (sección 4) y **no** se deduce de ésta.

- Una variante aparece **como máximo una vez** por carrito. Añadir la misma
  variante dos veces **suma cantidad**; no duplica la línea.
- Un carrito tiene **una sola moneda**. Mezclarlas devuelve
  `409 CART_CURRENCY_MISMATCH`; lo impone además un trigger.
- `quantity` está acotada a `1..10000` por línea. No es un límite legal —los
  topes de entries son otra cosa y viven en la `PromotionRulesVersion`—: es un
  límite operativo.

```text
Method: GET
Endpoint: /api/v1/cart

Purpose:
Carrito vigente de la sesión, con su cotización de entries.

Authentication: sesión (participante o anónima con cookie de carrito)

Request: sin parámetros

Response: 200 CartWithQuote

Errors: ninguno propio; un carrito inexistente devuelve uno vacío

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/cart/items

Purpose:
Añadir una variante al carrito.

Authentication: sesión

Request: { "variant_id": "uuid", "quantity": 1 }

Response: 200 CartWithQuote

Errors:
404 PRODUCT_NOT_FOUND, 409 VARIANT_NOT_PURCHASABLE, 409 INSUFFICIENT_STOCK,
422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: PATCH
Endpoint: /api/v1/cart/items/{item_id}

Purpose:
Cambiar la cantidad de una línea.

Authentication: sesión

Request: { "quantity": 3 }

Response: 200 CartWithQuote

Errors: 404 CART_ITEM_NOT_FOUND, 409 INSUFFICIENT_STOCK, 422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: DELETE
Endpoint: /api/v1/cart/items/{item_id}

Purpose:
Quitar una línea.

Authentication: sesión

Request: `item_id` en la ruta

Response: 200 CartWithQuote

Errors: 404 CART_ITEM_NOT_FOUND

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/cart/entry-quote

Purpose:
Cotización de entries del carrito de servidor, con desglose auditable.

Resuelve el conflicto de nombres de `HO-005`: `frontend` proponía
`POST /entries/quote` y `backend` `POST /api/v1/entry-quotes/cart`. Gana un
`GET` sobre el carrito, porque DEC-023 ya hace del carrito el recurso y una
cotización es una LECTURA derivada de él. Un `POST` sugeriría que el cliente
aporta los ítems, que es justo lo que DEC-023 descarta.

Authentication: sesión

Request: sin cuerpo

Response: 200
{
  "promotion_id": "uuid",
  "rules_version_id": "uuid",
  "engine_version": 1,
  "evaluated_at": "2026-09-15T12:00:00.000Z",
  "eligible_subtotal": { "amount_minor": "3000", "currency": "USD" },
  "entries_before_caps": 30,
  "final_entries": 25,
  "eligible_items": [
    { "line_id": "...", "sku": "...", "quantity": 3, "multiplier_ids": ["labor-day-2x"] }
  ],
  "ineligible_items": [{ "line_id": "...", "sku": "...", "reason_key": "PRODUCT_NOT_ELIGIBLE" }],
  "applied_multipliers": [
    { "id": "labor-day-2x", "numerator": 2, "denominator": 1 }
  ],
  "applied_caps": [
    { "kind": "PER_ORDER", "limit": 25, "entries_before": 30, "entries_after": 25 }
  ]
}

`reason_key` y `kind` son enums estables; el copy es de `frontend` (DEC-022).

Esta cifra es ORIENTATIVA hasta que la orden alcance el estado que las Official
Rules definan como cualificante. Las entries las genera el backend al recibir
la confirmación de pago, NUNCA cuando el frontend llega a la página de éxito.

PRECISIONES DE LA IMPLEMENTACIÓN

- `eligible_subtotal` es `null` cuando el carrito está vacío: sin líneas no hay
  moneda que declarar. `entries_before_caps` y `final_entries` valen `0`.
- `line_id` es el identificador de la línea del carrito de servidor
  (`cart_items.id`), el mismo que devuelve `CartWithQuote`. Permite casar la
  cotización con la línea sin que el cliente aporte nada.
- Sin carrito, la respuesta es la cotización de un carrito vacío, no un 404: la
  respuesta correcta a "cuántas entries genera mi carrito" cuando no hay carrito
  es "cero", y así el frontend recibe igualmente la promoción y la versión de
  reglas vigentes.
- `applied_multipliers` sólo aparece con `entry_multipliers_enabled` encendido;
  `applied_caps`, con `entry_caps_enabled` (DEC-032). Con los flags apagados
  ambas listas van vacías.
- `engine_version` es la versión del motor de cálculo, no la del paquete. Junto
  con `rules_version_id` es lo que hace reproducible la cifra (DEC-007).

**NO HAY FORMA DE ENVIAR ÍTEMS.** Es un `GET` sin cuerpo, y los parámetros de
query se ignoran. Está cubierto por un test que lo intenta.

Errors:
409 NO_ACTIVE_PROMOTION, 409 CALCULATION_CONFIG_INVALID,
409 MULTIPLIER_CONFLICT_UNRESOLVED, 409 CURRENCY_MISMATCH,
409 RESULT_EXCEEDS_SAFE_RANGE

Los tres últimos los emite el motor de cálculo y viajan con su propio `code`
(DEC-031). `MULTIPLIER_CONFLICT_UNRESOLVED` significa que la configuración
declara `EXCLUSIVE` y dos periodos se solapan: el motor **falla en vez de
desempatar por su cuenta**, y eso se corrige en la configuración legal, no en el
cliente.

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

### Fórmulas de cálculo admitidas (motor `engine_version: 1`)

La fórmula la fija `PromotionRulesVersion.purchase_entry_formula` (DEC-012). El
motor admite cuatro modos y **cada uno declara su propia `rounding_policy`**
(`FLOOR` | `CEIL` | `HALF_UP` | `HALF_DOWN` | `HALF_EVEN`), obligatoria y sin
valor por defecto:

| Modo                        | Campos                                               |
| --------------------------- | ---------------------------------------------------- |
| `FIXED_PER_ORDER`           | `entries`                                            |
| `FIXED_PER_PRODUCT`         | `entries_per_unit`                                   |
| `ENTRIES_PER_CURRENCY_UNIT` | `amount_unit_minor`, `entries_per_amount_unit`       |
| `TIERED_BY_AMOUNT`          | `tiers[] { id, min_eligible_amount_minor, entries }` |

`partial_refund_rounding_policy` es la política de **otra** operación —cómo se
prorratea una devolución parcial— y ya no gobierna el cálculo base.

`entries_per_amount_unit` es un par de enteros `{ numerator, denominator }`
(DEC-010), nunca un decimal. `TIERED_BY_AMOUNT` aplica el escalón **más alto**
cuyo umbral no supere el subtotal elegible, y los escalones **no se acumulan**;
la traza lo registra en `tier_selection` y `applied_tier_id`.

Esta tabla describe lo que el motor **puede** expresar. Cuál se usa lo decide el
abogado del cliente: hoy `purchase_entry_formula` sigue en `TBD`
(`docs/LEGAL_PENDING.md`) y ninguna promoción puede activarse sin resolverla.

---

## 6. Portal del participante

```text
Method: GET
Endpoint: /api/v1/account/entry-summary

Purpose:
Saldo de entries del participante en una promoción, con su procedencia.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>

Response: 200
{
  "promotion_id": "uuid",
  "active_entries": 15,
  "purchase_entries": 12,
  "amoe_entries": 3,
  "as_of": "2026-09-15T12:00:00.000Z"
}

Compra y AMOE conviven en el MISMO universo elegible conservando su procedencia
(principio 9). Nunca son dos saldos separados.

El número sale de la vista SQL de saldo, que deriva del ledger. Nunca de un
contador editable.

Errors: 404 PROMOTION_NOT_FOUND

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-transactions

Purpose:
Historial del ledger del propio participante, incluidas las correcciones.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{
  "items": [
    {
      "id": "uuid",
      "type": "PURCHASE_EARNED",
      "source_type": "PURCHASE",
      "quantity_delta": 10,
      "reason_key": "ORDER_QUALIFIED",
      "effective_at": "2026-09-10T12:00:00.000Z",
      "reverses_transaction_id": null
    }
  ],
  "next_cursor": null
}

Una devolución aparece como una FILA NUEVA con delta negativo, no como la
desaparición de la original. El participante puede ver qué pasó y cuándo.

`reason_key` es un enum estable. NUNCA prosa: el copy es de `frontend`.

Errors: 404 PROMOTION_NOT_FOUND

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-numbers

Purpose:
Rangos de números asignados al participante ("mis números").

Authentication: sesión de participante

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{
  "items": [
    {
      "batch_id": "uuid",
      "quantity": 11000,
      "first_number": "LSW26-000450001",
      "last_number": "LSW26-000461000"
    }
  ],
  "next_cursor": null
}

Los números viajan como CADENA, jamás como número (DEC-010).

Detrás del flag `visible_entry_numbers_enabled`, apagado. Con el flag apagado
devuelve 404: los rangos se asignan igual -para que sean reconstruibles hacia
atrás- pero no se muestran.

AVISO: la secuencia de números NO es el algoritmo del sorteo. Que existan
números no autoriza a sortear sobre ellos (DEC-017).

Errors: 404 NOT_FOUND cuando el flag está apagado

Authorization: entry.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/orders

Purpose:
Pedidos del propio participante.

Authentication: sesión de participante

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [OrderSummary], "next_cursor": null }

Errors: ninguno propio

Authorization: order.self.read

Owner: backend

Status: PROPOSED
```

```text
Method: GET
Endpoint: /api/v1/account/orders/{order_id}

Purpose:
Detalle de un pedido, con la traza del cálculo de entries que produjo.

Authentication: sesión de participante

Request: `order_id` en la ruta

Response: 200 OrderDetail, incluyendo `entry_calculation` con
`rules_version_id`, `engine_version` y el desglose que se persistió en el
`EntryCalculationSnapshot`.

Es lo que permite responder "por qué esta compra generó 37 entries y no 36"
meses después, cuando el catálogo y las reglas ya han cambiado.

Errors: 404 ORDER_NOT_FOUND

Authorization: order.self.read

Owner: backend

Status: PROPOSED
```

---

## 7. AMOE

Toda esta sección está detrás del flag `amoe_enabled`, apagado, y de una
modalidad `amoe_mode` que sigue sin elegir (`docs/LEGAL_PENDING.md` →
"AMOE mechanism"). Con el flag apagado, estos endpoints devuelven 404.

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/amoe-config

Purpose:
Qué modalidad AMOE está vigente y qué exige, para decidir qué interfaz
renderizar.

Authentication: ninguna

Request: `slug` en la ruta

Response: 200
{
  "enabled": false,
  "mode": null,
  "submission_window": { "opens_at": null, "closes_at": null },
  "instructions": { "en-US": "...", "es-US": "..." }
}

`mode` es un enum precisamente porque las cuatro modalidades exigen pantallas
distintas; un booleano no permitiría decidir cuál renderizar.

Las instrucciones son contenido legalmente controlante: se renderizan tal cual.

Errors: 404 PROMOTION_NOT_FOUND, 404 NOT_FOUND si `amoe_enabled` está apagado

Authorization: PUBLIC

Owner: backend

Status: PROPOSED
```

```text
Method: POST
Endpoint: /api/v1/promotions/{promotion_id}/amoe-submissions

Purpose:
Enviar una participación sin compra.

Authentication: sesión de participante

Request: forma dependiente de `amoe_mode`. Se cierra cuando el abogado fije la
modalidad; documentarla ahora sería inventar un requisito legal.

Response: 201 { "submission_id": "uuid", "status": "SUBMITTED" }

Una participación aprobada genera entries del MISMO tipo que una compra, con
`source_type: "AMOE"`. Un solo universo, con procedencia (principio 9).

La aprobación crea una transacción del ledger. Nunca incrementa un contador.

Errors:
404 NOT_FOUND si `amoe_enabled` está apagado
409 AMOE_WINDOW_CLOSED
409 AMOE_LIMIT_REACHED
409 AMOE_DUPLICATE_SUBMISSION
422 VALIDATION_FAILED

Authorization: amoe.self.submit

Owner: backend

Status: PROPOSED
```

---

## 8. Admin

Superficie aislada y protegida. Toda ruta exige sesión administrativa con MFA
(DEC-006); las marcadas con step-up exigen además re-autenticación reciente.

| Method | Endpoint                                                 | Authorization            | Status      |
| ------ | -------------------------------------------------------- | ------------------------ | ----------- |
| GET    | `/api/v1/admin/dashboard`                                | `dashboard.read`         | IMPLEMENTED |
| GET    | `/api/v1/admin/promotions`                               | `promotion.read`         | PROPOSED    |
| POST   | `/api/v1/admin/promotions`                               | `promotion.create`       | PROPOSED    |
| PATCH  | `/api/v1/admin/promotions/{promotion_id}`                | `promotion.update`       | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/activate`       | `promotion.activate`     | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/close`          | `promotion.close`        | PROPOSED    |
| GET    | `/api/v1/admin/promotions/{promotion_id}/rules-versions` | `rules.version.read`     | PROPOSED    |
| POST   | `/api/v1/admin/promotions/{promotion_id}/rules-versions` | `rules.version.create`   | PROPOSED    |
| POST   | `/api/v1/admin/rules-versions/{id}/activate`             | `rules.version.activate` | PROPOSED    |
| GET    | `/api/v1/admin/products`                                 | `product.read`           | PROPOSED    |
| POST   | `/api/v1/admin/products`                                 | `product.write`          | PROPOSED    |
| POST   | `/api/v1/admin/products/{product_id}/publish`            | `product.publish`        | PROPOSED    |
| GET    | `/api/v1/admin/participants`                             | `participant.list`       | IMPLEMENTED |
| GET    | `/api/v1/admin/participants/{id}`                        | `participant.read`       | IMPLEMENTED |
| POST   | `/api/v1/admin/participants/{id}/disqualify`             | `participant.disqualify` | PROPOSED    |
| GET    | `/api/v1/admin/orders`                                   | `order.read`             | IMPLEMENTED |
| POST   | `/api/v1/admin/orders/{id}/refund`                       | `order.refund.initiate`  | PROPOSED    |
| GET    | `/api/v1/admin/entry-transactions`                       | `entry.ledger.read`      | PROPOSED    |
| POST   | `/api/v1/admin/entry-adjustments`                        | `entry.adjust.create`    | PROPOSED    |
| POST   | `/api/v1/admin/entry-adjustments/preview`                | `entry.adjust.create`    | IMPLEMENTED |
| POST   | `/api/v1/admin/entry-adjustments/{id}/approve`           | `entry.adjust.approve`   | PROPOSED    |
| GET    | `/api/v1/admin/amoe-submissions`                         | `amoe.review.read`       | PROPOSED    |
| POST   | `/api/v1/admin/amoe-submissions/{id}/approve`            | `amoe.review.approve`    | PROPOSED    |
| POST   | `/api/v1/admin/amoe-submissions/{id}/reject`             | `amoe.review.reject`     | PROPOSED    |
| GET    | `/api/v1/admin/payment-webhooks`                         | `payment.webhook.read`   | PROPOSED    |
| POST   | `/api/v1/admin/payment-webhooks/{id}/replay`             | `payment.webhook.replay` | PROPOSED    |
| GET    | `/api/v1/admin/reconciliation`                           | `reconciliation.read`    | PROPOSED    |
| GET    | `/api/v1/admin/feature-flags`                            | `flag.read`              | PROPOSED    |
| PATCH  | `/api/v1/admin/feature-flags/{key}`                      | `flag.update`            | PROPOSED    |

Notas que no caben en la tabla y que importan:

- **Cambiar un flag legalmente material** exige además
  `flag.update.legally_material`, step-up y **motivo obligatorio**. El motivo no
  es documentación: la base de datos rechaza el cambio sin él.
- **`entry.adjust.create` y `entry.adjust.approve` son capacidades distintas a
  propósito.** Un ajuste que se aprueba a sí mismo es una edición del ledger con
  otro nombre.
- Ningún endpoint de admin edita ni borra una transacción del ledger. **No
  existe tal endpoint y no puede existir**: el rol de base de datos de la
  aplicación no tiene el privilegio, y un trigger lanza excepción aunque lo
  tuviera (DEC-007). Una corrección es siempre una fila nueva.
- El dominio de **exportación y sorteo** (`export.*`, `draw.*`, `winner.*`) es
  de `security-integration` y se documentará en su propia sección cuando exista.
  `backend` produce el dataset; el formato, la firma y la entrega son de
  `security` (DEC-016). Ningún endpoint de sorteo se implementa sin las cinco
  condiciones de DEC-017.

---

## 9. Webhooks de pago

```text
Method: POST
Endpoint: /api/v1/webhooks/payments/{provider}

Purpose:
Recepción de eventos del proveedor de pago.

Authentication:
Verificación de FIRMA sobre el cuerpo crudo. No hay sesión. Es la razón por la
que `apps/api` es un proceso Fastify separado (DEC-004): las API routes de Next
no garantizan acceso al cuerpo sin parsear, y sin cuerpo crudo la firma no se
puede verificar.

Request: cuerpo crudo del proveedor + cabecera de firma

Response: 200 { "received": true }

El evento se persiste ANTES de procesarse, con `UNIQUE (provider,
provider_event_id)`. Un reintento del proveedor choca contra esa restricción y
es un no-op: no es un `if` en el código, que perdería bajo concurrencia.

Las entries se generan al alcanzar el estado cualificante configurado, no
cuando el frontend llega a una página de éxito.

Errors: 401 cuando la firma no verifica; 202 cuando el evento ya se conocía

Authorization: PUBLIC

Justificación de que sea PUBLIC: el llamante es el proveedor de pago, que no
tiene sesión. La autenticación es criptográfica, sobre la firma del cuerpo.

Owner: backend

Status: PROPOSED
```

---

# Qué NO está en este contrato, y por qué

- **Autenticación y sesión.** DEC-006 asigna ese diseño a `packages/security`.
  Las rutas de login, MFA y step-up las documenta ese agente.
- **Exportación al third-party administrator y sorteo.** DEC-016 y DEC-017.
  Propiedad de `security-integration`.
- **La forma exacta del envío AMOE.** Depende de la modalidad, que sigue en
  `TBD`. Documentarla ahora sería inventar un requisito legal.
- **Cualquier constante legal.** Edades mínimas, jurisdicciones, ratios,
  deadlines y topes NO aparecen en este documento. Viajan como datos desde
  `PromotionRulesVersion` (DEC-012).

---

## 10. Autenticación (DEC-006, DEC-045)

**Estado:** `IMPLEMENTED` para las cuatro rutas de abajo. Inscripción de MFA,
registro de participante, verificación de email y restablecimiento de
contraseña siguen en `TBD`: son la fase siguiente.

### Un solo sistema, dos políticas

`CLAUDE.md` §4 prohíbe dos sistemas de autenticación y DEC-006 lo repite. **No
existe `/admin/login`.** Participante y personal usan estas mismas rutas; lo
que cambia es la política que decide `audienceForRoles` a partir de los roles:

|              | `PARTICIPANT` | `STAFF`         |
| ------------ | ------------- | --------------- |
| Cookie       | `<base>`      | `<base>_staff`  |
| `SameSite`   | `Lax`         | `Strict`        |
| `Path`       | `/`           | `/admin`        |
| TTL absoluto | 14 días       | 8 horas         |
| Inactividad  | —             | 15 min          |
| MFA          | no            | **obligatorio** |

Los nombres llevan sufijo distinto para que una sesión de escaparate y una de
panel coexistan en el mismo navegador. Sin eso, entrar al panel cerraría la
sesión de la tienda y al revés, y el síntoma —"me desloguea solo"— sería muy
difícil de atribuir.

La fuente de esta tabla es `SESSION_POLICIES` en `packages/security`; aquí solo
se refleja. Si divergen, manda el código.

### El token es opaco

43 caracteres `base64url` (`[A-Za-z0-9_-]`). **No es un JWT y no se decodifica:
no lleva nada dentro.** Toda la información de la sesión vive en la fila de
`sessions`, que es lo que la hace revocable de verdad. La base de datos guarda
solo el hash SHA-256 del token.

### `SessionState`

```json
{
  "authenticated": true,
  "state": "ACTIVE",
  "scope": "STAFF",
  "email": "persona@ejemplo.invalid",
  "email_verified": true,
  "roles": ["CATALOG_MANAGER"]
}
```

`state` es `ANONYMOUS`, `ACTIVE` o **`MFA_PENDING`**. Este último es el estado
de una sesión de personal que ya pasó la contraseña y **todavía no vale para
nada** salvo para completar el segundo factor. No es una pantalla que se pueda
saltar: es una sesión que aún no autentica.

### `POST /api/v1/auth/login`

`Authorization: PUBLIC` — es la ruta que se usa antes de tener sesión.

Cuerpo: `{ "email": string, "password": string }`.

Respuestas: `200` `SessionState` · `401` credenciales inválidas · `423` cuenta
bloqueada, con `retry_after_seconds` · `422` cuerpo inválido.

**No distingue "no existe" de "contraseña incorrecta".** Ambos devuelven `401`
y consumen el mismo trabajo criptográfico, porque la diferencia de tiempo sería
medible desde fuera y convertiría el login en un enumerador de correos
registrados —que en un sweepstakes es una lista de participantes.

Cinco fallos consecutivos bloquean 15 minutos. El bloqueo es **temporal** a
propósito: uno permanente convertiría el formulario en una forma de dejar fuera
a cualquiera cuyo correo se conozca.

### `POST /api/v1/auth/mfa/verify`

`Authorization: PUBLIC` — la sesión existe pero está en `MFA_PENDING`, así que
exigir sesión válida aquí sería circular.

Cuerpo: `{ "code": string }` (seis dígitos; se aceptan espacios).

Respuestas: `200` `SessionState` con `state: "ACTIVE"` · `401` código inválido,
caducado o **ya usado**.

**Un código no vale dos veces**, ni siquiera dentro de su ventana de 30
segundos. El consumo de la ventana es atómico en el motor.

### `GET /api/v1/auth/session`

`Authorization: PUBLIC`. **Sin sesión devuelve `200` con `ANONYMOUS`, no
`401`**: es lo que consulta el frontend en cada render y un 401 ahí obligaría a
tratar el caso normal como error.

### `POST /api/v1/auth/logout`

`Authorization: PUBLIC`. Idempotente: siempre `200 { "ok": true }`, haya sesión
o no. Un 401 al cerrar sesión no le sirve a nadie y además revelaría si la
cookie presentada era válida.

**Revoca en base de datos además de borrar la cookie.** Borrar solo la cookie
dejaría el token vivo para quien lo hubiera copiado.

### La cabecera `Cookie` que reenvía `apps/web`

`apps/web` no es un navegador: es un segundo proceso (DEC-004) que reenvía la
sesión del visitante. Lo hace con `cookies().toString()` de Next, que **no
produce una cabecera `Cookie` de RFC 6265**, sino algo con forma de
`Set-Cookie`:

    lsw_session=<token>; Path=/; lsw_dev_staff_actor=compliance%40example.com; Path=/

Dos rarezas: pseudo-cookies `Path=/` intercaladas —atributos que solo
pertenecen a `Set-Cookie`— y valores percent-encoded.

**La API acepta esa forma** (HO-035, opción b; DEC-050). No porque sea la
preferida ni porque no pudiera rechazarla —un 400 ante una `Cookie` que no
cumple RFC 6265 sería legítimo—, sino porque rechazarla rompería a un cliente
que controlamos, la forma es demostrablemente inocua, y declarar y vigilar lo
que se acepta cuesta menos que obligar a cada cliente a normalizar. Es una
tolerancia medida, con un test que la fija; no una renuncia a imponer. Lo fija
`apps/api/test/cookie-header-contract.test.ts`, que levanta la app real y
comprueba, sobre la cabecera literal: que ambas cookies de sesión se encuentran
entre las pseudo-cookies, que el token sobrevive intacto —lo exige
`looksLikeSessionToken`—, que los valores se decodifican, que las
pseudo-cookies no desplazan a ninguna cookie real y que un `;` codificado no
inyecta una cookie extra. Sin ese test, una actualización de `@fastify/cookie`
respondería 401 a una sesión válida, o peor, devolvería un valor a medio
decodificar y atendería a la persona equivocada: ese segundo síntoma ya ocurrió
una vez, en el mock de desarrollo de `apps/web`, y es indistinguible de "esa
persona no tiene ese permiso".

**La forma normativa sigue siendo la del navegador** —`name=value`, sin
atributos— y está cubierta por el mismo test con las mismas afirmaciones. Si
`apps/web` pasa a construir la cabecera desde `cookies().getAll()`, no rompe
nada. Lo que **no** cambia con ello es la dependencia del decodificador:
`getAll()` devuelve valores decodificados y reenviarlos exige
`encodeURIComponent`, así que el percent-decoding se ejerce igual. Esa
codificación en origen no es opcional: sin ella, un valor de cookie con `;`
partiría la cabecera e inyectaría cookies que nadie envió.

### Lo que NO está aquí, y por qué

- **Inscripción de MFA, registro, verificación de email y reset de
  contraseña.** Fase siguiente.
- **Si la verificación de email condiciona ganar participaciones.** Depende de
  `docs/LEGAL_PENDING.md` ("Email verification before earning entries", `TBD`).
  El campo `email_verified` se publica como dato; **que ese dato tenga
  consecuencias es una decisión legal que aún no existe**.

---

# 11. Comercio, Portal, AMOE, Ajustes, Sorteo y Exportación (hito B5)

> **Cómo llegó esta sección aquí.** El reparto pedía que `backend` entregara
> estas secciones como texto para que el Team Lead las pegara. No fue posible
> dejarlas fuera del documento: el gate de DEC-015
> (`tests/security/src/contract/api-contract.test.ts`) exige que **toda** ruta
> del manifiesto aparezca aquí, así que con las rutas en código y las entradas
> fuera, el workspace queda en rojo. Se añaden **al final**, en bloque, para no
> tocar la sección 10, que edita la sesión paralela. Si el Lead prefiere pegarlas
> él, `git checkout docs/API_CONTRACT.md` revierte este bloque entero.

## Índice de rutas de este hito

Con el camino tal y como lo declara el código (`:slug`, no `{slug}`), que es lo
que compara el test de contrato contra `apps/api/openapi/route-manifest.json`.

| Método | Camino                                                                              | Authorization               |
| ------ | ----------------------------------------------------------------------------------- | --------------------------- |
| POST   | /api/v1/checkout/session                                                            | `PARTICIPANT_SELF`          |
| GET    | /api/v1/checkout/sessions/:order_draft_id                                           | `PARTICIPANT_SELF`          |
| GET    | /api/v1/account/orders                                                              | `order.self.read`           |
| GET    | /api/v1/account/orders/:order_id                                                    | `order.self.read`           |
| POST   | /api/v1/webhooks/payments/:provider                                                 | `PUBLIC`                    |
| GET    | /api/v1/account/entry-summary                                                       | `entry.self.read`           |
| GET    | /api/v1/account/entry-transactions                                                  | `entry.self.read`           |
| GET    | /api/v1/account/entry-numbers                                                       | `entry.self.read`           |
| GET    | /api/v1/account/award-holds                                                         | `entry.self.read`           |
| GET    | /api/v1/me                                                                          | `participant.self.read`     |
| PATCH  | /api/v1/me                                                                          | `participant.self.update`   |
| GET    | /api/v1/promotions/:slug/amoe-config                                                | `PUBLIC`                    |
| POST   | /api/v1/promotions/:promotion_id/amoe-submissions                                   | `amoe.self.submit`          |
| GET    | /api/v1/account/amoe-submissions                                                    | `PARTICIPANT_SELF`          |
| GET    | /api/v1/admin/amoe-submissions                                                      | `amoe.review.read`          |
| POST   | /api/v1/admin/amoe-submissions/:submission_id/approve                               | `amoe.review.approve`       |
| POST   | /api/v1/admin/amoe-submissions/:submission_id/reject                                | `amoe.review.reject`        |
| GET    | /api/v1/admin/entry-adjustments                                                     | `entry.ledger.read`         |
| POST   | /api/v1/admin/entry-adjustments                                                     | `entry.adjust.create`       |
| POST   | /api/v1/admin/entry-adjustments/preview                                             | `entry.adjust.create`       |
| POST   | /api/v1/admin/entry-adjustments/:adjustment_id/approve                              | `entry.adjust.approve`      |
| POST   | /api/v1/admin/entry-adjustments/:adjustment_id/reject                               | `entry.adjust.approve`      |
| POST   | /api/v1/admin/participants/:participant_id/disqualify                               | `participant.disqualify`    |
| POST   | /api/v1/admin/orders/:order_id/refund                                               | `order.refund.initiate`     |
| GET    | /api/v1/admin/payment-webhooks                                                      | `payment.webhook.read`      |
| POST   | /api/v1/admin/payment-webhooks/:event_id/replay                                     | `payment.webhook.replay`    |
| GET    | /api/v1/admin/promotions/:promotion_id/draw-authorizations                          | `draw.result.read`          |
| POST   | /api/v1/admin/promotions/:promotion_id/draw-authorizations                          | `draw.authorization.create` |
| POST   | /api/v1/admin/promotions/:promotion_id/draw-authorizations/:authorization_id/revoke | `draw.authorization.create` |
| POST   | /api/v1/admin/draws                                                                 | `draw.initiate`             |
| GET    | /api/v1/admin/draws                                                                 | `draw.result.read`          |
| GET    | /api/v1/admin/promotions/:promotion_id/potential-winners                            | `winner.workflow.read`      |
| POST   | /api/v1/admin/potential-winners/:potential_winner_id/status                         | `winner.status.update`      |
| POST   | /api/v1/admin/promotions/:promotion_id/export-snapshots                             | `export.snapshot.create`    |
| GET    | /api/v1/admin/promotions/:promotion_id/export-snapshots                             | `export.snapshot.read`      |
| GET    | /api/v1/admin/export-snapshots/:snapshot_id                                         | `export.snapshot.read`      |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/validate                                | `export.snapshot.validate`  |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/finalize                                | `export.finalize`           |
| GET    | /api/v1/admin/export-snapshots/:snapshot_id/download                                | `export.download`           |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/deliver                                 | `export.deliver`            |
| POST   | /api/v1/admin/export-snapshots/:snapshot_id/results                                 | `winner.status.update`      |
| GET    | /api/v1/admin/dashboard                                                             | `dashboard.read`            |
| GET    | /api/v1/admin/orders                                                                | `order.read`                |
| GET    | /api/v1/admin/orders/:order_id                                                      | `order.read`                |
| GET    | /api/v1/admin/participants                                                          | `participant.list`          |
| GET    | /api/v1/admin/participants/:participant_id                                          | `participant.read`          |
| GET    | /api/v1/admin/participants/:participant_id/pii                                      | `pii.view.full`             |
| GET    | /api/v1/admin/audit-events                                                          | `audit.read`                |

**Todas están `IMPLEMENTED`**, con dos matices que importan y que se detallan en
cada bloque: las rutas de comercio dependen de un proveedor de pago que sigue sin
elegir (`CLAUDE.md` §7) y responden `503 PAYMENT_PROVIDER_NOT_CONFIGURED`; las de
sorteo y de finalización de export dependen de `@lsw/tpa` y `@lsw/audit`, que
`apps/api` todavía no tiene como dependencia, y responden `409` con código propio
en vez de improvisar.

---

## 11.1 Comercio

```text
Method: POST
Endpoint: /api/v1/checkout/session

Purpose:
Congelar el carrito de servidor en un pedido DRAFT y abrir una sesión de pago.

Authentication: sesión de participante

Request:
{
  "shipping_address": {
    "full_name": "...", "line1": "...", "line2": null,
    "city": "...", "region": "...", "postal_code": "...", "country": "US"
  },
  "return_url": "https://example.test/checkout/return"
}

`region`, no `state`: el nombre del campo no debe presuponer que la subdivisión
territorial se llama estado en toda jurisdicción cubierta. NO hay validación de
jurisdicción: la elegibilidad territorial la fijan las Official Rules y sigue en
docs/LEGAL_PENDING.md.

Response: 201
{
  "provider": "mock",
  "mode": "hosted_redirect",
  "client_config": { "redirect_url": "https://..." },
  "order_draft_id": "uuid"
}

`client_config` es DELIBERADAMENTE OPACO: cada proveedor necesita cosas distintas
y tiparlo obligaría a elegir proveedor, que es la decisión que no está tomada.
`mode` es `hosted_redirect` o `embedded_component`.

El pedido se crea en DRAFT ANTES de llamar al proveedor: es lo que da el
`order_draft_id` y lo que permite reintentar sin duplicar el cobro. Las líneas se
congelan aquí -SKU, nombre, precio y elegibilidad-: el precio que vale es el que
el participante vio al pulsar, no el que hubiera cuando el proveedor liquide.

Errors:
409 CART_EMPTY
503 PAYMENT_PROVIDER_NOT_CONFIGURED (hoy, siempre: el proveedor sigue sin elegir)
422 VALIDATION_FAILED

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/checkout/sessions/{order_draft_id}

Purpose:
Estado de una sesión de pago.

Authentication: sesión de participante

Request: `order_draft_id` en la ruta

Response: 200
{ "order_draft_id": "uuid", "status": "PENDING", "order_id": null }

LA INTERFAZ NO DECIDE SI SE HA PAGADO. La página de retorno recibe del proveedor
unos parámetros en la URL y no se los cree: pregunta aquí, que es donde se ha
recibido -o no- el webhook firmado. Un `?outcome=paid` lo escribe cualquiera.

`order_id` es null mientras el pedido siga en DRAFT: hasta entonces no hay nada
que enseñar en el historial.

Errors: 404 ORDER_NOT_FOUND

Authorization: PARTICIPANT_SELF

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/webhooks/payments/{provider}

Purpose:
Recepción de eventos del proveedor de pago.

Authentication:
Verificación de FIRMA sobre el cuerpo CRUDO, antes de parsear. `apps/api`
instala un parser que entrega el Buffer intacto solo en esta ruta: un JSON
reserializado -aunque sea equivalente- ya no coincide con la firma.

Request: cuerpo crudo del proveedor + cabecera de firma

Response: 200 { "received": true } | 202 { "received": true }

202 significa que ese evento ya estaba procesado o lo está procesando otra
entrega simultánea. Es 2xx a propósito: un 4xx haría que el proveedor
reintentara en bucle.

Un manejador que falla también devuelve 200: el evento queda persistido en FAILED
y visible en GET /admin/payment-webhooks. Un 5xx solo conseguiría que el
proveedor reintentara contra el mismo fallo.

Errors:
401 UNAUTHENTICATED (firma inválida, o proveedor distinto del montado)
409 WEBHOOK_DIGEST_MISMATCH (mismo provider_event_id, cuerpo distinto)

Authorization: PUBLIC

Justificación de que sea PUBLIC: el llamante es el proveedor de pago, que no
tiene sesión. La autenticación es criptográfica, sobre la firma del cuerpo.

Owner: backend

Status: IMPLEMENTED
```

---

## 11.2 Portal del participante

Las rutas de esta sección se sirven **del ledger**, nunca de un contador.
`GET /account/entry-summary` devuelve un solo saldo con desglose por procedencia
-compra, AMOE, ajuste, sistema- porque compra y AMOE conviven en el MISMO
universo elegible (principio 9). Dos saldos separados dejarían de sumar en cuanto
hubiera una devolución.

```text
Method: GET
Endpoint: /api/v1/account/entry-summary

Purpose: saldo del participante en una promoción, con procedencia.

Authentication: sesión de participante

Request: ?promotion_id=<uuid>

Response: 200
{
  "promotion_id": "uuid",
  "active_entries": 15, "purchase_entries": 12, "amoe_entries": 3,
  "admin_entries": 0, "system_entries": 0,
  "as_of": "2026-09-15T12:00:00.000Z"
}

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

PROMOTION_NOT_OPERATIONAL distingue "no existe" de "existe pero no tiene versión
de reglas activa o ventana": son informaciones distintas y la segunda es
accionable para operaciones.

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-transactions

Purpose: historial del ledger propio, correcciones incluidas.

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{ "items": [ { "id", "type", "source_type", "quantity_delta", "reason_key",
              "effective_at", "expires_at", "reverses_transaction_id" } ],
  "next_cursor": null }

Una devolución aparece como FILA NUEVA con delta negativo, no como la
desaparición de la original.

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/entry-numbers

Purpose: rangos de números asignados ("mis números").

Request: ?promotion_id=<uuid>&cursor=<opaque>&limit=<1..100>

Response: 200
{ "items": [ { "batch_id", "quantity", "first_number", "last_number" } ],
  "next_cursor": null }

Los números viajan como CADENA, jamás como número (DEC-010).

Detrás del flag visible_entry_numbers_enabled, apagado: con el flag apagado
devuelve 404, y con él encendido pero sin secuencia inicializada devuelve
409 ENTRY_NUMBER_FORMAT_NOT_CONFIGURED en vez de inventar un prefijo.

AVISO: la secuencia NO es el algoritmo del sorteo (DEC-017).

Errors: 404 NOT_FOUND; 409 ENTRY_NUMBER_FORMAT_NOT_CONFIGURED

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/award-holds

Purpose:
Concesiones RETENIDAS: pedidos que ya calificaron y cuyas participaciones esperan
a que se cumpla una condición del participante -hoy, la verificación del correo,
y solo si las Official Rules la exigen-.

Request: ?promotion_id=<uuid>

Response: 200
{ "items": [ { "id", "order_id", "promotion_id", "reason",
              "qualified_at", "held_at" } ], "next_cursor": null }

Es lo que explica un entry_state PENDING_QUALIFICATION que no avanza. Se sirve
aparte y no como un sexto valor del enum: frontend declara cinco y añadir uno
sería un cambio de contrato.

Errors: 404 PROMOTION_NOT_FOUND; 409 PROMOTION_NOT_OPERATIONAL

Authorization: entry.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/orders

Purpose: pedidos del propio participante.

Request: ?cursor=<opaque>&limit=<1..100>

Response: 200 { "items": [OrderSummary], "next_cursor": null }

OrderSummary = { id, order_number, status, placed_at, total, item_count,
promotion_id, entry_state, entries_granted }.

`status` es la PROYECCIÓN del vocabulario de frontend
(PENDING_PAYMENT | PAID | FULFILLED | CANCELLED | REFUNDED |
PARTIALLY_REFUNDED | CHARGEBACK) derivada de las cuatro máquinas internas.
`entry_state` es un campo APARTE
(NOT_APPLICABLE | PENDING_QUALIFICATION | GRANTED | PARTIALLY_REVERSED |
REVERSED) y se DERIVA del ledger en cada lectura: no hay columna que lo guarde.

`entries_granted` es null -no 0- mientras no haya cifra.

Authorization: order.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/orders/{order_id}

Purpose: detalle de un pedido, con la traza del cálculo de entries.

Response: 200 OrderDetail = OrderSummary + { items, subtotal, shipping_total,
tax_total, shipping_address, entry_calculation }.

`entry_calculation` es { rules_version_id, engine_version, evaluated_at,
final_entries, trace } leído del EntryCalculationSnapshot persistido, con la
versión de motor de ESE movimiento y no la vigente hoy.

Errors: 404 ORDER_NOT_FOUND

Authorization: order.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/me

Purpose: perfil del participante autenticado.

Response: 200 { id, email, display_name, email_verified, language_preference,
created_at }

SIN fecha de nacimiento, estado de residencia ni edad. No es un olvido: la
elegibilidad la fijan las Official Rules y sigue en docs/LEGAL_PENDING.md.

Authorization: participant.self.read

Owner: backend

Status: IMPLEMENTED
```

```text
Method: PATCH
Endpoint: /api/v1/me

Purpose: cambiar nombre para mostrar e idioma preferido.

Request: { "display_name": "..." | null, "language_preference": "es-US" }

Solo esos dos campos. El correo NO se cambia por aquí: cambiarlo invalida la
verificación, y la verificación puede ser condición para acumular
participaciones. `language_preference` está acotado a en-US | es-US (DEC-021);
la RESPUESTA lo declara string porque el backend podría soportar un idioma que la
interfaz aún no tenga.

Response: 200 ParticipantProfile

Errors: 422 VALIDATION_FAILED

Authorization: participant.self.update

Owner: backend

Status: IMPLEMENTED
```

---

## 11.3 AMOE

```text
Method: GET
Endpoint: /api/v1/promotions/{slug}/amoe-config

Purpose: qué modalidad AMOE está vigente y qué exige.

Response: 200
{
  "enabled": false, "promotion_id": "<uuid>", "mode": null,
  "submission_window": { "opens_at": null, "closes_at": null },
  "identity_requirements": [],
  "required_fields": null,
  "instructions": null,
  "external_url": null,
  "entries_per_approved_submission": null, "requires_review": null,
  "max_per_participant_per_period": null, "limit_period": null
}

Con la vía encendida, los cuatro campos nuevos:

  promotion_id      la promoción por la que se preguntó. VIAJA TAMBIÉN CON LA VÍA
                    APAGADA: no es un parámetro de AMOE, es el dato con el que se
                    preguntó. La ruta se pide por slug y el envío se dirige por
                    identificador.

  required_fields   [{ key, type, required, label_key, max_length }] o null.
                    Se deriva UNA A UNA de identity_requirements, en ese orden.
                    ES LA PIEZA QUE IMPIDE QUE EL FRONTEND INVENTE EL FORMULARIO:
                    la interfaz pinta exactamente esos campos y ni uno más. Uno de
                    más es recogida de datos personales que nadie autorizó; uno de
                    menos, un envío que el backend rechaza con AMOE_PAYLOAD_INVALID.
                    type: TEXT | EMAIL | TEL | TEXTAREA | DATE | CODE. Gobierna qué
                    control se pinta; ninguna validación legal. label_key es una
                    clave de copy del frontend (DEC-022), sin namespace, no prosa
                    del backend. Se sirve en LAS CUATRO modalidades: el dominio
                    exige esas claves en cualquier envío que entre por la API.

  instructions      { "en-US", "es-US" } o null. EXCEPCIÓN CONSCIENTE A DEC-022:
                    aquí el backend SÍ publica prosa, porque es texto LEGALMENTE
                    CONTROLANTE (dirección postal, formato del sobre, plazos) que
                    escribe el abogado en PromotionRulesVersion.config. Se renderiza
                    tal cual, como las Reglas Oficiales. Los DOS locales son
                    obligatorios (DEC-021). null = no publicadas: la pantalla remite
                    al documento; nadie rellena ese hueco.

  external_url      destino de EXTERNAL_INSTRUCTIONS, o null. SOLO https:, validado
                    al leer la configuración. Un javascript: escrito en la
                    configuración rompe la promoción (409 AMOE_CONFIG_INVALID) en vez
                    de llegar a un navegador.

Origen: PromotionRulesVersion.config.amoe (DEC-012). Bloque opcional
identity_fields: { "<clave>": { type?, label_key?, max_length? } }, solo
presentación. Sin descriptor: type TEXT, label_key = la clave del payload,
max_length 500. Un descriptor de una clave que NO está en identity_requirements
no añade ningún campo.

Con el flag apagado responde enabled: false y NADA MÁS salvo promotion_id: si la
vía no existe, sus parámetros tampoco son asunto de nadie.

Errors: 404 PROMOTION_NOT_FOUND; 409 AMOE_CONFIG_INVALID

Authorization: PUBLIC

Justificación de que sea PUBLIC: la vía SIN COMPRA tiene que ser visible sin
cuenta. Exigir sesión para saber cómo participar gratis convertiría la cuenta en
un requisito de participación, que es justo lo que AMOE existe para evitar.

Owner: backend

Status: IMPLEMENTED
```

```text
Method: POST
Endpoint: /api/v1/promotions/{promotion_id}/amoe-submissions

Purpose: enviar una participación sin compra.

Request: { "payload": { "<clave>": "<texto>" } }

`payload` es un mapa de clave a TEXTO: las cuatro modalidades piden datos
distintos y cuál aplica lo dirá el abogado. Las claves obligatorias las declara
identity_requirements.

Response: 201
{ "submission_id", "promotion_id", "status", "mode", "submitted_at",
  "entries_awarded" }

Una participación aprobada genera entries del MISMO tipo que una compra, con
source_type AMOE. La aprobación crea una transacción del ledger; nunca incrementa
un contador.

Errors:
404 NOT_FOUND (flag apagado)
409 AMOE_WINDOW_CLOSED
409 AMOE_LIMIT_REACHED
409 AMOE_DUPLICATE_SUBMISSION
409 AMOE_CONFIG_INVALID
422 VALIDATION_FAILED

Authorization: amoe.self.submit

Owner: backend

Status: IMPLEMENTED
```

```text
Method: GET
Endpoint: /api/v1/account/amoe-submissions

Purpose: envíos AMOE del propio participante.

Request: ?promotion_id=<uuid>

Response: 200 { "items": [AmoeSubmission], "next_cursor": null }

NO devuelve el payload: contiene datos personales y el participante ya sabe lo
que envió. Lo que necesita es el ESTADO.

Authorization: PARTICIPANT_SELF

No existe capacidad de LECTURA de los envíos propios en el catálogo
(amoe.self.submit es de escritura). Se declara como recurso propio del
participante -que es lo que es- en vez de reutilizar una capacidad de escritura
para leer, o de inventar una que nadie podría conceder.

Owner: backend

Status: IMPLEMENTED
```

| Método | Endpoint                                       | Authorization         | Notas                                                                                                                                            |
| ------ | ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/admin/amoe-submissions?promotion_id=` | `amoe.review.read`    | Cola de revisión. Lleva `participant_id` interno; nunca el payload. Añade `entries_before`, `entries_if_approved` y `entries_after_if_approved`. |
| POST   | `/api/v1/admin/amoe-submissions/{id}/approve`  | `amoe.review.approve` | `reason_key` obligatorio (HO-034.1). Cantidad según la versión de reglas **del envío**, no la vigente hoy.                                       |
| POST   | `/api/v1/admin/amoe-submissions/{id}/reject`   | `amoe.review.reject`  | `reason_key` obligatorio. Un rechazo NO consume cuota del límite.                                                                                |

---

- **La cola proyecta el efecto de la decisión, calculado por el motor.** Quien
  aprueba tiene que ver antes, cambio y después, y el panel no puede producir
  ninguna de las tres: el saldo está en el ledger y la cantidad la fija la versión
  de reglas DEL ENVÍO. Restar en el cliente sería una segunda implementación del
  motor. `entries_before` siempre trae número (cero es un saldo conocido);
  `entries_if_approved` y `entries_after_if_approved` son `null` cuando esa versión
  de reglas ya no declara AMOE legible: la aprobación fallaría, y una cifra que no
  se va a cumplir es peor que ninguna. NO son acumulativas entre filas: cada una
  contesta "si apruebo ESTA".
- **El campo de participaciones se llama `entries_awarded` en las TRES formas
  AMOE** (respuesta de envío, listado del participante y cola de revisión). No es
  `entries` ni `entries_granted`; `entries_granted` es de `OrderSummary` y ahí se
  queda.

## 11.4 Ajustes, descalificación, devoluciones y webhooks

| Método | Endpoint                                       | Authorization            | Step-up |
| ------ | ---------------------------------------------- | ------------------------ | ------- |
| GET    | `/api/v1/admin/entry-adjustments`              | `entry.ledger.read`      | no      |
| POST   | `/api/v1/admin/entry-adjustments`              | `entry.adjust.create`    | sí      |
| POST   | `/api/v1/admin/entry-adjustments/{id}/approve` | `entry.adjust.approve`   | sí      |
| POST   | `/api/v1/admin/entry-adjustments/{id}/reject`  | `entry.adjust.approve`   | sí      |
| POST   | `/api/v1/admin/participants/{id}/disqualify`   | `participant.disqualify` | sí      |
| POST   | `/api/v1/admin/orders/{id}/refund`             | `order.refund.initiate`  | sí      |
| GET    | `/api/v1/admin/payment-webhooks`               | `payment.webhook.read`   | no      |
| POST   | `/api/v1/admin/payment-webhooks/{id}/replay`   | `payment.webhook.replay` | sí      |

Notas que no caben en la tabla y que importan:

- **`entry.adjust.create` y `entry.adjust.approve` se comprueban tres veces**: el
  autorizador de la ruta, `AdjustmentService.approve` y el CHECK
  `adjustments_approver_differs` de la migración 0022. Las dos primeras se pueden
  saltar cambiando código; la tercera no.
  . Es el motivo **del aprobador**, distinto del motivo
  del ajuste; queda en `audit_events` (`metadata.approval_reason_key`) porque
  aprobar toca el ledger y merece la misma explicación que rechazar. Sin él,
  **403**: lo exige el autorizador antes del handler (HO-034.1).
- **Crear un ajuste devuelve `PENDING_APPROVAL`** mientras
  `dual_approval_for_sensitive_actions_enabled` esté encendido, que es su valor
  de arranque y el único flag que arranca así (DEC-032).
- **Descalificar emite una fila NEGATIVA por cohorte** `(procedencia,
caducidad)`, con `source_ref = disqualification:<decision_id>:<expiry_key>`
  (DEC-047). Nunca borra al participante ni sus filas. `reason_detail` es
  obligatorio: descalificar sin explicar por qué es un borrado con formulario.
  Respuesta: `{ id, promotion_id, participant_id, decision_id, reason_key,
decided_at, entries_removed, cohort_count }`.
- **La devolución administrativa** llama al proveedor y, con el abono confirmado,
  pide el movimiento de reversal. El importe de mercancía ELEGIBLE lo calcula
  `@lsw/commerce` sobre la elegibilidad CONGELADA de cada línea. Devuelve
  `{ order_id, provider_refund_id, amount, entry_transaction_id,
entries_reversed }`. Hoy responde `503 PAYMENT_PROVIDER_NOT_CONFIGURED`.
- **`replay` NO reprocesa el evento**: el cuerpo original no se guarda -contiene
  datos de tarjeta y PII- y sin él no se puede verificar la firma. Lo que hace es
  dejarlo visible para que el proveedor lo reintente. Un evento ya `PROCESSED`
  devuelve `404 PAYMENT_EVENT_NOT_REPLAYABLE`: repetir su efecto es exactamente
  lo que la idempotencia del ledger existe para impedir.
- Ningún endpoint de esta sección edita ni borra una transacción del ledger. **No
  existe tal endpoint y no puede existir** (DEC-007).

---

- **`preview` NO escribe nada.** Dado
  `{ promotion_id, participant_id, direction, quantity }` devuelve
  `{ before, proposed_delta, after, would_make_balance_negative,
requires_second_approval, as_of }`. Es una LECTURA: ni fila de ledger, ni
  expediente, ni evento de auditoría. `would_make_balance_negative` es
  literalmente la misma función que rechaza el ajuste al aplicarlo, no una
  reimplementación, para que no exista una previsualización en verde seguida de
  un rechazo. `as_of` viaja porque un saldo es una foto: entre la previsualización
  y la solicitud puede entrar una compra o una descalificación. Exige
  `entry.adjust.create` y no `entry.ledger.read`: quien no puede pedir un ajuste
  no tiene por qué poder simularlo sobre un participante concreto. Es POST y no
  GET porque el cuerpo lleva un identificador de participante, y en un GET
  viajaría en la URL. Con `manual_adjustments_enabled` apagado responde 404, igual
  que crear. Errores: 401, 403, 404, 422.

## 11.5 Sorteo (DEC-017)

| Método | Endpoint                                                                       | Authorization               | Step-up |
| ------ | ------------------------------------------------------------------------------ | --------------------------- | ------- |
| GET    | `/api/v1/admin/promotions/{promotion_id}/draw-authorizations`                  | `draw.result.read`          | no      |
| POST   | `/api/v1/admin/promotions/{promotion_id}/draw-authorizations`                  | `draw.authorization.create` | sí      |
| POST   | `/api/v1/admin/promotions/{promotion_id}/draw-authorizations/{auth_id}/revoke` | `draw.authorization.create` | sí      |
| POST   | `/api/v1/admin/draws`                                                          | `draw.initiate`             | sí      |
| GET    | `/api/v1/admin/draws?promotion_id=`                                            | `draw.result.read`          | no      |
| GET    | `/api/v1/admin/promotions/{promotion_id}/potential-winners`                    | `winner.workflow.read`      | no      |
| POST   | `/api/v1/admin/potential-winners/{id}/status`                                  | `winner.status.update`      | sí      |

- **`POST /admin/draws` llama a `initiateDraw()` de `@lsw/tpa`** con los puertos
  reales: flag persistido (`ConfigRepository`, nunca entorno), `authorize()` de
  `@lsw/security`, repositorios de PostgreSQL, CSPRNG del sistema (el rechazo de
  muestreo vive en `@lsw/tpa/random`) y la cadena de `@lsw/audit`. Consulta los
  cinco cerrojos y se niega en el primero que no pasa, dejando `AuditEvent`
  `draw.rejected` de la negativa.
  - Cerrojo 1 (flag apagado o no evaluado): `409 INTERNAL_DRAW_DISABLED`.
  - Cerrojos 2-5: `409 DRAW_REFUSED`.
  - En los dos casos, `details.reason` lleva el **`reason_code` estable del
    dominio** (`draw.refused.*`) y `details` el contexto. Nunca viaja prosa
    (DEC-031).
    Hoy el cerrojo 1 está cerrado por defecto, y aunque se encendiera el cerrojo 3
    se niega con `draw.refused.second_approval_missing` mientras no exista la ruta
    de segunda aprobación (`draw.approve`, sesión paralela). Sin transacción
    envolvente a propósito: cada negativa escribe su evento antes de lanzar, y una
    transacción lo retrocedería. `DRAW_ENGINE_NOT_WIRED` deja de existir.
- **Éxito**: `201` con el `DrawingEvent` encadenado (`record_hash`,
  `previous_record_hash`) y el expediente de `PotentialWinner` en `SELECTED`
  persistido en su propia transacción (si el proceso muriera en medio, sobrevive
  el `DrawingEvent`, que es la evidencia). Tres hechos auditables:
  `draw.initiated`, `draw.completed`, `winner.selected`.
- **`POST /potential-winners/{id}/status`** aplica la transición con
  `transitionPotentialWinner` de `@lsw/tpa`; aquí no se replica la máquina, se
  llama. Una transición no permitida responde `409 WINNER_TRANSITION_NOT_ALLOWED`
  con `details: { reason, from, to, allowed[] }` (los destinos salen de la misma
  máquina, para que el panel no lleve su propia tabla). Dos transiciones
  concurrentes desde el mismo estado: `409 WINNER_TRANSITION_CONFLICT`, solo se
  aplica una. Emite `winner.status_changed`. `WINNER_WORKFLOW_NOT_WIRED` deja de
  existir.

## 11.6 Exportación al third-party administrator (DEC-016)

| Método | Endpoint                                                   | Authorization              | Step-up |
| ------ | ---------------------------------------------------------- | -------------------------- | ------- |
| POST   | `/api/v1/admin/promotions/{promotion_id}/export-snapshots` | `export.snapshot.create`   | no      |
| GET    | `/api/v1/admin/promotions/{promotion_id}/export-snapshots` | `export.snapshot.read`     | no      |
| GET    | `/api/v1/admin/export-snapshots/{id}`                      | `export.snapshot.read`     | no      |
| POST   | `/api/v1/admin/export-snapshots/{id}/validate`             | `export.snapshot.validate` | no      |
| POST   | `/api/v1/admin/export-snapshots/{id}/finalize`             | `export.finalize`          | sí      |
| GET    | `/api/v1/admin/export-snapshots/{id}/download`             | `export.download`          | sí      |
| POST   | `/api/v1/admin/export-snapshots/{id}/deliver`              | `export.deliver`           | sí      |
| POST   | `/api/v1/admin/export-snapshots/{id}/results`              | `winner.status.update`     | sí      |

- **Crear** fija la tupla de DEC-016 -promoción, `cutoff_at`, `rules_version_id`,
  `ledger_high_water_mark` y las tres versiones- y nada más. El corte se pide
  EXPLÍCITO y no se toma del reloj: es una decisión de operaciones, no el
  instante en que alguien pulsó el botón.
- **La marca de agua no es redundante con el corte.** `effective_at` puede ser
  anterior al corte en una fila escrita DESPUÉS -un pago que liquida tarde-, y
  sin el tope de secuencia esa fila entraría en un recálculo posterior y
  cambiaría un digest ya firmado.
- **Formas que cambian respecto a la propuesta**: `GET .../download` exige
  `?reason=` (3..2000 caracteres) y responde `200 application/octet-stream` (ZIP
  determinista) con `Content-Disposition: attachment`, `X-Content-Type-Options:
nosniff`, `Cache-Control: no-store` y `X-LSW-Artifact-Sha256`. El body de
  `POST .../results` sustituye `reason_code` por `external_reference` (1..200).
- **Validar** congela el universo elegible en tramos de ordinales, reúne los
  números del ledger y ejecuta `runReconciliationChecks` de `@lsw/tpa`, incluida
  la verificación REAL de la hash chain de la promoción con `@lsw/audit`.
  Devuelve `{ snapshot_id, passed, checks[] }`: cada `check.id` es un código
  estable `reconciliation.*` y `check.detail` lleva severidad y contexto; ningún
  `check` lleva prosa (DEC-031). `passed` solo si nada `CRITICAL` bloquea. La
  línea de caducidad aparece SIEMPRE, valga cero o no (DEC-033/034), y la cadena
  aparece como `reconciliation.chain_not_sealed` (AVISO) mientras no haya almacén
  write-once (DEC-037). Escribe la transición `VALIDATING` solo al pasar de
  `DRAFT`; revalidar es una lectura.
- **Finalizar** reconcilia; si algo crítico bloquea responde
  `409 EXPORT_RECONCILIATION_BLOCKED` con
  `details: { reason: "tpa.reconciliation_blocked", failed_checks[] }`. Si no,
  calcula `content_digest` y `merkle_root` con `buildExportArtifact` desde el
  ORIGEN y los escribe en una FILA NUEVA de `export_snapshot_states`, con las
  MISMAS cifras con las que se calculó el digest. `200` con el manifiesto. Sobre
  un snapshot que no está en `DRAFT`/`VALIDATING`:
  `409 EXPORT_SNAPSHOT_NOT_FINALIZABLE`. `artifact_sha256` NO se escribe al
  finalizar: es el hash del paquete, que incluye la procedencia, que incluye
  `finalized_at`. Los códigos `EXPORT_DIGEST_CALCULATOR_NOT_CONFIGURED`,
  `EXPORT_FINALIZATION_NOT_WIRED` y `EXPORT_ARTIFACT_NOT_AVAILABLE` dejan de
  existir.
- **Descargar** sirve el paquete ZIP determinista con `200`. Descarga DIRECTA y
  no enlace efímero: `export.download` ya exige step-up, así que la autenticación
  fuerte va en la petición en vez de en una URL que se puede reenviar. Exige
  `?reason=` escrito (es el fichero con más datos de participantes del sistema y
  toda descarga deja constancia de quién, cuándo y POR QUÉ) y emite
  `export.downloaded` con `artifact_sha256`.
- **Entregar** distingue dos cosas que no son la misma:
  - ENVIAR por un canal (`SFTP`, `HTTPS_API`, `SIGNED_URL`) se niega con
    `409 EXPORT_DELIVERY_NOT_CONFIGURED` y `details.reason = "tpa.dry_run"`. La
    negativa la produce el adaptador con el paquete real, así que deja
    `export.delivery_failed`. Falta el administrador externo y su canal
    (`docs/LEGAL_PENDING.md`); pasar a `LIVE` exige modo explícito Y canal.
  - REGISTRAR EL ACUSE de una entrega hecha por descarga manual autenticada
    (`MANUAL_DOWNLOAD`) sí funciona: pasa por `recordDeliveryReceipt` del
    adaptador, deja `export.delivery_acknowledged` y escribe la transición
    `DELIVERED` con método, referencia y `artifact_sha256`. Si el
    `acknowledged_sha256` no coincide con el hash reconstruido:
    `409 EXPORT_ACKNOWLEDGEMENT_MISMATCH`.
- **Resultados** pasa por el adaptador: `ingestPotentialWinnerResult` deja
  `tpa.result_ingested` y `toPotentialWinners` construye los expedientes con
  `source: EXTERNAL_ADMINISTRATOR` y sin `drawing_event_id`. Solo se acepta sobre
  un snapshot en `DELIVERED`. El motivo del expediente lo fija `@lsw/tpa`
  (`winner.selected_by_external_administrator`, DEC-022); `external_reference`
  ata el expediente al envío del que salió.

## 11.7 Lecturas del panel: dashboard, pedidos, participantes y auditoría (HO-034 punto 5)

Siete rutas de **solo lectura**. Ninguna escribe, ninguna configura y ninguna
toca el ledger: una corrección es siempre una fila nueva y eso vive en §11.4.
Frontera con §12 (sesión paralela): la escritura de `entry_pool_cap` y de toda
la configuración de promoción vive allí; aquí solo se lee.

Todas exigen sesión de personal con MFA (DEC-006) además de su capacidad.
Todas paginan con el cursor opaco de §Paginación (`?cursor=&limit=1..100`).

### GET /api/v1/admin/dashboard

    Authorization: dashboard.read

Agregados de cabecera, todos referidos al **mismo instante** (`as_of`). Se
calculan sobre la promoción `ACTIVE`; si no hay ninguna, `promotion_id` y
`promotion_status` son `null` y los conteos no se acotan por promoción.

`active_entries` y `participants` son **cifras del ledger**, y el catálogo dice
que `dashboard.read` no las cubre ("la reconciliación vive detrás de
`reconciliation.read`"). Se pueblan solo si el actor tiene **además**
`entry.ledger.read`; en caso contrario llegan `null`, que significa _no
publicado_ y no _cero_. Salen de `lsw_entry_balances_at` (DEC-007), nunca de una
suma escrita en la aplicación.

`participants` = participantes con **saldo activo distinto de cero** en la
promoción. No es el censo de cuentas registradas.

```json
{
  "promotion_id": "3f1c…",
  "promotion_status": "ACTIVE",
  "active_entries": 1234,
  "participants": 56,
  "orders_last_24h": 7,
  "amoe_pending_review": 3,
  "adjustments_pending_approval": 1,
  "as_of": "2026-09-15T12:00:00.000Z"
}
```

401 sin sesión · 403 sin la capacidad.

### GET /api/v1/admin/orders

    Authorization: order.read

Pedidos de cualquier participante, más recientes primero. Filtro opcional
`?promotion_id=`. El cursor va por `order_number`, que es único y monótono con
la creación: con `created_at`, dos pedidos del mismo milisegundo se solaparían
entre páginas.

**El correo del comprador viaja siempre enmascarado** (`a***@dominio`).
`order.read` es "ver pedidos", no una capacidad de PII. La fila no publica
líneas ni dirección de envío: repartir PII a granel para pintar una tabla que no
la usa no es aceptable, y DEC-014 lo impide por construcción — no está declarada
en el esquema, así que no puede salir.

```json
{
  "items": [
    {
      "id": "…",
      "order_number": "LSW-00000042",
      "status": "PAID",
      "entry_state": "GRANTED",
      "placed_at": "2026-09-10T10:00:00.000Z",
      "total": { "amount_minor": "5000", "currency": "USD" },
      "participant_email": "a***@example.test",
      "participant_id": "…"
    }
  ],
  "next_cursor": null
}
```

401 · 403 · 422 (cursor inválido: falla, no devuelve la primera página).

### GET /api/v1/admin/orders/:order_id

    Authorization: order.read

**Misma forma que `GET /api/v1/account/orders/:order_id`** y construida por el
mismo presentador, para que soporte y participante lean lo mismo por teléfono.
Incluye `entry_calculation` con `rules_version_id`, `engine_version`,
`evaluated_at`, `final_entries` y la `trace` que se persistió en el
`EntryCalculationSnapshot` — es lo que permite contestar meses después por qué
esta compra generó 37 participaciones y no 36.

No lleva correo: el pedido trae `participant_id`, y esa pregunta tiene su propia
capacidad en la ficha del participante.

401 · 403 · 404.

### GET /api/v1/admin/participants

    Authorization: participant.list

Participantes, más recientes primero, cursor por `created_at`. **PII siempre
enmascarada**, y la respuesta lo dice: `pii_masked` es un dato, no una deducción
de la interfaz — un correo a medias sin él parece un dato corrupto.

`email` es `""` cuando la cuenta está anonimizada y no tiene correo. `""` (no
hay) y `a***@dominio` (hay y está oculto) son afirmaciones distintas.

`disqualified` se resuelve con `EXISTS` sobre `disqualifications`, no con una
columna: una columna sería una segunda fuente de verdad sobre un hecho que ya
está registrado con su motivo, su actor y su instante.

```json
{
  "items": [
    {
      "id": "…",
      "email": "a***@example.test",
      "display_name": "Ada",
      "created_at": "2026-09-01T05:00:00.000Z",
      "disqualified": false,
      "pii_masked": true
    }
  ],
  "next_cursor": null
}
```

401 · 403 · 422.

### GET /api/v1/admin/participants/:participant_id

    Authorization: participant.read

La misma fila más `phone` (enmascarado: `***34`), `preferred_locale`, `status` y
`review_state`. `pii_masked` es `true`. No lleva pedidos ni cifras del ledger:
para eso están `order.read` y `entry.ledger.read`, con sus propias rutas.

401 · 403 · 404.

### GET /api/v1/admin/participants/:participant_id/pii

    Authorization: pii.view.full

Misma ficha **sin enmascarar**, con `pii_masked: false`.

**Es una ruta aparte y no un `?pii=full`, a propósito.** El registro de DEC-015
declara la capacidad por (método, camino) y el autorizador corre antes del
handler: un parámetro que cambiara la capacidad exigida dejaría al cliente elegir
con qué permiso se le juzga. Tampoco se desenmascara "si el actor tiene la
capacidad": `pii.view.full` exige segundo factor reciente y motivo (DEC-006,
DEC-027), y comprobarla dentro del handler saltaría las dos condiciones.

**Cómo viaja el motivo (HO-034.1).** Esta ruta exige motivo, y es un `GET` sin
cuerpo donde ponerlo. Se manda en la cabecera:

    X-LSW-Reason-Code: participant_support_case

La forma es la misma que la del `reason_code` que se persiste en `audit_events`
(`^[a-zA-Z][a-zA-Z0-9_.]{2,63}$`), de modo que **lo que abre la puerta es
exactamente lo que queda escrito en la traza**. Sin cabecera, o con una que no
respete la forma, la respuesta sigue siendo **403**: eso no es un fallo, es el
control funcionando. Hace falta además segundo factor reciente.

Durante un tiempo esta ruta respondió 403 siempre, porque el autorizador pasaba
`reasonProvided: false` como constante. Ya no.

401 · 403 · 404.

### GET /api/v1/admin/audit-events

    Authorization: audit.read

Traza de auditoría, la más reciente primero. Filtros opcionales
`?promotion_id=`, `?actor_id=`, `?action=`.

**Solo lectura, y no por convención**: no existe endpoint que edite o borre una
fila, el rol de base de datos de la aplicación no tiene el privilegio y un
trigger lanza excepción aunque lo tuviera (DEC-007, DEC-008). La verificación de
la cadena de hashes **no** está aquí: es `audit.integrity.verify`, otra capacidad
y otra ruta.

**Qué no se publica.** `before`, `after`, `reason_text`, `source_ip` y
`user_agent` ni siquiera se seleccionan en la consulta: los tres primeros son
material interno y los dos últimos huella de conexión. `actor_email` viaja
**siempre `null`** — la tabla guarda `actor_id`, un identificador interno, y su
propia documentación dice "nunca un correo ni un nombre"; resolverlo en la
lectura metería en la traza justo el dato que la escritura decidió no guardar.
Publicar el nombre de la persona sería un DEC con su capacidad, no un `JOIN`
añadido de paso.

El orden y el cursor van por `sequence_no`, el orden **total** de escritura que
asigna el motor. Con `occurred_at` habría empates y la paginación se saltaría uno
de los dos hechos: en una traza de auditoría, un hecho que nadie llega a ver es
exactamente el fallo que la traza existe para impedir.

```json
{
  "items": [
    {
      "id": "…",
      "occurred_at": "2026-09-14T09:00:00.000Z",
      "actor_type": "HUMAN",
      "actor_id": "…",
      "actor_email": null,
      "actor_roles": ["COMPLIANCE_OFFICER"],
      "action": "entry.adjust.approve",
      "entity_type": "adjustment",
      "entity_id": "…",
      "promotion_id": "…",
      "reason_key": "SUPPORT_CORRECTION",
      "request_id": "…"
    }
  ],
  "next_cursor": null
}
```

401 · 403 · 422 (`action` con forma inválida se rechaza antes de la consulta).

---

## 12. Altas del panel: catálogo y promociones (DEC-010, DEC-011, DEC-012)

Hasta esta sección el catálogo era **de solo lectura**. El escaparate leía
productos y promociones, el panel las listaba, y no existía ninguna forma de
crear una: el panel enseñaba listas vacías y llenarlas exigía SQL a mano contra
producción. Ésta es la puerta que faltaba.

**Nada de lo que hay aquí concede participaciones.** Un producto es
**mercancía** (`CLAUDE.md` §1): tiene SKU, precio, nombre y existencias, y
ninguna columna suya dice cuántas participaciones otorga, porque eso lo dice la
`PromotionRulesVersion` (DEC-012). Crear un producto y publicarlo **no** lo
convierte en elegible para nada.

**Publicar es una ruta aparte y no un `PATCH { status }`.** El catálogo de
DEC-027 separa `product.write` de `product.publish`, y el registro de DEC-015
declara la capacidad por (método, camino). Si el estado viajara en el cuerpo, la
capacidad exigida la elegiría el cliente al decidir qué campos manda, y el
autorizador —que corre **antes** del handler— no puede juzgar una decisión que
todavía no se ha tomado. Lo mismo vale para activar y cerrar una promoción.

**Los dos idiomas son obligatorios en el alta.** No hay `optional` ni fallback de
uno al otro (principio 4). Un producto con nombre solo en inglés no es bilingüe a
medias: es un producto que en media tienda aparece sin nombre.

### GET /api/v1/admin/products

    Authorization: product.read

Catálogo completo, `DRAFT` y `ARCHIVED` incluidos —a diferencia de
`GET /products`, que solo sirve lo publicado—. Paginación con `?cursor=`.

`price_amount_minor` es **cadena**, no número: un importe en unidad menor puede
superar el entero seguro de JavaScript. `null` significa que el producto aún no
tiene variante, **no** que sea gratis.

401 · 403.

### POST /api/v1/admin/products

    Authorization: product.write

```json
{
  "sku": "GORRA-LS-001",
  "slug": "gorra-lone-star",
  "currency": "USD",
  "name": { "es-US": "Gorra Lone Star", "en-US": "Lone Star Cap" },
  "description": { "es-US": null, "en-US": null },
  "price_amount_minor": 2500,
  "stock_quantity": 100
}
```

Crea producto, sus dos traducciones y su primera variante con precio, **todo en
la misma transacción**: un producto sin variante no tiene precio y uno sin
traducciones no tiene nombre, y cualquiera de las mitades sin la otra deja en el
catálogo una fila que el escaparate no puede pintar.

**Nace en `DRAFT` siempre.** `price_amount_minor` va en la **unidad menor** de la
moneda como entero (DEC-010): 2500 son 25,00 USD. `stock_quantity: null` es
"existencias no gestionadas", que no es lo mismo que cero.

**201** con el producto · 409 `CATALOG_CONFLICT` si el SKU o el slug ya existen,
con el mensaje del motor en `details.engine` · 422 · 401 · 403.

### GET /api/v1/admin/products/:product_id

    Authorization: product.read

401 · 403 · 404.

### PATCH /api/v1/admin/products/:product_id

    Authorization: product.write

Campos opcionales: `name`, `price_amount_minor`, `stock_quantity`. Un `PATCH` sin
ningún campo es 422: no es una edición.

**No cambia el estado**, a propósito. Ver la ruta siguiente.

200 · 401 · 403 · 404 · 409 · 422.

### POST /api/v1/admin/products/:product_id/publish

    Authorization: product.publish

```json
{ "published": true }
```

`true` lo pone `ACTIVE` y visible en la tienda; `false` lo archiva. La variante
sigue al producto: una variante `ACTIVE` bajo un producto `ARCHIVED` seguiría
siendo comprable por su identificador aunque no aparezca en ningún listado.

200 · 401 · 403 · 404 · 422.

### GET /api/v1/admin/promotions

    Authorization: promotion.read

Promociones para el panel, borradores incluidos. Paginación con `?cursor=`.

401 · 403.

### POST /api/v1/admin/promotions

    Authorization: promotion.create

```json
{
  "slug": "gmc-denali-2025",
  "internal_name": "GMC Denali 2025",
  "legal_timezone": "America/Chicago",
  "public_name": {
    "es-US": "Gana una GMC Denali 2025",
    "en-US": "Win a 2025 GMC Denali"
  },
  "starts_at": null,
  "ends_at": null
}
```

**`legal_timezone` es obligatoria y no tiene valor por defecto** (DEC-011). Todos
los plazos se evalúan contra ella, nunca contra la del navegador ni la del
contenedor. Un valor por defecto —aunque fuera `America/Chicago`, que es la de
las Official Rules— convertiría una decisión legal en un descuido. Que la zona
exista lo comprueba PostgreSQL contra su propio catálogo.

**Nace en `DRAFT` y todavía no puede activarse**: le falta la
`PromotionRulesVersion` (DEC-012).

**201** · 409 `CATALOG_CONFLICT` si el slug existe, o `LIFECYCLE_REFUSED` si la
zona horaria no la conoce el servidor · 422 · 401 · 403.

### GET /api/v1/admin/promotions/:promotion_id

    Authorization: promotion.read

401 · 403 · 404.

### PATCH /api/v1/admin/promotions/:promotion_id

    Authorization: promotion.update

Campos opcionales: `internal_name`, `public_name`, `starts_at`, `ends_at`.

**La zona horaria legal no se edita**, a propósito: cambiarla después de haber
evaluado plazos contra ella movería retroactivamente el momento en que la
promoción abrió o cerró.

200 · 401 · 403 · 404 · 409 · 422.

### POST /api/v1/admin/promotions/:promotion_id/schedule

    Authorization: promotion.update

Sin cuerpo. Pasa la promoción de `DRAFT` a `SCHEDULED`, que es **la antesala
obligatoria de `ACTIVE`**: el motor no admite `DRAFT → ACTIVE` directamente
(`promotion_status_transitions`). Primero se publica la ventana y después, con
la versión de reglas activa, se activa.

Exige `starts_at` y `ends_at`; si faltan, **409 `LIFECYCLE_REFUSED`** con el
mensaje del motor. Es reversible (`SCHEDULED → DRAFT` existe en la tabla) y por
eso va con `promotion.update` y sin motivo: no cambia el universo de
participaciones.

200 · 401 · 403 · 404 · 409.

### POST /api/v1/admin/promotions/:promotion_id/activate

    Authorization: promotion.activate   (motivo obligatorio + step-up)

```json
{ "reason_code": "promotion_launch_approved", "reason_text": null }
```

El `reason_code` lo lee el **autorizador**, antes del handler, con la misma forma
que se persiste en `audit_events.reason_code` (`^[a-zA-Z][a-zA-Z0-9_.]{2,63}$`):
lo que abre la puerta es exactamente lo que queda escrito en la traza. Sin
motivo, o con uno mal formado, **403**.

**Los cerrojos los impone PostgreSQL**, no la API
(`lsw_promotions_enforce_lifecycle`):

1. La transición tiene que figurar en `promotion_status_transitions`.
2. Ventana explícita: `starts_at` y `ends_at` no pueden ser `null`.
3. `active_rules_version_id` no puede ser `null`, la versión tiene que
   pertenecer a esta promoción y estar en `ACTIVE`.
4. Esa versión no puede tener **claves legales sin resolver**
   (`unresolved_required_keys` vacío). Es una columna **generada** por el motor:
   la aplicación no puede escribirla, luego no puede declarar resuelto lo que no
   lo está. Ver `docs/LEGAL_PENDING.md`.

Si alguno salta: **409 `LIFECYCLE_REFUSED`** con el mensaje del motor en
`details.engine`. Ese texto llega al panel a propósito —quien no puede activar
necesita saber cuál de los cuatro cerrojos saltó, y el único que lo sabe con
certeza es el que lo comprobó—. El texto **no** es contrato estable; el código
sí.

200 · 401 · 403 · 404 · 409 · 422.

### POST /api/v1/admin/promotions/:promotion_id/close

    Authorization: promotion.close   (motivo obligatorio + step-up)

Mismo cuerpo que `activate`. Cerrar detiene la entrada de participaciones.

200 · 401 · 403 · 404 · 409 · 422.
