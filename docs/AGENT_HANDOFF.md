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

Status: OPEN

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

Status: OPEN

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

## HO-003

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

Status: OPEN

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
