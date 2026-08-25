# DECISIONS.md

Registro de decisiones arquitectónicas (**ADR ligero**) de Lone Star Winners.

**Todo cambio importante de arquitectura debe quedar registrado aquí.**

## Reglas

1. Una decisión no implementada previamente registrada aquí **no existe**.
   Si un agente encuentra código que contradice este documento, abre un
   handoff en lugar de adaptarse silenciosamente.
2. Las decisiones **no se borran**. Una decisión que deja de aplicar cambia a
   `Superseded` y apunta a la que la reemplaza.
3. Las decisiones de stack (framework, ORM, base de datos, hosting, pagos,
   email, storage, analytics, colas, nube) requieren **acuerdo de los tres
   agentes** antes de pasar a `Accepted`.
4. Las decisiones que afecten seguridad, auditabilidad, entries, AMOE o
   integración con el third-party administrator requieren revisión explícita
   del agente `security-integration`.
5. Identificadores correlativos: `DEC-001`, `DEC-002`, … sin reutilizar.

## Estados

- `Proposed` — propuesta abierta, aún en discusión.
- `Accepted` — vigente y vinculante.
- `Rejected` — descartada, con motivo registrado.
- `Superseded` — reemplazada por otra decisión (indicar cuál).

---

## Plantilla

```text
## DEC-000

Status:
Proposed / Accepted / Rejected / Superseded

Date:

Decision:

Context:

Alternatives:

Reason:

Affected areas:
```

Campos opcionales recomendados cuando apliquen:

```text
Proposed by:
Agreed by:
Supersedes / Superseded by:
Legal dependency:
```

---

# Registro de decisiones

_(vacío — la primera decisión será `DEC-001`)_

> Nota: el stack técnico **no está decidido**. Ver `CLAUDE.md` §7.
> Las decisiones de stack deben aparecer aquí antes de escribirse en código.
