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
      "stock_quantity": 10
    }
  ]
}
```

`description` puede ser `null`. `stock_quantity` puede ser `null`, y **`null` no
es cero**: significa "existencias no gestionadas", y esa variante se puede añadir
al carrito en cualquier cantidad admitida.

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
  "lines": [
    {
      "id": "uuid",
      "variant_id": "uuid",
      "product_slug": "example-tee",
      "sku": "LSW-TEE-M",
      "name": { "en-US": "...", "es-US": "..." },
      "quantity": 2,
      "unit_price": { "amount_minor": "2500", "currency": "USD" },
      "line_subtotal": { "amount_minor": "5000", "currency": "USD" }
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

| Method | Endpoint                                       | Authorization            | Status   |
| ------ | ---------------------------------------------- | ------------------------ | -------- |
| GET    | `/api/v1/admin/dashboard`                      | `dashboard.read`         | PROPOSED |
| GET    | `/api/v1/admin/promotions`                     | `promotion.read`         | PROPOSED |
| POST   | `/api/v1/admin/promotions`                     | `promotion.create`       | PROPOSED |
| PATCH  | `/api/v1/admin/promotions/{id}`                | `promotion.update`       | PROPOSED |
| POST   | `/api/v1/admin/promotions/{id}/activate`       | `promotion.activate`     | PROPOSED |
| POST   | `/api/v1/admin/promotions/{id}/close`          | `promotion.close`        | PROPOSED |
| GET    | `/api/v1/admin/promotions/{id}/rules-versions` | `rules.version.read`     | PROPOSED |
| POST   | `/api/v1/admin/promotions/{id}/rules-versions` | `rules.version.create`   | PROPOSED |
| POST   | `/api/v1/admin/rules-versions/{id}/activate`   | `rules.version.activate` | PROPOSED |
| GET    | `/api/v1/admin/products`                       | `product.read`           | PROPOSED |
| POST   | `/api/v1/admin/products`                       | `product.write`          | PROPOSED |
| POST   | `/api/v1/admin/products/{id}/publish`          | `product.publish`        | PROPOSED |
| GET    | `/api/v1/admin/participants`                   | `participant.list`       | PROPOSED |
| GET    | `/api/v1/admin/participants/{id}`              | `participant.read`       | PROPOSED |
| POST   | `/api/v1/admin/participants/{id}/disqualify`   | `participant.disqualify` | PROPOSED |
| GET    | `/api/v1/admin/orders`                         | `order.read`             | PROPOSED |
| POST   | `/api/v1/admin/orders/{id}/refund`             | `order.refund.initiate`  | PROPOSED |
| GET    | `/api/v1/admin/entry-transactions`             | `entry.ledger.read`      | PROPOSED |
| POST   | `/api/v1/admin/entry-adjustments`              | `entry.adjust.create`    | PROPOSED |
| POST   | `/api/v1/admin/entry-adjustments/{id}/approve` | `entry.adjust.approve`   | PROPOSED |
| GET    | `/api/v1/admin/amoe-submissions`               | `amoe.review.read`       | PROPOSED |
| POST   | `/api/v1/admin/amoe-submissions/{id}/approve`  | `amoe.review.approve`    | PROPOSED |
| POST   | `/api/v1/admin/amoe-submissions/{id}/reject`   | `amoe.review.reject`     | PROPOSED |
| GET    | `/api/v1/admin/payment-webhooks`               | `payment.webhook.read`   | PROPOSED |
| POST   | `/api/v1/admin/payment-webhooks/{id}/replay`   | `payment.webhook.replay` | PROPOSED |
| GET    | `/api/v1/admin/reconciliation`                 | `reconciliation.read`    | PROPOSED |
| GET    | `/api/v1/admin/feature-flags`                  | `flag.read`              | PROPOSED |
| PATCH  | `/api/v1/admin/feature-flags/{key}`            | `flag.update`            | PROPOSED |

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

### Lo que NO está aquí, y por qué

- **Inscripción de MFA, registro, verificación de email y reset de
  contraseña.** Fase siguiente.
- **Si la verificación de email condiciona ganar participaciones.** Depende de
  `docs/LEGAL_PENDING.md` ("Email verification before earning entries", `TBD`).
  El campo `email_verified` se publica como dato; **que ese dato tenga
  consecuencias es una decisión legal que aún no existe**.
