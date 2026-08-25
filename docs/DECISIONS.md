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

> **Estado de esta tanda (DEC-001 … DEC-021):** producto de la FASE 1
> (planificación) del 2026-08-25, en la que los tres agentes propusieron de
> forma independiente y sin verse entre sí. **Aprobadas por el usuario el
> 2026-08-25**; todas pasan a `Accepted` y son vinculantes.
>
> `DEC-022`, `DEC-023` y `DEC-024` resuelven los conflictos que quedaron
> abiertos como `HO-001`, `HO-002` y `HO-004`.

---

## DEC-001

Status: Accepted

Date: 2026-08-25

Decision:
Monorepo gestionado con **pnpm workspaces + Turborepo**, con la disposición de
rutas ya prevista en `docs/TASK_OWNERSHIP.md` (`apps/web`, `apps/api`,
`packages/*`).

Context:
Tres agentes con ownership estricto por rutas y necesidad real de compartir
tipos de contrato entre frontend y backend.

Alternatives:
Repositorios separados (descartado: complica el reparto de ownership y el
versionado del contrato compartido). npm/yarn workspaces (descartado: pnpm es
más eficiente en disco con varias apps). Nx (descartado: sobrecoste para el
tamaño actual).

Reason:
`docs/TASK_OWNERSHIP.md` ya anticipaba rutas de monorepo, así que la fricción
de la decisión es baja. Turborepo aporta cache de tareas en CI.

Affected areas: repositorio completo, CI, ownership.

Proposed by: frontend, backend (coincidencia independiente)
Agreed by: frontend, backend; security no objeta

---

## DEC-002

Status: Accepted

Date: 2026-08-25

Decision:
**TypeScript en modo `strict`** en todo el monorepo, con
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y
`noImplicitOverride`. `@typescript-eslint/no-explicit-any` como *error*.

Context:
Los contratos entre frontend y backend son tipados; un cambio de contrato debe
fallar en build, no en producción.

Alternatives:
TypeScript sin `strict` (descartado). JavaScript (descartado).

Reason:
Es lo que convierte el principio #16 en algo que el compilador detecta.

Affected areas: todo el código.

Proposed by: los tres
Agreed by: los tres

---

## DEC-003

Status: Accepted

Date: 2026-08-25

Decision:
**PostgreSQL 16+** como base de datos, con **tres roles de base de datos
diferenciados**: `migrator` (DDL), `app` (DML, **sin `UPDATE`/`DELETE` sobre
tablas de ledger y auditoría**) y `readonly_report`.

Context:
El ledger append-only, los rangos de entries sin solapamiento y la idempotencia
de awards deben ser garantizados por el motor de base de datos, no por código
de aplicación.

Alternatives:
Cualquier store schemaless (**objetado formalmente por `security`**: dejaría la
inmutabilidad en manos del código, y un solo bug la anularía). MySQL
(descartado: sin `EXCLUDE USING gist` sobre rangos).

Reason:
Se requieren transacciones serializables, `UNIQUE` compuestos, `CHECK`,
`EXCLUDE USING gist` sobre `int8range`, triggers y GRANTs por rol. Es la
precondición técnica de los principios #5, #6 y #7.

Affected areas: `packages/database`, hosting, todo el dominio de entries.

Proposed by: backend
Agreed by: backend, security (requisitos no negociables R1 y R2 de security)

Nota: **el proveedor concreto (Neon / RDS / Supabase / otro) sigue sin decidir.**
Restricción vinculante: si el hosting no permite crear roles de base de datos
diferenciados, ese hosting queda descartado.

---

## DEC-004

Status: Accepted

Date: 2026-08-25

Decision:
Dos procesos separados:
- **`apps/web`** — Next.js (App Router) con `output: "standalone"`.
- **`apps/api`** — **Fastify 5 standalone**. Las API routes de Next **no** se
  usan para lógica de negocio.

El frontend consume la API por HTTP. No se fusionan.

Context:
Los webhooks de pago exigen *raw body* para verificar firma; los jobs largos y
la generación de export snapshots no encajan en funciones serverless.

Alternatives:
Todo en Next API routes (**descartado explícitamente por backend**: rompe la
verificación de firma de webhooks y da al frontend autoridad sobre reglas de
negocio, violando la frontera de `docs/ARCHITECTURE.md`).

Reason:
Mantiene la frontera de responsabilidad del principio #15 como separación de
procesos, no solo de carpetas. `standalone` evita dar por supuesto Vercel y
mantiene abierta la decisión de hosting.

Affected areas: `apps/web`, `apps/api`, despliegue.

Proposed by: frontend (Next standalone), backend (Fastify separado)
Agreed by: frontend, backend; security no objeta

---

## DEC-005

Status: Accepted

Date: 2026-08-25

Decision:
**Drizzle ORM** + `drizzle-kit`, con **migraciones SQL forward-only
versionadas**. Sin `db push`. Sin migraciones destructivas sobre tablas de
ledger o auditoría.

Context:
El esquema forma parte del expediente de auditoría y debe ser legible por un
tercero.

Alternatives:
Prisma (mejor DX, pero abstrae precisamente lo que aquí es evidencia
regulatoria: triggers, `CHECK`, `EXCLUDE`, `FOR UPDATE`, GRANTs). Si se
prefiriera Prisma, habría que escribir a mano las constraints críticas en SQL.

Reason:
`security` exige poder inspeccionar las migraciones en CI y fallar si alguna
concede `UPDATE`/`DELETE` sobre ledger o auditoría. Con migraciones SQL planas
eso es verificable; con migraciones generadas y opacas, no.

Affected areas: `packages/database`, quality gates, auditoría.

Proposed by: backend
Agreed by: backend; alineado con los requisitos R1/R2 de security

---

## DEC-006

Status: Accepted

Date: 2026-08-25

Decision:
**Un único sistema de identidad** para participantes y administradores.
Sesiones de servidor **opacas y revocables** en cookie `httpOnly`, `Secure`,
`SameSite=Lax` (`Strict` en el scope admin), respaldadas por tabla `Session`.
**No** JWT auto-contenido, **no** tokens en `localStorage`.
Hash de contraseña con **Argon2id**. **MFA/TOTP obligatorio para todo rol
administrativo**. **Step-up authentication** (re-auth + MFA reciente, ventana
menor o igual a 5 min) para descarga de export, finalización de snapshot,
inicio de sorteo, cambio de rol, cambio de flag legalmente material y ajuste
manual.

Context:
El patrón habitual (auth de participante con la librería del framework, más un
login admin propio) viola el principio #16 y crea dos superficies de escalada
de privilegios.

Alternatives:
JWT sin estado (descartado: no se revoca; añadir una denylist reintroduce el
estado sin ninguna ventaja). Dos sistemas separados (**prohibido** por
`CLAUDE.md`).

Reason:
Los tres agentes convergieron de forma independiente en la cookie `httpOnly`.
El admin no es otra aplicación: es el mismo usuario con roles distintos, scope
de cookie distinto y política de sesión más estricta.

Affected areas: `packages/security`, `apps/api`, `apps/web`, todos los flujos.

Proposed by: security (recomendación); frontend y backend (preferencia
coincidente e independiente)
Agreed by: los tres

Nota: si en el futuro se propone SSO/IdP externo para staff, se implementa como
*provider adicional dentro del mismo Identity*, nunca como sistema paralelo, y
requiere un `DEC-xxx` propio.

---

## DEC-007

Status: Accepted

Date: 2026-08-25

Decision:
El **entry ledger es append-only de forma estructural**, garantizado en tres
capas independientes:
1. **Permisos de base de datos** — `REVOKE UPDATE, DELETE ON
   entry_transactions, audit_events FROM app;`
2. **Triggers** `BEFORE UPDATE OR DELETE` que lanzan excepción.
3. **Test de invariante en CI** que intenta activamente un `UPDATE` y un
   `DELETE` y exige que fallen; más un check que inspecciona las migraciones y
   falla si alguna concede `UPDATE`/`DELETE` sobre esas tablas.

Toda corrección es una **fila nueva** con delta de signo contrario y
`reverses_transaction_id` apuntando a la original. Sin soft-delete. Sin campo
`status` mutable: un cambio de estado es otra fila.

El saldo es un **agregado derivado** (`SUM(quantity_delta)`), expuesto como
vista SQL única. Nunca un campo editable. Cualquier caché de saldo se escribe
en la misma transacción y un job de reconciliación la recalcula contra el
ledger y alerta ante cualquier deriva.

Los reversals se anclan a `rules_version_id` y `engine_version` **originales**:
un refund de hoy revierte lo que se calculó bajo las reglas de entonces, no
bajo las de ahora.

Context:
Principios globales #5, #6 y #7. El atajo natural de cualquier ORM para un
refund es `UPDATE` o `DELETE`, y sería una violación irreversible.

Alternatives:
Append-only por convención de código (descartado: un solo bug lo anula).
Soft-delete (descartado: sigue siendo mutación).

Reason:
Convierte la auditabilidad en una garantía del motor, no en disciplina de los
desarrolladores.

Affected areas: `packages/database`, `packages/sweepstakes`, `packages/audit`,
quality gates.

Proposed by: backend y security (diseños independientes prácticamente idénticos)
Agreed by: backend, security

---

## DEC-008

Status: Accepted

Date: 2026-08-25

Decision:
Cada `EntryTransaction` y cada `AuditEvent` incluye
`hash = SHA256(canonical(payload) || prev_hash)`, **encadenado por promoción**,
con `canonicalization_version` explícita. Un **job verificador** recorre la
cadena periódicamente y emite alerta más un `AuditEvent` de tipo
`INTEGRITY_CHECK`. El `chain_head_hash` de cada promoción se **sella
diariamente en un almacén externo write-once**, fuera del alcance del rol `app`.

Context:
Sin anclaje externo, un atacante con acceso total a la base de datos podría
recalcular toda la cadena y reescribir el pasado sin dejar rastro.

Alternatives:
Solo append-only sin hash chain (descartado: detecta el borrado, no la
reescritura coherente). Hash chain sin sellado externo (insuficiente por la
razón anterior).

Reason:
Es la diferencia entre *append-only* y **tamper-evident**. Un tercero debe
poder demostrar que el histórico no se reescribió.

Affected areas: `packages/audit`, `packages/database`, infraestructura.

Proposed by: security
Agreed by: security; backend ya contemplaba puntos de emisión de `AuditEvent`
compatibles

---

## DEC-009

Status: Accepted

Date: 2026-08-25

Decision:
**Idempotencia estructural**, garantizada por constraints y no por lógica:
- `UNIQUE (promotion_id, source_type, source_ref)` sobre todo award de entries.
- `UNIQUE (provider, provider_event_id)` sobre todo webhook, persistido
  **antes** de procesarse.
- Asignación de rangos de entries con `pg_advisory_xact_lock(promotion_id)` y
  **constraint de exclusión GiST sobre `int8range`**, que hace matemáticamente
  imposible el solapamiento.

Un duplicado debe fallar como error de restricción de base de datos, nunca como
un `if` en el código.

Context:
Un webhook reintentado por el proveedor de pago es el fallo con mayor coste
reputacional posible: entries duplicadas en un sweepstakes.

Alternatives:
`if (alreadyAwarded)` en código (descartado: condición de carrera bajo doble
clic o reintento concurrente).

Reason:
Backend y security identificaron este riesgo de forma independiente y con la
misma mitigación.

Affected areas: `packages/sweepstakes`, `packages/commerce`, `packages/database`.

Proposed by: backend, security
Agreed by: backend, security

---

## DEC-010

Status: Accepted

Date: 2026-08-25

Decision:
**Nunca coma flotante** para dinero ni para entries.
- Dinero: enteros en unidad menor (`amount_minor`) más `currency` explícita.
- Entries: enteros.
- Multiplicadores: par numerador/denominador entero, nunca decimal.
- Rangos de entries: `string` en el contrato de API (por ejemplo
  `LSW26-000450001`), nunca número.

Context:
Aritmética de coma flotante sobre dinero o entries produce discrepancias
legalmente indefendibles.

Alternatives:
`float`/`number` (descartado en base de datos y en el contrato de API).

Reason:
Requisito R4 de security y reglas equivalentes en el rol de backend.

Affected areas: base de datos, contrato de API, frontend.

Proposed by: los tres
Agreed by: los tres

---

## DEC-011

Status: Accepted

Date: 2026-08-25

Decision:
Todos los instantes se almacenan como `timestamptz` **en UTC**. Cada promoción
declara su **timezone legal IANA explícita** (`promotion.legal_timezone`), y
todos los deadlines se evalúan **en el servidor** contra esa zona. Prohibido
usar la zona del navegador o la del servidor como fuente de verdad. Cada
registro distingue `occurred_at` (cuándo ocurrió) de `recorded_at`
(`DEFAULT now()` de la base de datos).

Context:
Un cierre de promoción evaluado en la zona equivocada admite o rechaza entries
incorrectamente, con consecuencias legales directas.

Alternatives:
UTC sin zona legal declarada (descartado: no permite evaluar un deadline
expresado en hora local en las Official Rules).

Reason:
Riesgo identificado por security, coincidente con la propuesta de backend.

Affected areas: base de datos, `packages/sweepstakes`, frontend.

Proposed by: backend, security
Agreed by: backend, security

---

## DEC-012

Status: Accepted

Date: 2026-08-25

Decision:
La configuración legal vive en una entidad **`PromotionRulesVersion`
inmutable** (`DRAFT` / `ACTIVE` / `ARCHIVED`), con activación auditada. **Cero
constantes legales en código.** Cada `EntryTransaction` guarda el
`rules_version_id` que la produjo. Una promoción `ACTIVE` **nunca** edita sus
reglas: crea una versión nueva.

**Una promoción no puede transicionar a `ACTIVE` mientras exista una clave
requerida en estado provisional o `TBD`.** El validador de activación lo
bloquea y devuelve la lista de claves faltantes.

Context:
Principios #2, #3 y #14. Los requisitos legales los fija el abogado del cliente
y todavía están sin resolver.

Alternatives:
Constantes en código con un comentario "TODO: confirmar con legal" (descartado:
es exactamente lo que prohíbe el principio #2).

Reason:
Convierte "pendiente del abogado" en un bloqueo verificable por máquina en vez
de una nota que se olvida.

Affected areas: `packages/sweepstakes`, `apps/api`, admin, frontend.

Proposed by: backend, security
Agreed by: backend, security

---

## DEC-013

Status: Accepted

Date: 2026-08-25

Decision:
Los **feature flags se persisten en base de datos**, **desactivados por
defecto**, con cambio auditado y `reason` obligatorio. Prohibido leer flags
legalmente materiales desde variables de entorno del frontend. Los flags se
leen **en el servidor**, en la misma request que el render.

Context:
El principio #8 exige que la capacidad AMOE exista aunque esté apagada; el #11
exige que el sorteo interno no pueda activarse sin autorización.

Alternatives:
Flags en variables de entorno (descartado por security: no auditable, y expone
política legal al cliente).

Reason:
Un flag legalmente material es una decisión de negocio auditable, no una
variable de despliegue.

Affected areas: `apps/api`, `apps/web`, `packages/security`, admin.

Proposed by: security
Agreed by: security, backend; frontend lo requiere leído en servidor

Nota: **la lista exacta y la convención de nombres siguen sin cerrar.** Ver
`HO-003` en `docs/AGENT_HANDOFF.md`.

---

## DEC-014

Status: Accepted

Date: 2026-08-25

Decision:
El backend publica un **spec OpenAPI 3.1 generado desde los esquemas Zod**, y
`packages/api-types` (tipos generados) es **propiedad de `backend`** como
productor del contrato. El frontend consume mediante `openapi-typescript` y
`openapi-fetch`.

Context:
El principio #16 y la regla "un agente no debe asumir una API que no esté
documentada" dependían hasta ahora de la buena voluntad.

Alternatives:
Tipos mantenidos a mano en ambos lados (descartado: la deriva de contrato es
cuestión de tiempo).

Reason:
Una sola definición Zod produce validación en runtime, tipos de TypeScript y el
documento que alimenta `docs/API_CONTRACT.md`. Convierte la regla en algo que
verifica el compilador.

Affected areas: `apps/api`, `apps/web`, `packages/api-types`,
`docs/API_CONTRACT.md`.

Proposed by: frontend (petición), backend (oferta)
Agreed by: frontend, backend

---

## DEC-015

Status: Accepted

Date: 2026-08-25

Decision:
`docs/API_CONTRACT.md` hace **obligatorio** el campo `Authorization:` con el
nombre exacto del permiso requerido. Existe un **test de contrato** que compara
el registro de rutas del backend contra el documento: si un endpoint existe en
código y no en el contrato, o su permiso difiere, **CI falla**. Toda ruta
declara su permiso en un registro central **deny-by-default**; una ruta sin
permiso declarado **no arranca**.

Context:
Ocultar un botón en el frontend no es autorización, y el principio #16 no puede
depender de que los agentes se acuerden de actualizar un documento.

Alternatives:
Revisión manual (descartado: no escala y no es verificable).

Reason:
Permite a `security` auditar sin editar código ajeno, respetando el ownership
del principio #15.

Affected areas: `apps/api`, `docs/API_CONTRACT.md`, CI, `tests/security`.

Proposed by: security
Agreed by: security

---

## DEC-016

Status: Accepted

Date: 2026-08-25

Decision:
El **`ExportSnapshot` es una función pura** de
`(promotion_id, cutoff_at, rules_version_id, ledger_high_water_mark,
export_schema_version, canonicalization_version)`. Regenerarlo en cualquier
momento futuro debe producir **bytes idénticos**.

Determinismo obligatorio: orden fijo de filas y columnas, UTF-8 sin BOM, saltos
`LF`, formato numérico invariante de locale, fechas ISO-8601 UTC, y ningún
`generated_at` dentro de las filas de datos (solo en el manifiesto).

Integridad: **Merkle root** sobre el hash canónico de cada registro, SHA-256 del
ZIP y de cada miembro, y firma criptográfica desprendida con clave **fuera del
repositorio**. Almacenamiento write-once. Un export finalizado **jamás se
sobrescribe**: una corrección es una versión nueva que referencia la anterior.

Test en CI: doble generación sobre un fixture sembrado produce hashes
idénticos; y la regeneración tras insertar filas posteriores al corte **no
cambia** el snapshot.

Context:
Principio #10. Es la razón técnica por la que el ledger no puede admitir
`UPDATE` (DEC-007).

Alternatives:
Export como resultado de una query del día (descartado: no reproducible, no
auditable por un tercero).

Reason:
El Merkle root permite al TPA verificar un registro concreto sin recibir todo el
fichero, y detecta reordenación.

Affected areas: `packages/tpa`, `packages/audit`, `apps/api`, CI.

Proposed by: security
Agreed by: security; backend produce el dataset, security es propietario del
formato, la firma y la entrega

---

## DEC-017

Status: Accepted

Date: 2026-08-25

Decision:
Un sorteo interno requiere **cinco cerrojos simultáneos**, todos necesarios:
1. Flag `internal_draw_enabled = false` por defecto, persistido en base de
   datos. Nunca `true` en migraciones semilla ni en `.env.example`. Test de
   invariante que falla si el default es `true`.
2. Entidad **`DrawAuthorization`** por promoción, con `authorized_by` y
   `authorization_reference` al documento de aprobación. Sin autorización viva,
   el endpoint devuelve 403 **aunque el flag esté activo**.
3. **Separación de funciones**: quien finaliza el snapshot
   (`COMPLIANCE_OFFICER`) **no puede** iniciar el sorteo (`DRAW_OFFICER`), y el
   inicio exige segunda aprobación de un actor distinto dentro de un TTL, más
   step-up auth.
4. **Entrada inmutable verificada**: el sorteo opera solo sobre un
   `ExportSnapshot` en estado `FINALIZED`, **recalculando su hash en el momento
   del sorteo**. Nunca sobre una query en vivo.
5. **CSPRNG** del sistema operativo con rechazo de muestreo. Prohibidos por
   regla de lint `Math.random()`, PRNG sembrados y timestamps como entropía.

El resultado es un **`PotentialWinner`**, nunca un ganador confirmado. Sin
publicación automática.

Context:
Principio #11. El riesgo real es que el módulo se active simplemente porque
existe.

Alternatives:
Solo un feature flag (descartado: insuficiente; un flag se cambia sin dejar
constancia de autorización legal).

Reason:
La autorización del principio #11 debe ser un objeto de datos con referencia al
documento que la respalda, no una variable booleana.

Affected areas: `packages/security`, `packages/tpa`, `apps/api`, admin.

Proposed by: security
Agreed by: security; backend se compromete a no implementar selección aleatoria
interna sin este `DEC` aprobado

Nota adicional propuesta por security, **no vinculante**: esquema
*commit-reveal* (publicar `snapshot_hash` y `commitment = SHA256(server_seed)`
antes del sorteo, y revelar `server_seed` después) para que un auditor externo
compruebe que la semilla no se eligió a posteriori. Requiere decisión del
cliente y de su abogado.

---

## DEC-018

Status: Accepted

Date: 2026-08-25

Decision:
Stack de calidad, **bloqueante en `main` desde el primer milestone**:
`gitleaks` (secretos) con hook pre-commit; esquema de entorno validado en boot;
`tsc --noEmit` strict; ESLint type-aware con `eslint-plugin-security` y reglas
propias (prohibir `Math.random()` en `packages/security`, `packages/tpa` y
`packages/sweepstakes`; prohibir SQL por concatenación; prohibir
`dangerouslySetInnerHTML` sin sanitizar); `semgrep` o CodeQL; `osv-scanner` con
Renovate; **Vitest** con **cobertura mínima del 90 % en `packages/audit`,
ledger y export**, y 70 % global; **Testcontainers con PostgreSQL real**;
test de invariantes de base de datos sobre las migraciones; **test de matriz de
autorización** (rol x endpoint); **Playwright** con `@axe-core/playwright`; y
test de reproducibilidad de snapshot.

Context:
Los tres agentes propusieron Vitest de forma independiente. Security aportó la
lista completa de gates.

Alternatives:
Mocks o SQLite para los tests de ledger (**descartado explícitamente**: el
comportamiento crítico, es decir concurrencia, unicidad de rangos y doble
webhook, no es testeable así).

Reason:
Principio #12: seguridad y auditabilidad por encima de shortcuts.

Affected areas: CI, todos los paquetes.

Proposed by: security (lista completa); backend y frontend (Vitest,
Testcontainers, Playwright)
Agreed by: los tres

---

## DEC-019

Status: Accepted

Date: 2026-08-25

Decision:
**`docs/LEGAL_PENDING.md` es el único registro de decisiones legales
pendientes.** El archivo `docs/LEGAL_CONFIG_PENDING.md` que menciona el prompt
del agente `security-integration` **no se crea**. En ese punto concreto, el
prompt del agente queda *superseded* por `CLAUDE.md`.

Context:
El prompt de `security-integration` pide crear `docs/LEGAL_CONFIG_PENDING.md`,
pero la constitución ya designa `docs/LEGAL_PENDING.md` para exactamente lo
mismo.

Alternatives:
Crear ambos (**descartado**: sería el anti-patrón de "dos fuentes de verdad" que
prohíbe `CLAUDE.md` y que el propio agente `security` tiene el deber de
impedir).

Reason:
El propio agente de security detectó la contradicción entre su prompt y la
constitución, y propuso resolverla a favor de la constitución.

Affected areas: `docs/`.

Proposed by: security
Agreed by: security

---

## DEC-020

Status: Accepted

Date: 2026-08-25

Decision:
**Jobs y colas sobre `pg-boss`** (cola implementada sobre el mismo PostgreSQL),
no sobre Redis/BullMQ.

Context:
Encolar un job y escribir en el ledger deben poder ocurrir dentro de la misma
transacción.

Alternatives:
Redis con BullMQ (descartado por ahora: encolar no es atómico respecto a la
transacción del ledger, lo que abre la puerta a entries duplicadas si la
transacción hace rollback después de encolar). SQS (misma objeción).

Reason:
Si la transacción hace rollback, el job desaparece con ella. Si el volumen lo
exigiera más adelante, se migra sin tocar la lógica de dominio.

Affected areas: `apps/api`, `packages/database`.

Proposed by: backend
Agreed by: backend; sin objeción de security

---

## DEC-021

Status: Accepted

Date: 2026-08-25

Decision:
**i18n con `next-intl`.** Ambos idiomas llevan **prefijo de ruta** (`/en/...` y
`/es/...`); **ningún locale por defecto sin prefijo**. Diccionarios en
`messages/en-US.json` y `messages/es-US.json` con ICU MessageFormat.
**Test de paridad de claves en CI**: el build falla si una clave existe en un
locale y no en el otro, o si queda una cadena literal visible fuera del
diccionario. Formateo de números, fechas y moneda con `Intl` según locale.

Context:
Principio #4: español e inglés son idiomas de primera clase.

Alternatives:
Locale por defecto sin prefijo (**descartado**: esconder un idioma lo convierte
de facto en secundario). Páginas duplicadas a mano (descartado).

Reason:
El test de paridad convierte el principio #4 en algo mecánicamente verificable
en vez de una intención declarada.

Affected areas: `apps/web`, CI.

Proposed by: frontend
Agreed by: frontend; backend y security no objetan

Nota: **la frontera del contenido dinámico localizado sigue abierta.** Ver
`HO-001` en `docs/AGENT_HANDOFF.md`.

---

## DEC-022

Status: Accepted

Date: 2026-08-25

Decision:
**El backend envía códigos estables; el frontend es dueño del copy en ambos
idiomas.**

- El envelope de error es
  `{ error: { code, message_key, details, request_id } }`. **Sin** `message_en`
  ni `message_es`.
- El ledger expone `reason_key` como **enum estable**, nunca prosa.
- Todo texto visible al participante se resuelve desde `messages/en-US.json` y
  `messages/es-US.json`.

**Única excepción:** el contenido **legalmente controlante** (Official Rules,
disclaimers y cualquier texto aprobado por el abogado) viaja desde el backend
como objeto por locale, con los campos `is_legally_controlling` e
`is_informational_translation`. El frontend **nunca** traduce ni autotraduce
ese contenido: lo renderiza tal cual llega.

Context:
Resuelve `HO-001`. `frontend` pedía claves estables; `backend` se contradijo a
sí mismo, definiendo el envelope con `message_en`/`message_es` en su sección de
APIs y proponiendo lo contrario en su sección de riesgos.

Alternatives:
Backend traduce y envía ambos idiomas (descartado: el copy legal viviría en dos
repositorios de texto distintos, y el test de paridad de claves de DEC-021 no
podría verificarlo).

Reason:
Es la única opción compatible con el test que rompe el build cuando falta una
traducción. La excepción legal existe porque la redacción aprobada por el
abogado no es copy de producto: es texto controlado cuya fuente debe ser única.

Affected areas: `docs/API_CONTRACT.md`, `apps/api`, `apps/web`, `messages/*`.

Proposed by: Team Lead (consolidando frontend y backend)
Agreed by: aprobado por el usuario el 2026-08-25

---

## DEC-023

Status: Accepted

Date: 2026-08-25

Decision:
**El carrito vive en el servidor.** Existen endpoints de carrito
(`GET|POST|PATCH|DELETE /api/v1/cart*`) propiedad de `backend`. La cotización
de entries se calcula **sobre el carrito de servidor**, no sobre una lista de
ítems enviada por el cliente.

Context:
Resuelve `HO-002`. `frontend` pedía carrito de servidor; `backend` no ofreció
ninguno, y su cotizador recibía los ítems en el cuerpo de la petición, lo que
implicaba un carrito de cliente.

Alternatives:
Carrito en cliente (descartado: sería el cliente quien decide qué se cotiza, lo
que roza el requisito R13 de `security` — "los números los produce el backend" —
y no deja rastro de qué se cotizó ni cuándo).

Reason:
Un carrito de servidor cuesta más trabajo, pero hace que carrito y cotización
compartan una única fuente de verdad y deja una traza auditable. En un producto
donde una cifra de entries mal calculada es un problema legal, esa traza vale
más que la simplicidad.

Affected areas: `apps/api`, `apps/web`, `packages/commerce`,
`docs/API_CONTRACT.md`.

Proposed by: Team Lead (consolidando frontend y backend)
Agreed by: aprobado por el usuario el 2026-08-25

---

## DEC-024

Status: Accepted

Date: 2026-08-25

Decision:
Ampliación de ownership, resolviendo `HO-004`:

- **`security-integration`** pasa a ser propietario de `docs/SECURITY.md`,
  `docs/THREAT_MODEL.md`, `docs/PRODUCTION_READINESS.md`, `docs/runbooks/**` y
  de la configuración de CI (`.github/workflows/**`).
- La **zona neutral raíz** del monorepo (`pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`, configuración de ESLint y Prettier, `package.json`
  raíz, `.env.example`) la crea **`backend-sweepstakes`**, en solitario y
  **antes** de que ningún otro agente escriba código.

Context:
`docs/TASK_OWNERSHIP.md` dejaba sin propietario los documentos de seguridad, el
CI y la configuración raíz. Los tres agentes los necesitan, y sin asignación
explícita habrían acabado editándolos a la vez.

Alternatives:
Dejar la zona neutral a quien llegue primero (descartado: es exactamente el
escenario de edición simultánea que prohíbe `CLAUDE.md` §4).

Reason:
`security` ya es el autor natural de los quality gates, así que el CI le
pertenece. La raíz del monorepo la crea un solo agente para que exista una
sola vez y de forma coherente; se elige `backend` porque es quien más depende
de ella para arrancar.

Affected areas: `docs/TASK_OWNERSHIP.md`, raíz del repositorio, CI.

Proposed by: Team Lead (resolviendo HO-004)
Agreed by: aprobado por el usuario el 2026-08-25
