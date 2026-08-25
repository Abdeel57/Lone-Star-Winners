# Lone Star Winners

Plataforma bilingüe (español / inglés) de **e-commerce + sweepstakes** para
Estados Unidos.

Los usuarios adquieren mercancía elegible y esas compras **pueden generar
promotional entries** conforme a las **Official Rules aprobadas por el abogado
del cliente**, junto a un mecanismo **AMOE** (Alternative Method of Entry).

> No es una página de venta de boletos, ni una rifa, ni una lotería.

---

## Estado actual

**Fase 0 — infraestructura de coordinación.**

El desarrollo **no ha comenzado**. Lo que existe hoy es la preparación para que
tres agentes especializados de Claude Code trabajen coordinadamente sobre este
repositorio.

El **stack técnico todavía no está decidido**: framework de frontend y backend,
ORM, base de datos, hosting, procesador de pagos, email, storage, analytics,
colas y proveedor de nube se acuerdan entre los tres agentes en la fase de
planificación y se registran en `docs/DECISIONS.md`.

---

## Estructura

```text
Lone Star/
├── .claude/
│   ├── settings.json                 # Agent Teams habilitado
│   ├── README.md                     # Guia de los agentes
│   └── agents/
│       ├── frontend-ux.md            # Agente 1: Frontend + UX/UI
│       ├── backend-sweepstakes.md    # Agente 2: Backend + Sweepstakes
│       └── security-integration.md   # Agente 3: Security + Compliance
├── docs/
│   ├── AGENT_HANDOFF.md              # Comunicacion entre agentes
│   ├── DECISIONS.md                  # Registro ADR
│   ├── API_CONTRACT.md               # Fuente de verdad de las APIs
│   ├── ARCHITECTURE.md               # Modulos y fronteras
│   ├── TASK_OWNERSHIP.md             # Propiedad de archivos
│   └── LEGAL_PENDING.md              # Pendientes del abogado
├── CLAUDE.md                         # Constitucion del proyecto
├── ORCHESTRATOR.md                   # Prompt de arranque del Team Lead
├── .gitignore
└── README.md
```

---

## El equipo

| Teammate | Agente | Dominio |
|---|---|---|
| `frontend` | `frontend-ux` | Frontend, UX/UI, bilingüe, storefront, portal, admin UI |
| `backend` | `backend-sweepstakes` | Base de datos, APIs, commerce, sweepstakes engine, AMOE |
| `security` | `security-integration` | Seguridad, compliance, auditoría, exports, TPA, QA, integración |

---

## Cómo empezar

1. Pega los tres prompts especializados en `.claude/agents/` (ver
   [.claude/README.md](.claude/README.md), sección 3).
2. Reinicia Claude Code si estaba abierto.
3. Abre una sesión principal en la raíz del proyecto y escribe:

```text
Lee ORCHESTRATOR.md y sigue sus instrucciones. Crea el equipo y desarrolla Lone Star Winners.
```

---

## Protocolo de trabajo

```text
PLAN -> AGREE ON CONTRACT -> ASSIGN OWNERSHIP -> IMPLEMENT
     -> TEST -> SECURITY REVIEW -> INTEGRATE -> VERIFY
```

---

## Reglas no negociables

- Las Official Rules las determina el abogado del cliente. **Ningún agente
  inventa requisitos legales.**
- Lo legal y comercial crítico es **configurable**, nunca hardcoded.
- Español e inglés son **idiomas de primera clase**.
- Las entries son **auditables** y **no se borran silenciosamente**: refunds,
  chargebacks, fraude y descalificaciones se reflejan mediante movimientos o
  reversals.
- Compra y **AMOE** coexisten en el mismo universo lógico conservando su
  procedencia.
- Un random drawing interno **no se activa sin autorización**.
- **Sin secretos en el repositorio.** Variables de entorno vía `.env.example`
  con valores falsos.
- **Sin operaciones destructivas de Git.**
- Mobile-first.

El detalle completo está en [CLAUDE.md](CLAUDE.md).
