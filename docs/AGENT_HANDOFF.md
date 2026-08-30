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

## HO-037

Status: OPEN

## Handoff

Date: 2026-08-27
From: sesión paralela (lone-star-a3, backend) y Team Lead
To: security-integration (test de paridad, registro), backend-sweepstakes
(decisión del grupo A)

Context:
El primer despliegue de `api` en Railway no arrancó porque faltaba
`MFA_SECRET_ENCRYPTION_KEY`, obligatoria en el esquema de arranque
(`apps/api/src/config/env.ts`) y ausente del servicio. Al revisar el sentido
contrario apareció el fallo simétrico: **el registro
(`packages/security/src/env/registry.ts`) marca como obligatorias para `api`
ocho variables que el esquema de arranque nunca valida y que ningún código
lee** (comprobado con grep sobre `packages/` y `apps/` excluyendo el propio
registro):

- **Grupo A — valores codificados que el registro presenta como
  configurables (4).** El código lee un literal y la variable se ignora en
  silencio: `ARGON2_MEMORY_KIB` (→ `ARGON2_PARAMETERS` en
  `packages/security/src/crypto/password.ts`), `EXPORT_SCHEMA_VERSION` (→
  constante en `apps/api/src/routes/export.ts`),
  `AUDIT_CHAIN_CANONICALIZATION_VERSION` (→ `CURRENT_CANONICALIZATION_VERSION`
  en `packages/audit`), `MFA_TOTP_ISSUER` (→ literal en
  `packages/database/src/scripts/create-admin-cli.ts`). Un operador que ponga
  `ARGON2_MEMORY_KIB=65536` en Railway cree haber endurecido algo y no ha
  endurecido nada. Las dos versiones de formato rozan además el principio 14.
- **Grupo B — funcionalidad que aún no existe (4).** `EMAIL_PROVIDER`,
  `OTEL_ENABLED`, `PAYMENT_WEBHOOK_TOLERANCE_SECONDS`, `PGBOSS_SCHEMA`.

Existe test de paridad registro ↔ `.env.example`, pero **no** registro ↔
esquema de arranque de `apps/api`.

What I need from you:

1. **security-integration**: un test en `tests/security` que afirme, en
   **dirección única**, que toda variable que el registro marca obligatoria
   para `api` está validada por `apps/api/src/config/env.ts` (el esquema puede
   validar de más sin que sea fallo). Para que nazca en verde, **rebajar las
   ocho en el registro** (no ampliar `env.ts`: para el grupo B sería exigir
   configuración de algo inexistente; para el grupo A sería mentir también en
   el arranque). `packages/security` es de security (DEC-027).
2. **backend-sweepstakes** (decisión del grupo A, asumida por la sesión
   paralela, después de HO-034.1 y de su fase 3): cablear de verdad
   `EXPORT_SCHEMA_VERSION` y `AUDIT_CHAIN_CANONICALIZATION_VERSION` (versiones
   de formato con consecuencias de auditoría: el código debe leer la
   configuración en vez del literal) y **borrar** del registro
   `ARGON2_MEMORY_KIB` y `MFA_TOTP_ISSUER` hasta que alguien los necesite. Si
   la decisión cambia, se anota aquí antes de tocar código.

Blocking: NO para el push. Sí antes de dar por cerrada la configuración de
despliegue (`docs/DEPLOYMENT_RAILWAY.md`): mientras tanto, la lista de
"obligatorias" del registro no es fiable como checklist de Railway; la
fiable es la del esquema de arranque de `apps/api`.

---

## HO-038 — El panel ya puede crear productos y promociones: faltan los botones (backend → frontend)

**Fecha:** 2026-08-27
**De:** `backend-sweepstakes`
**Para:** `frontend-ux`
**Estado:** CERRADO — 2026-08-27. Pantallas de catalogo y promociones entregadas por backend-sweepstakes por orden directa del usuario (tabla en escritorio, tarjetas en telefono; alta, edicion, publicar, programar, activar y cerrar; el impedimento conocido se dice antes del boton y el 409 del motor se ensena tal cual).

El usuario pidió textualmente "que el admin funcione y tenga los botones". La
mitad de servidor está entregada en `9b1c278` y documentada en
`docs/API_CONTRACT.md` **§12**. Lo que falta es pantalla.

### Lo que ya responde

Once rutas, todas en el manifiesto (78 rutas ahora, eran 67):

| Método | Ruta                                        | Capacidad            |
| ------ | ------------------------------------------- | -------------------- |
| GET    | `/admin/products`                           | `product.read`       |
| POST   | `/admin/products`                           | `product.write`      |
| GET    | `/admin/products/{product_id}`              | `product.read`       |
| PATCH  | `/admin/products/{product_id}`              | `product.write`      |
| POST   | `/admin/products/{product_id}/publish`      | `product.publish`    |
| GET    | `/admin/promotions`                         | `promotion.read`     |
| POST   | `/admin/promotions`                         | `promotion.create`   |
| GET    | `/admin/promotions/{promotion_id}`          | `promotion.read`     |
| PATCH  | `/admin/promotions/{promotion_id}`          | `promotion.update`   |
| POST   | `/admin/promotions/{promotion_id}/activate` | `promotion.activate` |
| POST   | `/admin/promotions/{promotion_id}/close`    | `promotion.close`    |

Las pantallas **Catálogo** y **Promociones** del panel ya existen y hoy pintan
listas vacías. Lo que falta es el formulario de alta, el de edición y los botones
de publicar, activar y cerrar.

### Cinco cosas que la interfaz NO puede decidir por su cuenta

1. **Los dos idiomas son obligatorios en el alta.** El formulario tiene que pedir
   nombre en español y en inglés, los dos, sin rellenar uno con el otro. Un
   `422` con `path: "name.es-US"` significa exactamente eso.

2. **El precio va en la unidad menor, como entero.** 25,00 USD se manda como
   `2500`. Si el formulario acepta "25.00" y lo manda tal cual, es un `422`. Y
   `price_amount_minor` **vuelve como cadena**, no como número: puede superar el
   entero seguro de JavaScript, así que no lo pases por `Number()` para
   formatearlo.

3. **Activar y cerrar exigen un `reason_code`** con forma
   `^[a-zA-Z][a-zA-Z0-9_.]{2,63}$`, y **el autorizador lo lee antes del
   handler**. Sin él la respuesta es **403**, no 422, porque quien deniega es la
   puerta y no la validación. Un diálogo de confirmación que no pida motivo hará
   que el botón parezca roto.

4. **El `409 LIFECYCLE_REFUSED` hay que enseñarlo, no traducirlo.** Su
   `details.engine` trae el mensaje de PostgreSQL explicando cuál de los cuatro
   cerrojos saltó: falta ventana, falta versión de reglas, la versión no está
   activa, o le quedan claves legales sin resolver. Reescribirlo en el frontend
   produciría una explicación que se queda obsoleta el día que cambie el trigger,
   y quien opera necesita el motivo real.

5. **Publicar no es un campo, es un botón.** `PATCH` con `status` no hace nada, a
   propósito: publicar exige `product.publish`, que es otra capacidad. Si la
   pantalla mete el estado en el formulario de edición, el usuario verá que
   guardar "no aplica" el cambio.

### Lo que el usuario todavía no podrá hacer, y no es culpa de la interfaz

**Activar una promoción.** Le falta la `PromotionRulesVersion` (DEC-012), que no
existe todavía como superficie de escritura, y además el trigger exige que esa
versión no tenga claves legales sin resolver — y el borrador del abogado (HO-036)
aún no fija fechas de inicio ni de fin. Crear y editar promociones sí funciona;
activarlas devolverá `409` con el motivo exacto, que es la respuesta correcta.

Merece la pena que la pantalla lo diga de antemano en vez de dejar que el usuario
descubra el 409: si `active_rules_version_id` es `null`, el botón de activar
puede explicarse en vez de fallar.

## HO-039

Status: OPEN

## Handoff

Date: 2026-08-27
From: security-integration (e2e real, commit `7e47044`) y frontend-ux, vía
Team Lead
To: backend-sweepstakes (contrato y esquema), frontend-ux (consumo cuando
llegue)

Context:
El primer e2e contra `apps/api` real demostró que **el escaparate ha vivido de
fixtures**: `GET /promotions/{slug}` publica `id, slug, status, title, summary,
legal_timezone, starts_at, ends_at, rules_version_id, rules_version,
prize_value`, y `GET /products*` publica `id, slug, name, description, sku,
currency, variants[{ id, sku, price, availability }]`. Todo lo demás que
pintan la portada, la ficha de promoción y el catálogo existía solo en
`apps/web/src/lib/api/contract.ts` (marcado `[PROVISIONAL]`) y en
`src/mocks/fixtures/*`. Contra la API real las cuatro páginas públicas morían
con `TypeError` (500). `31f4c92` hace que el escaparate tolere la ausencia —
no pinta lo que no tiene y deriva `price_from` de las variantes — pero **el
hero de la GMC, la banda del premio, la fotografía, el tope de 10,000 de
DEC-042 y la oferta de participaciones siguen sin fuente en producción**.

What I need from you (backend), en el contrato antes que en el código
(principio 16), y como **opcionales** mientras el abogado no cierre lo suyo:

1. **`prize`** en `PromotionDetail`: `{ name: LocalizedText, description:
LocalizedText, declared_value: MoneyMinor | null }`. `prize_value` ya
   existe en el resumen; `declared_value` es el mismo dato y debe salir de la
   misma columna, no de una segunda.
2. **`media`** en `PromotionDetail`: `{ hero_url, square_url, alt:
LocalizedText | null }` (dos recortes, DEC-042; `alt` nulo = decorativa).
   No existe modelo de medios en el esquema (HO-017 lo confirmó para
   productos): decidir si es una tabla de medios o dos URL en la promoción,
   y registrarlo como DEC. Hasta entonces, la foto del premio sigue siendo
   un fichero estático de `apps/web/public/prizes/` que el frontend elige, y
   eso es exactamente lo que DEC-042 quería evitar.
3. **`entry_pool`** en `PromotionDetail`: `{ cap: number, issued: number |
null }`. `cap` es configuración de la promoción (su escritura es §12,
   `entry_pool_cap`); `issued` sale del ledger (`lsw_entry_balances_at`),
   nunca de un contador aparte. El frontend no resta ni pinta `issued`
   (DEC-044); lo publica el backend porque el panel lo necesitará.
4. **`entry_offer`** en `PromotionDetail`: `{ base_entries_per_unit,
unit_amount, multiplier, multiplier_starts_at, multiplier_ends_at }`,
   derivado de la `PromotionRulesVersion` activa (DEC-012), `null` sin
   versión activa. Es lo que permite decir qué ofrece la promoción sin meter
   nada en el carrito. El borrador del abogado fija "2 participaciones por
   cada $5.00 completos": esa es la forma de este objeto, no una constante.
5. **`administrator_name`** en `PromotionDetail` (`string | null`), pendiente
   del TPA (LEGAL_PENDING).
6. Catálogo (HO-019, sigue abierto): `variant.name`, `summary`,
   `category_key`, `image_url`/`images`, `shipping_note`,
   `entry_eligibility` (evaluada contra la versión de reglas activa, con
   `evaluated_against_rules_version_id`). Los tipos en `apps/web` ya son
   opcionales y el catálogo funciona sin ellos; lo que falta es que el
   catálogo deje de ser SKU y precio.

Frontend, cuando llegue cada campo: quitar el `?` correspondiente en
`contract.ts` y el caso "ausente" del test `real-api-shapes.test.tsx`, que
es el que hoy fija que la ausencia no rompe.

Blocking: NO para el despliegue (el escaparate ya no cae). SÍ para que la
promoción de la GMC sea real en producción: hoy en Railway la portada
enseña título y valor del premio, y nada más de lo que se ve en el mock.

## HO-040

Status: OPEN

## Handoff

Date: 2026-08-27
From: sesión paralela (revisión de `cbec565`) y Team Lead
To: security-integration (test de integración), backend-sweepstakes (revisión)

Context:
`POST /orders` escribía el id de la VARIANTE en `order_items.product_id`
desde que existe la ruta, y ningún test lo vio: los dobles en memoria de
`apps/api/test/support/in-memory-repositories.ts` aceptan cualquier uuid en
cualquier columna, así que un pedido "correcto" para el doble era un pedido
que el motor rechazaba por clave ajena (500 antes del 503 de pago). Lo
encontró el e2e real (`cbec565`). Es la versión de base de datos de la
lección de `admin-reads.test.ts`: un doble que no impone claves ajenas no
prueba integridad referencial.

What I need from you:
Un test de integración contra PostgreSQL real
(`packages/database/test/integration/`, o uno nuevo en `apps/api` con
`startTestDatabase()`) que recorra el checkout de punta a punta con datos
sembrados: carrito con una línea → `POST /orders` → fila en `orders` y en
`order_items` con `product_id = products.id` y
`product_variant_id = product_variants.id`, y el 503
`PAYMENT_PROVIDER_NOT_CONFIGURED` como respuesta. Que afirme por NOMBRE de
restricción cuando algo falle (`dbErrorMatching`). Sin Docker en local se
ejecuta en CI y contra el Postgres embebido del scratchpad; el e2e 04 queda
como segunda red, no como la única.

Blocking: NO. Se hace cuando se decida qué parte del checkout merece prueba
de integración; hasta entonces la red es el e2e 04.

---

## HO-041 — Segundo borrador de Official Rules: paquetes, tasas por tipo, tope 10,000 por persona, AMOE postal, bonus y catálogo real (Team Lead → backend, frontend, security)

Status: OPEN

## Handoff

Date: 2026-08-29
From: Team Lead
To: backend-sweepstakes, frontend-ux, security-integration

Context:
El cliente entregó el **segundo borrador** de las Official Rules
(`docs/legal/Sweepstakes Official Rules - DRAFT v2 (2026-08-29).docx`) y tres
mensajes. Transcripción, cambios y preguntas nuevas en
`docs/LEGAL_PENDING.md` §"Segundo borrador". Decisiones: **DEC-052**
(paquetes como productos `ENTRY_PACKAGE`, tasa por tipo, tope también en
AMOE, `entry_pool` retirado), **DEC-053** (categorías, variantes con nombre,
imágenes por URL) y **DEC-054** (superficie de escritura de versiones de
reglas, atajo bonus, flags, transcripción postal). Contrato: **§13** de
`docs/API_CONTRACT.md` (modifica §3, §4, §5, §12).

Resumen de lo que las reglas exigen y hoy no existe:

1. **Tope 10,000 por participante** (no un universo total): existe como
   `entry_limits.per_participant_max` + flag `entry_caps_enabled`, pero la
   concesión AMOE lo ignora y la interfaz lo pinta como "universo".
2. **1 participación por $1 en mercancía y 2 por $1 en paquetes**: el motor
   tiene una sola tasa por promoción y no sabe qué es un paquete.
3. **AMOE postal 2,000 por ficha, 5 fichas, 2 por sobre**: el dominio lo
   soporta por configuración, pero nadie puede meter una ficha (no hay
   transcripción) ni cargar la configuración (no hay escritura de versiones).
4. **Bonus 2X/5X/10X con duración**: el motor los calcula, pero no hay forma
   de crearlos desde el panel ni de anunciarlos en el sitio.
5. **Catálogo real** (7 categorías, gorras 5×5): sin categorías, sin nombre de
   variante, sin imágenes, y el panel crea una sola variante.

Además: `docs/API_CONTRACT.md` estaba **corrupto desde `d53cf42`** (el archivo
entero insertado dentro de una línea; dos copias concatenadas). Reparado por
el Team Lead en esta ronda conservando las cuatro ediciones posteriores.

What I need from you:

**backend-sweepstakes** (`packages/sweepstakes`, `packages/database`,
`packages/commerce` si hace falta, `apps/api`):

- `packages/sweepstakes`: modo `ENTRIES_PER_CURRENCY_UNIT_BY_PRODUCT_KIND`,
  `productKind` en `CalculationItemInput`, `product_kind_scope` en periodos,
  `bonus_rules` (esquema + lector), `mail_in` en `amoeConfigSchema`, tope en
  `AmoeService.grant` (§13.3), `ENTRY_CALCULATION_ENGINE_VERSION = 2`,
  transcripción (`submitOnBehalf` con metadata y bloqueo de auto-aprobación).
  Tests de motor: 1/$1 y 2/$1 con carrito mixto y FLOOR único; bonus solo
  paquetes; tope en AMOE con recorte y con espacio cero.
- `packages/database`: migración `0026_product_kind_categories_variants`
  (enum `product_kind`, `products.kind` NOT NULL DEFAULT 'MERCHANDISE',
  `products.category_key`, `products.image_url`, `product_variants.image_url`,
  `product_categories` + traducciones + las 8 categorías sembradas,
  `product_variant_translations`, `order_items.product_kind`), repositorios
  (carrito y pedidos con `productKind`; versiones de reglas: list/create/
  clone/update/documents/activate en transacción; flags: update + amoe_mode;
  categorías; variantes), `dev-seed` con los productos reales del cliente como
  fixtures (precios ficticios marcados) y un paquete por importe
  ($10/$20/$50/$100). Test de integración: activar versión archiva la
  anterior; PATCH sobre ACTIVE lo rechaza el trigger.
- `apps/api`: §13 completo, `openapi/` regenerado (`contract:check` verde),
  `entry_offer` por variante y en `PromotionDetail`, filtros de catálogo,
  `entry_pool` fuera. Errores nuevos en `http/errors.ts`
  (`AMOE_ENTRY_CAP_REACHED`, `RULES_VERSION_NOT_ACTIVE`, `SEPARATION_OF_DUTIES`).
  El autorizador ya conoce las capacidades (`packages/security`); la nueva
  `amoe.submission.transcribe` la añade security en paralelo: coordinar por
  nombre, no esperar.

**frontend-ux** (`apps/web`, `packages/ui`, `packages/design-system`):

- Escaparate: sección **Paquetes de participaciones** (kind) y filtros por
  categoría; ficha con selector de variante por nombre (colores) e imagen;
  en paquetes, **"Incluye N participaciones"** desde `entry_offer.base_entries`
  y, con bonus, `entries_now` con el periodo y su fin (countdown existente).
  Hero/portada: retirar el "universo de 10,000" y `entry_pool`; mostrar
  "máximo 10,000 por persona" desde `entry_offer.per_participant_max`, las
  tasas desde `entry_offer.rates`, y el **anuncio de bonus** (activo y
  próximos) desde `bonus_periods`. AMOE `MAIL_IN_REVIEW`: valor por ficha,
  límite, fichas por sobre, plazos e instrucciones desde `amoe-config`.
  Copy bilingüe: la palabra es "paquete de participaciones" / "entry
  package"; nada de "boletos". Actualizar `contract.ts`, fixtures del mock y
  tests (`real-api-shapes`, `decoration`, `promotion-presentation`,
  `promotion-rules-gate`, `no-hardcoded-copy`).
- Panel: formulario de producto con `kind`, categoría, imagen y **lista de
  variantes** (alta/edición/archivar); pantalla **Reglas** por promoción
  (versiones, crear/clonar, formulario estructurado para §13.2 con vista JSON
  avanzada, documentos ES/EN, activar con motivo + step-up, mostrar
  `unresolved_required_keys` y `validation` antes del botón); acción **Bonus**
  (multiplicador 2X/5X/10X o libre, inicio/fin con presets 6h/12h/24h/48h,
  ámbito paquetes/mercancía/ambos, motivo); pantalla **Flags** (lista,
  interruptor con motivo; las legalmente materiales avisan de que exigen
  `flag.update.legally_material`); en AMOE, **Transcribir ficha postal**
  (formulario con los campos de `required_fields`, sobre y número de fichas)
  y la proyección con tope. Navegación por capacidades como hoy.

**security-integration** (`packages/security`, `packages/audit`,
`packages/tpa`, `tests/security`, `tests/e2e`):

- `packages/security`: capacidad `amoe.submission.transcribe` (roles
  `PROMOTION_MANAGER`, `COMPLIANCE_OFFICER`), par de lectura, y comprobar
  que el autorizador exige `flag.update.legally_material` + step-up para
  flags materiales y `rules.version.activate` + motivo + step-up para activar
  y para el atajo bonus. Actualizar los tests de paridad del catálogo.
- `tests/security`: pruebas de autorización para las 18 rutas de §13.11
  (sin capacidad → 403; motivo ausente → 403; step-up), afirmación negativa de
  que `entry_pool`, `issued` y `remaining` no aparecen en ninguna respuesta
  pública, y que el escaparate no multiplica (`no-client-entry-math` verde).
- `tests/e2e`: semilla con la configuración de §13.2 (relleno para las claves
  TBD, como hoy) y un paquete de $10; escenarios: cotización de $10 en
  paquete = 20; bonus 5X creado desde el panel por el compliance officer →
  100; transcripción de ficha postal + aprobación por otra persona → 2,000;
  tope: participante en 9,000 recibe 1,000 y la traza lo anota.
- **Security review** final de los diffs de backend y frontend antes de
  INTEGRATE, con la lista de hallazgos aquí.

Reparto de tiempos: backend es el camino crítico; frontend arranca contra el
contrato con el mock (`apps/web/src/mocks`) y cambia al real cuando la API
publique `openapi/`; security arranca con la capacidad y los tests de
contrato, y cierra con la revisión.

Blocking: SÍ para dar por incorporado el borrador v2. NO para el despliegue
actual: ninguna promoción está activa y nada de esto cambia una promoción en
curso.

---

### HO-041 · petición cruzada de security

Status: OPEN

Date: 2026-08-29
From: security-integration (fase 1 de HO-041)
To: backend-sweepstakes, frontend-ux

He añadido la capacidad **`amoe.submission.transcribe`** al catálogo de
`packages/security` y he corregido `flag.update`. Las dos cosas rompen o
condicionan trabajo que es vuestro; aquí va lo exacto, para que no haya que
deducirlo de un fallo de CI.

#### 1. backend — migración RBAC nueva (rompe `packages/database/test/parity.test.ts` HOY)

Con la capacidad añadida, `pnpm --filter @lsw/database test` falla en **tres**
pruebas de `test/parity.test.ts`:

- `las capacidades sembradas son exactamente las de @lsw/security`
- `la migracion 0008 asigna a cada capacidad EL flag que la gobierna`
- `la matriz rol x capacidad sembrada es la de ROLE_CAPABILITIES`

Es el comportamiento correcto de ese test (una capacidad que el catálogo declara
y la migración no siembra dejaría una fila sin referencia en `admin_permissions`).
Hace falta una migración **forward-only** (DEC-005; no editar `0004` ni `0007`),
por ejemplo `0027_amoe_transcription_capability.sql`, con:

```sql
-- `depends_on_feature_flag` NO se lista: desde `0008` es columna GENERATED
-- (`feature_flag_key IS NOT NULL`).
INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii, legal_dependency) VALUES
  ('amoe.submission.transcribe', 'amoe', 'SENSITIVE',
   'Transcribir al sistema una ficha AMOE recibida por correo, a nombre de otra persona. Entra en la cola de revision; no concede participaciones.',
   false, false, false, true, true, 'AMOE');

UPDATE admin_permissions SET feature_flag_key = 'amoe_enabled'
 WHERE key = 'amoe.submission.transcribe';

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('PROMOTION_MANAGER', 'amoe.submission.transcribe'),
  ('COMPLIANCE_OFFICER', 'amoe.submission.transcribe');

-- Ver el punto 2: `flag.update` deja de exigir step-up.
UPDATE admin_permissions SET requires_step_up = false WHERE key = 'flag.update';
```

Y **tres ajustes en el propio test de paridad**, que hoy solo mira dos ficheros:

- `RBAC_SEED_MIGRATIONS` (línea ~99) enumera `[0004, 0007]`; hay que añadir la
  nueva o la capacidad no se verá.
- el bloque `la migracion 0008 asigna a cada capacidad EL flag` lee **solo**
  `0008_permission_feature_flag_key.sql`; el `UPDATE … feature_flag_key` de la
  migración nueva no lo vería. Conviene leer la unión de las dos, como ya se
  hace con las semillas.
- `parseSeedRowsAcross("admin_permissions")` mapea las columnas **por posición**
  (índices 0..10, con `depends_on_feature_flag` en el 9). El `INSERT` de arriba
  no puede llevar esa columna (es GENERATED), así que su lista de columnas
  difiere de la de `0004`/`0007` y el parseo posicional se descoloca. Decidid
  vosotros cómo: parsear por nombre de columna, o mantener dos formas.

No lo he tocado porque `packages/database/**` es vuestro (`docs/TASK_OWNERSHIP.md`).

#### 2. backend — `flag.update` ya NO exige step-up (relajación deliberada)

`capabilities.ts` declaraba `flag.update` con `requiresStepUp: true`, y la
sección 13.9 del contrato lo publica sin step-up (solo lo exige cuando la clave
es legalmente material). He alineado el catálogo con el contrato y he escrito el
porqué completo en el comentario de la capacidad. Resumen: los tres flags no
materiales (`manual_adjustments_enabled`, `provisional_entries_enabled`,
`dual_approval_for_sensitive_actions_enabled`) no abren por sí solos ninguna vía
de escritura —lo que habilitan sigue exigiendo step-up, motivo y segunda
aprobación— y exigir MFA en cada interruptor de la pantalla de flags acaba en
una ventana de step-up permanentemente abierta. **El motivo sigue siendo
obligatorio** y queda en `audit_events` con antes y después. Si el Team Lead
prefiere conservar el step-up, se revierte en una línea y la sección 13.9
debería decirlo.

#### 3. backend — helper nuevo: `capabilityForFlagUpdate(key)`

`packages/security` exporta:

```ts
export function capabilityForFlagUpdate(
  key: FeatureFlagKey,
): "flag.update" | "flag.update.legally_material";
```

Deriva la capacidad de `FEATURE_FLAGS[key].legallyMaterial`. Úsalo en
`PATCH /admin/feature-flags/:key` en vez de escribir la lista de claves
materiales —o un `if (is_legally_material)`— en el handler: sería una segunda
declaración de qué flags son materiales, y un flag nuevo se quedaría fuera.

**Aviso de diseño que os afecta**: el autorizador decide en un `preHandler` con
la capacidad **estática** de la ruta, y esta ruta lleva `:key`. Declarar
`flag.update` y no comprobar nada más significaría cambiar un flag legalmente
material con la capacidad débil y sin step-up. Las dos salidas limpias son
declarar la capacidad estricta en la ruta, o volver a autorizar en el handler con
`capabilityForFlagUpdate(key)` + `getCapability(...)` y la antigüedad del MFA que
ya trae `requireStaffContext` (`secondsSinceLastMfa`). `tests/security` comprueba
la derivación; la ruta la comprobáis vosotros.

#### 4. backend — `flag.update.legally_material` exige **segunda aprobación** y la sección 13.9 no la contempla

El catálogo lo declara `requiresSecondApproval: true` desde DEC-032 (y
`flags.ts` lo repite por escrito). `authorize()` deniega si la ruta no declara
`secondApprovalEnforcedBy`, así que **tal como está el contrato,
`PATCH /admin/feature-flags/:key` sobre un flag material y
`PATCH /admin/settings/amoe-mode` responderán 403 `FORBIDDEN` siempre**, igual
que le pasó a `entry.adjust.create` en HO-034.1.

No lo he relajado: bajar un control CRITICAL sin que nadie lo decida es
exactamente lo que este rol no debe hacer. Hay que elegir, y es decisión del
Team Lead: (a) implementar doble control para el cambio de flags materiales y
declarar `secondApprovalEnforcedBy` en las dos rutas, o (b) quitar
`requiresSecondApproval` de la capacidad y decirlo en DEC-032/DEC-054. Mientras
no se decida, esas dos rutas no pueden funcionar.

#### 5. backend — errores nuevos en `apps/api/src/http/errors.ts`

`tests/security/src/permissions/section-13-routes.test.ts` falla hoy porque no
existen `SEPARATION_OF_DUTIES` (409, sección 13.10), `AMOE_ENTRY_CAP_REACHED`
(409, sección 13.3) ni `RULES_VERSION_NOT_ACTIVE` (409, sección 13.8). Ya
estaban pedidos en HO-041; ahora queda comprobado por una prueba.

#### 6. backend — la migración `0026` y la semilla del e2e

`tests/e2e/seed/seed-e2e.mjs` ya escribe `products.kind` y `products.category_key`,
y siembra un paquete `ENTRY_PACKAGE` de $10 con la categoría `entry-packages`.
Mientras `0026` no exista, la semilla falla con _column "kind" does not exist_ —
es lo esperado, no un defecto del escenario. La semilla también da por hecho que
`0026` siembra las ocho categorías de DEC-053.

#### 7. frontend — el escáner `no-client-entry-math` no vigila `entry_offer`

`apps/web/src/test/no-client-entry-math.test.ts` compara el fuente contra la
lista `ENTRY_FIELDS`, y esa lista **no incluye `base_entries` ni `entries_now`**.
Con la sección 13.4, la ficha de un paquete puede escribir
`base_entries * multiplicador` o `base_entries * cantidad` y el escáner seguiría
en verde: es su punto ciego por diseño (vigila lo que se le nombra).

Añadid los dos a `ENTRY_FIELDS`. Lo he convertido en un gate que falla hoy y que
se apaga solo cuando lo hagáis:
`tests/security/src/invariants/entry-math-scanner-coverage.test.ts`.

#### 8. frontend — `ADMIN_CAPABILITIES` y la pantalla de transcripción

`apps/web/src/lib/api/contract.ts` declara `AdminCapability` como unión cerrada
y `capabilitiesOf()` **ignora** las capacidades que no conoce (correcto: no
rompe nada). Consecuencia: hasta que añadáis `"amoe.submission.transcribe"` a
`ADMIN_CAPABILITIES`, el enlace/botón de _Transcribir ficha postal_ no se puede
pintar por capacidad aunque la API ya la publique (`GET /auth/session` la
resuelve con `capabilitiesForRoles`, sin pasar por la base de datos).

#### 9. frontend — el escenario del e2e cambió de modalidad AMOE

La semilla pasa de `ONLINE_FORM` a **`MAIL_IN_REVIEW`** (es lo único que el
borrador v2 contempla). `specs/06-amoe.spec.mjs` ya no espera un formulario de
envío en `/{locale}/amoe`: espera las instrucciones del abogado, el valor por
ficha, el límite y los plazos de `mail_in`. Los tres bloqueos nuevos están en
`tests/e2e/lib/blockers.mjs` (`SECTION_13_API_ROUTES_MISSING`,
`SECTION_13_ADMIN_SCREENS_MISSING`, `SECTION_13_STOREFRONT_ENTRY_OFFER_MISSING`)
con evidencia de fichero y línea; se apagan poniéndolos a `false` en el mismo
commit que los resuelve.

#### 10. Riesgo abierto para el Team Lead: la vía en línea sigue accesible con AMOE postal

`POST /api/v1/promotions/:promotion_id/amoe-submissions` (participante,
`amoe.self.submit`) **no consulta la modalidad**: el dominio documenta que
`amoe_mode` decide qué pinta la interfaz, no quién puede escribir. Con la
promoción configurada como `MAIL_IN_REVIEW`, un participante autenticado puede
seguir creando envíos AMOE por API sin ficha, sin sobre y sin matasellos, y cada
uno vale 2,000 participaciones si alguien lo aprueba. El límite de 5 por
`PROMOTION` acota el daño, no lo impide.

No he escrito ninguna prueba que fije un comportamiento u otro —congelaría una
decisión que no es mía—, pero **hay que decidirlo antes de activar una promoción
real**: o la ruta rechaza los envíos cuando la modalidad no es en línea, o la
cola tiene que poder distinguir un envío en línea de una ficha transcrita (hoy
solo se diferencian por `metadata`). Relacionado con
`docs/LEGAL_PENDING.md` §"Segundo borrador", preguntas 6 y 7.

### HO-041 · resolución del Team Lead a los hallazgos de security (fase 1) — 2026-08-29

Los cuatro hallazgos son correctos. Se resuelven así; **§13.9 y §13.10 del
contrato quedan modificados por este bloque** (backend lo refleja en §13 al
marcar `IMPLEMENTED`; nadie reescribe §13.9 entero mientras backend edita).

**1. Flags legalmente materiales y `amoe_mode` exigen segunda aprobación
(DEC-032) → se construye control dual, no se rebaja la capacidad.**
Patrón idéntico a ajustes (HO-034.1):

- Tabla `setting_change_requests` (migración de backend, siguiente número
  libre): `id`, `setting_kind` (`FEATURE_FLAG` | `AMOE_MODE`), `setting_key`
  (clave del flag o `amoe_mode`), `requested_value jsonb` (`{ "enabled": bool }`
  o `{ "amoe_mode": AmoeMode | null }`), `status` (`PENDING_APPROVAL` |
  `APPLIED` | `REJECTED`), `reason_code`, `reason_text`,
  `requested_by_admin_user_id`, `requested_at`, `decided_by_admin_user_id`,
  `decided_at`, `decision_notes`, `applied_before jsonb`, `applied_after jsonb`;
  `CONSTRAINT setting_change_requests_approver_differs CHECK (decided_by IS NULL OR decided_by <> requested_by)`.
- `POST /api/v1/admin/settings/change-requests` — capacidad
  `flag.update.legally_material` (motivo + step-up); la ruta declara
  `secondApprovalEnforcedBy` apuntando al servicio y a la CHECK. Cuerpo
  `{ setting_kind, setting_key, enabled?, amoe_mode?, reason_code, reason_text }`.
  Con `dual_approval_for_sensitive_actions_enabled` encendido → 201
  `status: "PENDING_APPROVAL"` sin efecto; apagado → 201 `status: "APPLIED"`
  con efecto inmediato (mismo criterio que `AdjustmentService`). 422 si
  `setting_key` no es material (para esos existe el PATCH) o el valor no
  encaja con el `setting_kind`.
- `GET /api/v1/admin/settings/change-requests?status=&cursor=` — `flag.read`.
- `POST /api/v1/admin/settings/change-requests/:id/approve` y `/reject` —
  `flag.update.legally_material` (motivo + step-up); aprobar por quien
  solicitó → 409 `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` (el servicio Y la
  CHECK); aprobar aplica el cambio y deja `audit_events` `setting.change.applied`
  con `before/after`; `amoe_mode` sigue validándose contra la versión de
  reglas activa (409 `AMOE_CONFIG_INVALID` si discrepan) **en el momento de
  aplicar**.
- **`PATCH /api/v1/admin/settings/amoe-mode` desaparece** del contrato.
- `PATCH /api/v1/admin/feature-flags/:key` queda **solo para flags no
  materiales**: capacidad estática `flag.update` (motivo, sin step-up); si
  `capabilityForFlagUpdate(key)` (helper nuevo de `@lsw/security`) devuelve
  `flag.update.legally_material`, la ruta responde **409 `FLAG_LEGALLY_MATERIAL`**
  con `details.use = "POST /admin/settings/change-requests"`, sin tocar nada.
  Así la capacidad de la ruta es estática y el hallazgo 3 queda cerrado.
- `GET /api/v1/admin/feature-flags` añade por fila
  `pending_change_request_id: uuid | null`.

**2. La vía AMOE en línea no puede quedar abierta con AMOE postal.**
`AmoeService.submit` (camino del participante) rechaza con
`AMOE_MODE_NOT_ONLINE` (409 en la API) cuando `config.mode` es
`MAIL_IN_REVIEW` o `EXTERNAL_INSTRUCTIONS`; `submitOnBehalf` (transcripción)
solo se admite con `MAIL_IN_REVIEW` (409 `AMOE_MODE_NOT_MAIL_IN` en otro
caso). El escaparate ya pinta esas dos modalidades sin formulario; ahora la
API lo garantiza. Test de dominio y de API para las dos direcciones.

**3. Capacidad estática** → resuelto por el punto 1 (dos rutas, una por
capacidad).

**4. `applied_cap` observable.** (a) `GET /admin/amoe-submissions` publica,
para envíos `APPROVED`, `granted_entries: number` y
`applied_cap: { kind, limit, requested, granted } | null` (leídos de la
transacción del ledger enlazada por `entry_transaction_id`). (b) El ledger
del portal (`GET /me/entries/ledger` o la ruta equivalente de §6/§11.2)
publica `applied_cap` con la misma forma en las filas `AMOE_EARNED` y
`PURCHASE_EARNED` cuyo `metadata`/traza lo contenga; `null` en el resto. No
es PII: es el dato del propio participante y explica por qué recibió menos
de lo anunciado.

**Efecto para frontend (pantalla Flags y AMOE):** flags no materiales →
interruptor con motivo; flags materiales y `amoe_mode` → botón «Solicitar
cambio» (crea la solicitud) y lista de solicitudes pendientes con
«Aprobar»/«Rechazar» (deshabilitado para quien la pidió, con explicación);
en la cola AMOE, mostrar `granted_entries`/`applied_cap` tras aprobar; en el
portal, la fila del ledger explica el recorte.

**Efecto para security (fase 2):** actualizar la matriz de §13.11 en
`tests/security` (quitar `PATCH /admin/settings/amoe-mode`; añadir las cuatro
rutas de `settings/change-requests`; `PATCH /admin/feature-flags/:key` sobre
flag material → 409 `FLAG_LEGALLY_MATERIAL`, no 403), y el e2e `11-mail-in-amoe`
debe afirmar que `POST /promotions/:id/amoe-submissions` responde 409
`AMOE_MODE_NOT_ONLINE` con AMOE postal.

---

### HO-041 · fase 1b de security: gates actualizados a la resolución del Team Lead

Status: OPEN (esperando a backend)

Date: 2026-08-29
From: security-integration
To: backend-sweepstakes, frontend-ux

Recogida la resolución. `tests/security` y `tests/e2e` ya afirman el diseño
nuevo. **502 pruebas, 497 pasan, 5 fallan**, y las cinco son gates de trabajo
pendiente que se apagan solos:

1. `apps/api/src/http/errors.ts` no declara `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN`,
   `FLAG_LEGALLY_MATERIAL`, `AMOE_MODE_NOT_ONLINE` ni `AMOE_MODE_NOT_MAIL_IN`.
   Los otros cuatro (`SEPARATION_OF_DUTIES`, `AMOE_ENTRY_CAP_REACHED`,
   `RULES_VERSION_NOT_ACTIVE`, `RULES_CONFIG_INVALID`) ya están: gracias.
2. Ninguna fuente de `apps/api/src` declara `/admin/settings/change-requests`, y
   cuando exista **tiene que declarar `secondApprovalEnforcedBy`** o la puerta
   denegará igual que antes (hay una prueba que lo comprueba por separado).
3. El manifiesto no publica las 21 rutas de §13.11.
4. §13.11 de `docs/API_CONTRACT.md` todavía lista `PATCH /admin/settings/amoe-mode`
   y no las cuatro de `settings/change-requests`; la prueba «el contrato documenta
   las 21 rutas» falla hasta que backend actualice la tabla al marcar `IMPLEMENTED`.
5. `ENTRY_FIELDS` de `apps/web/src/test/no-client-entry-math.test.ts` sigue sin
   `base_entries` ni `entries_now` (petición 7 del bloque anterior).

Lo que la matriz de `tests/security` afirma ahora, por si condiciona la
implementación:

- `flag.update.legally_material` **conserva** `requiresSecondApproval: true`, y
  hay una prueba que impide bajarlo: era la alternativa fácil al control dual.
- `PATCH /admin/feature-flags/:key` es alcanzable **porque** `flag.update` no
  exige segunda aprobación; sobre una clave material el rechazo es **409
  `FLAG_LEGALLY_MATERIAL`**, no 403. Se afirma el código a propósito: 403 se
  lee como «permiso mal configurado» y el atajo evidente sería ensanchar el rol
  (el mecanismo de HO-013).
- `GET /admin/settings/change-requests` se lee con `flag.read`, no con la
  capacidad de escritura.
- Se afirma la **ausencia** de `PATCH /admin/settings/amoe-mode`: si reapareciera,
  volvería el 403 permanente del hallazgo 1.

En `tests/e2e`, `11-mail-in-amoe` afirma ahora las dos direcciones de la
modalidad —envío en línea de un participante → 409 `AMOE_MODE_NOT_ONLINE`, y la
transcripción por el panel sigue funcionando— y lee `applied_cap` por las
superficies del contrato (`granted_entries`/`applied_cap` en
`GET /admin/amoe-submissions` para envíos `APPROVED`, y `applied_cap` por fila en
`GET /account/entry-transactions`). El acceso directo con `pg` se queda como red
de reconciliación: comprueba que la API y la fila cuentan lo mismo, no sustituye
a las anteriores.

**Un detalle del contrato para backend**: el ledger del portal debe publicar
`applied_cap: null` en las filas sin recorte, no omitir la clave. Un campo
ausente es indistinguible de una versión antigua de la API, y la prueba lo exige
así.

### HO-041 · petición cruzada de backend

Status: OPEN

Date: 2026-08-29
From: backend-sweepstakes
To: security-integration, frontend-ux, Team Lead

Cierro mi parte de HO-041 (contrato §13 completo, incluida la resolución de la
fase 1 de security). Lo que sigue es lo que **no puedo hacer yo** porque vive
fuera de `apps/api/**`, `packages/database/**`, `packages/sweepstakes/**` y
`packages/commerce/**`, más dos cosas que sí hice en mi zona pero que os afectan.

**1. Para `security` — dos migraciones del catálogo RBAC que escribí yo.**

`packages/security` cambió en paralelo (capacidad `amoe.submission.transcribe`,
`flag.update` sin step-up) y `packages/database/test/parity.test.ts` compara el
catálogo de código contra lo que siembran las migraciones. Al quedarse en rojo
mi paquete, escribí la migración que faltaba:

- `packages/database/drizzle/0027_rbac_catalog_ho041.sql`: siembra
  `amoe.submission.transcribe` (dominio `amoe`, `SENSITIVE`, `touches_pii`,
  `legal_dependency: AMOE`), le asigna `feature_flag_key = 'amoe_enabled'`, se
  la concede a `PROMOTION_MANAGER` y `COMPLIANCE_OFFICER`, y aplica
  `requires_step_up = false` a `flag.update`.
- `packages/database/test/parity.test.ts` ahora lee el catálogo **por nombre de
  columna** y aplica los `UPDATE` posteriores. La lectura posicional dejó de
  valer en cuanto una migración tuvo que insertar otra combinación de columnas:
  desde `0008`, `depends_on_feature_flag` es GENERADA y no se puede escribir.

No he tocado `packages/security`. Si preferís que la migración la escriba
security, decidlo y la retiro.

**2. Para `security` — tabla y rutas del control dual (resolución fase 1).**

- `packages/database/drizzle/0028_setting_change_requests.sql`, con
  `CONSTRAINT setting_change_requests_approver_differs`. Es el segundo cerrojo
  de la separación de funciones; el primero está en
  `apps/api/src/routes/admin-rules.ts`, handler de `/approve`.
- Las cuatro rutas de `settings/change-requests` declaran
  `secondApprovalEnforcedBy` apuntando a los dos sitios, como ya hacía
  `POST /admin/entry-adjustments`.
- `PATCH /admin/settings/amoe-mode` **no existe**. `PATCH /admin/feature-flags/:key`
  responde **409 `FLAG_LEGALLY_MATERIAL`** (no 403) sobre una clave material, y
  no toca nada.
- Códigos nuevos para vuestra matriz de §13.11: `AMOE_ENTRY_CAP_REACHED`,
  `RULES_VERSION_NOT_ACTIVE`, `SEPARATION_OF_DUTIES`, `RULES_CONFIG_INVALID`,
  `FLAG_LEGALLY_MATERIAL`, `SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN`,
  `SETTING_CHANGE_NOT_PENDING`, `AMOE_MODE_NOT_ONLINE`, `AMOE_MODE_NOT_MAIL_IN`.
  Los dos últimos y `SETTING_CHANGE_NOT_PENDING` no estaban en vuestro encargo:
  los dos primeros salen de la fase 1 y el tercero cubre la carrera entre dos
  aprobaciones de la misma solicitud.

**3. Para `security` — `tests/e2e` y `tests/security` necesitan semilla nueva.**

No puedo tocar `tests/**`. Lo que hay que cambiar:

- La siembra de `order_items` necesita `product_kind` (columna NOT NULL sin
  default: insertar sin ella falla).
- `POST /admin/products` exige `kind` en el cuerpo. Sin él, 422.
- Con AMOE postal, `POST /promotions/:id/amoe-submissions` responde 409
  `AMOE_MODE_NOT_ONLINE` —lo que pedís en el e2e `11-mail-in-amoe`— y la
  transcripción va por `POST /admin/amoe-submissions`, que exige además
  `preferred_locale` en el cuerpo (`en-US` o `es-US`).

**4. Para `frontend` — cambios de forma que no estaban en el contrato original.**

Todos documentados en **§13.12** del contrato. Los tres que más os afectan:

- `entry_offer.rates[].amount_unit.currency` es **nulable**: `promotions` no
  tiene columna de moneda y la única fuente es `config.currency`.
- `variants[].name` es `LocalizedText | null`; `null` = variante única sin
  nombre, y NO son dos cadenas vacías.
- `POST /admin/amoe-submissions` exige `preferred_locale` en el cuerpo, y la
  respuesta añade `flagged_envelope`.
- `GET /admin/feature-flags` añade `pending_change_request_id` por fila y
  `amoe_mode_pending_change_request_id` en la raíz. La pantalla de flags
  necesita las cuatro rutas de `settings/change-requests` para lo material.

**5. Para el Team Lead — dos cosas que no me corresponden.**

- **Puede merecer un `DEC-0xx`** la tabla `setting_change_requests` y el diseño
  de dos caminos (PATCH para lo no material, solicitud+aprobación para lo
  material). No he reservado número para no colisionar con `security` y
  `frontend`, que están escribiendo en paralelo en el mismo fichero.
- Los tests de integración de `packages/database` **no se han ejecutado**: no
  hay Docker en esta máquina. Están escritos y compilan (`typecheck` verde),
  pero alguien tiene que correrlos con PostgreSQL antes de dar por buenas las
  migraciones `0026`, `0027` y `0028`.

**6. Sin novedad legal.** No he escrito ningún valor legal en código. Todo lo
del borrador v2 —tasas, tope, plazos postales, techo de bonus— vive en
`PromotionRulesVersion.config` y aparece en el repositorio únicamente como
fixture de test, marcado como tal.

Blocking: NO. Los puntos 1 y 2 ya están hechos y en verde; el 3 bloquea vuestra
fase 2 hasta que actualicéis la semilla.

---

### HO-041 · petición cruzada de frontend — 2026-08-29

Status: OPEN

From: frontend-ux
To: backend-sweepstakes (puntos 1 a 5), Team Lead (punto 6)

`apps/web` ya consume §13 completo, y `apps/api/openapi/openapi.json` ya publica
las 18 rutas. Comparando las dos formas aparecen **cinco divergencias entre el
contrato escrito y lo que publica la API real**. Ninguna bloquea: el frontend
tolera las dos formas y prefiere la que llega. Se anotan aquí porque el
frontend no edita `docs/API_CONTRACT.md` (regla de ownership) y una de ellas
—la primera— hoy rompería una pantalla si se hubiera escrito solo contra el
documento.

**1. `GET /admin/amoe-submissions` publica `submission_id`, no `id`, y no trae
`participant_email`.** El contrato nombra `submission_id` en las tres formas
AMOE, y esta capa llevaba `id` desde antes (el `TODO(HO-031)` de
`contract.ts`). El panel resuelve las dos con `amoeSubmissionId()`
(`apps/web/src/lib/admin/amoe-queue.ts`) y etiqueta la fila con el correo
cuando llega y con el identificador cuando no. **Petición: cerrad cuál es el
nombre** y actualizad §11.3; entonces sobra la mitad del ayudante.

La respuesta real trae además `mode`, `period_bucket`, `flagged_duplicate` y
`flagged_envelope`, que §11.3/§13 no describen. El panel ya usa
`flagged_envelope` para avisar del sobre con más fichas de las admitidas
(§13.10). **Petición: documentadlos.**

**2. `GET /promotions/{slug}/amoe-config` publica el límite PLANO**
(`max_per_participant_per_period`, `limit_period`) y §13.2 lo describe anidado
bajo `limit`. El frontend lee la plana primero y cae a la anidada. **Petición:
cerrad cuál es.** La respuesta real sí publica ya
`entries_per_approved_submission` y `mail_in`, así que la petición que esta
capa tenía anotada como `[PROVISIONAL]` queda cubierta.

**3. Solicitudes de cambio de ajustes: falta saber si la pidió quien mira.**
`GET /admin/settings/change-requests` publica `requested_by_admin_user_id`, y
la sesión publica correo, roles y capacidades, no un identificador de actor. La
pantalla no puede deshabilitar con conocimiento de causa el botón de aprobar la
propia solicitud: hoy lo advierte y deja que el 409
`SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN` sea el control —que es lo correcto,
pero manda a alguien a un rechazo evitable—. **Petición: un booleano por fila,
`requested_by_me`**, o el identificador del actor en `GET /auth/session`.
Cualquiera de los dos vale; el booleano no reparte identificadores.

**4. `AdminRulesVersion`: `missing_keys` y `unresolved_required_keys`
conviven.** El listado publica una y §13.7 la otra.
`unresolvedRulesKeys()` (`apps/web/src/lib/admin/rules-version.ts`) elige en un
solo sitio. **Petición: dejad una.** Lo mismo con `activatable`, que §13.7 no
declara: el panel no afirma nada cuando falta, en vez de deducir un veredicto.

**5. Ficha postal transcrita: el aviso es genérico a propósito.** La cola
publica `transcribed_by_admin_user_id` y el panel no conoce el suyo, así que
advierte «la transcribió alguien del equipo, que no puede aprobarla» sin decir
quién. Con el punto 3 resuelto, se puede afinar a «la transcribiste tú».

**6. Para el Team Lead — `docs/LEGAL_PENDING.md`.** Al construir la pantalla de
Reglas aparecieron dos preguntas que el segundo borrador no resuelve y que la
interfaz ha dejado deliberadamente abiertas:

- **Zona horaria de un periodo bonus.** El atajo pide instantes ABSOLUTOS en
  UTC y no hora de pared de la zona legal: un periodo de doce horas que cruza un
  cambio de horario no tiene una respuesta obvia, y no es el frontend quien debe
  elegirla. Si el abogado quiere que la ventana se exprese en hora legal de la
  promoción, cambia el formulario y cambia lo que se anuncia.
- **Bonus sobre mercancía.** El formulario permite acotar a paquetes, a
  mercancía o a ambos, porque §13.1 lo permite; el texto del borrador dice
  «Opciones 1 y 2» y el cliente habla solo de paquetes. Ya está anotado como
  pregunta 2 del segundo borrador; queda confirmado que la interfaz no elige.

Blocking: NO para el escaparate ni para el panel —todo funciona contra la API
real tal como la publica hoy—. SÍ para poder retirar los tres ayudantes de
tolerancia (`amoe-queue.ts`, la doble lectura del límite AMOE y
`unresolvedRulesKeys`), que existen solo mientras las dos formas convivan.

### HO-041 · respuesta de backend a la petición cruzada de frontend

Status: RESUELTO (puntos 1 a 5; el 6 es del Team Lead)

Date: 2026-08-29
From: backend-sweepstakes
To: frontend-ux

Las cinco divergencias, punto por punto. Los tres ayudantes de tolerancia
(`amoe-queue.ts`, la doble lectura del límite AMOE y `unresolvedRulesKeys`) se
pueden retirar.

**1. `submission_id` es el nombre. No hay `id`.** Lo publica
`amoeSubmissionSchema`, del que la fila de la cola es una extensión, así que
vale también para aprobar, rechazar y transcribir. Escrito en §11.3.

Y **documentada la fila entera** en §11.3 → "Forma completa de la fila de la
cola (`AmoeReviewItem`)", con `mode`, `period_bucket`, `flagged_duplicate`,
`flagged_envelope`, `transcribed_by_admin_user_id`, `granted_entries` y
`applied_cap`, que se publicaban sin estar descritos.

**`participant_email` AÑADIDO, y enmascarado.** Comprobado en
`packages/security/src/capabilities.ts`: `amoe.review.read` declara
`touchesPii: true`, así que la condición se cumple. Sale **enmascarado** por
`http/pii.ts` —dominio entero e inicial de la parte local— porque el dato
completo es `pii.view.full`, que es otra capacidad y exige motivo: para
distinguir filas y reconocer un dominio desechable basta con el enmascarado. El
`payload` del envío sigue sin salir.

**2. Las dos formas del límite AMOE son correctas y no hay nada que cerrar.**
La anidada (`amoe.limit.*`) es la de `PromotionRulesVersion.config` —lo que
redacta el abogado y parsea `amoeConfigSchema`—; la plana es la de la RESPUESTA
de `GET /promotions/{slug}/amoe-config`, que publica lo que el participante
necesita leer y no la configuración con su forma interna (`duplicate_policy` no
sale en absoluto). Aclarado en §13.12, nota 12. Leed la plana.

**3. `requested_by_me: boolean` por fila** en `GET /admin/settings/change-requests`
—y en las respuestas de crear, aprobar y rechazar, que comparten presentador—.
Booleano y no el actor de la sesión: el panel solo necesita saber si puede
aprobar ESA fila, y repartir identificadores de cuentas administrativas por un
listado es regalar el mapa del equipo. El 409 sigue siendo el control.

**4. `transcribed_by_me: boolean`** en la cola AMOE, con el mismo criterio.
Ya podéis afinar el aviso a «la transcribiste tú» (vuestro punto 5).

**5. `unresolved_required_keys` es el nombre; `missing_keys` no existe** en
`apps/api` ni en el `openapi.json` emitido —comprobado por `grep`—, así que no
había nada que retirar por mi parte: el nombre del contrato es el único que
publica la API. **`activatable` sí faltaba y se ha añadido**, con su definición
escrita en §13.7: `unresolved_required_keys` vacía **Y** ninguna rebanada
`INVALID` **Y** `status === "DRAFT"`. Es un atajo de presentación para pintar un
botón, **no el control**: quien impide activar sigue siendo el trigger de
DEC-012, así que no deis por hecho el resultado.

**6.** Las dos preguntas legales son del Team Lead; no las toco.

Contratos afectados: §11.3, §13.7, §13.9, §13.10, §13.12 (notas 12 a 14).
`openapi/` regenerado. `apps/api` lint/typecheck/test en verde.

---

### HO-041 · security review (fase 2)

Status: OPEN — **hay hallazgos BLOQUEANTES (S-01, S-02)**

Date: 2026-08-29
From: security-integration
To: backend-sweepstakes, frontend-ux, Team Lead

Revisión de solo lectura sobre los diffs de `apps/api`, `packages/sweepstakes`,
`packages/database` y `apps/web`. `tests/security`: **503 pruebas, 502 pasan**
(la única roja es S-09, abajo). No he tocado `tests/e2e`.

Antes de la lista, dos cosas que conviene decir en positivo, porque condicionan
cómo leer el resto: la matriz de autorización de las 21 rutas es **correcta ruta
por ruta** (capacidad, motivo y step-up coinciden con el contrato y con el
catálogo), y el trabajo de minimización pública está bien hecho — ninguna
respuesta pública publica `entry_pool`, `issued`, `remaining`, `stock_quantity`
ni `quantity_available`, `readAppliedCap` es una proyección blanca de cuatro
escalares, el ledger del portal está acotado por `principal.participantId` (sin
IDOR) y `entry-offer.ts` devuelve `null` en vez de inventar una cifra, capturando
solo errores de dominio.

---

#### BLOQUEANTE

**S-01 — Quien transcribe puede firmar la ficha con el identificador de otro administrador, y después aprobarla él mismo.**
`packages/sweepstakes/src/amoe/amoe-service.ts:479-489`

```ts
public async submitOnBehalf(input: AmoeTranscribeInput, principal: Principal) {
  this.requireCapability(principal, SWEEPSTAKES_CAPABILITIES.amoeSubmissionTranscribe);
  return await this.submitInternal(input, {
    transcribedByAdminUserId: input.transcribedByAdminUserId,   // <- del INPUT
```

`transcribedByAdminUserId` llega como PARÁMETRO y nunca se contrasta con
`principal.actor.adminUserId` (`requireCapability`, :976-986, solo exige ámbito
STAFF y capacidad). Como `assertNotSelfTranscribed` (:731-746) compara al
aprobador contra ese mismo valor almacenado, quien transcriba puede escribir el
id de un compañero y aprobar la ficha él solo: **la separación de funciones de
DEC-054 punto 4 se evade sin tocar la metadata**. De paso, los dos eventos de
auditoría (`amoe.submission.created` :605-608 y `amoe.submission.transcribed`
:633) atribuyen el hecho a esa persona ajena — falsificación de actor en el
único registro que responde "quién hizo esto".

Hoy la ruta HTTP pasa `staff.adminUserId` (`apps/api/src/routes/amoe.ts:601-608`),
así que **no es explotable por HTTP**. Es bloqueante igualmente porque el propio
fichero declara que la regla no es del transporte y debe valer para "un job o un
script de administración" (:718-729), y porque un control de separación de
funciones cuyo dato de entrada lo elige quien lo va a eludir no es un control.

_Corrección (backend):_ derivar `transcribedByAdminUserId` de `principal.actor`
exigiendo `type === "ADMIN"`, y quitarlo de `AmoeTranscribeInput`. Test: mismo
principal, id ajeno en el input → rechazo.

**S-02 — Apagar `dual_approval_for_sensitive_actions_enabled` permite que UNA sola persona aplique un cambio legalmente material, y DEC-032 dice que ese flag no puede relajar nada.**
`apps/api/src/routes/admin-rules.ts:1186-1252`

Con el flag apagado, `POST /admin/settings/change-requests` nace `APPLIED`,
`decided_by = requested_by` y **aplica el cambio en el acto**, mientras la ruta
declara `secondApprovalEnforcedBy` (:1145) — con lo que `authorize()` recibe
`secondApprovalGranted: true`. `flag.update.legally_material` es CRITICAL con
`requiresSecondApproval: true`, y `packages/security/src/flags.ts` dice, sobre
ese flag, literalmente: _"APAGARLO NO RELAJA `requiresSecondApproval` de las
capacidades CRITICAL: solo puede AÑADIR la exigencia"_.

La cadena completa: `dual_approval_for_sensitive_actions_enabled` **no** es
legalmente material, así que se apaga por `PATCH /admin/feature-flags/:key` con
`flag.update` (SECURITY_ADMIN, sin step-up); a partir de ahí un COMPLIANCE_OFFICER
solo enciende o apaga `amoe_enabled`, `winner_publication_enabled`,
`internal_draw_enabled` o `visible_entry_numbers_enabled`. Dos personas, ninguna
aprobando a la otra. Apagar `amoe_enabled` deja la promoción sin vía gratuita:
es el cambio más grave que se puede hacer con un interruptor.

El patrón viene de `AdjustmentService` (`packages/sweepstakes/src/adjustment/adjustment-service.ts:250-257`)
y allí ya era discutible; extenderlo a los flags legalmente materiales amplía
mucho el radio.

_Corrección — hay que elegir una, y es decisión del Team Lead:_
(a) que el control dual de los ajustes legalmente materiales **no** dependa del
flag (siempre `PENDING_APPROVAL`), que es lo que dice DEC-032 hoy; o
(b) que `dual_approval_for_sensitive_actions_enabled` solo se pueda apagar por la
propia cola de solicitudes —es decir, que desarmar el control dual exija control
dual—, lo que además cierra el eslabón débil de la cadena; o
(c) enmendar DEC-032 explicando por qué el flag sí puede relajar, y entonces
`packages/security/src/flags.ts` y el test
`tests/security/src/flags/feature-flags.test.ts` ("la segunda aprobación no se
puede apagar por la puerta de atrás") dejan de decir la verdad y hay que
reescribirlos.

Yo recomiendo (b): es el cambio más pequeño y deja el invariante escrito donde se
puede comprobar. Si se elige, `packages/security` puede exportar el dato
(`flagRequiresChangeRequest(key)`) para que la ruta no lo escriba a mano; lo hago
yo en cuanto se decida.

---

#### ALTA

**S-03 — El tope por participante no está serializado: dos aprobaciones concurrentes de fichas DISTINTAS lo superan.**
`packages/sweepstakes/src/amoe/amoe-service.ts:1008-1079`

La lectura del saldo sí ocurre dentro de `withTransaction` (:1024-1028), pero
estar en la misma transacción no serializa nada: no hay `pg_advisory_xact_lock`
ni relectura, y bajo READ COMMITTED cada transacción no ve la fila no confirmada
de la otra. La UNIQUE `entry_transactions_idempotent_source` **no** acota este
caso: `source_ref` es `amoe:<submissionId>` (:1004), único por ENVÍO, no por
participante — solo protege la doble aprobación del mismo envío.

Escenario: participante con 9.000 de 10.000 y dos fichas en cola; dos revisores
aprueban a la vez; ambas leen 9.000, ambas conceden 1.000 → 11.000. Ninguna
restricción del motor lo rechaza. Es exactamente el tipo de carrera que el
repositorio ya resuelve en otros sitios con `pg_advisory_xact_lock`
(`packages/database/src/repositories/audit-event-repository.ts:367`,
`payment-event-repository.ts:187`).

**Agravante en la vía de compra**: `packages/sweepstakes/src/award/award-service.ts:403-423`
lee el saldo **fuera** de la transacción que abre en :464, así que una compra
concurrente con una aprobación AMOE supera el tope aunque solo se arregle AMOE.

_Corrección (backend):_ `pg_advisory_xact_lock(promotion_id, participant_id)` como
primera sentencia de la transacción en las dos vías, y mover la lectura del saldo
de `award-service.ts:403` dentro de `withTransaction`.

**S-04 — La transcripción puede colgar un perfil de participante de la identidad de un miembro del personal.**
`apps/api/src/services/admin-rules.ts:582-604`

Si el email de la ficha coincide con una identidad existente sin perfil de
participante, el código **reutiliza esa identidad** y le crea el perfil. El
comentario dice explícitamente "una cuenta de personal, por ejemplo". Es decir:
tecleando el correo de un compañero (o el propio) en una ficha postal se crea un
expediente de participante ligado a una identidad de personal, y con la
aprobación de otra persona esa identidad acumula 2.000 participaciones.

El borrador v2 §1 excluye a empleados y afiliados. Que la plataforma monte ese
estado en silencio, por la vía gratuita y sin marcarlo, es un problema de
elegibilidad, no de estilo.

_Corrección (backend):_ si la identidad tiene fila en `admin_users`, no crear el
perfil: 409 con código propio, o crear el envío **marcado** para revisión
humana. Nunca en silencio.

**S-05 — Las versiones de reglas se crean y se editan sin ningún `AuditEvent`.**
`apps/api/src/routes/admin-rules.ts` (crear ~:611, editar ~:665, documentos ~:700)

Solo emiten auditoría `rules.version.activated` (:805) y
`rules.version.bonus_period_added` (:963). `rules.version.create` es SENSITIVE en
el catálogo, y en `packages/security/src/capabilities.ts` una capacidad no
rutinaria emite `AuditEvent` por defecto: el catálogo promete algo que el código
no cumple. Un `DRAFT` es mutable y es el texto que después pasa a ser legalmente
controlante; sin evento no se puede reconstruir **qué** cambió en el borrador ni
quién lo cambió, solo quién lo creó (`created_by_admin_user_id`).

_Corrección (backend):_ emitir `rules.version.created`, `rules.version.updated`
y `rules.version.document_updated` con `before`/`after` (o el diff seguro de
`packages/audit/src/safe-diff.ts`, que existe justo para esto).

**S-06 — `setting_change_requests` admite UPDATE sin trigger que impida reescribir una decisión.**
`packages/database/drizzle/0028_setting_change_requests.sql:139`

`GRANT SELECT, INSERT, UPDATE ... TO lsw_app` y **ningún trigger**. Las CHECK
cubren `approver_differs` y la coherencia de la decisión, pero **no** impiden que
una fila `APPLIED` pase a `REJECTED`, ni que se reescriba `decided_by`. La
cabecera del fichero (:40) afirma "lo que no se puede es reescribir la decisión:
el CHECK lo impide", y no es así. El camino de la aplicación sí es seguro
(`decideSettingChangeRequest` solo actualiza desde `PENDING_APPROVAL`), pero el
criterio del repositorio es que estas cosas las imponga el motor: `adjustments`
tiene `lsw_adjustments_are_write_once_where_it_matters()`
(`0022_entry_operations.sql:166-180`) exactamente para esto.

_Corrección (backend):_ trigger `BEFORE UPDATE` que rechace cualquier cambio
cuando `OLD.status <> 'PENDING_APPROVAL'`, calcado del de `adjustments`.

---

#### MEDIA

**S-07 — La separación de funciones no cubre `reject`.**
`packages/sweepstakes/src/amoe/amoe-service.ts:748-783`

`assertNotSelfTranscribed` se invoca en `approve` (:712) y no en `reject`. Quien
transcribe puede rechazar él solo la ficha que tecleó, cerrando unilateralmente
la única vía gratuita de esa persona. Asimétrico con `approve` y con los ajustes.
_Corrección (backend):_ llamarlo también en `reject`.

**S-08 — Con auto-aprobación y espacio cero, el rescate a `PENDING_REVIEW` se pierde: el `throw` revierte el envío entero.**
`packages/sweepstakes/src/amoe/amoe-service.ts:657-683`

Con `requires_review: false` y tope agotado se pasa el envío a `PENDING_REVIEW`,
se emite `amoe.submission.cap_reached` y **se relanza**. La ruta envuelve `submit`
en una transacción real (`apps/api/src/routes/amoe.ts:429-435`), así que la
excepción revierte también el `submissions.save` y los dos eventos: no queda ni
la ficha ni el rastro, justo lo contrario de lo que documenta el comentario. Solo
se sostiene con el doble en memoria, que no revierte nada. No hay test de esa
rama (los seis casos de tope usan `requires_review: true`).
_Corrección (backend):_ no relanzar en la vía automática, o emitir el rescate
fuera de la transacción del llamante; y un test de auto-aprobación con espacio cero.

**S-09 — Cuatro códigos de error de §13 viven sueltos en las rutas, fuera del catálogo `http/errors.ts`.**
`apps/api/src/routes/admin-rules.ts:1042, 1312, 1421`; `apps/api/src/routes/amoe.ts:177-188`

`SETTING_CHANGE_SELF_APPROVAL_FORBIDDEN`, `FLAG_LEGALLY_MATERIAL`,
`AMOE_MODE_NOT_ONLINE` y `AMOE_MODE_NOT_MAIL_IN` se construyen con
`new ApiError({ code: "..." })` dentro del handler. **El control existe y
funciona**; lo que falta es que estén donde se puedan enumerar: una errata en una
cadena suelta no la contradice ningún tipo, el catálogo deja de listar lo que la
API puede responder, y el frontend traduce por código. Es la única prueba roja de
`tests/security` (`section-13-routes.test.ts`, "los codigos de error viven en el
catalogo").
_Corrección (backend):_ declararlos como fábrica en `ApiErrors`.

**S-10 — La cola de revisión publica el correo del participante y el id del administrador que transcribió, sin exigir `pii.view.masked`.**
`apps/api/src/routes/amoe.ts:519, 552-555`

El correo va enmascarado en la frontera (correcto, es el patrón de `http/pii.ts`),
pero la ruta solo exige `amoe.review.read`. Que hoy todos los roles con esa
capacidad tengan además `pii.view.masked` es una coincidencia del reparto, no una
garantía. `transcribed_by_admin_user_id` además no hace falta: `transcribed_by_me`
ya resuelve lo que la interfaz necesita, y el id crudo se lo lleva cualquiera con
`amoe.review.read`, incluido SUPPORT, que no tiene `rbac.admin.read`.
_Corrección (backend):_ condicionar `participant_email` a `pii.view.masked` y
retirar `transcribed_by_admin_user_id` de la proyección.
_Corrección (frontend):_ `apps/web/src/components/admin/amoe-review.tsx:67, 197,
214-219` pinta el correo y está escrito para pintar el `payload` completo
—nombre, dirección, teléfono— el día que la API lo publique, sin comprobar
ninguna capacidad de PII. Condicionarlo a `can(actor, "pii.view.masked")`.

**S-11 — Dos sinks de imagen no pasan por el validador nuevo.**
`apps/web/src/components/order-line-list.tsx:55` (`<img src={line.image_url}>`) y
`apps/web/src/components/promotion-hero.tsx:207, 324` (`<Image src={heroImage}>`,
desde `media.hero_url`).

`lib/media-url.ts` es **correcto** —rechaza `javascript:`, `vbscript:`, `data:`,
`http:`, `//evil`, `/\evil` y los esquemas ofuscados con `\n`/`\t`— y se aplica
en `product-card.tsx:182`, `add-to-cart-form.tsx:123` y la galería de la ficha.
Falta en esos dos. No es XSS ejecutable (`javascript:` en `src` no ejecuta), pero
permite incrustar contenido de terceros y `http:` (mixed content, baliza de
referrer) desde un campo que edita quien administra el catálogo.
_Corrección (frontend):_ pasarlos por `safeImageUrl`. Ojo: el fixture de respaldo
del hero es un `data:` URI (`mocks/fixtures/promotions.ts:245-246`) y habrá que
moverlo a `public/`.

**S-12 — El payload de una ficha se persiste con las claves que traiga, sin filtrar por `identity_requirements`.**
`packages/sweepstakes/src/amoe/amoe-service.ts:589` y `:940-952`

`assertPayloadComplete` comprueba que **estén** las claves requeridas; las de más
se guardan tal cual (`z.record(...)` sin tope de número de claves,
`apps/api/src/routes/amoe.ts:112`). Es minimización: `amoe_submissions.payload`
acaba almacenando datos personales que nadie pidió. Preexistente en la vía del
participante, nuevo en la del personal.
_Corrección (backend):_ proyectar el payload a las claves de
`identity_requirements` antes de persistirlo.

**S-13 — La transcripción no tiene cuota propia: cada correo nuevo estrena su límite de 5 fichas.**
`packages/sweepstakes/src/amoe/amoe-service.ts:84-108`; `apps/api/src/routes/amoe.ts:565-630`

Los dos controles antiabuso acotan por contenido (huella) y por persona (5 por
`PROMOTION`), pero ninguno acota "un operador creando N participantes con N
correos distintos". La única defensa es la capacidad y el rate limit global.
Requiere dos personas del equipo para convertirse en participaciones (S-01 y S-07
aparte), pero conviene que sea medible.
_Corrección (backend):_ cuota por transcriptor y ventana, o al menos un contador
"participantes creados por transcripción" en el informe de reconciliación.

**S-14 — Cobertura: el test de "un solo redondeo" del modo nuevo no discrimina, y la regresión de los cuatro modos anteriores es un solo caso.**
`packages/sweepstakes/test/calculation.test.ts:813-829` y `:900-909`

El carrito mixto elegido (12,50 MERCHANDISE + 10,00 ENTRY_PACKAGE → 32) da el
mismo número redondeando por tipo (12 + 20 = 32): el test pasa igual con la
implementación incorrecta. Y de la promesa de `engine-version.ts:51-64` —"los
resultados de configuraciones antiguas son idénticos"— solo existe **un** caso
(`ENTRIES_PER_CURRENCY_UNIT` con `productKind: ENTRY_PACKAGE`). Faltan
`FIXED_PER_ORDER`, `FIXED_PER_PRODUCT` y `TIERED_BY_AMOUNT` con tipo explícito y
carrito mixto, y los cuatro modos con un periodo `product_kind_scope: null`, que
es la única forma que puede tener una configuración migrada desde la versión 1.
El test de determinismo (:485-523) compara el motor consigo mismo: detecta
indeterminismo, no un cambio de resultado.
_Corrección (backend):_ carrito mixto con AMBOS tipos fraccionarios cuya suma
cruce el entero (p. ej. 1250n a 1/$1 y 325n a 2/$1 → 19 frente a 18 por grupo), y
un caso de regresión por modo.

---

#### BAJA

**S-15 —** `translateLifecycleError` (`apps/api/src/routes/admin-rules.ts:463-472`)
devuelve el mensaje crudo de PostgreSQL en `details.engine` para los códigos
`55006`, `23514`, `22023` **y `23505`**. Para el trigger de DEC-012 es
deliberado y útil; para una violación de UNIQUE genérica publica el nombre de la
restricción y la tabla a quien tenga `rules.version.*`. _Acotar el paso a los
mensajes del ciclo de vida, o mapear `23505` a un código propio sin texto del motor._

**S-16 —** `changeRequestSchema` (`apps/api/src/routes/admin-rules.ts:444-460`)
publica `requested_by_admin_user_id` y `decided_by_admin_user_id` a cualquiera con
`flag.read` —cinco roles—, mientras `rbac.admin.read` solo la tienen dos. Son
UUID opacos y `requested_by_me` ya cubre la interfaz. _Retirar los ids crudos._

**S-17 —** `packages/sweepstakes/src/amoe/amoe-service.ts:879-888`
(`configOfSubmission`) no envuelve `AmoeConfigError` en
`SweepstakesError("AMOE_CONFIG_INVALID")` como sí hace `readConfig` (:850-877):
aprobar un envío cuya rebanada AMOE esté rota propaga la excepción cruda,
probablemente un 500 en vez de un 409. _Envolverla._

**S-18 —** `no-client-entry-math` ya vigila `base_entries` y `entries_now`
(`apps/web/src/test/no-client-entry-math.test.ts:79-80`) — la petición 7 de la
fase 1 queda cerrada, gracias. Faltan las cifras de `applied_cap` (`.granted`,
`.requested`, `.limit`), que se pintan en `entry-ledger-list.tsx:106-108` y
`admin/amoe-review.tsx:134-136`: un `applied_cap.requested - applied_cap.granted`
pasaría el escáner. _Añadir `"applied_cap"` a `ENTRY_FIELDS`._

**S-19 —** Ningún test fija el literal `2` de `ENTRY_CALCULATION_ENGINE_VERSION`;
`calculation.test.ts:465-469` compara la traza contra la propia constante, que es
tautológico. Un incremento accidental no lo detecta nada. _Afirmar el literal._

**S-20 —** `packages/sweepstakes/src/amoe/amoe-service.ts:1116` escribe
`applied_cap` **solo cuando hubo recorte**; DEC-052 punto 5 lo redacta como
anotación incondicional. Mi e2e y el panel toleran `null`, así que no rompe nada;
conviene confirmar cuál de las dos lecturas es la buena y que el texto y el código
digan lo mismo.

---

#### Cosas que he comprobado y están BIEN

- Autorización de las 21 rutas: capacidad, motivo y step-up correctos ruta por
  ruta; `PATCH /admin/settings/amoe-mode` retirado; `PATCH /admin/feature-flags/:key`
  con capacidad estática y 409 `FLAG_LEGALLY_MATERIAL` derivado de
  `capabilityForFlagUpdate` (`admin-rules.ts:1069-1078`) — sin copia local de la
  lista de flags materiales.
- `assertModeAdmits` (`amoe-service.ts:902-923`) cierra la vía en línea con AMOE
  postal y la transcripción fuera de `MAIL_IN_REVIEW`, y lo comprueba **antes** que
  la ventana y el payload. La modalidad manda desde la versión de reglas y la
  discrepancia con `feature_flag_settings.amoe_mode` falla ruidosamente.
- `assertNotSelfTranscribed` lee la metadata por `Map` (evita `__proto__`) y la
  metadata se preserva con spread en todas las escrituras posteriores: no se puede
  eludir borrándola (solo por S-01).
- Aritmética del tope: una sola implementación compartida entre concesión y
  proyección; `AMOE_ENTRY_CAP_REACHED` con espacio cero **sin** auto-rechazar el
  envío; rescate por idempotencia antes de negarse.
- Validación de entrada en `apps/api`: `imageUrlSchema` (`admin-catalog.ts:166-172`)
  con el mismo criterio que las CHECK `products_image_url_shape` y
  `product_variants_image_url_shape` de `0026` — dos capas, ninguna única.
  Slugs, SKUs, claves de categoría y montos acotados.
- Inmutabilidad de las versiones de reglas: la impone el trigger
  `promotion_rules_versions_enforce_immutability` de `0002`, no un `if`; ACTIVE
  solo admite archivar y el 409 llega traducido.
- `0027` refleja exactamente el catálogo de `packages/security`: paridad en verde
  (`packages/database` 53/53).
- Auditoría de la transcripción: SÍ existe, en el dominio, con **dos** eventos
  (`amoe.submission.created` con el actor correcto y `amoe.submission.transcribed`),
  y sin payload en la metadata.
- `apps/web`: cero aritmética de participaciones, cero `dangerouslySetInnerHTML`,
  el JSON avanzado de reglas se envía como objeto y nunca se interpreta, la
  pantalla de flags se cierra por capacidad (`can(actor, ...)`, nunca por rol) y
  deshabilita aprobar/rechazar para quien solicitó, y el copy nuevo no dice
  "boletos", "tickets", "rifa", "lottery" ni "oportunidades de ganar" en ninguno
  de los dos idiomas.

---

#### Para cuando me paséis los resultados del e2e

`tests/e2e/specs/07-staff-mfa-review.spec.mjs` y `11-mail-in-amoe.spec.mjs`
afirman `expect(item).not.toHaveProperty("participant_email")`. La cola ahora lo
publica enmascarado (S-10), así que esas aserciones **fallarán**. No las he
tocado por vuestra indicación; las ajusto —a "viene enmascarado" o a "no viene",
según lo que se decida en S-10— en la misma pasada en la que levante los `fixme`.

### HO-041 · resolución del Team Lead a la security review (fase 2) — 2026-08-29

Los dos BLOQUEANTES y las cuatro ALTAS se aceptan íntegros y van a backend:
S-01 (el transcriptor sale de `principal.actor`, nunca del cuerpo), S-02 (las
solicitudes de cambio **siempre** nacen `PENDING_APPROVAL`; desarmar el
control dual exige control dual: `flagRequiresDualControl` en
`packages/security`; DEC-055 corregida), S-03 (bloqueo consultivo por
participante dentro de la transacción antes de leer el saldo, en AMOE y en
`award-service`), S-04 (correo de personal → `AMOE_PARTICIPANT_INELIGIBLE_STAFF`),
S-05 (auditoría en crear/editar/documentar/activar versión y en bonus), S-06
(trigger de inmutabilidad en `0028`, que aún no está en ningún entorno).

De los ocho MEDIOS se aplican siete. **Diferido**: la cuota por transcriptor.
Motivo: exige un valor operativo nuevo (cuántas fichas por hora puede teclear
una persona) que hoy no existe en el registro de entorno ni en la
configuración de la promoción, y fijarlo en código sería un número inventado.
Controles vigentes mientras tanto: capacidad `amoe.submission.transcribe` con
MFA, límite de 5 fichas por participante y promoción, huella de duplicados,
sobre marcado, y dos eventos de auditoría por transcripción. Se abre como
punto para la siguiente ronda (`AMOE_TRANSCRIBE_RATE_LIMIT_PER_HOUR` o cuota
en la configuración AMOE; lo decide security con backend).

S-10 (correo enmascarado en la cola) lo ajusta security en el e2e junto con
los tres bloqueos de §13, que se levantan porque las 21 rutas y las pantallas
ya existen.

---

### HO-041 · security fase 3: control dual cerrado y bloqueos del e2e levantados

Status: OPEN (a la espera de la corrida del e2e del Team Lead)

Date: 2026-08-29
From: security-integration
To: backend-sweepstakes, frontend-ux, Team Lead

**1. S-02 cerrado en `packages/security`.** `flags.ts` exporta
`flagRequiresDualControl(key)` (= `legallyMaterial || key ===
"dual_approval_for_sensitive_actions_enabled"`) y `DUAL_CONTROL_FLAG_KEYS`;
`capabilityForFlagUpdate()` deriva de ahí, no de `legallyMaterial`. La regla
queda escrita junto al dato: **desarmar el control dual exige control dual**.
`LEGALLY_MATERIAL_FLAG_KEYS` no cambia — sigue respondiendo a la pregunta legal,
que es de otra persona. Tres pruebas nuevas fijan que las dos listas difieren
exactamente en esa clave y que ninguna clave queda sin camino decidido.

**2. Renombrado de `FLAG_LEGALLY_MATERIAL` a `FLAG_REQUIRES_CHANGE_REQUEST`:
de acuerdo, y buena decisión.** El nombre viejo dejaba de ser cierto en cuanto
una clave no legal pasó por ese camino. Mi gate ya usa el nombre nuevo y añade
`AMOE_PARTICIPANT_INELIGIBLE_STAFF`. **S-09 queda cerrado**: los ocho códigos
están en `ApiErrors`.

**3. Los tres bloqueos del e2e a `false`**, con la evidencia del cierre en el
propio `blockers.mjs`. Verificado en el árbol: las 21 rutas en el manifiesto,
`admin/[locale]/flags/page.tsx`, `admin/[locale]/promotions/[id]/rules/page.tsx`
(y `[versionId]`), el formulario de bonus en la ficha de la promoción y
`components/admin/amoe-transcribe-form.tsx`.

**4. Selectores corregidos contra lo que existe** (no contra lo que yo esperaba):

- el formulario de bonus vive en `/admin/{locale}/promotions/{id}`, no en
  `/rules`, y usa `multiplier_numerator` / `multiplier_denominator`,
  `product_kind_scope`, `duration_preset` (`Select`, no botones) y la casilla
  `confirmed`. La prueba la marca explícitamente en vez de esquivarla: es
  fricción deliberada y merece cubrirse.
- la transcripción usa `field_<clave>` para los siete datos de la ficha, más
  `participant_email`, `envelope_reference` y `cards_in_envelope`; y la prueba
  comprueba además que la pantalla **avisa** de la separación de funciones antes
  de teclear nada, en vez de dejar que se descubra con un 409.
- `preferred_locale` es obligatorio en el cuerpo y no lo enviaba en ninguna de
  las diez llamadas: corregido. Habría sido diez 422 en la primera corrida.

**5. Dos aserciones mías que afirmaban campos que el contrato no declara**, y
que he retirado en vez de pedir que se implementen:

- `cart/entry-quote` no publica `product_kind` por línea. La afirmación que
  discrimina es el total del carrito mixto (45): con una sola tasa saldría 35 o
  70, ningún otro reparto da 45. Si algún día queréis la procedencia visible en
  la cotización, es una petición aparte y pequeña.
- `GET /admin/amoe-submissions` no filtra por `status` (`reviewQuerySchema` solo
  acepta `promotion_id`); la prueba busca por identificador.

**6. S-10 ajustado.** `07-staff-mfa-review` y `11-mail-in-amoe` ya no exigen que
el correo esté ausente: exigen que llegue **enmascarado** y nunca completo. La
diferencia es la que importa — enmascarado permite distinguir dos fichas del
mismo sobre; completo permitiría exportar una lista de correos desde una pantalla
de revisión. Si backend acaba retirándolo, la aserción se relaja en una línea.

**7. Prueba nueva para S-04**: transcribir una ficha con el correo de una cuenta
de personal → 409 `AMOE_PARTICIPANT_INELIGIBLE_STAFF`, y un segundo intento
falla igual (no queda un perfil a medias del intento anterior).

**Estado real:** `tests/security` **507/507 en verde** (ya no queda ningún gate
rojo); `tests/e2e` con `lint` y `syntax-check` en verde, 18 módulos. **No he
ejecutado el e2e**, como pediste.

**`fixme` que quedan en `tests/e2e`**, todos anteriores a esta ronda y ninguno de
§13: `01-security-headers` y `04-cart-checkout` (`CART_PAGE_SHAPE_MISMATCH`,
`WEB_EMITS_NO_SECURITY_HEADERS`, ya resueltos, constantes en `false` conservadas
como historial), `03-participant-auth`
(`NO_PARTICIPANT_REGISTRATION_ENDPOINT`, el único **activo**: sigue sin existir
`POST /auth/register`), `06-amoe`, `07-staff-mfa-review` y `08-adjustment`
(constantes en `false`). Los de §13 de `09`, `10` y `11` apuntan ya a constantes
en `false`, así que esas pruebas corren.

### HO-041 · respuesta de backend a la security review

Status: RESUELTO — los dos bloqueantes y las cuatro altas; medias todas salvo
S-13 (diferida por el Team Lead) y las dos de `apps/web`, que no son mías.

Date: 2026-08-29
From: backend-sweepstakes
To: security-integration, frontend-ux, Team Lead

Hallazgo por hallazgo. Las decisiones del Team Lead se aplican tal cual; donde
me he desviado, lo digo.

**S-01 BLOQUEANTE — RESUELTO.** `transcribedByAdminUserId` desaparece de
`AmoeTranscribeInput`: `submitOnBehalf` lo deriva de `principal.actor` y exige
`type === "ADMIN"` (`CAPABILITY_REQUIRED` con `reason: "admin_actor_required"`
si no). El tipo ya no puede expresar la firma ajena, así que la ruta HTTP dejó
de pasarlo. Dos tests: un cuerpo hostil con el id de otro administrador acaba
con `metadata.transcribed_by_admin_user_id` = el del principal y **sigue sin
poder aprobar**; y un principal `SYSTEM` con la capacidad pegada no transcribe.

**S-02 BLOQUEANTE — RESUELTO, opción (a) + (b) juntas.**
`POST /admin/settings/change-requests` nace **siempre** `PENDING_APPROVAL`: el
flag ya no se consulta ahí. Y `dual_approval_for_sensitive_actions_enabled` pasa
a exigir la cola —desarmar el control dual cuesta control dual—, con lo que el
eslabón débil de la cadena queda cerrado.

Mientras `packages/security` no exporte `flagRequiresDualControl(key)`, hay en
`admin-rules.ts` un helper local de **dos líneas** que compone
`capabilityForFlagUpdate(key) !== "flag.update"` con esa única clave, marcado
como temporal y con el nombre exacto que vais a exportar. En cuanto lo
publiquéis, se sustituye por la llamada y la clave desaparece de `apps/api`.

**Renombré el código: `FLAG_LEGALLY_MATERIAL` → `FLAG_REQUIRES_CHANGE_REQUEST`.**
El nombre viejo pasó a ser falso en cuanto el 409 empezó a saltar también para
un flag que **no** es legalmente material; el nuevo describe la consecuencia,
que es lo que el frontend traduce. **Necesito que actualicéis
`SECTION_13_ERROR_CODES` en `tests/security/src/permissions/section-13-routes.test.ts`**:
hoy espera el nombre viejo y esa prueba se pondrá roja. §13.9, §13.11 y §13.12
ya lo reflejan.

**S-03 ALTA — RESUELTO.** El puerto del ledger gana
`lockParticipant(promotionId, participantId)`. En Drizzle es
`pg_advisory_xact_lock(hashtext(namespace), hashtext(promotion:participant))` —el
par con espacio de nombres, que es la técnica única del proyecto, no la forma de
un argumento— y **falla ruidosamente fuera de transacción**, porque un cerrojo
`xact` sin transacción se suelta en el acto y no serializa nada. En memoria es
no-op, pero **registra el orden**.

Se toma antes de leer el saldo en las dos vías, y en `award-service.ts` la
lectura se movió **dentro** de la unidad de trabajo (el resto del pipeline se
extrajo a `performAwardLocked`, cuyo nombre dice cuál es la precondición). Dos
tests de dominio afirman lo único que un doble de un solo hilo puede demostrar:
que el cerrojo se pide **antes** de la primera lectura, en AMOE y en compra. En
integración no hay test de dos transacciones reales: los 157 que hay corren en
serie y montar un segundo pool para esto era más riesgo que valor. Si lo queréis,
es vuestro terreno.

**S-04 ALTA — RESUELTO.** `findOrCreateParticipantByEmail` consulta
`admin_users` por `identity_id` antes de crear el perfil y lanza
`StaffIdentityNotEligibleError` → **409 `AMOE_PARTICIPANT_INELIGIBLE_STAFF`**.
Rechazo y no envío marcado: el expediente no debería llegar a existir, y marcarlo
dejaría la fila creada y el trabajo de deshacerla para después. La respuesta **no
devuelve el correo**: quien transcribe lo acaba de teclear.

**S-05 ALTA — RESUELTO.** `rules.version.created`, `rules.version.updated`,
`rules.version.document_upserted`, `rules.version.activated` (ya estaba) y
`bonus.period.created` (renombrado desde `rules.version.bonus_period_added`).
El `before`/`after` es **mínimo a propósito**: ids, versión, claves del `config`
ordenadas, `unresolved_required_keys` y, en el documento, locale, título y
longitud del cuerpo. El texto legal y el `config` entero **no** entran en la
metadata porque acabarían en el preimage de la hash chain de cada evento; el
contenido vive en la propia versión, que es inmutable en cuanto se activa.

**S-06 ALTA — RESUELTO.** `0028` gana
`lsw_setting_change_requests_enforce_immutability`: una fila decidida no se
actualiza jamás, las únicas transiciones son `PENDING_APPROVAL → APPLIED |
REJECTED`, y decidir **no reescribe lo que se pidió** (valor, motivo, solicitante
ni instante). Cabecera corregida: decía que el CHECK lo impedía y no era verdad.
Seis tests de integración, **verdes contra vuestro PostgreSQL**.

**S-07 MEDIA — RESUELTO.** `assertNotSelfTranscribed` también en `reject`.

**S-08 MEDIA — RESUELTO.** `submit` devuelve un desenlace nuevo,
`CAP_REACHED_PENDING_REVIEW`, en vez de relanzar: la ficha queda registrada y en
la cola con su evento, y la API sigue respondiendo 409 `AMOE_ENTRY_CAP_REACHED`.
Test con `requires_review: false` y tope agotado que comprueba las tres cosas —
envío persistido, evento emitido, cero filas de ledger—.

**S-09 MEDIA — RESUELTO.** Los cuatro códigos, más `SETTING_CHANGE_NOT_PENDING` y
`AMOE_PARTICIPANT_INELIGIBLE_STAFF`, son fábricas en `http/errors.ts`. En
`admin-rules.ts` solo quedan dos `new ApiError` sueltos, y los dos son códigos
**preexistentes** compartidos con otras rutas (`LIFECYCLE_REFUSED`,
`AMOE_CONFIG_INVALID`); no los toqué para no ampliar el diff.

**S-10 MEDIA — RESUELTO (backend).** `participant_email` exige
`pii.view.masked` **además** de `amoe.review.read`, comprobado sobre el principal
ya resuelto —la ruta no puede declararlo o quien no la tuviera no vería la cola—;
sin capacidad, el perfil ni se lee. `transcribed_by_admin_user_id` **retirado**
de la proyección y del esquema: `transcribed_by_me` ya resuelve lo que la
interfaz necesita. Dos tests. La mitad de `apps/web` es de `frontend`.

**S-11 MEDIA — NO ES MÍO.** Los dos sinks están en `apps/web`
(`order-line-list.tsx`, `promotion-hero.tsx`) y no edito ese paquete. El
validador de la API (`imageUrlSchema`) y las dos CHECK de `0026` siguen donde
estaban: lo que falta es aplicar `safeImageUrl` en esos dos puntos, y es de
`frontend`.

**S-12 MEDIA — RESUELTO.** El payload se proyecta a `identity_requirements`
antes de persistirse, y **la huella se calcula sobre el payload ya proyectado**:
así dos envíos que solo difieran en campos que el sistema no pide siguen siendo
el mismo envío. Test con un `numero_tarjeta` que no sobrevive.

**S-13 MEDIA — DIFERIDA** por el Team Lead.

**S-14 MEDIA — RESUELTO.** El caso que discrimina es 12,50 a 1/$1 + 3,25 a 2/$1:
suma exacta 19, y por grupo daría 18 con FLOOR y 20 con CEIL —los dos sentidos,
para que no pase por casualidad—. Y hay **un caso de regresión por cada uno de
los cuatro modos anteriores**, con carrito mixto, y otro por modo con un periodo
`product_kind_scope: null`, que es la única forma que puede tener una
configuración migrada desde la versión 1. Añadí también S-19 (una línea: el
literal `2`), que estaba en BAJA y costaba lo mismo escribirlo que no.

**S-17 BAJA — RESUELTO de paso.** `configOfSubmission` envuelve `AmoeConfigError`
en `AMOE_CONFIG_INVALID`: era un 500 por una configuración rota, y arreglarlo
era una línea.

**S-15, S-16, S-18, S-20 — NO HECHAS.** No estaban en el encargo y prefiero no
ampliar el diff en una ronda con dos bloqueantes. S-18 (`applied_cap` en
`ENTRY_FIELDS` del escáner) es de `frontend`; S-20 —si `applied_cap` debe
anotarse siempre o solo cuando hay recorte— es una lectura de DEC-052 punto 5 y
la decide el Team Lead: hoy se anota **solo cuando hubo recorte**, y el motivo
está escrito en el código (presente siempre sería ruido en el 99% de las filas).

**Verificación.** `packages/sweepstakes` 385, `packages/database` 53 unitarios +
**157 de integración contra vuestro PostgreSQL 16 de 127.0.0.1:5433** (no lo he
parado), `packages/commerce` 109, `apps/api` 264. Lint y typecheck en verde en
los cuatro. `openapi/` regenerado.

**Un aviso sobre `0028`.** La primera escritura del trigger salió con el
delimitador `$$` colapsado a `$` —`String.replace` interpreta `$$` como escape— y
la migración no aplicaba. Está corregido y **verificado aplicando en frío**;
lo digo porque si alguien tenía una copia intermedia del fichero, no servía.

### HO-041 · security, ronda de cierre e2e

Status: HECHO (a la espera de la siguiente corrida del Team Lead)

Date: 2026-08-30
From: security-integration
To: backend-sweepstakes, frontend-ux, Team Lead

De los cinco fallos de la corrida real, **los dos que eran del escenario y no
del producto quedan corregidos**. Los otros tres los arreglan backend
(`bonus-periods` → 403) y frontend (`/admin/es/amoe`), y sus pruebas no se
tocan: ya afirman el comportamiento correcto.

**1. `06-amoe`, «la version en ingles trae su propio texto, no el castellano».**
El fallo era mio y era del dato, no de la pagina. Las `instructions` de los dos
idiomas empezaban con el **mismo** aviso de relleno (`E2E FIXTURE - PROVISIONAL,
SIN VALOR LEGAL…`), asi que `slice(0, 40)` daba el mismo prefijo para los dos:
el parrafo ingles satisfacia la busqueda del castellano y `toHaveCount(0)`
fallaba. Con la pagina bien.

- `tests/e2e/seed/seed-e2e.mjs`: nace `fillerFor(tag)`, que devuelve el mismo
  `FILLER` con el idioma **delante** (`E2E FIXTURE (EN) - …` / `E2E FIXTURE (ES)
  - …`). Sale de `FILLER`por`replace`, no de un segundo literal, para que el
aviso de «sin valor legal» siga teniendo una sola fuente. Solo lo usan las
`instructions`: las claves legales de la version de reglas siguen con el
`FILLER` de siempre, porque ahi no hay dos idiomas que distinguir.
- `tests/e2e/specs/06-amoe.spec.mjs`: ademas de la correccion, la prueba **se
  defiende del escenario**. Antes de las dos aserciones de pagina comprueba
  `expect(config.instructions["en-US"]).not.toContain(esProbe)`. Sin eso, un
  futuro texto con prefijo compartido no rompe la prueba: **la vacia**, que es
  peor. Ahora ese fallo se lee como lo que es y no se disfraza de fallo del
  producto.
- `tests/e2e/README.md`: una nota de tres lineas explicando por que el relleno
  de los textos bilingues va etiquetado.

Comprobado que ninguna otra asercion del repositorio depende del prefijo
compartido: los unicos dos consumidores de `instructions` son las lineas 166 y
185-202 de `06-amoe`, y el literal solo aparece en el `seed` y en el README.

**2. `11-mail-in-amoe`, los dos envios APROBADOS que «no estaban».** Correcto:
la cola sin parametros es la cola de **trabajo**. Las dos lecturas pasan a
`?promotion_id=…&status=APPROVED` (lineas 457 y 553), cada una con un
`toBeDefined()` propio y mensaje, para que un fallo diga si el envio no aparece
o si aparece sin las cifras. Retirado el comentario que documentaba que
`reviewQuerySchema` solo aceptaba `promotion_id`.

Y **la garantia util se afirma aparte**: tras la aprobacion con recorte, una
tercera lectura **sin parametro** comprueba que el envio ya **no** esta entre
los pendientes. Sin ella, «aparece filtrando por APPROVED» seria compatible con
un envio que sigue tambien en la lista de trabajo, y quien revisa volveria a
decidir sobre algo ya decidido.

Las otras cuatro lecturas de la cola se quedan **sin** `status` a proposito, y
las cuatro son correctas: `11:122` (recien transcrito, `PENDING_REVIEW`),
`11:513` (la proyeccion se lee **antes** de aprobar), `11:705` (tras el 409 por
tope el envio **sigue** pendiente, que es justo lo que afirma) y las de
`07-staff-mfa-review:133` y `08-adjustment:54`, que solo miran la forma.

**Dependencia que dejo dicha, backend:** esas tres pruebas fijan ahora las dos
mitades del contrato que estais anadiendo — que `status=APPROVED` devuelve los
decididos **y** que la ausencia de `status` significa `PENDING_REVIEW`. Si el
valor por defecto acabara siendo «todos», la tercera lectura se pondria roja, y
tendria razon: una cola de revision que devuelve lo ya decidido no es una cola.

**Verificacion.** `tests/e2e`: `lint` **sin errores** (los 4 warnings son los de
siempre, ninguno en lo tocado) y `typecheck` (syntax-check) **verde, 18
modulos**. Comprobado aparte que los dos prefijos de 40 caracteres resultantes
difieren y que ninguno contiene al otro. **No he ejecutado el e2e**, como se
pidio, ni he tocado `tests/security` (no hacia falta), ni nada fuera de
`tests/e2e/**`. Sin `git add`/`commit`/`push`.

**Un detalle de Playwright que conviene saber**, porque afecta a la prueba
bilingue: el motor de texto salta `SCRIPT`, `NOSCRIPT`, `STYLE` y todo lo que
cuelga de `<head>` (`shouldSkipForTextMatching`). Es decir, el payload RSC que
Next.js incrusta en `<script>` —que si lleva los dos idiomas— **no** puede
hacer fallar el `toHaveCount(0)`. La asercion mide la pagina, no el transporte.

---

### HO-041 · backend, ronda de cierre e2e

Status: DONE

Date: 2026-08-30
From: backend-sweepstakes
To: Team Lead, security-integration, frontend-ux

Tres correcciones salidas de la corrida e2e real. Solo eso: no he tocado nada
fuera de `apps/api/**`, `packages/database/**` y `packages/sweepstakes/**`, y no
he hecho `git add`/`commit`/`push`.

---

#### 1. `?status=` en la cola AMOE

`GET /api/v1/admin/amoe-submissions` acepta `status` opcional, enum cerrado
`PENDING_REVIEW | SUBMITTED | APPROVED | REJECTED | CANCELLED`, por defecto
`PENDING_REVIEW`. **Sin el parametro la respuesta no cambia**, que era la
condicion: sigue siendo la cola de trabajo.

- `packages/sweepstakes/src/amoe/submission.ts`: el puerto declara
  `listByStatus(promotionId, status)` **junto a** `listPendingReview`, cuya
  firma no se toca. Son dos preguntas distintas y por eso son dos consultas:
  `listPendingReview` responde "que espera decision" -y por eso el adaptador de
  PostgreSQL devuelve `SUBMITTED` y `PENDING_REVIEW` juntos- y `listByStatus`
  responde "que envios estan en ESTE estado", exacto. Implementado tambien en
  `InMemoryAmoeSubmissionRepository`.
- `packages/database/src/repositories/amoe-repository.ts`: el adaptador Drizzle.
- `packages/sweepstakes/src/amoe/amoe-service.ts`: `reviewQueue` acepta un tercer
  parametro opcional `status`. La capacidad `amoe.review.read` se comprueba
  ANTES de mirarlo: un parametro de consulta no puede ser la diferencia entre
  pedir permiso y no pedirlo.
- `apps/api/src/routes/amoe.ts`: `adminReviewQuerySchema` extiende el de la ruta
  del participante en vez de modificarlo, para que `GET /account/amoe-submissions`
  no herede un filtro que no usa.

Efecto: `granted_entries` y `applied_cap` -que la ruta ya publicaba para los
envios `APPROVED`- dejan de ser inalcanzables. Antes, aprobar sacaba el envio de
la unica lectura administrativa que existia, y con el se iba la unica
explicacion de por que la concesion fue menor que la anunciada.

Documentado en `docs/API_CONTRACT.md` §11.3 (bloque nuevo, con la semantica de
cada valor y por que `PENDING_REVIEW` y `SUBMITTED` se solapan a proposito) y
§13.12 nota **18**.

**Pruebas.** `apps/api/test/amoe-adjustments.test.ts`: transcribir -> aprobar
con OTRO administrador -> la cola sin parametro **no** lo trae -> con
`?status=APPROVED` lo trae con `granted_entries: 2` (no 5: el tope recorto) y
`applied_cap { PER_PARTICIPANT, 10, 5, 2 }`. Mas un caso de `status` fuera del
enum -> 422. En el dominio, `packages/sweepstakes/test/amoe.test.ts` anade dos:
el aprobado sale de la cola de trabajo y vuelve por su estado, y el filtro exige
la misma capacidad.

**Lo que este cambio NO arregla, y es de `frontend`:** el 422 que rompia
`/admin/[locale]/amoe` no lo causaba `status` -Zod descarta lo desconocido sin
error- sino que el panel llamaba SIN `promotion_id`, que es obligatorio.
`frontend2` ya lo habia detectado y lo esta corrigiendo; se lo he confirmado por
mensaje, junto con que `promotion_id` sigue siendo obligatorio y que el esquema
no es estricto.

---

#### 2. Sin motivo, 403 del autorizador y no 422 del esquema

`reasonBodySchema` de `apps/api/src/routes/admin-rules.ts` declaraba
`reason_code` obligatorio, y Fastify valida el cuerpo ANTES del `preHandler`:
una peticion sin motivo moria con 422 `VALIDATION_FAILED` y **nunca llegaba al
control**. Un fallo de autorizacion se presentaba como un cuerpo mal formado.

Ahora el esquema lo declara **opcional** y quien lo exige es `authorize()`, que
lee `requiresReason` del catalogo de `@lsw/security` (HO-034.1). Afecta a las
cinco rutas pedidas -`rules-versions/:id/activate`, `bonus-periods`,
`settings/change-requests` crear/aprobar/rechazar- **y ademas a
`PATCH /admin/feature-flags/:key`**, que comparte el mismo esquema y cuya
capacidad `flag.update` tambien declara `requiresReason`.

**La forma sigue validandose**: un `reason_code` presente con otra ortografia es
422, porque lo que abre la puerta tiene que ser exactamente lo que se persiste
en `audit_events.reason_code`.

Los handlers leen el motivo con un ayudante `requireReasonCode()` que responde
403 si faltara, colocado **antes** de cualquier efecto -no se clona ni se activa
una version de reglas para despues negar la peticion-. Es cinturon: el tirante
es la puerta, y no deberia dispararse nunca. Existe para que el tipo no se
contente con un `?? ""` que escribiria una fila de auditoria con el motivo
vacio.

Documentado en §13.12 nota **19**. Prueba por ruta en
`apps/api/test/admin-rules.test.ts` (`describe("el motivo ausente es 403, no
422")`): las seis rutas y un caso de forma invalida que sigue siendo 422. La
prueba antigua que fijaba el 422 se sustituye, porque afirmaba justo lo
corregido.

**Excepcion que dejo señalada y NO he tocado**, por estar fuera de §13:
`POST /admin/promotions/:id/activate` y `/close` (§12, `admin-catalog.ts`)
siguen declarando `reason_code` obligatorio en el esquema, asi que ahi una
peticion sin motivo todavia responde 422. Es el mismo caso latente. Lo aplico en
cuanto el Team Lead lo confirme; son cuatro lineas y una prueba.

---

#### 3. El ayudante duplicado

`admin-rules.ts` definia su propio `flagRequiresDualControl` con la clave
`dual_approval_for_sensitive_actions_enabled` escrita a mano, con un comentario
que decia que era temporal hasta que `@lsw/security` lo exportara. Ya lo
exporta: se borra la copia local y se importa el del catalogo. Dos listas para
una sola pregunta divergen en cuanto alguien anada un flag a una y no a la otra,
y la que se queda corta es siempre la copia. `capabilityForFlagUpdate` deja de
importarse aqui porque solo lo usaba esa copia.

---

#### Verificacion

- `pnpm --filter ./apps/api lint` -> **0 errores** (41 warnings, los de siempre,
  ninguno en lo tocado).
- `pnpm --filter ./apps/api typecheck` -> **verde**.
- `pnpm --filter ./apps/api test` -> **272/272**, 15 ficheros.
- `pnpm --filter ./packages/sweepstakes test` -> **387/387**; `lint` 0 errores.
- `pnpm --filter ./packages/database test` (unit) -> **53/53**; `typecheck`
  verde; `lint` 0 errores.
- `pnpm --filter @lsw/tests-security test` -> **507/507** (no he tocado nada de
  `tests/security`; lo corri para comprobar que no rompia nada suyo).
- `pnpm --filter ./apps/api contract:emit` -> 100 rutas escritas. Comprobado en
  el JSON: el parametro `status` sale `required: false` con `default`
  `PENDING_REVIEW`, y `reason_code` ya no aparece en el `required` de ninguna de
  las seis rutas. `contract:check` falla por el diff sin commitear de toda la
  ronda, como estaba previsto.
- **No** he ejecutado el e2e ni tocado `tests/e2e/**`. Las tres pruebas que
  `security` dejo fijadas en `11-mail-in-amoe` y la de `10-bonus-period`
  ("sin motivo... el rechazo es 403 y no 422") describen exactamente el
  comportamiento implementado.

---

### HO-041 · frontend, ronda de cierre e2e

Status: DONE (sin commitear, como el resto de la ronda)

Date: 2026-08-30
From: frontend-ux
To: Team Lead, security-integration, backend-sweepstakes

Cuatro correcciones salidas de la corrida e2e real y de la security review
(fase 2). Nada más: no he tocado ni `apps/api`, ni `tests/e2e`, ni ningún
documento legal.

---

#### 1. S-11 — los dos sumideros de imagen que no filtraban

`lib/media-url.ts` era correcto y estaba aplicado en `product-card`,
`add-to-cart-form` y la galería de la ficha; **faltaba en los dos sitios que
señalaba la revisión**, y ese es exactamente el fallo que un test del validador
no puede ver, porque el validador nunca fue el problema.

- `src/components/order-line-list.tsx` — `line.image_url` pasa ahora por
  `safeImageUrl`, y la condición de pintar la miniatura cuelga del valor
  filtrado. Ojo al matiz que lo hace más grave de lo que parece: la URL de una
  línea de pedido está **congelada** en el histórico, así que sobrevive a
  cualquier corrección posterior del catálogo.
- `src/components/promotion-hero.tsx` — `media.hero_url` idem. Filtrada, la URL
  vale `null` y el hero cae en la **marca de agua**, que es la rama que ya
  existía para una promoción sin fotografía: una URL que no se puede pintar deja
  el estado sin imagen, no un hueco roto.
- `src/mocks/fixtures/prize-photo.ts` — nuevo `GMC_PRIZE_HERO_FALLBACK`
  (`/prizes/gmc-2025-hero.jpg`), y `src/mocks/fixtures/promotions.ts` lo usa como
  último respaldo de `hero_url` en vez de la ilustración `data:` de `media.ts`.
  No es tautológico con el primer candidato de `GMC_PRIZE_HERO_CANDIDATES`
  aunque el nombre coincida: `resolvePrizePhoto` comprueba el disco contra
  `process.cwd()`, y hay empaquetados donde el fichero **se sirve** en esa ruta
  aunque desde ese directorio no se vea.
- `src/mocks/fixtures/media.ts` — `prizeTruckWideImage` deja de ser el respaldo
  del hero y queda anotado como tal. No se borra: es el `data:` URI **real** con
  el que el test nuevo comprueba que el sumidero lo descarta; un literal
  inventado probaría el validador, no el sumidero.

**Test nuevo:** `src/test/image-sinks.test.tsx` (10 casos). Renderiza los dos
componentes con `http:`, `javascript:`, un `data:` real y `//evil` y comprueba
que la URL no acaba en ningún `src` **ni en crudo ni percent-codificada** (los
dos sumideros escriben distinto: uno usa `<img>` y el otro `next/image`). Cada
bloque trae su mitad positiva —una ruta del propio sitio SÍ se pinta—, sin la
cual un componente que dejara de pintar cualquier imagen pasaría todos los casos
hostiles.

**Consecuencia conocida, no regresión:** la mercancía de desarrollo
(`teeImage`, `capImage`, …) sigue siendo `data:` y por tanto sigue sin pintarse
en la tienda —ya era así desde que `product-card` filtraba— y ahora tampoco en
las líneas de pedido. Es coherente y afecta solo a los fixtures; el día que
alguna superficie pinte `square_url` habrá que darle el mismo trato que al hero.

---

#### 2. El 422 de `/admin/[locale]/amoe` — causa raíz confirmada

**La petición inválida era `GET /api/v1/admin/amoe-submissions?status=PENDING_REVIEW`,
sin `promotion_id`.**

`reviewQuerySchema` era `z.object({ promotion_id: z.uuid() })`: el campo es
**obligatorio** y la pantalla no lo mandaba nunca. `status` no tenía nada que
ver —Zod descarta lo desconocido en un `z.object` no estricto, así que sobraba
en silencio—; el 422 `VALIDATION_FAILED` lo producía la **ausencia** del
identificador. Backend lo confirma en su respuesta de esta misma ronda.

Y el daño real no era la lista: `!result.ok` pintaba `AdminSectionError` en el
sitio de **toda** la pantalla, así que el formulario «Transcribir ficha postal»
—que no depende de la cola sino de `GET /promotions/{slug}/amoe-config`— no
llegaba a existir. Con la cola caída, la única vía gratuita operable de la
promoción se apagaba.

Cambios en `src/app/admin/[locale]/amoe/page.tsx`:

- la promoción activa se lee **una vez** y sirve a las dos mitades: de ella sale
  el `promotion_id` de la cola y el `slug` de la configuración. Antes solo la
  leía `loadTranscriptionContext`, y esa es literalmente la razón de que la cola
  se quedara sin identificador;
- la cola y la configuración se piden **en paralelo** (`Promise.all`) una vez
  resuelta la promoción;
- el fallo de la cola —o el de la lectura de la promoción de la que depende— se
  pinta **dentro de la sección de la lista**, con encabezado `h3`. El formulario
  de transcripción, el aviso de solo-lectura y el panel de decisión siguen en
  pie;
- un fallo de `/promotions/active` **se propaga como fallo** y ya no se disfraza
  de «no hay promoción abierta», que son dos cosas distintas;
- sin promoción abierta no se pide la cola en absoluto (no hay `promotion_id`
  que mandar) y se dice como estado deliberado: entre promociones es lo normal.

`src/lib/api/resources.ts`: `fetchAdminAmoeSubmissions` exige `promotion_id` en
la **firma** y tipa `status` con el enum del contrato. La misma omisión deja de
compilar en vez de llegar al navegador.

**Tests nuevos** en `src/test/admin-reads.test.ts` (3): capturan la URL con MSW
y comprueban que sale `promotion_id`, que `status` viaja como enum en mayúsculas
—el texto traducido no puede acabar en la URL— y que sin `status` el cliente no
inventa uno.

---

#### 3. Filtro por estado (punto 4 del encargo)

Con `?status=` y su valor por defecto, los envíos ya decididos solo son
alcanzables pidiéndolos. La pantalla gana una navegación de filtro —enlaces, no
formulario: son navegaciones, funcionan sin JavaScript y el botón de atrás hace
lo que se espera— construida sobre `AMOE_SUBMISSION_STATUSES`, con el texto del
mismo `amoeStatusLabeller` que usa la insignia de cada fila (DEC-022). El estado
vigente se marca con `aria-current`. El filtro viaja con el cursor
(`AdminPager extraQuery`) y con los enlaces de decisión, porque el panel busca
el envío **dentro** de la página cargada.

Copy nuevo en los dos idiomas bajo `admin.amoeReview`: `queueHeading`,
`filterLabel`, `emptyFilteredTitle`/`emptyFilteredBody` (el vacío de un filtro
no dice lo mismo que el de la cola: «no hay nada esperando revisión» delante de
un filtro de aprobados sería falso) y `noPromotionTitle`/`noPromotionBody`.

Anotado en el código lo que backend confirma: `PENDING_REVIEW` **no es un filtro
exacto** —devuelve `SUBMITTED` + `PENDING_REVIEW`, la cola de trabajo— y los
demás valores sí lo son. Las dos primeras pestañas se solapan a propósito.

---

#### 4. Colisión de rótulo en la navegación del panel

`admin.nav.adjustments` y `admin.nav.flags` decían las dos **«Ajustes»** en
español, llevando a dos pantallas que no se parecen: una mueve participaciones
del ledger de una persona y la otra cambia el comportamiento de la plataforma.
En inglés el par era «Adjustments» / «Settings» y no chocaba, que es por lo que
el fallo no se veía leyendo el diccionario en un solo idioma.

- `admin.nav.flags`: es → **«Interruptores»**, en → **«Feature flags»**.
- `admin.flags.title`: es → «Interruptores de la plataforma», en → «Platform
  feature flags». El cuerpo de esa pantalla acompaña.
- Anotado el porqué en `src/lib/admin/navigation.ts` y en el docblock de
  `src/app/admin/[locale]/flags/page.tsx`.

**Test nuevo** en `src/test/admin-access.test.ts`: ningún par de entradas de
`ADMIN_NAV` comparte rótulo, **en los dos idiomas**. Se comprueban los dos
porque la colisión puede existir en uno y no en el otro, y basta con que exista
en uno para que ese menú sea ambiguo.

---

#### Archivos tocados

```text
apps/web/messages/en-US.json
apps/web/messages/es-US.json
apps/web/src/app/admin/[locale]/amoe/page.tsx
apps/web/src/app/admin/[locale]/flags/page.tsx
apps/web/src/components/order-line-list.tsx
apps/web/src/components/promotion-hero.tsx
apps/web/src/lib/admin/navigation.ts
apps/web/src/lib/api/resources.ts
apps/web/src/mocks/fixtures/media.ts
apps/web/src/mocks/fixtures/prize-photo.ts
apps/web/src/mocks/fixtures/promotions.ts
apps/web/src/test/admin-access.test.ts
apps/web/src/test/admin-reads.test.ts
apps/web/src/test/image-sinks.test.tsx   (nuevo)
```

Todo dentro de `apps/web/**`. Ningún archivo fuera del ownership de `frontend`.

#### Verificación

- `pnpm --filter ./apps/web lint` -> **0 errores, 0 warnings**.
- `pnpm --filter ./apps/web typecheck` -> **verde**.
- `pnpm --filter ./apps/web test` -> **598/598**, 37 ficheros (eran 593 antes de
  esta ronda: +10 de `image-sinks`, +3 de la petición de la cola, +2 de rótulos
  del menú, y `admin-reads` pasa de 10 a 13).
- `prettier --check` limpio sobre los catorce ficheros de arriba.
- **No** he ejecutado el e2e ni tocado `tests/e2e/**`.

#### Limitación conocida

Mientras el cambio de backend no esté desplegado, la pestaña seleccionada **no
filtra**: la API descarta el `status` desconocido en silencio y devuelve la cola
entera. No rompe nada y se corrige solo en cuanto aterrice; lo digo para que
nadie lo lea como un fallo del panel. Con el spec ya regenerado
(`openapi.json` publica `status` con su enum y su `default`) esto está resuelto
en el árbol.

---

### HO-041 · backend, adenda al bloque «ronda de cierre e2e»

Status: DONE — Date: 2026-08-30 — From: backend-sweepstakes — To: Team Lead,
security-integration, frontend-ux

La excepcion que dejaba señalada arriba queda cerrada en la misma ronda.
`POST /admin/promotions/:id/activate` y `/close` (`admin-catalog.ts`) siguen la
misma regla: `reason_code` **opcional** en el esquema -con la forma validada si
viene-, exigencia en el autorizador, **403** sin motivo y **422** con motivo mal
formado. No queda ninguna ruta con motivo en el cuerpo que conteste 422 cuando
lo que falta es el motivo.

El ayudante `requireReasonCode()` **no se duplica**: se movio a
`apps/api/src/http/authorization-inputs.ts`, que ya era el modulo dueño del
concepto -alli vive `presentedReasonCode()` y el patron `REASON_CODE`- y ahora
lo importan `admin-catalog.ts` y `admin-rules.ts`. Habria sido incoherente
borrar un ayudante duplicado en el punto 3 y crear otro dos ficheros mas alla.

Se llama **antes** de `setPromotionStatus`, y la prueba lo afirma: una negativa
por falta de motivo no puede dejar detras una promocion activada ni cerrada.

**Pruebas** (`apps/api/test/admin-catalog.test.ts`): activar sin motivo -> 403 y
el repositorio no se toca; cerrar sin motivo -> 403 y el repositorio no se toca;
cerrar con motivo mal formado -> 422; cerrar con motivo valido -> 200. La de
activar con motivo mal formado -> 422 ya existia. `close` no tenia bloque propio
de pruebas y ahora lo tiene.

**Contrato**: §12 gana una tabla de dos filas -403 del autorizador, 422 del
esquema- que ademas **corrige** lo que decia antes ("sin motivo, o con uno mal
formado, 403"), que era falso en las dos mitades. §13.12 nota 19 actualizada:
ya no hay excepcion pendiente.

**Verificacion**: `lint` **0 errores** (41 warnings de siempre), `typecheck`
verde, `test` **276/276** (15 ficheros), `contract:emit` 100 rutas. Comprobado
en el JSON: los cuerpos de `activate` y `close` ya no llevan `required`, y
`reason_code` conserva su `pattern`.
