# Pending Legal Decisions

Este documento registra las decisiones que **corresponden al abogado del
cliente** y que todavía no están resueltas.

## Reglas

1. **Ningún agente inventa respuestas aquí.** `TBD` significa `TBD`.
2. Mientras un punto siga en `TBD`, lo que dependa de él debe implementarse
   como **configuración**, con un valor por defecto explícitamente marcado
   como provisional, nunca como una regla fija en el código.
3. Cuando una decisión llegue, se sustituye `TBD` por la respuesta, se indica
   la fecha y el origen, y si tiene consecuencias arquitectónicas se abre la
   correspondiente entrada en `docs/DECISIONS.md`.
4. Las Official Rules son la fuente autoritativa. Este documento solo refleja
   su estado.
5. Ninguna funcionalidad que dependa de un punto `TBD` se declara terminada.

Formato al resolver un punto:

```text
## Minimum age
RESOLVED — <respuesta>
Date: <fecha>
Source: <Official Rules v.X / correo del abogado / ...>
Impact: <DEC-xxx si aplica>
```

---

## Eligibility

TBD

## Allowed states

TBD

## Minimum age

TBD

## Promotion start/end rules

TBD

## AMOE mechanism

TBD

## Entry limits

TBD

## Multipliers

TBD

## Product eligibility

TBD

## Winner drawing method

TBD

## Third-party administrator requirements

TBD

## Official Rules

TBD

---

# Categorías añadidas en la FASE 1 (2026-08-25)

Estas cinco preguntas **no estaban en la lista original**. Las detectaron los
agentes `backend` y `security` durante la planificación, al descubrir que
afectan al diseño del sistema _antes_ de escribir código. Ver `HO-006` en
`docs/AGENT_HANDOFF.md`.

## Entry expiration

TBD

¿Las Official Rules contemplan que las entries expiren?

**Por qué importa antes de construir:** si expiran, el saldo de un participante
deja de ser una suma pura del ledger y pasa a depender de ventanas temporales.
Eso cambia el diseño del entry ledger y del export al third-party
administrator. Detectado por `backend`; debe resolverse **antes del hito B1**.

## Rounding policy for partial refunds

TBD

Cuando se reembolsa parcialmente una orden, ¿cómo se redondea la cantidad de
entries a revertir? Candidatas: proporcional con `floor`, proporcional con
banker's rounding, o por ítem.

**Por qué importa:** un participante puede perder o conservar una entry según
la política elegida. `backend` señala explícitamente que **no debe elegirla un
ingeniero**: tiene consecuencias legales y la debe aprobar el abogado.

## Record retention and right of erasure

TBD

¿Cuánto tiempo deben conservarse los registros? ¿Cómo se atiende una solicitud
de supresión de datos sin destruir la auditabilidad del sweepstakes?

**Diseño propuesto mientras siga TBD:** la supresión se implementa como
**anonimización del `Participant`** (nulificar campos de PII, conservar
`participant_id` y un `pseudonym_ref`), **nunca** como borrado de filas del
ledger. Así los conteos y la reconciliación histórica sobreviven intactos.
Detectado por `security`.

## Email verification before earning entries

TBD

¿Exigen las Official Rules que un participante verifique su email antes de
poder acumular entries?

**Por qué importa:** condiciona el flujo de registro y el momento en que se
generan las entries de una compra. Se implementa como feature flag, nunca como
supuesto. Detectado por `security`.

## Controlling language of the Official Rules

TBD

¿Qué idioma es el legalmente controlante, y cuál es traducción informativa?

**Por qué importa:** `frontend` necesita campos explícitos
`is_legally_controlling` e `is_informational_translation` por locale. Esa
relación es **texto visible** para el participante, no una suposición del
equipo. El frontend nunca autotraduce texto legal. Detectado por `frontend`.

---

## Nota de proceso

`security` advirtió además de un riesgo de cumplimiento que no es legal sino de
redacción: **el copy del checkout no puede describir la compra como "boletos"
ni como "oportunidades de ganar"**, porque contradice `CLAUDE.md` §1. Pide
revisión de compliance del copy bilingüe **antes** de `INTEGRATE`, en ambos
idiomas — una traducción laxa al español puede crear una representación legal
distinta de la del inglés.

## Entry pool cap for the GMC 2025 promotion

TBD

El cliente ha fijado (2026-08-26, DEC-042) un **universo total de 10,000
participaciones** para la promoción de la camioneta GMC 2025. Debe quedar
reflejado en las Official Rules: cómo se agota el cupo, qué ocurre con una
compra elegible cuando ya no quedan participaciones, y si el cupo convive con
el mecanismo AMOE. Mientras siga TBD, el tope vive como configuración de la
promoción y la interfaz lo muestra como dato, sin urgencia fabricada.

## Prize imagery disclaimer

TBD

La promoción GMC Denali 2025 (DEC-042) muestra una fotografía real del
vehículo entregada por el cliente. El texto alternativo describe lo que se ve
("plateada, vista frontal de tres cuartos") y **no promete nada**. Falta
decidir si las Official Rules exigen un descargo del tipo "la imagen es
ilustrativa y puede no corresponder al vehículo exacto entregado" (color,
equipamiento, año-modelo). Mientras siga TBD, la interfaz no incluye ninguna
afirmación al respecto: añadir un descargo es una afirmación legal y la
redacta el abogado.

## Drawing evidence and TPA delivery (DEC-016 / DEC-017)

TBD

Cinco decisiones que el dominio de sorteo deja preparadas pero **no toma**:

1. **Commit–reveal**: si el sorteo interno debe publicar un compromiso de la
   semilla antes del sorteo y revelarla después. Construido y `DISABLED` por
   defecto. No impide elegir la semilla de mala fe antes de comprometerla;
   evitarlo exige entropía que el operador no controle.
2. **Identidad del third-party administrator** y su esquema de export
   exacto. Hoy: esquema mínimo sin PII y entrega en modo dry-run.
3. **Almacén write-once para el sellado** de la hash chain. Hoy todos los
   informes se entregan declarando `UNSEALED` (DEC-037).
4. **Si el sorteo interno llegará a autorizarse alguna vez.** Sin
   `DrawAuthorization` con referencia documental, la puerta no se abre.
5. **Retención del `DrawingEvent` y del expediente de ganador potencial**, y
   requisitos documentales de verificación de ganador.
