# TASK_OWNERSHIP.md

Propiedad de archivos y responsabilidades en Lone Star Winners.

> **Esta estructura es preliminar.** Las rutas anticipan un monorepo, pero el
> stack y la disposición del repositorio **no están decididos** (ver
> `CLAUDE.md` seccion 7 y `docs/ARCHITECTURE.md` seccion 5). Cuando el stack
> definitivo se elija, este documento **se ajusta** mediante una entrada en
> `docs/DECISIONS.md`, conservando el mismo reparto de dominios.

---

## Regla de oro

**Un archivo, un propietario.**

Antes de modificar cualquier archivo, un agente comprueba aquí si le
pertenece. Si no le pertenece, **no lo edita**: abre un handoff en
`docs/AGENT_HANDOFF.md`.

Dos agentes **no** editan el mismo archivo simultáneamente.

---

## FRONTEND AGENT

Agente: `frontend-ux` - Teammate: `frontend`

Propietario de:

```text
apps/web/**
packages/ui/**
packages/design-system/**
```

Responsabilidades:

- frontend;
- UX/UI;
- responsive;
- i18n presentation;
- storefront;
- portal del participante;
- presentation layer del admin.

---

## BACKEND AGENT

Agente: `backend-sweepstakes` - Teammate: `backend`

Propietario de:

```text
apps/api/**
packages/database/**
packages/sweepstakes/**
packages/commerce/**
```

Responsabilidades:

- database;
- APIs;
- commerce;
- orders;
- sweepstakes;
- entries;
- AMOE;
- business logic.

---

## SECURITY AGENT

Agente: `security-integration` - Teammate: `security`

Propietario de:

```text
packages/security/**
packages/audit/**
packages/tpa/**
tests/security/**
```

Responsabilidades:

- security;
- audit;
- authorization review;
- snapshots;
- exports;
- TPA integration;
- drawing controls;
- quality gates;
- final integration review.

Además, y de forma transversal: **derecho de lectura sobre todo el
repositorio** y rol de **auditor técnico final**. Ese derecho es de lectura y
revisión, no de edición: los cambios en código ajeno se solicitan por handoff.

---

## Archivos compartidos

Estos archivos los escriben los tres agentes. Para evitar conflictos:
**se añade al final, no se reescribe lo existente**, y cada entrada indica su
autor.

| Archivo                 | Uso                                                                         |
| ----------------------- | --------------------------------------------------------------------------- |
| `docs/AGENT_HANDOFF.md` | Anadir handoffs al final; actualizar solo el `Status` de los propios.       |
| `docs/DECISIONS.md`     | Anadir `DEC-xxx` al final.                                                  |
| `docs/API_CONTRACT.md`  | El **owner** del endpoint edita su entrada; los demas proponen por handoff. |
| `docs/LEGAL_PENDING.md` | Cualquiera anade preguntas; **nadie inventa respuestas**.                   |
| `docs/ARCHITECTURE.md`  | Lo mantiene el Team Lead con acuerdo de los tres.                           |

---

## Archivos reservados al Team Lead / al usuario

Ningún agente los modifica sin instrucción explícita:

```text
CLAUDE.md
ORCHESTRATOR.md
README.md
.claude/settings.json
.claude/agents/**
.gitignore
```

---

## Zona neutral

Configuración raíz del proyecto (manifiestos de paquetes, linters, formatters,
CI) es **zona neutral**: se acuerda en la fase de planificación, se registra en
`docs/DECISIONS.md` y **un solo agente** la crea, designado por el Team Lead.

---

## Ajuste 2026-08-29 (Team Lead, HO-041)

- `tests/e2e/**` pertenece a **security-integration** (lo creó en HO-030 y es
  la red de integración final). `backend` y `frontend` proponen cambios al
  escenario por handoff; los ajustes de semilla que exija un cambio de
  contrato los hace `security` en la misma ronda.
- `docs/legal/**` es **zona de solo lectura**: contiene los documentos del
  abogado tal como llegan. Nadie los edita; se añaden versiones nuevas con
  fecha en el nombre.
