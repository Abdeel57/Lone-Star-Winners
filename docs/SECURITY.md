# SECURITY.md

Controles de seguridad de **Lone Star Winners**.

Propietario: agente `security-integration` (DEC-024).
Estado: **hito S1** — linea base de seguridad y quality gates.

Este documento describe lo que el repositorio **hace hoy**, no lo que se
pretende hacer algun dia. Lo pendiente esta en la seccion "Gates pendientes",
con el motivo por el que todavia no existe. Un documento de seguridad que
describe controles inexistentes es peor que no tenerlo: da cobertura donde no
la hay.

Este documento **no da consejo legal**. Las Official Rules las fija el abogado
del cliente; lo no resuelto vive en `docs/LEGAL_PENDING.md` (DEC-019).

---

## 1. Que protege este sistema

Por orden de dano si se pierde:

1. **La integridad del universo de entries.** Si alguien puede anadir,
   borrar o reescribir entries sin dejar rastro, el sorteo deja de ser
   defendible, independientemente de lo bien que funcione el resto.
2. **La evidencia.** El ledger, la auditoria y los snapshots son lo que un
   tercero examinaria. Deben poder demostrar que el pasado no se reescribio.
3. **Los datos personales de los participantes.** Nombre, correo, direccion y,
   si mas adelante se exigen, documentos de verificacion del ganador.
4. **El dinero.** Pedidos, pagos, refunds y chargebacks.
5. **La disponibilidad**, en el ultimo lugar de la lista a proposito: un
   sistema caido es un problema; un sistema que reparte entries que nadie puede
   justificar es un problema distinto y peor.

---

## 2. Principios de diseno

- **Los controles viven donde no dependen de la disciplina de nadie.** El
  ledger es append-only por permisos de base de datos y triggers (DEC-007), no
  por convencion. La aleatoriedad debil esta prohibida por regla de lint y por
  test (DEC-017), no por acuerdo verbal.
- **Fallar en cerrado.** Un feature flag no consultado deniega. Un
  administrador externo sin configurar se niega a entregar. Un hook sin
  `gitleaks` instalado aborta el commit.
- **Deny-by-default.** Lo que no esta concedido explicitamente, no se puede.
  No existe un rol "puede todo".
- **Separacion de funciones.** Quien declara correcto el universo de entries no
  es quien sortea sobre el ni quien se lo lleva.
- **Minimizacion.** Se exporta lo que el administrador externo exige, no todo
  lo que hay. Se ve el PII completo cuando la tarea lo requiere, no por defecto.
- **El software no decide lo que es legal.** Lo hace configurable, versionado y
  auditable, y bloquea la activacion mientras falte una decision (DEC-012).

---

## 3. Controles implementados en S1

### 3.1 Gates de CI (bloqueantes)

`.github/workflows/ci.yml`

```text
format       prettier --check sobre todo el repositorio
lint         ESLint type-aware (raiz + por workspace)
typecheck    tsc --noEmit en modo strict
test         turbo run test (incluye tests/security)
integration  PostgreSQL 16 REAL como `services:` del job. Ejecuta
             `packages/database/test/integration/**`: GRANT por columna,
             triggers, columnas GENERATED, EXCLUDE USING gist y el ledger
             append-only, contra el motor y no contra un doble.
e2e          navegador -> apps/web -> apps/api -> PostgreSQL 16. Migraciones,
             escenario sembrado, `WEB_ENABLE_API_MOCKS=false`.
ci-gates     puerta unica para la proteccion de rama
```

Sobre `integration`: `packages/database/src/testing/postgres-container.ts` elige
via segun `TEST_DATABASE_URL`. Sin declarar, sigue usando Testcontainers y
Docker, igual que siempre; declarada, usa la instancia externa del servicio de
CI y crea una base de datos virgen por fichero de test. Las migraciones, los
tres roles de DEC-003 y las contrasenas efimeras son identicos por los dos
caminos. **Es la via que permite ejecutar en CI lo que la maquina de desarrollo
no puede: ahi no hay Docker (HO-015).**

`.github/workflows/security.yml`

```text
repo-hygiene       .env trackeado, material criptografico, secretos con
                   pinta de reales en .env.example, NEXT_PUBLIC_ sospechosas,
                   finales de linea CRLF en el indice
secret-scan        gitleaks sobre el historial COMPLETO
dependency-audit   osv-scanner (se salta mientras no exista lockfile)
security-gates     puerta unica para la proteccion de rama
```

Recomendacion de configuracion del repositorio: exigir en `main` solo los dos
checks agregados (`CI gates` y `Security gates`). Asi se anaden gates nuevos sin
reconfigurar la proteccion de rama cada vez.

### 3.2 Hook de pre-commit

`lefthook.yml`, con `.gitleaks.toml`. Cubre secretos en lo que se va a
commitear, ficheros que nunca deben versionarse y formato.

Todavia requiere activacion manual:

```text
pnpm dlx lefthook install
```

Ver handoff HO-008: hasta que `lefthook` sea devDependency de la raiz y
`prepare` ejecute `lefthook install`, los hooks no se instalan solos al clonar.
Mientras tanto, **CI es la unica red garantizada**.

### 3.3 Registro de permisos

`packages/security`: roles, capacidades, matriz rol x capacidad, separacion de
funciones y decision de autorizacion, todo como datos. Ver seccion 5.

### 3.4 Esquema de entorno

`packages/security/src/env`: declaracion de cada variable, su tipo, si es
secreta, en que entornos es obligatoria y que endurecimiento exige en
produccion. `assertEnv` lanza; no existe modo "avisa y sigue" (DEC-018).

### 3.5 Tests de invariante

`tests/security` contiene los que **pueden ejecutarse hoy**, sin base de datos:

```text
internal-draw-disabled   el sorteo interno no aparece activado en ningun
                         sitio del repositorio, ni existe variable de entorno
                         capaz de activarlo (DEC-017, cerrojo 1)
weak-randomness          ningun paquete critico usa Math.random(), PRNG
                         sembrado ni timestamp como semilla; y la regla de
                         ESLint que lo prohibe sigue en su sitio
env-registry             .env.example y el registro de entorno coinciden; la
                         configuracion de desarrollo NO seria valida en
                         produccion
authorization-matrix     deny-by-default, separacion de funciones, step-up,
                         motivo obligatorio y segunda aprobacion
unconfigured-adapter     sin administrador externo configurado no se entrega
                         nada, y no se simula que si
```

Los tests de invariante escanean el repositorio entero, no solo el codigo
propio. Una invariante que solo se comprueba sobre el modulo que la implementa
no detecta al que la ignora.

---

## 4. Gates pendientes

De la lista de DEC-018, esto **todavia no esta** y este es el motivo. Ninguno
se ha omitido en silencio.

### 4.1 Gates que ACABAN DE EXISTIR (HO-030)

Dejan esta lista y pasan a la seccion 3.1. Se anotan aqui para que quede el
rastro de cuando y por que dejaron de faltar.

```text
Testcontainers +          RESUELTO por otra via. No hacia falta Docker: hacia
PostgreSQL real           falta un PostgreSQL real, y `services: postgres:16`
                          de GitHub Actions lo da sin Docker-in-Docker. El
                          helper elige via segun `TEST_DATABASE_URL` y el
                          camino local con Docker no cambia.

Invariantes de base de    idem: corren en el mismo job `integration`. Son las
datos sobre migraciones   ~100 pruebas que llevaban meses escritas y sin
                          ejecutar (HO-015). ATENCION: "existe el gate" no es
                          "las pruebas pasan". Nunca se han ejecutado; su
                          primera ejecucion verde sera tambien la primera.

Playwright                `tests/e2e`, job `e2e`. Recorre alta y acceso de
                          participante, catalogo, carrito, cotizacion, el 503
                          del checkout sin proveedor de pago, el portal,
                          la configuracion AMOE, el segundo factor de personal
                          y la cola de revision. Ver `tests/e2e/README.md`.
```

### 4.2 Gates que siguen faltando

```text
semgrep / CodeQL          ya hay codigo que analizar: el motivo original
                          ("repositorio casi vacio") ha caducado. Queda como
                          trabajo pendiente, no como imposibilidad.

Matriz de autorizacion    la mitad estatica ya existe en tests/security. Falta
rol x endpoint            la parte que recorre las rutas reales de apps/api y
                          las contrasta con docs/API_CONTRACT.md (DEC-015).
                          El e2e cubre HOY un puñado de rutas, no la matriz.

axe / accesibilidad       el e2e ya arranca un navegador, asi que el obstaculo
                          desaparece en cuanto se anada `@axe-core/playwright`.
                          Es otra dependencia nueva, y una dependencia nueva
                          obliga a rehacer el lockfile: se deja para su propio
                          cambio.

Cobertura minima          90 % en audit, ledger y export; 70 % global. Sigue
                          sin fijarse: con el `integration` recien encendido,
                          el numero mediria cobertura de codigo NO EJECUTADO
                          hasta hoy, y no seria comparable con nada.

Reproducibilidad de       depende del generador de snapshots. El job
snapshot (doble           `integration` es su prerrequisito y ya existe; el
generacion, mismo hash)   gate en si, no. Es el que hace verificable DEC-016.

Cabeceras de seguridad    NO EXISTEN en `apps/web`: `next.config.mjs` no
del escaparate            define `headers()` y `middleware.ts` solo redirige.
                          Sin CSP, sin HSTS, sin `X-Content-Type-Options`, en
                          ningun entorno. `apps/api` SI las emite (helmet).
                          La prueba esta escrita en
                          `tests/e2e/specs/01-security-headers.spec.mjs`,
                          marcada `test.fixme` con su motivo: afirma lo
                          correcto y se enciende sola cuando el escaparate las
                          emita. Es un handoff a `frontend`.

Renovate                  requiere configuracion a nivel de repositorio en
                          GitHub, no solo un fichero.

Firma de commits          decision de organizacion, no de repositorio.
```

### 4.3 Requisito de un solo comando antes de que estos gates corran

`tests/e2e` es un workspace NUEVO y declara `@playwright/test`, que no esta en
`pnpm-lock.yaml`. Hasta que alguien ejecute **una vez** `pnpm install` en la
raiz, el paso de instalacion de **todos** los jobs falla con
`ERR_PNPM_OUTDATED_LOCKFILE`.

Es deliberado que falle asi. La alternativa -relajar `--frozen-lockfile`-
convertiria un control de cadena de suministro en un adorno, y lo haria en el
mismo fichero que declara que un gate saltable no es un gate.

---

## 5. Autenticacion y autorizacion

### 5.1 Identidad (DEC-006)

Un unico sistema para participantes y personal. Sesiones opacas y revocables en
cookie `httpOnly`, `Secure`, `SameSite=Lax` (`Strict` en el scope admin), con
tabla `Session` detras. Sin JWT auto-contenido y sin tokens en `localStorage`.
Argon2id para contrasenas. MFA/TOTP obligatorio en todo rol administrativo.

**Step-up authentication** (re-auth con MFA reciente, ventana maxima de 5
minutos) para: descarga de export, finalizacion de snapshot, inicio de sorteo,
cambio de rol, cambio de flag legalmente material y ajuste manual. El tope de
300 segundos es duro: configurar una ventana mayor no la amplia.

### 5.2 Roles

```text
PARTICIPANT         solo sus propios datos
SUPPORT             lectura con PII enmascarado; no ajusta, no exporta
PROMOTION_MANAGER   promociones, catalogo, reglas; PROPONE ajustes
COMPLIANCE_OFFICER  auditoria, aprobacion, finalizacion, autorizacion de sorteo
DRAW_OFFICER        unico que inicia un sorteo; no finaliza el snapshot
EXPORT_OFFICER      descarga y entrega al administrador externo
SECURITY_ADMIN      cuentas, roles y sesiones; sin capacidades operativas
SYSTEM              jobs y webhooks; nunca se asigna a una persona
```

Las ausencias son tan deliberadas como las presencias. Que `SECURITY_ADMIN` no
tenga `pii.view.full` ni `export.download` no es un olvido: administrar la
identidad y operar la promocion son trabajos distintos.

### 5.3 Separacion de funciones

```text
export.finalize        x  draw.initiate        DEC-017
entry.adjust.create    x  entry.adjust.approve DEC-007
export.finalize        x  export.deliver       DEC-016
```

Se comprueba al asignar roles **y** otra vez al autorizar. Si solo se
comprobara al asignar, bastaria un rol anadido a mano en base de datos para
anular el control.

### 5.4 Como se autoriza una peticion

`authorize()` en `packages/security` responde en este orden: capacidad
concedida, separacion de funciones, feature flag, step-up, motivo, segunda
aprobacion. Todos los campos del contexto son obligatorios: un contexto con
valores por defecto invita a olvidar uno, y el olvido se traduciria en
permitir. Aqui el olvido no compila.

---

## 6. Gestion de secretos

- Nunca en el repositorio: contrasenas, secretos de produccion, API keys,
  claves privadas, credenciales de pago, tokens (CLAUDE.md seccion 8).
- `.env.example` es **publico y versionado**, y todos sus valores son falsos.
  No esta excluido del escaneo a proposito: es el fichero con mas probabilidad
  de recibir un secreto real por error, precisamente porque parece inofensivo.
- Toda variable nueva se declara ademas en el registro de entorno. El gate de
  CI compara ambas listas.
- La clave privada de firma de exports (DEC-016) **no vive en el `.env`**: solo
  se referencia su localizacion, y en produccion la sirve el gestor de secretos.

**Si un secreto real llega a commitearse:** se rota primero y se limpia el
historial despues, nunca al reves. Un secreto en un commit borrado sigue en el
repositorio de quien ya lo clono, en los caches de CI y en los forks.

---

## 7. Severidades y excepciones

```text
CRITICA  permite conceder, borrar o alterar entries sin rastro; permite
         acceder al export o a la identidad de un ganador; permite escalar a
         un rol administrativo. Bloquea el despliegue.
ALTA     expone PII, permite eludir un control de autorizacion o de
         idempotencia. Bloquea la release.
MEDIA    debilita defensa en profundidad sin explotacion directa.
BAJA     endurecimiento recomendable.
```

Aceptar un riesgo **no** se hace anadiendo `continue-on-error` a un gate. Se
hace con una entrada en `docs/DECISIONS.md` que diga que se acepta, quien lo
acepta y hasta cuando. Un gate que se puede saltar no es un gate.

---

## 8. Ejecutar los gates en local

```text
pnpm run format:check          formato
pnpm run lint:root             ESLint type-aware
pnpm run typecheck             TypeScript strict
pnpm run test                  tests, incluidos los de invariante
pnpm dlx lefthook install      activar los hooks de Git (una vez)
gitleaks detect --config .gitleaks.toml --redact
```

---

## 9. Que hacer ante un incidente

Version corta mientras `docs/runbooks/` se completa en el hito S2:

1. Contener: revocar sesiones afectadas, rotar credenciales, no borrar nada.
2. Preservar evidencia: la traza de auditoria y el ledger son append-only por
   diseno; no se "limpian" durante un incidente.
3. Evaluar el alcance sobre el universo de entries antes que sobre cualquier
   otra cosa.
4. Escalar al cliente. Si el incidente puede haber afectado a la seleccion de
   un ganador o a datos de participantes, la decision sobre notificacion es del
   cliente y su abogado, no del equipo tecnico.
