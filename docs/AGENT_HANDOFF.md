# AGENT_HANDOFF.md

Canal de comunicación **asíncrono y persistente** entre los agentes de
Lone Star Winners.

Un handoff sirve para comunicar a otro agente:

- una **dependencia** (necesito algo tuyo para avanzar);
- una **petición** (te pido que hagas o cambies algo);
- un **contrato requerido** (necesito que esta API/tipo/evento exista);
- un **cambio realizado** (modifiqué algo que te afecta);
- un **problema encontrado** (detecté un defecto en tu dominio);
- una **tarea bloqueada** (no puedo continuar);
- una **tarea desbloqueada** (ya puedes continuar).

## Reglas

1. Todo cambio **cross-domain** requiere un handoff. Un agente no edita
   archivos que no le pertenecen (ver `docs/TASK_OWNERSHIP.md`); los solicita.
2. Los handoffs se **añaden al final** del documento. Nunca se borran ni se
   reescriben los antiguos: se actualiza su `Status`.
3. Un handoff con `Blocking: YES` tiene prioridad sobre el trabajo en curso
   del agente destinatario.
4. Si el handoff implica una API, debe reflejarse también en
   `docs/API_CONTRACT.md`.
5. Si implica arquitectura, debe reflejarse también en `docs/DECISIONS.md`.
6. Si implica una duda legal, debe reflejarse también en
   `docs/LEGAL_PENDING.md`.
7. Cada agente revisa este archivo **al inicio de cada milestone** y antes de
   declarar terminada una tarea.

## Estados

`OPEN` → `ACKNOWLEDGED` → `IN PROGRESS` → `RESOLVED`
(o `REJECTED`, siempre con motivo explícito)

## Identificadores

`HO-001`, `HO-002`, … correlativos, sin reutilizar números.

---

## Plantilla

```text
## HO-000

Status:
OPEN / ACKNOWLEDGED / IN PROGRESS / RESOLVED / REJECTED

## Handoff

Date:
From:
To:

Context:

What changed:

What I need from you:

Affected files:

Affected APIs:

Blocking:
YES / NO
```

---

# Registro de handoffs

> Los handoffs `HO-001` … `HO-006` proceden de la FASE 1 (planificación) del
> 2026-08-25. Son los puntos en los que las propuestas independientes de los
> tres agentes **no** coincidieron, o en los que quedó un hueco sin
> propietario. Ninguno puede cerrarse sin acuerdo explícito.

---

## HO-001

Status: RESOLVED (ver DEC-022, DEC-023, DEC-024)

## Handoff

Date: 2026-08-25
From: Team Lead (consolidando frontend y backend)
To: backend, frontend

Context:
Los dos agentes se contradicen sobre quién es dueño del texto bilingüe, y
backend se contradice consigo mismo.

- `frontend` pide `message_key` y `reason_key` como **enums estables**, y
  asume ser el dueño del copy en ambos idiomas.
- `backend`, en su sección de APIs, define el envelope de error con
  `message_en` y `message_es` (es decir, el backend traduce).
- `backend`, en su propia sección de riesgos, propone **lo contrario**: código
  estable más payload de datos, y que el frontend sea dueño del copy.

What changed:
Nada implementado todavía. Es una frontera sin propietario.

What I need from you:
Decidir y registrar como `DEC-xxx`. Recomendación del Team Lead: **código
estable más payload de datos; el frontend es dueño del copy en ambos idiomas.**
Motivo: es la única opción compatible con el test de paridad de claves de
DEC-021, y evita que el copy legal viva en dos repositorios de texto distintos.
Excepción a considerar: los textos legalmente controlantes (Official Rules,
disclaimers) podrían necesitar venir del backend precisamente porque su
redacción está aprobada por el abogado.

Affected files:
`docs/API_CONTRACT.md`, `apps/api`, `apps/web`, `messages/*.json`

Affected APIs:
Envelope de error global, ledger (`reason_key`), y todo endpoint con texto
visible.

Blocking:
YES — bloquea congelar el contrato P0 y bloquea el hito FE-M4.

---

## HO-002

Status: RESOLVED (ver DEC-022, DEC-023, DEC-024)

## Handoff

Date: 2026-08-25
From: Team Lead (consolidando frontend y backend)
To: frontend, backend

Context:
Hueco de contrato. `frontend` pide endpoints de **carrito en servidor**
(`GET|POST|PATCH|DELETE /cart`) para que la cotización de entries y el carrito
compartan fuente de verdad. `backend` **no ofrece ningún endpoint de carrito**:
su cotizador (`POST /entry-quotes/cart`) recibe los ítems en el cuerpo, lo que
implica un carrito en cliente.

What changed:
Nada. Ninguno de los dos asumió que el otro se ocupaba.

What I need from you:
Decidir dónde vive el carrito. La tensión real: un carrito en cliente es más
simple, pero significa que el cliente decide qué se cotiza, y eso roza el
requisito R13 de security ("los números los produce el backend"). Un carrito en
servidor es más trabajo pero deja una traza auditable de qué se cotizó y
cuándo.

Affected files:
`apps/api`, `apps/web`, `packages/commerce`

Affected APIs:
`/cart*` (existencia por decidir), `POST /entry-quotes/cart`

Blocking:
YES — bloquea el hito FE-M3 (storefront y carrito).

---

## HO-003 — RESUELTO por DEC-032

Status: OPEN

## Handoff

Date: 2026-08-25
From: Team Lead (consolidando los tres)
To: frontend, backend, security

Context:
Los tres agentes usan nombres y listas distintas para los feature flags.

- `frontend` enumera 6 en `snake_case` minúscula
  (`visible_entry_numbers_enabled`, …).
- `backend` enumera 9 en `MAYÚSCULA_CON_GUION_BAJO` (`ENTRY_NUMBERS_ENABLED`,
  …), incluyendo cuatro que nadie más contempla (`ENTRY_CAPS_ENABLED`,
  `ENTRY_EXPIRATION_ENABLED`, `DUAL_APPROVAL_ADJUSTMENTS`,
  `PROVISIONAL_ENTRIES_ENABLED`).
- `security` enumera 8 en `snake_case`, añadiendo `manual_adjustments_enabled`
  y `dual_approval_for_sensitive_actions_enabled`.

Además `frontend` pide explícitamente que `amoe_mode` sea un **enum de 4
modalidades**, no un booleano, porque un booleano no basta para decidir qué
interfaz renderizar.

What changed:
Nada implementado. Es divergencia de nomenclatura y de alcance.

What I need from you:
Una lista única, canónica, con convención de nombres única, registrada como
`DEC-xxx`. Debe incluir el enum `amoe_mode` además del booleano
`amoe_enabled`.

Affected files:
`packages/database`, `packages/security`, `apps/api`, `apps/web`

Affected APIs:
`GET /config` (o equivalente) y todo endpoint condicionado por flag.

Blocking:
NO para empezar, YES antes de la primera migración que cree la tabla de flags.

---

## HO-004

Status: RESOLVED (ver DEC-022, DEC-023, DEC-024)

## Handoff

Date: 2026-08-25
From: security
To: Team Lead

Context:
`docs/TASK_OWNERSHIP.md` asigna a `security` solo
`packages/{security,audit,tpa}/**` y `tests/security/**`. Pero su prompt le
exige producir `docs/SECURITY.md`, `docs/THREAT_MODEL.md`,
`docs/PRODUCTION_READINESS.md`, `docs/runbooks/**` y la configuración de CI,
que hoy no pertenecen a nadie.

What changed:
Nada. Es un hueco de ownership detectado en planificación.

What I need from you:
Un `DEC-xxx` que asigne esos paths a `security`, o que designe explícitamente a
otro agente para CI (en cuyo caso `security` audita sin editar). La
configuración raíz del monorepo sigue siendo **zona neutral** pendiente de
asignar a un único agente, según `docs/TASK_OWNERSHIP.md`.

Affected files:
`docs/TASK_OWNERSHIP.md`, `docs/SECURITY.md`, `docs/runbooks/**`, CI

Affected APIs:
Ninguna.

Blocking:
NO para empezar, YES antes del hito S1.

---

## HO-005

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend
To: frontend

Context:
`backend` declara explícitamente que **no quiere congelar los contratos P0
contra suposiciones**: necesita ver la forma real de la interfaz (portal de
entries, cotizador de carrito, admin) antes de fijarlos.

What changed:
Ambos publicaron su lista de endpoints P0 de forma independiente. Coinciden en
lo esencial, pero con nombres distintos: `POST /entries/quote` (frontend) frente
a `POST /api/v1/entry-quotes/cart` (backend), entre otros.

What I need from you:
Reconciliar ambas listas en una sola tabla dentro de `docs/API_CONTRACT.md`,
con estado `PROPOSED`, antes de que backend implemente. Incluye acordar
prefijo de versión (`/api/v1/`), paginación por cursor y el envelope de error
(ligado a `HO-001`).

Affected files:
`docs/API_CONTRACT.md`

Affected APIs:
Todas las P0.

Blocking:
YES — bloquea los hitos B2 y FE-M3.

---

## HO-006

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend, security
To: Team Lead (para elevar al abogado del cliente)

Context:
Durante la planificación surgieron **cinco preguntas legales que no estaban en
`docs/LEGAL_PENDING.md`** y que afectan al diseño antes de escribir código.

What changed:
Se han añadido a `docs/LEGAL_PENDING.md` como categorías nuevas, todas en
`TBD`.

What I need from you:
Trasladarlas al abogado del cliente. En particular, la expiración de entries
debe resolverse **antes** del hito B1: si las Official Rules la contemplan, el
saldo deja de ser una suma pura y pasa a depender de ventanas temporales, lo
que cambia el diseño del ledger.

Affected files:
`docs/LEGAL_PENDING.md`, `packages/sweepstakes`, `packages/database`

Affected APIs:
Cálculo de saldo, reversals, retención de datos.

Blocking:
NO para empezar, YES para cerrar B1 y para activar cualquier promoción.

---

## HO-007

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: backend

Context:
**Dos registros de permisos coexisten.** `security` creó el catálogo canónico
en `packages/security` (8 roles, 51 capacidades con formato
`dominio.recurso.accion`, más metadatos de step-up, segunda aprobación,
dependencia de flag y separación de funciones). En paralelo, `backend` creó
otro en `packages/database/src/domain/permissions.ts` y en la migración
`0001_identity_and_rbac.sql` (6 roles, convención de claves distinta:
`entry.adjust_request` frente a `entry.adjust.create`).

Es exactamente el anti-patrón de dos fuentes de verdad que prohíbe
`CLAUDE.md` §4.

What changed:
Ambos catálogos existen hoy en el repositorio. Ninguno es incorrecto en sí;
son incompatibles entre sí.

What I need from you:
Adoptar el catálogo de `packages/security` como canónico e importarlo desde
`packages/database` para la semilla y para un test de paridad. Dos diferencias
son **sustantivas, no cosméticas**:

- **Falta `EXPORT_OFFICER`.** En el modelo de `backend`, `COMPLIANCE_OFFICER`
  acumula `export.finalize` y `export.download`, de modo que la separación
  entre finalizar y entregar que exige DEC-016 **no es representable**.
- **Falta el actor `SYSTEM`**, así que la auditoría no puede distinguir por rol
  un job automático de una persona.

Reconocimiento explícito de `security`: el diseño de `backend` es bueno
(`SUPER_ADMIN` excluido de `export.finalize` y `draw.execute`, conflicto de
roles impuesto por trigger) y esos aciertos deben conservarse en la fusión.

Affected files:
`packages/security/src/{roles,capabilities,permissions}.ts`,
`packages/database/src/domain/permissions.ts`,
`packages/database/drizzle/0001_identity_and_rbac.sql`

Affected APIs:
Todas las de admin (DEC-015: `Authorization` obligatorio por ruta).

Blocking:
YES — bloquea que `apps/api` declare permisos por ruta.

---

## HO-008

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: backend

Context:
Los hooks de pre-commit (`lefthook.yml` + `.gitleaks.toml`) ya existen, pero
`lefthook` no está declarado como dependencia.

What I need from you:
Añadir `lefthook` como devDependency de la raíz y `"prepare": "lefthook
install"` en el `package.json` raíz.

Hasta entonces los hooks exigen `pnpm dlx lefthook install` a mano, y **CI es
la única red garantizada** contra secretos commiteados.

Affected files: `package.json` (raíz)

Blocking: NO

---

## HO-009

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: backend

Context:
`security` necesita el **esquema del ledger congelado** para implementar la
hash chain de DEC-008 y el generador de snapshots de DEC-016.

What I need from you:
Congelar el esquema de `EntryTransaction` antes de que `security` escriba la
canonicalización. Escribirla ahora fijaría el orden de campos de una tabla que
todavía no existe, y ese orden forma parte del hash reproducible.

Dependencia cruzada: el diseño del ledger depende a su vez de `HO-006`
(¿pueden expirar las entries?), pendiente del abogado.

Affected files: `packages/audit/**`, `packages/tpa/**`, `packages/database/**`

Blocking: YES para los hitos S3 y S4.

---

## HO-010

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: backend

Context:
**Dos esquemas de variables de entorno.** `apps/api/src/config/env.ts` declara
25 variables con Zod; el registro declarativo de `packages/security` declara 66.
Divergencia ya detectada: `LOG_LEVEL` admite `fatal` en `apps/api` pero no en
`.env.example`. `security` alineó el suyo al conjunto amplio.

What I need from you:
Que el validador de `apps/api` se construya **sobre** el registro de
`packages/security`, o como mínimo un test que exija que toda variable de uno
esté declarada en el otro.

Affected files: `apps/api/src/config/env.ts`, `packages/security/src/env/**`

Blocking: NO

---

## HO-011

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: Team Lead

Context:
`prettier --check .` **fallará en su primera ejecución** por deriva
preexistente: las tablas markdown de `docs/TASK_OWNERSHIP.md`,
`docs/ARCHITECTURE.md` y `CLAUDE.md` nunca pasaron por prettier, y los
ficheros nuevos de `security` tampoco.

What I need from you:
Un `pnpm format` único sobre todo el repositorio, ejecutado por el Team Lead.

`security` **no lo ejecutó a propósito**: habría reescrito ficheros que no son
suyos mientras `frontend` y `backend` trabajaban en paralelo.

Affected files: todo el repositorio.

Blocking: YES para que CI pase en verde por primera vez.

---

## HO-012

Status: OPEN

## Handoff

Date: 2026-08-25
From: security
To: backend

Context:
`@types/node` está fijado en `^22` mientras el proyecto corre Node 24
(DEC-025). `security` replicó `^22` en sus paquetes deliberadamente, para no
crear dos versiones de tipos en el mismo workspace.

What I need from you:
Subir `@types/node` a `^24` en la raíz. `security` alineará los suyos después.

Affected files: `package.json` (raíz), manifiestos de los paquetes.

Blocking: NO

---

## HO-013 — RESUELTO por security (11 capacidades anadidas)

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend
To: security

Context:
Al integrar DEC-027, `backend` descubrió que el catálogo canónico de
`packages/security` **no tiene ninguna capacidad de lectura** para promociones,
versiones de reglas, catálogo de productos ni dashboard.

Desaparecieron `promotion.read`, `rules_version.read`, `product.read`,
`product.write` y `dashboard.read`, y no existe equivalente.

Consecuencia concreta: **`PROMOTION_MANAGER` puede crear y activar una
promoción, pero no puede leerla.** Y sus propias notas dicen que "opera el
catálogo" cuando no existe ninguna capacidad de catálogo.

What changed:
`backend` tuvo que reapuntar los tests de `apps/api` a `order.read` por no
haber nada mejor. Es un parche, no una solución.

What I need from you:
Añadir las capacidades de lectura que faltan y revisar qué roles las reciben.
`backend` **no lo arregló por su cuenta**: `packages/security` es territorio de
`security`, y la regla 4 de `docs/DECISIONS.md` le atribuye la revisión de
autorización.

Affected files:
`packages/security/src/capabilities.ts`, `packages/security/src/permissions.ts`,
`packages/database/drizzle/0004_rbac_catalog_unification.sql` (resiembra),
`apps/api/src/routes/**`

Affected APIs:
Todas las de lectura de admin.

Blocking:
YES para las rutas de lectura de admin.

---

## HO-014 — REGLA ESCRITA por security; falta conectarla en la config raiz

Status: OPEN

## Handoff

Date: 2026-08-25
From: Team Lead
To: los tres

Context:
**La misma trampa del lenguaje ha producido tres bugs reales en dos dominios
distintos**, todos detectados en la ronda de corrección:

1. `security` — `\s` dentro de un template literal sin etiquetar colapsaba a
   `s`. El escáner de aleatoriedad lanzaba `SyntaxError` al cargar. El de
   sorteo interno **no lanzaba**: compilaba, corría en verde y era ciego a 5 de
   6 formas de activar el sorteo.
2. `frontend` — el matcher del middleware `"...\..."` colapsaba a `.`,
   convirtiendo el patrón en "dos caracteres cualesquiera" y excluyendo del
   middleware casi cualquier ruta.

En todos los casos ESLint lo estaba señalando como `no-useless-escape`, y en
todos los casos se leyó como un detalle de estilo.

What I need from you:

1. `security`: valorar una regla de lint que prohíba construir expresiones
   regulares desde template literals sin `String.raw`, en todo el workspace y
   no solo en tus paquetes.
2. Los tres: **`no-useless-escape` deja de tratarse como cosmético.** En este
   proyecto es un indicador de patrón corrupto.
3. `security` ya estableció el patrón correcto: todo escáner debe llevar
   **tests de sus propios patrones** (casos que deben y que no deben coincidir).
   En un escáner, "no encontré nada" y "no busqué nada" son indistinguibles sin
   esa red.

Affected files: `eslint.config.mjs` (raíz, de `backend`), todos los escáneres.

Blocking: NO, pero es prevención de una clase de fallo ya materializada tres veces.

---

## HO-015

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend
To: Team Lead

Context:
**La migración `0004_rbac_catalog_unification.sql` (449 líneas) nunca se ha
ejecutado contra un PostgreSQL real.** No hay Docker en esta máquina
(`docker info` falla), así que `pnpm test:integration` no corre.

Está verificada estáticamente (paridad de catálogos, `drizzle-kit check`) y
revisada a mano, pero **columna generada, clave ajena compuesta y bloque
`DO $$` son exactamente lo que un test estático no puede probar**.

What I need from you:
Ejecutar `pnpm test:integration` en cuanto haya Docker disponible. Es lo
primero que debe correr en un entorno que lo tenga.

Affected files: `packages/database/drizzle/**`

Blocking: YES para dar por bueno el esquema.

---

## HO-016

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend
To: Team Lead / backend

Context:
`docs/API_CONTRACT.md` sigue siendo un esqueleto sin un solo endpoint,
mientras `apps/api` ya sirve tres rutas y `apps/web` consume contra MSW.

La regla 1 de `docs/API_CONTRACT.md` dice que ninguna API es consumible sin
estar documentada ahí. Hoy se incumple.

What I need from you:
Poblar el contrato con lo implementado y con lo propuesto, reconciliando las
listas P0 de `frontend` y `backend` (`HO-005`, todavía OPEN). `backend` genera
`route-manifest.json`, que es exactamente lo que `security` puede comparar
contra el documento sin editar código ajeno (DEC-015).

Affected files: `docs/API_CONTRACT.md`

Blocking: YES para el siguiente hito de ambos.

---

## HO-017

Status: RESOLVED en backend (`62fc4d1`); consumo en `apps/web` en curso

## Handoff

Date: 2026-08-25
From: frontend
To: backend

Context:
**`apps/api` y `docs/API_CONTRACT.md` ya divergen de lo implementado**, y
`frontend` no cambió su capa porque la regla 1 del contrato dice que no se
consume lo que no está documentado.

Diferencias de campo, para decidir cuál gana y documentarlo:

|          | capa de `frontend`                                                                                          | `apps/api` hoy                                              |
| -------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Carrito  | `{cart: {…}, entry_quote}`                                                                                  | plano: `{id, currency, lines, subtotal, entry_quote}`       |
| Línea    | `line_id`, `product_name`+`variant_name`, `line_total`, `image_url`, `availability`                         | `id`, `name`, `line_subtotal`, sin imagen ni disponibilidad |
| Carrito  | `updated_at`, `item_count`                                                                                  | no existen                                                  |
| Producto | `summary`, `category_key`, `image_url`, `price_from`, `availability`, `entry_eligibility`, `is_purchasable` | ninguno; expone `stock_quantity` en crudo                   |

What I need from you:
Dos peticiones que `frontend` defiende con argumento:

1. **`updated_at` en el carrito es necesario**, no cosmético: es lo que permite
   detectar una cotización caducada comparándolo con `quote.evaluated_at`. Sin
   él, la interfaz no puede saber que la cifra que muestra ya no vale.
2. **`is_purchasable` separado de `availability`**, porque existe stock retirado
   de la venta y deducir uno del otro es un error esperando a ocurrir. Y **no
   publicar `stock_quantity` exacto**: la ficha no lo necesita y es información
   de negocio.

Affected files: `apps/api/src/routes/{cart,storefront}.ts`,
`docs/API_CONTRACT.md`, `apps/web/src/lib/api/contract.ts`

Blocking: NO hoy (todo va contra MSW), YES para conectar frontend con la API real.

---

Resolution (2026-08-27, Team Lead):
Backend publica en `GET /cart` y en las mutaciones (`62fc4d1`, contrato §5):
`updated_at` del motor (migración `0025`: `carts.updated_at` no cambiaba al
mutar líneas porque el trigger de 0009 solo disparaba con `UPDATE carts`),
`item_count` (suma de `quantity`), `image_url` **siempre `null`** (no existe
tabla de medios y no se inventa) y `availability: { status }` derivada del
mismo predicado `fitsStock` que produce el `409 INSUFFICIENT_STOCK`.
`quantity_available` NO se publica en ninguna ruta. La incoherencia con
`GET /products`, que publicaba `stock_quantity` en crudo, se resolvió hacia la
superficie que no filtra: el catálogo publica `availability.status` por
variante con el mismo predicado (`6025ccd`, DEC-051).
`is_purchasable` sigue pendiente (§4). Disponibilidad y elegibilidad de
entries: TBD en `docs/LEGAL_PENDING.md`; mientras tanto `availability` es
solo informativa. Hallazgo colateral en curso: `PATCH /cart/items/{id}` no
comprobaba existencias pese al 409 que le atribuye §5.

## HO-018

Status: OPEN

## Handoff

Date: 2026-08-25
From: frontend
To: backend

Context:
**`starts_at` y `ends_at` son nulables en la implementación y obligatorios en
el contrato.**

`apps/api/src/routes/storefront.ts:54-55` los devuelve nulables. El contrato los
declara obligatorios.

`frontend` encontró por qué eso es peligroso y no solo inconsistente:
**`new Date(null)` no es `NaN`, es el 1 de enero de 1970**, y `Number.isNaN` no
lo detecta. Sin la red que añadió, la portada habría anunciado que la promoción
cierra en 1970.

What I need from you:
Decidir en qué dirección se alinean: o el contrato los hace nulables, o la
implementación deja de serlo. `frontend` ya añadió un `toDate()` que exige
cadena no vacía, con test, y su comentario resume la lección: **el tipo describe
lo acordado, no lo que llega por el cable.**

Affected files: `apps/api/src/routes/storefront.ts`, `docs/API_CONTRACT.md`

Blocking: YES para conectar con la API real.

---

## HO-019

Status: OPEN

## Handoff

Date: 2026-08-25
From: frontend
To: backend

Context:
**`PromotionSummary` no publica la oferta de participaciones.** El contrato
define su forma de manera cerrada (10 campos) y no incluye `entry_offer`.

Consecuencia medible: la portada hace **dos peticiones**
(`/promotions/active` → `/promotions/{slug}`) solo para poder decir cuál es el
ratio vigente.

Además, cuatro tipos se **nombran** en el contrato pero no se publican:
`PromotionDetail`, `ProductSummary`, `ProductDetail`, `CartWithQuote`.
`frontend` los diseñó como petición explícita, marcados `[PROVISIONAL]`.

What I need from you:
O la oferta entra en el resumen, o hace falta una ruta pública que la publique.
Y publicar la forma de los cuatro tipos.

Otros tres contratos que `frontend` necesita y no existen:

- **Facetas / categorías del catálogo.** Hoy el filtro solo ofrece las
  categorías de la página actual; con paginación por cursor, una categoría que
  solo aparezca en la página tres no es seleccionable desde la primera. Degrada
  de forma visible pero no rompe, y no lo cableó porque sería dato de negocio
  viviendo en el frontend.
- **Nombre, duración y atributos de la cookie de sesión de carrito.** El
  contrato dice "cookie de carrito" sin publicar ninguno. `frontend` reenvía la
  cabecera `Cookie` completa y propaga `Set-Cookie` tal cual: **no inventa un
  nombre de cookie**, y no rellena `SameSite`/`Secure` por defecto, porque
  hacerlo sería que el frontend decidiera la política de sesión (DEC-006) y
  taparía el defecto si el backend los olvidara.
- **Enumerar `reason_key`, `kind` de tope y `category_key`.** El contrato los
  llama enums estables y solo nombra dos valores. `frontend` usa lista explícita
  más genérico, de modo que un valor nuevo produce una frase genérica y **nunca
  una clave técnica en pantalla**.

Affected files: `docs/API_CONTRACT.md`, `apps/api/src/routes/**`

Blocking: A es el más bloqueante; el resto degrada sin romper.

---

## HO-020

Status: OPEN

## Handoff

Date: 2026-08-25
From: backend
To: Team Lead

Context:
**No existe modelo de premio.** `prize_value` de `PromotionSummary` es `null`
siempre: no hay tabla de premios ni clave en `PromotionRulesVersion`.

El valor de un premio es **dato legalmente material**, así que modelarlo
requiere decisión previa y probablemente entrada en `docs/LEGAL_PENDING.md`.

What I need from you:
Decidir cómo se modela el premio antes de que alguien lo improvise. `frontend`
ya soporta `null` sin romperse y tiene un test de que no queda una etiqueta
"valor del premio" con el hueco vacío.

Affected files: `packages/database`, `packages/sweepstakes`, `apps/api`,
`docs/LEGAL_PENDING.md`

Blocking: NO para construir, YES para lanzar una promoción.

---

## HO-021

Status: OPEN

## Handoff

Date: 2026-08-26
From: frontend
To: backend

Context:
DEC-042 (promoción GMC 2025 con universo de 10,000 participaciones y hero con
foto del premio) necesita dos campos que el contrato no publica. `frontend`
los añadió como `[PROVISIONAL]` en su capa (`apps/web/src/lib/api/contract.ts`,
sobre `PromotionDetail`), y los lee con `?? null` para no reventar contra una
API que aún no los sirve.

What I need from you:
Publicar en `docs/API_CONTRACT.md` y servir desde `apps/api`:

1. **`media: PromotionMedia | null`** — `hero_url`, `square_url`, `alt`
   (localizado por locale, nulable). Dos recortes y no uno: el mismo encuadre
   no sirve para un hero a sangre y para una tarjeta cuadrada. `alt: null`
   significa imagen decorativa (el titular ya nombra el premio).
2. **`entry_pool: EntryPool | null`** — `cap` e `issued`. **Sin campo
   `remaining` a propósito**: restarlo en el cliente sería una cifra de
   "quedan X" inventada a partir de dos números que pueden llegar
   desincronizados. Si algún día se muestra "restantes", lo calcula y lo
   sirve el backend. Un test de `frontend` comprueba que `cap - issued` no
   aparece en el DOM.

El tope de 10,000 depende de las Official Rules (ver `docs/LEGAL_PENDING.md`,
"Entry pool cap"): modelarlo en `PromotionRulesVersion.config` como
`caps.per_promotion_total` o equivalente, con el validador de activación de
DEC-012 bloqueando mientras siga TBD.

Hallazgo de paso, para que no se repita en otros consumidores: leer
`entry_pool !== null` reventaba con 500 en todas las páginas contra una API
que no publica el campo, porque `undefined` pasa esa comprobación. Mientras
un campo sea provisional, se lee con `?? null`.

Affected files:
`docs/API_CONTRACT.md`, `apps/api/src/routes/storefront.ts`,
`packages/sweepstakes` (config de caps), `apps/web/src/lib/api/contract.ts`

Affected APIs:
`GET /api/v1/promotions/active`, `GET /api/v1/promotions/:slug`

Blocking:
NO hoy (todo va contra fixtures), YES para conectar el hero a la API real.

---

## HO-022

Status: OPEN

## Handoff

Date: 2026-08-26
From: team lead
To: security

Context:
DEC-043 fija Railway como hosting de los tres componentes. Al prepararlo
aparecieron dos choques con la postura de seguridad vigente, y uno de ellos
**rebaja una garantía existente**. No se ha aplicado en silencio: está en el
ADR, en `.env.example` y con tests. Falta tu revisión.

What I need from you:

1. **Revisar `DATABASE_NETWORK=private` (el que sí rebaja algo).**
   `apps/api/src/config/env.ts` admite ahora `DATABASE_SSL_MODE=disable` en
   producción **solo** si se declara `DATABASE_NETWORK=private`. Motivo:
   Railway emite certificados autofirmados y `verify-full` es inalcanzable
   contra su Postgres gestionado. Se rechazó `require` a propósito, porque
   cifra sin verificar y aparenta una protección que no da.

   Lo que se sustituye es una garantía criptográfica por una topológica. La
   pregunta que te toca responder: ¿es aceptable mientras la base solo sea
   alcanzable por la red privada del proyecto, y qué control detecta que
   alguien le abra un endpoint público más adelante? Hoy nada lo detecta.

   El valor por defecto sigue siendo `public` → `verify-full`. Cobertura en
   `apps/api/test/env.test.ts` ("DEC-043: camino de red hacia PostgreSQL"),
   incluido el caso de que el defecto no se relaje solo.

2. **Revisar el colapso de roles del punto 3 de DEC-043.** Las migraciones las
   aplica el superusuario de Railway (`packages/database/src/scripts/bootstrap-cli.ts`)
   porque el proveedor no cede la propiedad de `public`. Se comprobó que las
   diez migraciones conceden permisos a `lsw_app` con GRANT explícitos, así
   que la invariante de DEC-007 (ledger sin UPDATE/DELETE para la aplicación)
   se mantiene sea quien sea quien migre. Conviene que lo confirmes con el
   test de invariante contra una base real: aquí no había Docker para correr
   `test:integration`.

3. **Compliance del copy antes de publicar.** Lo pediste tú en
   `docs/LEGAL_PENDING.md` ("Nota de proceso") y sigue pendiente. El
   despliegue de DEC-043 pone en Internet catálogo, promociones y Reglas
   Oficiales en ambos idiomas, con los dieciséis puntos legales en TBD.
   Ninguna página puede presentar una promoción como vigente.

---

## HO-023

Status: OPEN

## Handoff

Date: 2026-08-26
From: frontend (vía Team Lead)
To: backend (configuración raíz, DEC-024)

Context:
Al aislar el directorio de build del smoke (`LSW_NEXT_DIST_DIR`, leído y
validado en `apps/web/next.config.mjs`) aparecieron tres problemas de
infraestructura que viven en `turbo.json`, no en `apps/web`:

1. **`LSW_NEXT_DIST_DIR` no entra en la clave de caché de turbo.** Con turbo en
   modo `strict`, `LSW_NEXT_DIST_DIR=.next-build pnpm run build` devuelve
   `8 cached, 8 total` y **no crea `.next-build`**: turbo reproduce la caché de
   `.next` sin construir nada. Peor que inútil: parece que funcionó. Solo
   funciona saltándose turbo (`cd apps/web && LSW_NEXT_DIST_DIR=.next-build
pnpm build`).
2. **`pnpm run build` envenena un `next dev` vivo incluso con 100 % cache
   hit**, porque turbo _restaura_ `.next/**` desde la caché encima del servidor
   en marcha. Reproducido: tras un build totalmente cacheado, `/es`, `/es/shop`
   y `/healthz` pasaron a 500 y el proceso no se recuperó sin reinicio.
3. **Un build aislado real ensucia `tsconfig.json` y `next-env.d.ts`** (Next
   los reescribe con el `distDir`). El smoke ya los guarda y restaura
   (`NEXT_MANAGED_FILES` en `apps/web/scripts/smoke.mjs`), pero el build no
   tiene ese guardián.

What I need from you:

- Declarar `LSW_NEXT_DIST_DIR` en `env` de la tarea `build` (o `globalEnv`) de
  `turbo.json`, para que un build aislado no colisione con la caché del build
  normal.
- Decidir qué hacer con `outputs`: hoy lista `.next/**`; con `distDir` distinto
  no se captura nada (aceptable) o se añade `.next-build/**` (entonces la
  caché lo restauraría también).
- Valorar una receta de desarrollo documentada ("no ejecutes `pnpm run build`
  con un `next dev` abierto; usa el build aislado") o, mejor, un script raíz
  `build:isolated` que fije el `distDir`, salte la caché de turbo para
  `@lsw/web` y restaure los dos ficheros gestionados por Next.

Affected files: `turbo.json`, `package.json` (raíz), `apps/web/scripts/smoke.mjs`
(referencia del guardián).

Blocking: NO. Aclaración de la sesión de Railway (2026-08-26): en Railway cada
build corre en un contenedor limpio, sin dev server que envenenar y sin caché
de turbo persistida; `LSW_NEXT_DIST_DIR` no se define y `next.config.mjs` cae a
`.next`. HO-023 es **ergonomía local**, no un bloqueante del despliegue.

---

## HO-024

Status: OPEN

## Handoff

Date: 2026-08-26
From: security-integration (auditoría HO-022, hallazgo H5), vía Team Lead
To: backend

Context:
El cerrojo de activación de DEC-012 —una promoción no pasa a `ACTIVE` mientras
queden claves legales requeridas en `TBD`— cubre **doce claves**.
`docs/LEGAL_PENDING.md` tiene **dieciocho epígrafes** abiertos. No están en el
array: mecanismo AMOE, multiplicadores, requisitos del TPA, retención,
verificación de email, el tope de participaciones de DEC-042 y el descargo
sobre la imagen del premio.

Consecuencia: **una promoción puede pasar a `ACTIVE` con AMOE sin decidir**,
que es exactamente la configuración que produce el hero "GANA / Comprar ahora"
sin línea de no-compra (hallazgo H4, tratado en DEC-044 desde el frontend
como defensa en profundidad).

What I need from you:

- Que el conjunto de claves requeridas del validador de activación se derive
  de una lista única alineada con los epígrafes de `docs/LEGAL_PENDING.md`, o
  que exista un test que falle cuando `LEGAL_PENDING.md` tenga un epígrafe sin
  clave correspondiente.
- Añadir, como mínimo: `amoe.method`, `multipliers.*`, `export.*` (TPA),
  `retention.*`, `eligibility.email_verification_required`,
  `caps.per_promotion_total` (DEC-042) y `prize.imagery_disclaimer`.
- Coordinar con el abogado qué claves son **requeridas** para activar y cuáles
  pueden quedar opcionales.

Affected files: `packages/sweepstakes/src/rules-keys.ts`,
`packages/database` (validador de activación), `docs/LEGAL_PENDING.md`

Blocking: YES para activar cualquier promoción real.

---

## HO-025

Status: OPEN

## Handoff

Date: 2026-08-26
From: Team Lead (sesión frontend, lone-star-2e)
To: sesión paralela (lone-star-c4: identidad, admin, despliegue) y agentes propios

Context:
El usuario ordena **desarrollar todo lo que falta**: cuentas de participante,
checkout y pagos, portal del participante, AMOE, panel de administración,
ganadores. La sesión paralela ya está en las fases 1–3 del admin (esquema de
credenciales/MFA/sesiones, rutas de auth, endpoints de catálogo admin), y
`CLAUDE.md` §4 prohíbe dos sistemas de autenticación y dos modelos de entries.

Reparto propuesto para no pisarse:

| Dominio                                                                                                                                                           | Quién           | Dónde                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad: credenciales, sesiones, MFA, **auth de participante y de admin** (mismo módulo, roles distintos)                                                       | sesión paralela | `packages/database` (migraciones 0010–0019), `packages/security`, `apps/api` (rutas `/auth/*`, `/admin/*`), `docs/API_CONTRACT.md` (secciones Auth y Admin) |
| Comercio: órdenes, `PaymentProvider` con proveedor **mock** (el real es un DEC pendiente del usuario), webhooks, refunds/chargebacks como intenciones de reversal | esta sesión     | `packages/commerce` (lógica pura + puertos ahora; rutas en `apps/api` cuando aterrice la fase 2)                                                            |
| Participaciones: pipeline orden calificada → snapshot de cálculo → ledger; AMOE: envío → revisión → ledger con procedencia AMOE; ajustes y descalificación        | esta sesión     | `packages/sweepstakes` (dominio puro con puertos), adaptadores en `packages/database` con migraciones **0020+**                                             |
| Portal del participante, checkout, AMOE (4 modalidades tras flag), pantallas de auth, admin (fase 4)                                                              | esta sesión     | `apps/web` completo, contra MSW con contratos `[PROVISIONAL]` hasta reconciliar                                                                             |

Reglas de convivencia mientras dure:

1. **Ninguna dependencia nueva ni `pnpm install`** desde esta sesión hasta que
   aterrice el lockfile de la fase 1 (argon2, otpauth).
2. **Ningún fichero de `apps/api` ni `packages/database`** desde esta sesión
   hasta que la fase 2 tenga contrato; el dominio se construye puro, con
   puertos, en `packages/commerce` y `packages/sweepstakes`.
3. `docs/API_CONTRACT.md`: la sesión paralela escribe Auth y Admin; esta
   sesión aportará Commerce, Entries, AMOE y Portal como secciones nuevas al
   final, **después** de que la fase 2 aterrice.
4. `docs/DECISIONS.md`: DEC-045 es de la sesión paralela; el siguiente de esta
   sesión es DEC-046 y se escribe cuando DEC-045 haya aterrizado.

What I need from you (sesión paralela):

- Confirmar el reparto y el rango de migraciones.
- Que la fase 2 incluya las rutas de **participante** (`register`, `login`,
  `logout`, `verify-email`, `password-reset`, `session`) sobre el mismo módulo,
  o decir explícitamente que las deja para esta sesión sobre sus primitivas.
- Cómo registra rutas `apps/api` (fichero compartido o por módulo), para que
  las rutas de comercio entren sin conflicto.

Affected files: ver tabla.

Blocking:
NO para arrancar el dominio puro y el frontend; SÍ para conectar auth real y
para las rutas de comercio en `apps/api`.

---

## HO-026

Status: RESUELTO (sesión paralela, 2026-08-26): draw.authorization.create ya
lleva promotion.read como lectura emparejada y winner.status.update ya existe
(permissions.ts:291-293). draw.approve se acepta como capacidad PROPIA — no
reutilizar draw.initiate, porque dejaría la separación de funciones dentro del
mismo rol — con read export.snapshot.read, step-up y SUPER_ADMIN excluido; se
implementa con las rutas de sorteo y resiembra en 0010–0019. Sin capacidad de
lectura del expediente de autorización hasta que exista una ruta que la use.

## Handoff

Date: 2026-08-26
From: security-integration (esta sesión)
To: sesión paralela (propietaria de `packages/security` durante la fase 1–2)

Context:
Al construir los controles de sorteo (DEC-017) y la entrega al TPA (DEC-016)
como dominio puro, aparecieron **dos huecos en el catálogo canónico de
capacidades** que `CAPABILITY_READ_COVERAGE` detectará en cuanto existan las
rutas:

1. **`draw.authorization.read`** no existe. `draw.authorization.create` sí, y
   la regla de cobertura exige lectura para toda escritura. Sin ella,
   `GET /admin/promotions/{id}/draw-authorizations` no puede declarar
   permiso. Alternativa: reutilizar `draw.result.read`.
2. **`draw.approve`** no existe. La segunda aprobación de un sorteo (actor
   distinto, TTL) necesita capacidad propia o exigir `draw.initiate` también
   al aprobador. El dominio ya rechaza que aprobador e iniciador coincidan.

Y una decisión de capacidad para la ingesta de resultados del TPA
(`POST /admin/export-snapshots/{id}/results`): crea expedientes de
`PotentialWinner`, así que se propone `winner.status.update`.

What I need from you:
Añadir (o decidir la reutilización) de las dos capacidades en
`packages/security/src/capabilities.ts` y asignarlas a roles
(`COMPLIANCE_OFFICER` / `DRAW_OFFICER` según separación de funciones), con
resiembra en `packages/database`. Hasta entonces las rutas de sorteo no se
crean.

Affected files: `packages/security/src/{capabilities,permissions}.ts`,
`packages/database` (resiembra).

Blocking: SÍ para las rutas admin de sorteo; NO para el dominio, ya
construido y probado.

---

## HO-027

Status: OPEN (regla permanente para todos los agentes)

## Handoff

Date: 2026-08-26
From: sesión paralela (lone-star-c4), vía Team Lead
To: los tres agentes y ambas sesiones

Context:
Al cerrar cinco errores de lint en `apps/api/src/routes/auth.ts` (`817f2a1`),
la sesión paralela comprobó que **uno de los "autocorregibles" abría un
agujero de autenticación silencioso**. El código era:

```ts
if (session === null || session.revokedAt !== null) {
  throw unauthenticated();
}
```

`prefer-optional-chain` propone `session?.revokedAt != null`. **No es
equivalente**: con `session === null` evalúa `undefined != null` → `false`, y
deja pasar exactamente el caso que hay que rechazar — un token que no
corresponde a ninguna sesión habría autenticado.

Reescritura correcta, en positivo, que satisface la regla sin cambiar la
semántica:

```ts
const usable = session !== null && session.revokedAt === null;
if (!usable) {
  throw ApiErrors.unauthenticated();
}
```

What I need from you (regla):

1. **Nunca aplicar `eslint --fix` a ciegas** sobre código de autenticación,
   autorización, ledger, reversals, sorteo o export. Cada corrección de
   `prefer-optional-chain`, `no-unnecessary-condition` o similar sobre una
   comprobación de `null` se revisa a mano y se prueba en negativo.
2. `prefer-optional-chain` sobre la forma `x === null || x.y !== null` es un
   **cambio de semántica disfrazado de estilo**. Se reescribe en positivo.
3. Cuando una construcción se deje a propósito de forma que la regla no
   sugiere, se anota en el propio código por qué, para que el siguiente que
   pase con `--fix` no la revierta.

Affected files: cualquier comprobación de sesión, permiso o saldo.

Blocking: NO. Es prevención de una clase de fallo ya materializada una vez.

---

## HO-028

Status: OPEN

## Handoff

Date: 2026-08-27
From: backend-sweepstakes (B5), vía Team Lead
To: security-integration (persistencia de auditoría) y Team Lead (dependencias)

Context:
Las 40 rutas de B5 (`64b7cea`) emiten eventos de auditoría a través de
`LoggingAuditSink` (`apps/api/src/services/audit-sink.ts`): log
estructurado con `event: "audit.pending_persistence"`, sin `reason_detail`
para no filtrar PII. **No es auditoría**: no se encadena, no se sella, no se
verifica. La tabla `audit_events` no existe.

Además, sorteo y export responden `409` porque el motor vive en
`@lsw/tpa` y `@lsw/audit`, que `apps/api` aún no declara como dependencias.

What I need from you:

1. `security-integration`: migración `audit_events` (rango 0024+, tres capas
   de DEC-007, hash chain de DEC-008/035 por promoción, `recorded_at` e `id`
   explícitos como en el ledger), adaptador que sustituya `LoggingAuditSink`,
   y el verificador de cadena conectado como job. Sin tocar
   `packages/security/src/env/**` ni `session-authorizer.ts` (sesión
   paralela).
2. Team Lead: añadir `@lsw/tpa` y `@lsw/audit` a `apps/api/package.json`,
   `pnpm install` con los agentes parados, y cablear `initiateDraw`,
   `ManualDownloadAdapter` y `recomputeContentDigest` en los handlers que hoy
   devuelven `409`.
3. Cuando exista `draw.approve` en el catálogo (sesión paralela), pegar
   `buildDrawApprovalRoute` (código completo en el informe de B5) con su fila
   en §11.5.

Affected files: `packages/database/drizzle/0024_*.sql`, `packages/audit`,
`apps/api/src/services/audit-sink.ts`, `apps/api/package.json`,
`apps/api/src/routes/{draw,export}.ts`.

Blocking: SÍ para dar por auditado cualquier flujo de admin; NO para el
resto.

---

## HO-029

Status: OPEN

## Handoff

Date: 2026-08-27
From: sesión paralela (lone-star-c4), vía Team Lead
To: sesión paralela (identidad) / security-integration

Context:
`SESSION_POLICIES` en `packages/security` declara `rotateOnPrivilegeChange:
true`, pero **la propiedad no se lee en ningún sitio del repositorio**: es una
promesa escrita en la política que nadie cumple. Se detectó al corregir el
autorizador (`8c1ef08`): sin rotación, una sesión de escaparate viva podía
heredar capacidades de personal si a la persona se le concedían roles después
de iniciar sesión. El arreglo adoptado —derivar los roles efectivos del
**scope de la sesión**, no de la persona— hace que la defensa no dependa de
la rotación, pero la promesa sigue en el código.

What I need from you:
Implementar la rotación (revocar/renovar sesiones vivas al cambiar los roles
de una identidad, exigiendo nueva autenticación y MFA para obtener scope
`STAFF`), o retirar la propiedad de la política para no documentar una
garantía inexistente. Con test.

Affected files: `packages/security/src/session.ts`,
`apps/api/src/http/session-authorizer.ts`, `packages/database` (sesiones).

Blocking: NO hoy (la defensa no depende de ella); SÍ antes de publicar el
panel de administración.

---

## HO-030

Status: OPEN

## Handoff

Date: 2026-08-27
From: Team Lead
To: security-integration (QA e integración)

Context:
`pnpm --filter @lsw/web smoke` recorre 35+ rutas contra el **servidor de
mocks**, no contra `apps/api`. Por tanto **no ejercita** el autorizador real,
las 40 rutas de B5 ni ninguna migración. Los tests unitarios de la API sí,
pero hay ~100 tests de integración (`packages/database/test/integration/**`)
escritos y **nunca ejecutados** por falta de Docker, y ninguna prueba de
punta a punta web↔api↔PostgreSQL.

What I need from you:
Un flujo e2e (Playwright, DEC-018) que levante `apps/api` contra PostgreSQL
real (Testcontainers o servicio en CI), `apps/web` con `WEB_ENABLE_API_MOCKS`
apagado apuntando a esa API, y recorra: alta y login de participante,
catálogo, carrito y cotización, checkout con el proveedor mock, portal con
el ledger, AMOE en una modalidad, login de personal con MFA, revisión AMOE y
un ajuste con doble aprobación. Debe correr en CI (`.github/workflows`) con
un servicio de PostgreSQL 16, para que deje de depender del Docker local.

Affected files: `tests/e2e/**` (nuevo), `.github/workflows/ci.yml`,
`apps/web/scripts/smoke.mjs` (referencia).

Blocking: SÍ para dar por integrado cualquier flujo; NO para seguir
construyendo.

---

## HO-031

Status: OPEN

## Handoff

Date: 2026-08-27
From: frontend-ux (FE-M6/M7)
To: backend-sweepstakes

Context:
Tres desajustes entre lo que sirve `apps/api` (§11) y lo que el panel y la
vía gratuita necesitan, encontrados al construir contra MSW y verificar
contra el manifiesto real.

1. **`GET /promotions/:id/amoe-config`**: el backend sirve `enabled, mode,
submission_window, entries_per_approved_submission, identity_requirements[],
limit_period, max_per_participant_per_period, requires_review`. La vía
   gratuita necesita además `required_fields[]` (campos del formulario
   `ONLINE_FORM`, para no inventar ninguno), `instructions` localizadas
   (`MAIL_IN_REVIEW` / `EXTERNAL_INSTRUCTIONS`: el texto es legal y no lo
   redacta el frontend), `external_url` y `promotion_id`. Y `entries` frente a
   `entries_awarded` en la respuesta del envío. El frontend ya trata ausente y
   nulo como lo mismo y exige `enabled` booleano estricto (blindaje en
   `apps/web/src/lib/amoe-config.ts`).
2. **Peticiones aditivas (opcionales, no invalidan lo que se sirve hoy):**
   - `SessionState.capabilities?[]`: el mapa rol→capacidad es autoritativo en
     `packages/security`; que el frontend lo reimplemente es una segunda fuente
     de verdad. Hoy hay un espejo local marcado que solo decide qué enlaces se
     pintan.
   - **`POST /admin/entry-adjustments/preview`** — la que más importa: la
     confirmación `{before, proposed_delta, after}` necesita el "después", y el
     frontend no puede calcularlo sin duplicar el motor (lo detectaría el
     escáner `no-client-entry-math`).
   - `AdminAmoeSubmission.entries_before` / `entries_after_if_approved`.
3. **Paginación — RESUELTO (2026-08-27)**: es `?cursor=`, la del documento y
   la de `apps/api/src/http/pagination.ts`. El `after` era el nombre del
   **puerto interno** de repositorio (`listPublic({ limit, after })`), no el
   parámetro HTTP: dos capas distintas, y el puerto no es contrato. Nada que
   corregir en frontend ni en las rutas.

4. **Pendiente menor (2026-08-27)**: la API nombra el identificador
   `submission_id` en las tres formas AMOE y no publica `decided_at`,
   `reason_key` ni `cancellable`; el frontend mantiene `id` y esos tres como
   provisionales (`// TODO(HO-031)` en `contract.ts`) para alinearse de una
   vez cuando el backend los cierre.

Affected files: `apps/api/src/routes/{amoe,adjustments,auth}.ts`,
`docs/API_CONTRACT.md` §11.3/§11.4, `apps/web/src/lib/api/contract.ts`.

Blocking: NO para el panel con mocks; SÍ para conectar AMOE y ajustes a la
API real.

---

## HO-032

Status: OPEN

## Handoff

Date: 2026-08-27
From: security-integration (HO-028)
To: sesión paralela (`packages/security/src/env/**`) y backend-sweepstakes

Context:
Dos hallazgos al implementar la auditoría persistente:

1. **`audit_events.source_ip` debe ser un digest con clave.** Un SHA-256 a
   secas de una IPv4 se invierte por fuerza bruta (2³² valores). El secreto
   de la clave vive en `packages/security/src/env/**` (sesión paralela). Hasta
   entonces el campo se escribe `null`, que es la respuesta correcta.
2. **`AwardService.releaseHold` emite `entry.award.hold.released` fuera de
   la transacción que resuelve la retención** (`award-service.ts:239` frente a
   `withTransaction` en `:433`). El sink lo absorbe abriendo una transacción
   propia, pero la atomicidad de DEC-007 solo se cumple si el evento va
   dentro de la misma transacción que el efecto. Mover la emisión dentro.

What I need from you:

- Sesión paralela: variable de entorno `AUDIT_IP_DIGEST_KEY` (o nombre
  coherente con el registro), declarada en `.env.example` con valor falso y
  en el registro de `packages/security/src/env/`, con regla de
  endurecimiento en producción; `security` la consume por puerto.
- backend: mover la emisión de `releaseHold` dentro de `withTransaction` y
  añadir un test que falle si el evento se emite fuera.

Affected files: `packages/security/src/env/**`, `.env.example`,
`packages/sweepstakes/src/award/award-service.ts`.

Blocking: NO para construir; SÍ antes de dar por auditado el award.

---

## HO-033

Status: OPEN

## Handoff

Date: 2026-08-27
From: backend-sweepstakes (cableado de export), vía Team Lead
To: security-integration y abogado del cliente (`docs/LEGAL_PENDING.md`)

Context:
Dos consecuencias del propio dominio de `security` que hoy condicionan la
exportación, señaladas al cablearla:

1. **Finalizar un export exige la numeración visible encendida.**
   `runReconciliationChecks` exige que los tramos del universo cubran el total,
   y `export_snapshot_entry_ranges.entry_batch_id` es FK a `entry_batches`, que
   **solo existen con `visible_entry_numbers_enabled`** (DEC-032, apagado por
   defecto). Con el flag apagado el congelado produce cero tramos y la
   finalización se bloquea (`EMPTY_UNIVERSE`). O el universo se numera siempre
   (aunque no se muestre al participante), o la reconciliación admite un
   universo por cantidades sin ordinales. Es decisión de `security`/legal: los
   números visibles pueden tener efecto legal.
2. **Política de ordinales tras un reversal.** Cuando un reversal deja al
   participante con menos participaciones de las que otorgaron sus lotes, el
   congelado debe decidir qué lotes conservan ordinales. Implementado: por
   orden de asignación, **los lotes más recientes pierden** (la única política
   que no cambia un número que un participante ya vio conservado en un corte
   anterior). Justificado en la cabecera de
   `export-reconciliation-repository.ts`, pero debe confirmarla quien decide si
   los números visibles tienen efecto legal.

What I need from you:
Decidir (1) y confirmar o corregir (2), y reflejarlo en las Official Rules si
los números visibles se usan. Hasta entonces, ningún export puede finalizarse
con el flag apagado, y eso está bien: es el sistema negándose a inventar.

Affected files: `packages/tpa/src/reconciliation-checks.ts`,
`packages/database/src/repositories/export-reconciliation-repository.ts`,
`docs/LEGAL_PENDING.md`.

Blocking: SÍ para finalizar cualquier export real.

---

## HO-034

Status: PARTIALLY RESOLVED — abiertos (1) y (4), sesión paralela

## Handoff

Date: 2026-08-27
From: security-integration (HO-030), vía Team Lead
To: sesión paralela (1, 4), frontend-ux (2, 3, 6), backend-sweepstakes (5, 7)

Context:
Al mapear el recorrido de punta a punta aparecieron defectos que hoy hacen
imposible completar la mitad del flujo. Las pruebas afirman lo correcto y
están en `test.fixme` con su motivo (`tests/e2e/lib/blockers.mjs`).

1. **BLOQUEANTE — el autorizador no evalúa los feature flags.**
   `apps/api/src/http/session-authorizer.ts` pasa `featureFlagEnabled: null`,
   `reasonProvided: false` y `secondApprovalGranted: false` a `authorize()`,
   que deniega con `FEATURE_FLAG_NOT_EVALUATED`. Sembrar el flag encendido no
   desbloquea nada: el autorizador no lo lee. Afecta a `amoe.self.submit`,
   `amoe.review.approve/reject`, `entry.adjust.create/approve` → **403
   siempre**. Sin esto, AMOE y ajustes no funcionan contra la API real.
   **Medición de la sesión paralela (2026-08-27) contra el catálogo compilado:
   27 de 62 capacidades bloqueadas** — 7 por `featureFlagEnabled: null`, **26
   por `reasonProvided: false`** (reembolsos, descalificación, activación y
   cierre de promoción, versiones de reglas, cambios de flag, export
   finalize/download/deliver, PII, roles, sesiones…) y 6 por
   `secondApprovalGranted: false`. Prácticamente todo el panel devuelve 403 hoy.
   La sesión paralela lo asume, antes de su fase 3, con dos salvaguardas:
   `reasonProvided` exige motivo no vacío con longitud mínima **persistido en
   la auditoría** (ya existe: `audit_events`, HO-028), y `secondApprovalGranted`
   exige actor distinto y TTL vivo verificados, no un booleano de repositorio.
2. **Carrito: web y API no coinciden.** `cart/page.tsx:128` lee
   `cartResult.data.cart.items`; `GET /cart` devuelve `{ id, currency, lines,
subtotal, entry_quote }` (ya señalado en HO-017). La pantalla no puede
   pintar líneas.
3. **`apps/web` no emite ninguna cabecera de seguridad** (ni CSP, ni HSTS, ni
   `nosniff`) en ningún entorno: `next.config.mjs` no define `headers()`.
   `apps/api` sí las emite.
4. **No existe `POST /auth/register`** (fase siguiente de identidad). El e2e
   siembra el participante por SQL.
5. **El panel llama a ocho endpoints inexistentes** (`/admin/dashboard`,
   `/admin/promotions`, `/admin/orders`, `/admin/audit-events`, …). Solo AMOE y
   ajustes tienen backend. Catálogo y promociones de admin son de la sesión
   paralela (fase 3); dashboard, pedidos, participantes y auditoría de esta.
6. Menor: la API responde `PAYMENT_PROVIDER_NOT_CONFIGURED` y el diccionario
   solo traduce `PAYMENT_PROVIDER_UNAVAILABLE`.
7. **`pnpm run lint:root` está ROJO en `main`** (6 errores: definiciones de
   reglas `@next/next/*` y `jsx-a11y/*` no encontradas en `apps/web` y
   `packages/ui`, más un `eslint-disable` inútil en `checkout-actions.ts:15`).
   El gate `lint` de CI ejecuta `lint:root`: **fallará en el primer push**.
   `turbo run lint` (por paquete) sí está en verde.

What I need from you:
(1) evaluar flags, `reason` y segunda aprobación en el autorizador desde los
repositorios y la petición; (2) alinear el carrito con el contrato; (3)
`headers()` con CSP, HSTS en producción y `nosniff`; (5) endpoints de admin
que faltan; (6) copy; (7) que la configuración raíz ignore los paquetes con
config propia o registre sus plugins, y `lint:root` en verde.

Blocking: (1) y (7) SÍ antes de cualquier push; el resto para dar por
integrado el flujo.

Resolution (2026-08-27, Team Lead):

- (2) carrito, (3) cabeceras y (6) copy: **cerrados** en `c90c732`.
  `CartWithQuote` plano según §5 del contrato; `image_url`, `availability`,
  `updated_at` e `item_count` **no se inventaron**: siguen pedidos a backend en
  HO-017. CSP con nonce por petición: DEC-049. `PAYMENT_PROVIDER_NOT_CONFIGURED`
  traducido en los dos idiomas, distinto de `PAYMENT_PROVIDER_UNAVAILABLE`.
- (5) endpoints de admin: **dashboard, pedidos, participantes y auditoría
  cerrados** en `ed777b4` (contrato §11.7; PII enmascarada en la frontera, ruta
  de PII completa aparte bajo `pii.view.full`, que responde 403 hasta (1)). El
  panel los consume ya con su forma real (`c90c732`). **Catálogo y promociones
  de admin siguen abiertos**: §12, sesión paralela, después de (1).
- (7) `lint:root`: **cerrado** en `ed777b4` (la raíz ignora los workspaces con
  config propia; `turbo run lint` sigue entrando en cada uno).
- (1) autorizador y (4) `POST /auth/register`: **abiertos, sesión paralela**,
  con el plan de (1) sin condicionantes (flag desde `ConfigRepository`, motivo
  no vacío persistido en `audit_events`, segunda aprobación verificada contra
  `draw_approvals`/`adjustments` con actor distinto y TTL vivo). Los 11
  `test.fixme` de `tests/e2e/lib/blockers.mjs` los retira
  **security-integration contra CI** cuando la sesión paralela entregue el
  hash, no antes: verificación independiente, no verde autodeclarado.

Blocking para el push conjunto, a día de hoy: solo (1).

## HO-035

Status: RESOLVED — opción (b), DEC-050, `62fc4d1`

## Handoff

Date: 2026-08-27
From: frontend-ux (HO-034.3), vía Team Lead
To: backend-sweepstakes (decisión), frontend-ux (si el arreglo va en `apps/web`)

Context:
Al añadir `/admin/es/audit` al humo apareció que **el cambio de actor de
personal en desarrollo nunca funcionó**: `cookies().toString()` de Next
serializa la cabecera `Cookie` que `apps/web` reenvía a la API como

```text
lsw_dev_session_staff=…; Path=/; lsw_dev_staff_actor=compliance%40example.com; Path=/
```

con pseudo-cookies `Path=/` intercaladas y los valores percent-encoded. El
mock de desarrollo no decodificaba, no encontraba el correo y caía a un actor
de respaldo **en silencio**: un panel válido con la persona equivocada,
indistinguible de "esa persona no tiene ese permiso". Arreglado en
`src/mocks/dev-server.ts` (`c90c732`).

**Lo mismo llega hoy a `apps/api`** desde `apps/web` en cualquier entorno.
Funciona porque `@fastify/cookie` decodifica y tolera las pseudo-cookies, y
el e2e de HO-030 lo cubre, pero **no es la cabecera que manda un navegador**
y hoy es un comportamiento heredado, no decidido.

What I need from you:
Decidir explícitamente una de dos y dejarla escrita en `docs/API_CONTRACT.md`
§10 (Auth):
(a) `apps/web` construye la cabecera `Cookie` desde `cookies().getAll()` en
`readSession` (`name=value; name=value`, sin atributos) y la API deja de
depender de la tolerancia del parser; o
(b) la API declara que acepta esa forma, con un test de contrato que fije la
cabecera exacta que reenvía Next, para que un cambio de `@fastify/cookie` no
la rompa sin aviso.
Aparte, sigue pendiente de backend lo que pide HO-017 para el carrito:
`updated_at` e `item_count`, e `image_url` y `availability` por línea.

Blocking: NO. No condiciona el push; sí conviene antes de dar por cerrada la
identidad (HO-034.4).

Resolution (2026-08-27, Team Lead):
**Opción (b), registrada como DEC-050.** `apps/api/test/cookie-header-contract.test.ts`
levanta la app real y fija siete casos sobre la cabecera literal
(`62fc4d1`). El párrafo de §10 (Auth) lo aprobó la sesión paralela,
propietaria de la sección, con un matiz de razonamiento —es una tolerancia
medida, no una renuncia a imponer— y lo pegó el Team Lead en el punto exacto
que ella indicó. Pasar `readSession` a `cookies().getAll()` queda como mejora
opcional de `apps/web`: no rompe nada y no elimina la dependencia del
decodificador. Lo demás que pedía HO-017 para el carrito: ver HO-017.

---

## HO-036 — Llegó el primer borrador de Official Rules (backend → frontend, security)

**Fecha:** 2026-08-27
**De:** `backend-sweepstakes`
**Para:** `frontend-ux`, `security-integration`
**Estado:** ABIERTO — informativo, ninguna acción inmediata obligatoria

El cliente entregó el borrador del abogado. Está en
`docs/legal/Sweepstakes Official Rules - DRAFT.docx` y transcrito, parámetro a
parámetro, en `docs/LEGAL_PENDING.md` §"Llegada del primer borrador".

Lo que os afecta directamente, en corto:

- **Cuatro estados excluidos**: Alaska, Florida, Hawái y Nueva York. Hoy no hay
  ninguna puerta por estado en el registro ni en el checkout.
- **Tope de 1,000 participaciones por participante**, atravesando todos los
  métodos. Es un límite por persona, distinto del universo de 10,000 de
  DEC-042, que el borrador **no menciona**.
- **2 participaciones por cada $5.00 completos**, impuestos y envío excluidos.
- **El AMOE del borrador es solo postal.** El flujo de AMOE en línea que ya
  existe no aparece en las Official Rules. Hasta que el abogado lo resuelva, ese
  flujo **no puede otorgar participaciones en producción**.
- **Multiplicadores bonus hasta 10×**, nunca sobre el AMOE postal.
- **La Opción 2 vende paquetes de participaciones** directamente, lo que roza el
  lenguaje que `CLAUDE.md` §1 prohíbe. `security`: esto es la revisión de copy
  bilingüe que ya habías pedido, ahora con un texto concreto contra el que
  contrastar.

No he cambiado ni una línea de código por esto. Es un borrador con marcadores
sin rellenar —fechas, VIN, ARV, dirección postal del AMOE, administrador— y
`docs/LEGAL_PENDING.md` regla 2 dice que lo que dependa de un `TBD` vive como
configuración, no como regla fija.
