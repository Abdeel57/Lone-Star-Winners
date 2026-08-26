# Despliegue en Railway

Registro operativo de DEC-043. Railway aloja los tres componentes —`apps/web`,
`apps/api` y PostgreSQL— dentro de un mismo proyecto, comunicados por su red
privada.

> **Alcance de lo que se publica.** Hoy existen catálogo, promociones, Reglas
> Oficiales y carrito. **No** hay identidad, checkout, pago, AMOE, sorteo ni
> export, y los dieciséis puntos de `docs/LEGAL_PENDING.md` siguen en `TBD`.
> Ninguna página puede presentar una promoción como vigente hasta que existan
> Official Rules aprobadas por el abogado del cliente.

---

## Antes de empezar

- El repositorio debe estar subido a GitHub (Railway despliega desde el repo).
- Una cuenta en [railway.com](https://railway.com).
- Node instalado en tu máquina, solo para generar los secretos del paso 5.

No hace falta Docker, ni la CLI de Railway, ni tocar ningún archivo.

---

## Los 7 pasos

### 1. Proyecto vacío

En Railway: **New Project → Empty Project**.

Se empieza vacío a propósito. Si eliges "Deploy from GitHub repo", Railway
detecta el monorepo pnpm e intenta crear un servicio por paquete desplegable,
incluidos los que no son servicios. Sale más barato crear los dos que
queremos.

### 2. PostgreSQL

**+ New → Database → PostgreSQL**.

Déjalo con su nombre por defecto, **`Postgres`**. Las variables del paso 5 lo
referencian por ese nombre.

### 3. Servicio `api`

**+ New → GitHub Repo →** selecciona el repositorio.

Luego, en **Settings** del servicio:

| Campo                      | Valor                   |
| -------------------------- | ----------------------- |
| Service Name               | `api`                   |
| Config-as-code (file path) | `apps/api/railway.json` |

La ruta del archivo de configuración es **absoluta desde la raíz del repo** y
no sigue al Root Directory: es una particularidad de Railway, no un descuido.
No pongas Root Directory: el build necesita la raíz del monorepo.

### 4. Servicio `web`

**+ New → GitHub Repo →** el **mismo** repositorio otra vez.

| Campo                      | Valor                   |
| -------------------------- | ----------------------- |
| Service Name               | `web`                   |
| Config-as-code (file path) | `apps/web/railway.json` |

### 5. Variables

En tu máquina:

```bash
node scripts/railway-env.mjs
```

Imprime dos bloques con los secretos ya generados. En Railway, para cada
servicio: **Variables → Raw Editor →** pegar el bloque correspondiente.

Los `${{...}}` son referencias de Railway y **se pegan tal cual**: Railway los
resuelve al desplegar. No los sustituyas a mano.

La salida contiene secretos reales. No la pegues en un chat, un issue ni un
commit.

### 6. Dominios

En **Settings → Networking → Generate Domain**, para **ambos** servicios.

- `web` lo necesita porque es la web pública.
- `api` lo necesita porque su esquema de entorno exige un `API_PUBLIC_URL`
  sobre HTTPS, y además te deja consultar `/api/v1/health/ready` para
  diagnosticar. El navegador nunca lo usa: `web` habla con `api` por la red
  privada.

### 7. Desplegar

**Deploy** en `api`, y cuando termine, en `web`. Ese orden importa solo la
primera vez: `api` es quien crea el esquema de la base de datos.

---

## Qué ocurre en cada despliegue de `api`

Antes de arrancar el proceso, Railway ejecuta `preDeployCommand`:

```
pnpm --filter @lsw/database run db:bootstrap
```

Que hace dos cosas, ambas idempotentes:

1. Aplica las migraciones pendientes con el superusuario del proveedor.
2. Asigna a `lsw_migrator`, `lsw_app` y `lsw_readonly_report` las contraseñas
   que llegan por variables de entorno.

Existe porque en una base recién creada hay un arranque en frío circular: el
rol `lsw_migrator` lo crea la migración `0000_baseline.sql`, y se crea **sin
contraseña** a propósito —una contraseña dentro de una migración sería una
contraseña versionada—. El único credencial que existe el minuto cero es el
superusuario que crea Railway.

Si el bootstrap falla, el despliegue se detiene y **no se promociona la
versión nueva**: la anterior sigue sirviendo.

---

## Comprobar que salió bien

```bash
curl -i https://<dominio-de-web>/healthz          # {"status":"ok"}
curl -i https://<dominio-de-api>/api/v1/health/ready
```

`/api/v1/health/ready` devuelve `503` si la base de datos no responde. Es el
healthcheck que usa Railway, así que un despliegue que no consiga hablar con
PostgreSQL falla de forma visible en vez de servir páginas de error.

---

## Decisiones que hay detrás, y sus trampas

Están todas en DEC-043. Resumen de las que muerden si se cambian sin pensar:

**`API_HOST=::` y no `0.0.0.0`.** La red privada de Railway es IPv6. Un
proceso que solo escuche en IPv4 es invisible dentro de ella, y `web` no
podría llamar a `api` aunque ambos estén sanos. Escuchar en `::` da doble pila
y sirve para los dos caminos.

**`PORT=8080` fijado a mano en `api`.** Railway asigna un `PORT` solo si no lo
defines tú. Aquí se define porque `${{api.RAILWAY_PRIVATE_DOMAIN}}` necesita
un puerto conocido: la referencia `${{api.PORT}}` **no** resuelve al puerto que
el servicio esté escuchando en tiempo de ejecución, solo a una variable puesta
a mano.

**`DATABASE_NETWORK=private` con `DATABASE_SSL_MODE=disable`.** Es la única
concesión de seguridad del despliegue, y está documentada como tal. Railway
emite certificados autofirmados, así que `verify-full` es inalcanzable contra
su Postgres gestionado. Se rechazó `require` a propósito: cifra sin verificar,
no protege de un intermediario y encima aparenta que sí. Lo que se sustituye
es una garantía criptográfica por una topológica, y solo se sostiene mientras
la base **no** tenga un endpoint público. El valor por defecto del esquema
sigue siendo `public` → `verify-full`.

> **Si algún día generas un dominio público para el servicio `Postgres`, esta
> decisión deja de ser válida.** Hoy no hay ningún control automático que lo
> detecte. Está anotado en `docs/AGENT_HANDOFF.md` (HO-022) para revisión de
> `security`.

**Las migraciones las aplica el superusuario.** DEC-003 pedía separar
`migrator` del propietario del esquema; Railway no cede la propiedad de
`public`. Lo que sí se conserva es la separación que de verdad protege el
ledger: la aplicación corre como `lsw_app`, que nunca recibe `UPDATE`/`DELETE`
sobre ledger ni auditoría (DEC-007), y eso lo garantizan los `GRANT`
explícitos de cada migración, que se aplican sea quien sea quien las ejecute.

---

## Rotar secretos

Cambiar `LSW_DB_APP_PASSWORD` en Railway **no** cambia la contraseña del rol en
PostgreSQL por sí solo: eso ocurre cuando vuelve a correr `db:bootstrap`, es
decir en el siguiente despliegue de `api`. Cambia la variable y redespliega.
Entre ambos momentos la API no podrá conectarse.

`SESSION_SECRET` es distinto: rotarlo invalidará todas las sesiones abiertas.
Hoy no hay sesiones implementadas, así que es inocuo; cuando las haya, no lo
será.

---

## Problemas frecuentes

| Síntoma                                        | Causa casi segura                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `api` no arranca y lista variables inválidas   | Falta alguna variable del bloque, o se pegó un `${{...}}` ya sustituido a mano. |
| `web` sirve páginas con estado de error        | `API_BASE_URL` mal formada, o `api` aún no ha desplegado.                       |
| `web` no alcanza a `api`                       | `API_HOST` no es `::`, o los servicios no se llaman exactamente `api` y `web`.  |
| El healthcheck de `api` da 503                 | El bootstrap no llegó a crear los roles, o `DATABASE_URL_APP` apunta mal.       |
| El build de `api` no encuentra `@lsw/database` | Se puso un Root Directory. El build necesita la raíz del monorepo.              |
