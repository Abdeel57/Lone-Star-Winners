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
`noImplicitOverride`. `@typescript-eslint/no-explicit-any` como _error_.

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
Los webhooks de pago exigen _raw body_ para verificar firma; los jobs largos y
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
_provider adicional dentro del mismo Identity_, nunca como sistema paralelo, y
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
Es la diferencia entre _append-only_ y **tamper-evident**. Un tercero debe
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
_commit-reveal_ (publicar `snapshot_hash` y `commitment = SHA256(server_seed)`
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
prompt del agente queda _superseded_ por `CLAUDE.md`.

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

---

## DEC-025

Status: Accepted

Date: 2026-08-25

Decision:
**Node.js 24 LTS**, no Node 22. `engines.node` queda en `>=24.0.0 <25` y
`.nvmrc` en `24.12.0`.

Context:
La propuesta original de `backend` en la FASE 1 decía "Node 22 LTS". Al crear
la zona neutral raíz, el propio agente detectó dos problemas: la máquina de
desarrollo corre **Node v24.12.0**, de modo que `pnpm install` habría fallado
con `engine-strict`; y a fecha de hoy Node 22 ya está en mantenimiento mientras
que **Node 24 es Active LTS**.

Alternatives:
Mantener Node 22 y forzar un cambio de versión con nvm en cada máquina
(descartado: fricción diaria y una LTS en mantenimiento para un proyecto que
empieza hoy).

Reason:
Fijar una versión que ni siquiera es la instalada habría bloqueado la
instalación de dependencias en el primer paso. El agente lo reportó en vez de
cambiarlo por su cuenta, que es exactamente el comportamiento correcto.

Affected areas: `package.json`, `.nvmrc`, CI.

Proposed by: backend (detectado durante la implementación)
Agreed by: Team Lead; supersede el "Node 22 LTS" de la propuesta original

---

## DEC-026

Status: Accepted

Date: 2026-08-25

Decision:
Se añade **`.gitattributes`** en la raíz con `* text=auto eol=lf`, más reglas
explícitas para los tipos que participan en hashes (`.sql`, `.json`, `.jsonl`,
`.csv`), `eol=crlf` para scripts de Windows y `binary` para los formatos que
nunca deben normalizarse. Propietario: **Team Lead**, junto a `.gitignore`.

Además, el glob `tests/*` se añade a `pnpm-workspace.yaml`, para que
`tests/security/**` —asignado a `security` en `docs/TASK_OWNERSHIP.md`— pueda
tener su propio `package.json` y dependencias.

Context:
El desarrollo ocurre en Windows con `core.autocrlf = true` **verificado**. Sin
`.gitattributes`, Git convierte los finales de línea a CRLF en el checkout.

Alternatives:
Confiar en `.editorconfig` y Prettier (descartado: solo aplican a quien tenga
el plugin instalado, y no gobiernan lo que hace Git al hacer checkout).

Reason:
Un `ExportSnapshot` cuyo hash depende del sistema operativo del desarrollador
**no es reproducible**, y por tanto no es auditable por el third-party
administrator. Esto convertía DEC-016 en inaplicable en la práctica. Detectado
por `backend` al crear la zona neutral.

Affected areas: raíz del repositorio, `packages/tpa`, `packages/database`,
`pnpm-workspace.yaml`, CI.

Proposed by: backend (detectado durante la implementación)
Agreed by: Team Lead

---

## DEC-027

Status: Accepted

Date: 2026-08-25

Decision:
**El catálogo canónico de roles y capacidades vive en `packages/security`.**
`packages/database` lo importa para la semilla y mantiene un test de paridad.
`apps/api` lo consume a través de `apps/api/src/http/permission-catalog.ts`.

Se adoptan del catálogo de `security`: los 8 roles (incluidos **`EXPORT_OFFICER`**
y el actor **`SYSTEM`**), la convención `dominio.recurso.accion`, y los
metadatos de step-up, segunda aprobación, dependencia de flag y dependencia
legal.

Se conservan del diseño de `backend`, por ser aciertos que el otro catálogo no
tenía: **`SUPER_ADMIN` excluido de `export.finalize`, `draw.authorize` y
`draw.execute`**; el conflicto de roles impuesto por trigger de base de datos; y
el renombrado de `COMPLIANCE_REVIEWER` a `COMPLIANCE_OFFICER` para alinear con
DEC-017.

Context:
Resuelve `HO-007`. Trabajando en paralelo, `security` y `backend` crearon dos
catálogos de autorización incompatibles: capacidades `entry.ledger.read` frente
a `entry.read`, y solo dos roles coincidentes de ocho. Es el anti-patrón de dos
fuentes de verdad que prohíbe `CLAUDE.md` §4.

Alternatives:
Que ganase el catálogo de `packages/database` (descartado: no puede representar
la separación entre `export.finalize` y `export.download` que exige DEC-016, no
tiene actor `SYSTEM` para distinguir un job de una persona en la auditoría, y
carece de `requiresSecondApproval`).

Reason:
**Los dos agentes detectaron el conflicto por separado y los dos recomendaron
la misma resolución**, sin haberse consultado. La regla 4 de este documento
atribuye a `security-integration` la revisión de autorización, y `backend` ya
había preparado el punto de indirección precisamente para que el cambio fuese
barato.

Affected areas: `packages/security`, `packages/database`, `apps/api`.

Proposed by: security y backend (coincidencia independiente)
Agreed by: Team Lead

---

## DEC-028

Status: Accepted

Date: 2026-08-25

Decision:
Se añade **`Identity`** al vocabulario canónico, como entidad intermedia:
`participants` y `admin_users` cuelgan de `identities`.

Sigue habiendo **un único sistema de identidad** (DEC-006). La diferencia es
que un empleado que no participa **no tiene fila en `participants`**.

Context:
`backend` introdujo la tabla durante B0 y pidió decisión explícita antes de
que existan datos.

Alternatives:
Una sola tabla de usuarios con un discriminador (descartado por el motivo de
abajo).

Reason:
Sin esta separación, una cuenta de personal podría acabar dentro del
`ExportSnapshot` que recibe el third-party administrator. Que un empleado
aparezca en el universo de participantes de un sweepstakes no es un detalle de
modelado: es un problema de integridad del sorteo.

Affected areas: `packages/database`, `packages/sweepstakes`, `packages/tpa`.

Proposed by: backend
Agreed by: Team Lead

---

## DEC-029

Status: Accepted

Date: 2026-08-25

Decision:
**El segmento de ruta y la etiqueta de formato son cosas distintas y se
declaran por separado.**

- Segmentos de ruta: `/en` y `/es` (cortos, legibles).
- Etiquetas de formato e identificadores de diccionario: **`en-US` y `es-US`**.
- Todo formateo con `Intl` (fechas, números, moneda) usa la **etiqueta
  completa**, nunca el segmento de ruta.

Context:
DEC-021 fijó las rutas y los diccionarios sin decir que eran identificadores
distintos. `frontend` lo detectó al implementar.

Alternatives:
Usar `es` a secas para todo (**descartado**: `es` formatea `31/12/2026`,
mientras que `es-US` formatea al modo estadounidense).

Reason:
Lone Star Winners es un producto para hispanohablantes **de Estados Unidos**.
Formatear sus fechas al estilo español sería un error silencioso: nadie lo
detecta hasta que un participante se equivoca de día, y en una promoción con
fecha de cierre eso tiene consecuencias.

Affected areas: `apps/web`, `packages/ui`, cualquier salida formateada.

Proposed by: frontend
Agreed by: Team Lead

---

## DEC-030

Status: Accepted

Date: 2026-08-25

Decision:
El **contenido dinámico localizado** —títulos de promoción, nombres de premio,
descripciones de producto: datos que un administrador teclea— se almacena y se
sirve **por locale desde el backend**, como objeto `{ "en-US": …, "es-US": … }`.

No es copy de producto (que es de `frontend` por DEC-022) ni texto legalmente
controlante (que viaja aparte con sus banderas). Es una **tercera categoría**
con dueño propio: `backend` lo persiste, el admin lo edita, `frontend` lo
renderiza sin traducirlo jamás.

Ningún locale puede quedar vacío al publicar: la validación de publicación
exige ambos idiomas completos.

Context:
DEC-021 lo dejó abierto y DEC-022 no lo cerró. `frontend` señaló que el nombre
de un premio no encaja en ninguna de las dos categorías existentes.

Alternatives:
Que `frontend` lo traduzca (descartado: no puede traducir datos que aún no
existen cuando se compila). Un solo idioma con traducción automática
(descartado: viola el principio #4).

Reason:
Si un locale pudiera quedar vacío, el principio #4 se rompería en producción
justo donde más se nota: el nombre del premio.

Affected areas: `packages/database`, `apps/api`, `apps/web`, admin.

Proposed by: frontend
Agreed by: Team Lead

---

## DEC-031

Status: Accepted

Date: 2026-08-25

Decision:
En el envelope de error, **`code` es la clave canónica de traducción**.
`message_key` queda eliminado del contrato para no tener dos campos con el
mismo propósito.

Los paquetes del workspace usan el prefijo **`@lsw/*`**, y los paquetes de
frontend consumidos por Next son **source-only** (`exports` apuntando a
`./src/index.ts` más `transpilePackages`), sin paso de build intermedio.

Context:
DEC-022 dejó ambos campos en el envelope sin decir cuál era la clave de
traducción. La convención `@lsw/*` la adoptaron los tres agentes de forma
espontánea, pero no estaba escrita en ninguna decisión.

Alternatives:
Conservar los dos campos (descartado: dos nombres para lo mismo es la semilla
de que se desincronicen).

Reason:
DEC-022 ya describe `code` como el enum estable. Tener además `message_key`
solo añade ambigüedad.

Affected areas: `docs/API_CONTRACT.md`, `apps/api`, `apps/web`, todos los
manifiestos.

Proposed by: frontend
Agreed by: Team Lead

---

## DEC-032

Status: Accepted

Date: 2026-08-25

Decision:
**Lista canónica de feature flags**, en `snake_case` minúscula, todos
persistidos en base de datos (DEC-013) y **desactivados por defecto**, con una
sola excepción.

| Flag                                          | Default    | Gobierna                       |
| --------------------------------------------- | ---------- | ------------------------------ |
| `amoe_enabled`                                | `false`    | Existencia de la vía AMOE      |
| `visible_entry_numbers_enabled`               | `false`    | Rangos "mis números" visibles  |
| `internal_draw_enabled`                       | `false`    | Sorteo interno (DEC-017)       |
| `state_eligibility_enforcement_enabled`       | `false`    | Restricción por jurisdicción   |
| `age_gate_enabled`                            | `false`    | Verificación de edad mínima    |
| `entry_multipliers_enabled`                   | `false`    | Multiplicadores                |
| `entry_caps_enabled`                          | `false`    | Límites de entries             |
| `entry_expiration_enabled`                    | `false`    | Caducidad de entries (DEC-033) |
| `winner_publication_enabled`                  | `false`    | Publicación de ganadores       |
| `manual_adjustments_enabled`                  | `false`    | Ajustes manuales de admin      |
| `provisional_entries_enabled`                 | `false`    | Entries provisionales          |
| `dual_approval_for_sensitive_actions_enabled` | **`true`** | Segunda aprobación             |

Además, **`amoe_mode` es un enum, no un booleano**:
`ONLINE_FORM` \| `MAIL_IN_REVIEW` \| `CODE` \| `EXTERNAL_INSTRUCTIONS`.

Context:
Resuelve `HO-003`. Los tres agentes usaban listas y convenciones distintas:
`frontend` 6 flags en minúscula, `backend` 9 en mayúscula,
`security` 8 en minúscula. Se fusionan sin perder ninguno.

Fusiones aplicadas: `jurisdiction_gate_enabled` y
`state_eligibility_enforcement_enabled` eran el mismo flag con dos nombres;
`DUAL_APPROVAL_ADJUSTMENTS` y `dual_approval_for_sensitive_actions_enabled`
también.

Alternatives:
`SCREAMING_SNAKE_CASE` (descartado: dos de los tres agentes ya usaban
minúscula, y coincide con la convención de columnas de base de datos y de
claves JSON, que es donde estos flags viven de verdad).

Reason:
`dual_approval_for_sensitive_actions_enabled` es el único que arranca en
`true`, por el principio #12: seguridad por encima de comodidad. Un flag que
hay que acordarse de activar para estar protegido acabará desactivado.

`amoe_mode` es enum porque un booleano no permite decidir **qué interfaz
renderizar**, y las cuatro modalidades exigen pantallas distintas. Lo señaló
`frontend`; el enum coincide exactamente con el modelado de `backend`.

Affected areas: `packages/database`, `packages/security`, `apps/api`,
`apps/web`, admin.

Proposed by: Team Lead (fusionando las tres listas)
Agreed by: pendiente de objeción de los tres

---

## DEC-033

Status: Accepted

Date: 2026-08-25

Decision:
**El entry ledger se construye ahora, soportando caducidad de entries como
configuración desactivada.**

- `entry_transaction` incluye `expires_at timestamptz NULL`.
- El flag `entry_expiration_enabled` arranca en `false` (DEC-032).
- La vista de saldo se escribe desde el principio para cubrir ambos casos:

```sql
SUM(quantity_delta)
WHERE status = 'POSTED'
  AND effective_at <= <corte>
  AND (expires_at IS NULL OR expires_at > <corte>)
```

Con el flag apagado, `expires_at` es siempre `NULL` y la expresión se comporta
exactamente como una suma pura.

Context:
`HO-006` sigue sin respuesta del abogado. `backend` advirtió, con razón, que si
las Official Rules contemplan caducidad, el saldo deja de ser una suma pura y
pasa a depender de ventanas temporales, lo que cambia el diseño del ledger. Eso
bloqueaba el hito B1, que es **el núcleo del producto**.

Alternatives:
Esperar a la respuesta del abogado (**descartado**: paraliza indefinidamente lo
más importante del sistema, y la fecha de respuesta no depende de nosotros).
Construir sin caducidad y migrar después (descartado: sería una migración sobre
una tabla append-only con datos reales, justo lo que DEC-007 hace costoso a
propósito).

Reason:
Es exactamente lo que ordenan los principios #3 y #14: lo que depende de las
Official Rules se modela como **configuración**, no como código. Una columna
nullable y un predicado de más no tienen coste medible con el flag apagado.

Si el abogado dice que no hay caducidad, el flag no se enciende jamás y no se
ha perdido nada. Si dice que sí, ya está soportado. **La asimetría de riesgo es
evidente en una sola dirección.**

`HO-006` **no se cierra** con esta decisión: la respuesta sigue haciendo falta
para activar cualquier promoción (DEC-012). Lo que se desbloquea es la
construcción, no la activación.

Affected areas: `packages/database`, `packages/sweepstakes`, `packages/tpa`.

Proposed by: Team Lead (desbloqueando B1)
Agreed by: pendiente de revisión de security por afectar a DEC-007 y DEC-016

---

## DEC-034

Status: Accepted

Date: 2026-08-25

Decision:
**Enmienda a DEC-033.** Una transacción de reversal **hereda `expires_at` de la
transacción que revierte**, y el CHECK se relaja a:

```sql
CHECK (expires_at IS NULL
       OR expires_at > effective_at
       OR reverses_transaction_id IS NOT NULL)
```

Context:
Al revisar la implementación de DEC-033, `security` encontró un **defecto de
corrección real en la decisión del Team Lead**: con el flag de caducidad
encendido, revertir una entry ya caducada deja el saldo **negativo**.

- T1: `PURCHASE_EARNED` +10, `effective_at = T1`, `expires_at = T2`
- T3 > T2: refund → `REFUND_REVERSAL` −10, `effective_at = T3`, `expires_at = NULL`
- Saldo en cualquier corte posterior a T3: la original queda excluida por
  caducidad, la reversal se cuenta → **−10**

El arreglo evidente estaba bloqueado por el propio CHECK
`entry_transactions_expiry_after_effect`, que prohibía copiar `expires_at` de
la original cuando el refund llega después de la caducidad. No era una línea de
trigger: era una decisión de diseño.

Alternatives:
Excluir las reversals del predicado de caducidad (descartado: obligaría a un
join y el saldo dejaría de ser un `SUM` plano). Emitir un movimiento
compensatorio al caducar (descartado por `backend` con mejor argumento: haría
que el `ExportSnapshot` dependiera de que un job hubiera corrido antes del
corte, rompiendo DEC-016).

Reason:
Correcto en las tres ventanas —antes de caducar +10, entre caducidad y refund
0, después del refund 0— y el saldo sigue siendo una suma plana.

Cuesta cinco líneas hoy, con `expires_at` siempre `NULL` porque el flag está
apagado. Después de que existan datos costaría una migración sobre una tabla
append-only, que DEC-007 hace deliberadamente cara.

Affected areas: `packages/database`, `packages/sweepstakes`, `packages/tpa`.

Proposed by: security (revisión de DEC-033)
Agreed by: Team Lead

Nota: `security` valida dos aciertos de la implementación de `backend`. Que
`lsw_entry_balances_at()` sea **parametrizada por corte** en vez de una vista
con `now()` incrustado evita la trampa que habría roto la reproducibilidad de
DEC-016 en silencio. Y no emitir fila `EXPIRATION` es mejor que la alternativa
que el propio `security` proponía.

Dos apuntes registrados para S3 y S4: la caducidad es un cambio de saldo **sin
fila**, invisible a la hash chain de DEC-008, así que el manifiesto del
snapshot debe registrar el corte y la versión del predicado, y el informe de
reconciliación debe sacar "entries excluidas por caducidad a este corte" como
línea propia. Y la semántica de bordes (`effective_at <=` inclusivo,
`expires_at >` exclusivo, intervalo semiabierto) pertenece a
`canonicalization_version`.

---

## DEC-035

Status: Accepted

Date: 2026-08-25

Decision:
**Construcción del preimage de la hash chain (DEC-008), versión 1.**

```
"LSW/CHAIN/v1\n"
  || u8len(domain)  || domain
  || u8len(promoId) || promoId
  || u32be(version)
  || u32be(len)     || canonical
  || prevHash
```

Tres puntos que van más allá de la letra de DEC-008:

1. **Longitudes explícitas y versión dentro del preimage.** DEC-008 decía
   `canonical(payload) || prev_hash`, que describe la idea pero no una
   construcción verificable. Sin la versión dentro, quien controle la fila
   puede reetiquetarla como "v2" y presentar después una canonicalización más
   permisiva que produzca el mismo hash.
2. **El génesis no es cero.** Se deriva de `(dominio, promoción)`. Con 32
   ceros, una fila de la promoción A serviría como primera fila de la B con su
   hash intacto.
3. **`sequence_no` queda fuera del payload**, por imposibilidad y no por
   gusto: es `GENERATED ALWAYS AS IDENTITY`, la base de datos lo asigna
   _durante_ el INSERT, y el hash debe existir _antes_ porque la tabla es
   append-only (DEC-007). Queda protegido por la **topología** de la cadena —el
   verificador recorre en ese orden y exige el encadenamiento— no por el
   contenido.

La forma canónica es **RFC 8785 (JCS)** más tres restricciones: `undefined`,
`bigint`, `Date`, `Map` y `Buffer` producen error en vez de omisión silenciosa;
solo enteros seguros, coma flotante rechazada (DEC-010), enteros grandes como
cadena de dígitos; y **NFC sobre cadenas y claves**, única desviación de RFC
8785 y necesaria porque el mismo nombre tecleado en macOS (NFD) y en Windows
(NFC) daría dos hashes distintos.

**Requisito sobre el camino de escritura:** `recorded_at` entra en el payload y
tiene `DEFAULT now()`. Quien inserte **debe pasarlo explícitamente** y usar ese
mismo valor al calcular el hash. Dejar actuar al `DEFAULT` hace que el hash
cubra un instante y la fila guarde otro: **la cadena nace rota**.

Context:
Al implementar DEC-008, `security` encontró que la fórmula era insuficiente
como especificación verificable por un tercero.

Alternatives:
Concatenación simple sin longitudes (descartado: permite ambigüedad de
frontera entre campos). Génesis de ceros (descartado por el motivo 2).

Reason:
Que un tercero pueda verificar la cadena con una librería estándar y sin
nuestro código es el objetivo entero de DEC-008. Una fórmula que no fija la
construcción byte a byte no lo permite.

Nota sobre el orden de columnas: la pregunta que planteó `HO-009` —si el orden
del DDL era definitivo— **resultó ser la equivocada**. La forma canónica ordena
las claves alfabéticamente, así que el orden físico es invisible al hash. Lo
que se fija es el **conjunto** de campos: 21 incluidos y 4 excluidos, con un
test de paridad que lee el DDL y exige que la suma cubra la tabla. Una columna
nueva rompe ese gate el mismo día, forzando una decisión explícita sobre si el
hash debe protegerla.

Affected areas: `packages/audit`, `packages/database`, `packages/tpa`.

Proposed by: security
Agreed by: Team Lead

---

## DEC-036

Status: Accepted

Date: 2026-08-25

Decision:
**El paquete de exportación separa manifiesto de contenido y procedencia.**

- **Manifiesto de contenido** — sin marcas de generación. Es lo que se hashea y
  se firma, y produce el `contentDigest`.
- **Procedencia** — quién generó el export, cuándo, con qué clave y con qué
  versión del generador. Queda **fuera** del digest.

Context:
DEC-016 exigía dos cosas a la vez que no caben juntas: (a) que `generated_at`
viviera solo en el manifiesto y no en las filas de datos, y (b) que regenerar
el snapshot produjera **bytes idénticos**. Si el manifiesto se hashea, cualquier
marca temporal dentro rompe (b).

`security` lo detectó al implementar DEC-016 y no eligió una de las dos por su
cuenta.

Alternatives:
Sacar `generated_at` del manifiesto (descartado: la procedencia es parte del
expediente de auditoría y debe conservarse). Renunciar a la reproducibilidad
byte a byte (descartado: es el fundamento del principio #10).

Reason:
La contradicción era real y sin resolverla DEC-016 no era implementable. La
separación conserva las dos propiedades: el contenido es reproducible y
verificable por un tercero, y la procedencia queda registrada sin contaminar
el digest.

Affected areas: `packages/tpa`, `packages/audit`.

Proposed by: security
Agreed by: Team Lead

---

## DEC-037

Status: Accepted

Date: 2026-08-25

Decision:
**Sin sello externo, el veredicto de integridad nunca es `INTACT`.** Es
`UNSEALED`, un estado propio.

El informe de reconciliación emite **siempre** la línea "entries excluidas por
caducidad a este corte", con código propio: `INFO` cuando vale cero, `WARNING`
en cuanto aparta algo. **No bloquea** finalizar el snapshot.

Context:
La hash chain detecta alteración de filas, borrado, reordenación e injerto
desde otra promoción. **No detecta una reescritura completa y coherente**: un
atacante con acceso total a la base de datos puede recalcular la cadena entera
y `verifyChain` la aprueba. El test lo afirma explícitamente en vez de
disimularlo. Solo el sello externo lo detecta, como `HISTORY_REWRITTEN`.

Por otro lado, la caducidad de DEC-034 es un cambio de saldo **sin fila**, y
por tanto invisible a la cadena: un tercero la verá íntegra y no encontrará
nada que explique la caída del saldo.

Alternatives:
Devolver `INTACT` sin sello (**descartado**: un verde ahí invita a no montar
nunca el almacén write-once, y entonces la única defensa contra la reescritura
completa deja de existir). Emitir la línea de caducidad solo cuando aparte algo
(descartado: su ausencia sería indistinguible de que no se comprobó).
Bloquear la finalización cuando hay caducadas (descartado: excluirlas es el
comportamiento correcto, y un gate que se dispara al hacer lo correcto acaba
desactivado).

Reason:
El sistema debe declarar sus propios límites. Un estado `UNSEALED` explícito
dice la verdad: la cadena es consistente consigo misma, y eso no basta.

Affected areas: `packages/audit`, `packages/tpa`, infraestructura.

Proposed by: security
Agreed by: Team Lead

---

## DEC-038

Status: Accepted

Date: 2026-08-25

Decision:
**Rebrand visual completo a la identidad del logo: negro + dorado, dark-first.**

- La paleta del design system pasa a la del logo (`Logo/logo.jpeg`): negros
  profundos como superficie, dorado como acento, un solo tema oscuro.
- Tipografía bold de alto impacto, titulares en mayúsculas, al estilo de la
  referencia aportada por el usuario (lgndsupplyco.com).
- **Queda superseded la nota de los tokens que prohibía el oro.** Esa
  prohibición protegía contra la estética de casino; la protección real nunca
  fue el color sino el **lenguaje**, y esa parte se mantiene íntegra (ver
  abajo).
- El logo se incorpora en cabecera, pie y favicon.

**Límite vinculante — "look LGND, copy legal":** se adopta la energía visual de
la referencia (hero a pantalla completa con el premio, cuenta atrás dramática,
badges dorados, secciones de gran impacto) pero **no su encuadre comercial**.
Siguen prohibidos: multiplicadores o cifras de entries en las tarjetas del
catálogo (el contrato no las expone), CTAs que vendan la compra como
participación ("ENTER NOW" sobre un producto), y cualquier copy que describa
la compra como boletos u oportunidades de ganar (`CLAUDE.md` §1). Las cifras
de participaciones siguen apareciendo solo donde las produce el backend: el
carrito.

Imágenes: fotografía placeholder generada por IA cuando haya créditos
disponibles; hasta entonces, dirección de arte SVG premium coherente con la
identidad. Ambas marcadas como provisionales.

Context:
Decisión del usuario (2026-08-25), con referencia visual explícita
(lgndsupplyco.com) y logo entregado en `Logo/logo.jpeg`. Las tres preguntas de
alcance se respondieron: rebrand total, look LGND con copy legal, fotos
generadas.

Alternatives:
Híbrido hero oscuro / tienda clara (descartado por el usuario). Mantener
paleta actual (descartado por el usuario). Réplica total de LGND incluyendo
multiplicadores por producto (descartada: exigía cambiar contrato y flags y
acercaba el copy al límite legal).

Reason:
El logo es negro y oro; la referencia es dark-first. La coherencia de marca lo
decide. La separación look/copy permite adoptar la fuerza visual sin heredar el
riesgo de compliance que `security` ya señaló sobre el lenguaje del checkout.

Affected areas: `packages/design-system`, `packages/ui`, `apps/web`.

Proposed by: usuario
Agreed by: Team Lead; el copy sigue sujeto a la revisión de compliance de
`security` antes de INTEGRATE

---

## DEC-039

Status: Accepted

Date: 2026-08-25

Decision:
**Enmienda a DEC-038: las secciones de mercancía van sobre banda CLARA.**

El usuario, viendo la captura móvil real de LGND, señaló que la sección de
productos sobre fondo blanco "lo hace ver limpio" y que la disposición móvil
(grid de 2 columnas, tarjetas con imagen dominante, chip arriba-izquierda,
botón "+" abajo-derecha, nombre bold debajo) es lo que busca.

- El grid del catálogo (`/shop`) y la franja de mercancía destacada de la
  portada pasan a **banda clara** (blanco cálido), con tinta oscura para
  texto y el oro como acento.
- El resto del sitio (cabecera, hero, marcador, banda del premio, pie)
  sigue oscuro. El resultado es exactamente la estructura real de LGND:
  bandas oscuras de promoción + secciones de producto claras.
- Grid móvil de **2 columnas desde 360px** con gutters estrechos.
- Los tokens de banda clara viven en el design system, no hardcodeados.

Context:
DEC-038 fijó dark-first total. Esta enmienda no la revierte: ajusta las
secciones de mercancía al patrón que el usuario aprobó con captura en mano.
La opción "híbrido" se le ofreció al inicio y la descartó; al ver el
resultado y la referencia real, la eligió para la mercancía. Su criterio
visual manda (DEC-038 lo establece).

Alternatives:
Mantener el grid oscuro (descartado por el usuario con referencia visual).

Reason:
En LGND real las tarjetas de producto viven sobre blanco y es lo que produce
la sensación "limpia" que el usuario quiere. El contraste banda oscura ↔
banda clara además hace que ambas golpeen más.

Affected areas: `packages/design-system`, `apps/web` (shop, franja destacada).

Proposed by: usuario (con captura de referencia)
Agreed by: Team Lead

---

## DEC-040

Status: Accepted

Date: 2026-08-25

Decision:
**Ampliación del alcance de DEC-039.** La banda clara y el estudio claro de
imágenes se extienden a:

- la **galería de la ficha de producto** (`/products/[slug]`), como panel
  claro dentro de una página que por lo demás sigue oscura;
- la **miniatura de línea del carrito**, con marco claro;
- el **módulo de media entero**: el estudio de los placeholders pasa a fondo
  claro para todo el sitio, no solo para las dos secciones de DEC-039.

El resto de DEC-039 no cambia: cabecera, hero, marcador, banda del premio y
pie siguen oscuros.

Context:
La revisión adversarial de cumplimiento detectó que la implementación de
DEC-039 tocaba tres sitios que su "Affected areas" no cubría, y que la
justificación vivía en un comentario del código
(`products/[slug]/page.tsx`) en vez de en este registro. Es el orden inverso
al protocolo de `CLAUDE.md` §3: se implementó y se documentó después.

Alternatives:
Revertir esos tres cambios para ceñirse a la letra de DEC-039 (descartado: la
extensión es coherente — un producto fotografiado sobre estudio claro en la
tienda y sobre estudio oscuro en su ficha sería la incoherencia real, y la
miniatura del carrito debe coincidir con la tarjeta de la que viene).

Reason:
La decisión es correcta; lo que faltaba era registrarla. Este DEC la hace
oficial y deja constancia de cómo se detectó, para que el patrón no se
repita: **cualquier extensión de alcance durante la implementación se
registra aquí antes de commitear, no en un comentario.**

Affected areas: `apps/web` (ficha de producto, carrito), `packages/ui`
(`MediaFrame`), módulo de media.

Proposed by: frontend (por criterio propio durante DEC-039)
Agreed by: Team Lead, tras el hallazgo B1 del revisor de cumplimiento

---

## DEC-041

Status: Accepted

Date: 2026-08-25

Decision:
Tres cambios estructurales en el design system, salidos de la corrección de
los hallazgos de la auditoría adversarial de DEC-039:

1. **`Badge` gana un eje `surface: dark | light`.** Cada tono tiene su
   combinación clara, y una unión de tipos impide `surface="light"` con
   tonos de estado que no existen en paleta clara. El relleno sólido claro es
   de tinta, espejo exacto del oscuro.
2. **La geometría del patrón topográfico vive una sola vez**, en
   `packages/design-system/tailwind-preset.mjs` (`TOPO_PATHS` +
   `topoPattern()`); un plugin `addBase` emite los cuatro tokens en `:root`.
   `tokens.css` conserva la prosa de diseño y apunta al preset. El CSS
   compilado sale byte a byte igual que las cadenas a mano (verificado).
3. **`--lsw-color-light-border-strong` pasa de `#c7bfb0` a `#938d82`**:
   de 1.72:1 a **3.11:1** sobre la banda clara y 3.30:1 sobre blanco. Es el
   token de los contornos que identifican un control; `light-border` sigue
   tenue a propósito para la separación de tarjetas.

Además, `ProductCard` solo se renderiza desde `MerchandiseBand`, que pinta la
banda clara siempre; una red DOM y otra estática lo garantizan.

Context:
La auditoría adversarial de DEC-039 (tres revisores independientes: cumplimiento,
accesibilidad, fidelidad) encontró cuatro bloqueantes que los cinco gates en
verde no detectaban: chips con paleta oscura sobre tarjeta blanca en el estado
por defecto, chip truncado en todos los anchos, anillo de foco a 1.35:1 y texto
seleccionado a 1.15:1. Más una veintena de menores. Los tres cambios de arriba
son los que alteran el sistema, no solo el sitio de uso.

Alternatives:
Arreglar cada chip en su sitio de uso (descartado: el fallo se repetiría en el
siguiente componente que usara `Badge` sobre claro). Mantener tres copias del
SVG topográfico con un comentario que las vincule (descartado: ya habían
divergido).

Reason:
Los cuatro bloqueantes compartían una causa: las capas que el sistema y el
navegador pintan por encima (foco, selección, badges por defecto) venían
calibradas para negro y ninguna red las miraba. Los arreglos van al sistema y
llevan red propia, para que el siguiente componente sobre banda clara no
repita el fallo.

Affected areas: `packages/design-system`, `packages/ui`, `apps/web`.

Proposed by: frontend (corrección de hallazgos)
Agreed by: Team Lead

---

## DEC-042

Status: Accepted

Date: 2026-08-26

Decision:
**Nueva promoción destacada: una camioneta GMC 2025, con un universo total de
10,000 participaciones.** Y un segundo acento de color, **rojo**, para
llamadas a la acción y textos de atención, junto al oro de marca.

- La promoción entra como fixture **provisional** y protagoniza el hero al
  estilo de la referencia (foto de la camioneta a sangre, titular gigante,
  CTA rojo, línea de disclaimer debajo del botón).
- El tope de 10,000 participaciones es **configuración de la promoción**
  (`entry_pool_cap`), no texto fijo. Se muestra como dato de las Reglas
  Oficiales; cualquier cifra de "emitidas" o "restantes" la produce el
  backend, nunca el frontend.
- El rojo es un token semántico nuevo (`accent` / "hot"), distinto de
  `danger`. Se usa en: CTA principal del hero, botones de compra, fragmentos
  destacados del titular, barra de progreso y flechas de la barra de anuncio.
  El oro sigue siendo la marca.
- La palabra es **promoción**, nunca "rifa", "boletos" ni "sorteo de
  boletos" (`CLAUDE.md` §1). El CTA rojo principal lleva a la mercancía
  ("Comprar ahora"), no a "participar": comprar mercancía no es participar.
- La línea "_No se requiere compra — Nulo donde esté prohibido — Ver Reglas
  Oficiales_" **es data-driven**: solo se renderiza cuando `amoe_enabled` y
  la configuración lo respaldan; si no, la línea es "Sujeto a las Reglas
  Oficiales".

Context:
Dirección del usuario (2026-08-26) con dos capturas del hero de LGND
("WIN THIS 682HP ESCALADE V", botón rojo "ENTER NOW", disclaimer debajo,
barra de anuncio "ENTER NOW TO WIN…"). El usuario usó la palabra "rifa" de
forma coloquial; el producto sigue siendo lo que define la constitución.

Alternatives:
Hardcodear el tope (descartado: principio #14). Copiar "ENTER NOW" como CTA
sobre la tienda (descartado: encuadra la compra como participación, DEC-038).

Reason:
El tope de participaciones es un parámetro que fijan las Reglas Oficiales
(`docs/LEGAL_PENDING.md`, "Entry limits"); mostrarlo como dato configurado es
legítimo, inventar urgencia sobre él no. El rojo es puro énfasis visual y no
toca el lenguaje.

Affected areas: `packages/design-system` (token `accent`), `packages/ui`
(variantes rojas de `Button`/`Badge`), `apps/web` (hero, fixtures, barra de
anuncio, ficha de producto).

Proposed by: usuario
Agreed by: Team Lead; el tope de 10,000 queda anotado en LEGAL_PENDING
