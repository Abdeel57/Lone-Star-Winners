# @lsw/database

Esquema PostgreSQL 16, migraciones SQL forward-only y conexion por rol.

Propietario: `backend-sweepstakes` (`docs/TASK_OWNERSHIP.md`).

---

## Puesta en marcha local

```bash
# 1. Crear la base de datos (con un superusuario del cluster)
createdb lone_star_winners

# 2. Aplicar las migraciones (rol migrator)
DATABASE_URL_MIGRATOR=postgresql://...  pnpm --filter @lsw/database db:migrate

# 3. Asignar contrasenas a los tres roles de DEC-003.
#    Las migraciones los crean con LOGIN y SIN contrasena a proposito: una
#    contrasena escrita en una migracion es una contrasena versionada.
psql "$DATABASE_URL_SUPERUSER" \
  -v app_password="$LOCAL_APP_PASSWORD" \
  -v migrator_password="$LOCAL_MIGRATOR_PASSWORD" \
  -v readonly_password="$LOCAL_READONLY_PASSWORD" \
  -f packages/database/sql/local-dev/set-role-passwords.sql

# 4. Sembrar datos ficticios (rol app)
DATABASE_URL_APP=postgresql://...  pnpm --filter @lsw/database db:seed
```

---

## Reglas de esta carpeta

1. **Las migraciones se escriben a mano, en SQL plano** (DEC-005). `drizzle-kit`
   se usa para inspeccionar diferencias, nunca como generador de lo que se
   aplica, y **nunca** `push`. El motivo esta en la propia decision: `security`
   tiene que poder abrir una migracion en CI y verificar sus `GRANT` sin
   ejecutarla.

2. **Forward-only.** No hay `down`. Una correccion es una migracion nueva.

3. **Cada migracion concede sus permisos tabla a tabla, al final del archivo.**
   Deliberadamente NO existe ningun `ALTER DEFAULT PRIVILEGES` que de escritura
   al rol `lsw_app`: si existiera, el dia que se cree `entry_transactions` el
   rol heredaria `UPDATE` y `DELETE` en silencio y DEC-007 quedaria roto sin que
   nadie escribiera SQL equivocado.

4. **Enteros para dinero y entries** (DEC-010). Ni un `numeric`, ni un `real`,
   ni un `double precision` que represente un importe.

5. **`timestamptz` siempre** (DEC-011). La zona legal la declara cada promocion
   en `promotions.legal_timezone` y se valida contra `pg_timezone_names`.

6. **Finales de linea LF** (DEC-026). Un test lo comprueba.

Los tests de `test/migration-audit.test.ts` verifican estas reglas sobre el
texto de las migraciones, sin necesidad de base de datos.

---

## Tests

```bash
pnpm --filter @lsw/database test              # unitarios, sin Docker
pnpm --filter @lsw/database test:integration  # PostgreSQL 16 real, requiere Docker
```

Los de integracion levantan un contenedor con Testcontainers y comprueban lo
que no se puede simular: triggers, columnas `GENERATED`, `GRANT` por columna y
transiciones de estado (DEC-018 descarta mocks y SQLite para esto).

---

## Nota de despliegue

`createDatabaseHandle` fija `timezone=UTC` y `statement_timeout` mediante el
parametro `options` del paquete de arranque de la conexion. Un pooler en modo
transaccion (por ejemplo PgBouncer) puede rechazar ese parametro; si el
proveedor elegido lo hace, hay que fijar esos valores con `ALTER ROLE ... SET`
al aprovisionar. Se anotara cuando se decida el proveedor (nota de DEC-003).
