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

**Hoy solo hay tres rutas `IMPLEMENTED`, y las tres son infraestructura.** Todo
lo demás es `PROPOSED`: acordado en papel, para que `frontend` diseñe contra
ello, y **no asumible como existente**.

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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
```

---

## 5. Carrito de servidor (DEC-023)

**El carrito vive en el servidor.** La cotización de entries se calcula sobre
el carrito del servidor, nunca sobre una lista de ítems enviada por el cliente:
en un producto donde una cifra de entries mal calculada es un problema legal,
la traza de qué se cotizó y cuándo vale más que la simplicidad.

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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Status: PROPOSED
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

Errors: 409 NO_ACTIVE_PROMOTION, 409 CALCULATION_CONFIG_INVALID

Authorization: PARTICIPANT_SELF

Owner: backend

Status: PROPOSED
```

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
