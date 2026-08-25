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

_(vacío — el primer handoff será `HO-001`)_
