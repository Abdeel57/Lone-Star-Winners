# .claude/ — Guía de los agentes de Lone Star Winners

Esta carpeta contiene la configuración de **Agent Teams** de Claude Code para
este proyecto. Esta guía está escrita para que se entienda sin experiencia
previa con Agent Teams.

---

## 1. Qué hay aquí

```text
.claude/
├── settings.json                    <- activa Agent Teams
├── README.md                        <- este archivo
└── agents/
    ├── frontend-ux.md               <- Agente 1
    ├── backend-sweepstakes.md       <- Agente 2
    └── security-integration.md      <- Agente 3
```

---

## 2. Qué es cada agente

| Archivo | Agente | Color | Modelo | De qué se encarga |
|---|---|---|---|---|
| `agents/frontend-ux.md` | `frontend-ux` | azul | Fable 5 | Frontend, UX/UI, experiencia bilingüe, e-commerce visual, portal del participante, capa de presentación del admin. |
| `agents/backend-sweepstakes.md` | `backend-sweepstakes` | verde | Opus 5 | Backend, base de datos, APIs, commerce logic, sweepstakes engine, entry ledger, AMOE, servicios administrativos. |
| `agents/security-integration.md` | `security-integration` | naranja | Opus 5 | Seguridad, compliance, auditoría, exportaciones, integración con third-party administrator, QA e integración final. |

Cuando se levante el equipo, cada agente se convierte en un **teammate** con
nombre corto: `frontend`, `backend` y `security`.

> **Modelos.** `backend` y `security` llevan `model: opus` fijado en su
> frontmatter. `frontend` **no** puede fijarlo ahí (el frontmatter solo acepta
> `sonnet`/`opus`/`haiku`/`inherit`, no `fable`), así que Fable 5 se le asigna
> al crear el teammate. `ORCHESTRATOR.md` ya se lo indica al Team Lead.

---

## 3. Dónde pegar cada prompt

Cada archivo de agente tiene una **zona de pegado** marcada con comentarios
`<!-- ZONA DE PEGADO -->`. Dentro hay una línea placeholder:

| Prompt | Archivo | Línea a reemplazar |
|---|---|---|
| **Prompt 1 — Frontend + UX/UI** | `.claude/agents/frontend-ux.md` | `[Pegar aquí el Prompt 1 — Frontend + UX/UI]` |
| **Prompt 2 — Backend + Sweepstakes Engine** | `.claude/agents/backend-sweepstakes.md` | `[Pegar aquí el Prompt 2 — Backend + Sweepstakes Engine]` |
| **Prompt 3 — Security + Compliance + Integration** | `.claude/agents/security-integration.md` | `[Pegar aquí el Prompt 3 — Security + Compliance + Integration]` |

### Reglas al pegar

1. **Reemplaza solo esa línea.** No borres nada más.
2. **No toques el bloque de frontmatter** de arriba del archivo (las líneas
   entre `---` con `name`, `description` y `color`). Sin él, Claude Code no
   registra el agente.
3. **No borres la sección "Contexto permanente"** del final: contiene el
   ownership y las reglas mínimas que atan al agente a la constitución del
   proyecto.
4. Guarda el archivo.

---

## 4. Cómo iniciar el Team Lead

1. Pega los tres prompts (paso 3).
2. Si Claude Code ya estaba abierto, **reinícialo** para que lea
   `.claude/settings.json` y registre los agentes.
3. Abre una sesión principal de Claude Code en la raíz del proyecto.
4. Escribe:

```text
Lee ORCHESTRATOR.md y sigue sus instrucciones. Crea el equipo y desarrolla Lone Star Winners.
```

El archivo que arranca la orquestación es **`ORCHESTRATOR.md`**, en la raíz del
proyecto. Contiene las instrucciones completas del Team Lead.

Verificación rápida: puedes escribir `/agents` en Claude Code para comprobar
que los tres agentes aparecen listados.

---

## 5. Cómo revisar decisiones

Todas las decisiones de arquitectura viven en **`docs/DECISIONS.md`**, en
formato ADR ligero (`DEC-001`, `DEC-002`, …), cada una con estado
`Proposed` / `Accepted` / `Rejected` / `Superseded`.

Si quieres saber por qué el proyecto usa cierta tecnología o cierto enfoque,
ese es el único archivo que necesitas leer. Una decisión que no esté ahí
**no ha sido tomada oficialmente**.

---

## 6. Cómo revisar handoffs

La comunicación entre agentes vive en **`docs/AGENT_HANDOFF.md`**
(`HO-001`, `HO-002`, …).

Para ver el estado real del proyecto de un vistazo, busca ahí:

- handoffs con `Blocking: YES` y `Status: OPEN` → alguien está **atascado**;
- handoffs `RESOLVED` → trabajo coordinado ya completado;
- handoffs `REJECTED` → una petición que se descartó, con su motivo.

---

## 7. Otros archivos que conviene conocer

| Archivo | Para qué sirve |
|---|---|
| `CLAUDE.md` | Constitución del proyecto: qué es, 20 principios globales, protocolo. |
| `ORCHESTRATOR.md` | Prompt de arranque del Team Lead. |
| `docs/ARCHITECTURE.md` | Módulos, fronteras y lo que sigue sin decidir. |
| `docs/API_CONTRACT.md` | Todas las APIs. El frontend no puede usar una que no esté ahí. |
| `docs/TASK_OWNERSHIP.md` | Qué archivos puede tocar cada agente. |
| `docs/LEGAL_PENDING.md` | Lo que falta por decidir el abogado del cliente. |

---

## 8. Recordatorio importante

El **stack todavía no está decidido** (framework, base de datos, ORM, hosting,
pagos, etc.). Esa discusión la tienen los tres agentes en la primera fase y
queda registrada en `docs/DECISIONS.md`. No hace falta que elijas nada por
adelantado.
