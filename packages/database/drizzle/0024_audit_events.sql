-- ===========================================================================
-- 0024_audit_events
--
-- LA TABLA QUE FALTABA. Registro de hechos auditables append-only (DEC-007)
-- con la hash chain de DEC-008 y el preimage de DEC-035.
--
-- Hasta hoy los hechos auditables de las 40 rutas de B5 iban al log
-- estructurado con `event: "audit.pending_persistence"` (ver HO-028). Un log
-- rota, no se encadena, no se sella y no se puede verificar; las tres cosas
-- que DEC-008 exige. Esto lo sustituye.
--
-- ---------------------------------------------------------------------------
-- 1. NO SE PUEDE EDITAR NI BORRAR (DEC-007, tres capas)
-- ---------------------------------------------------------------------------
--
--    Capa 1 - PERMISOS. `lsw_app` recibe SELECT e INSERT. Nada mas. Al final
--             del archivo hay ademas un REVOKE explicito, redundante a
--             proposito: un auditor lee la intencion escrita, no la deduce de
--             lo que no esta.
--
--    Capa 2 - TRIGGERS. `BEFORE UPDATE OR DELETE` que lanza excepcion. Cubre
--             al superusuario, al migrator y a cualquier rol futuro que
--             alguien cree sin leer esto -incluido el superusuario del
--             proveedor de hosting que aplica las migraciones (DEC-043)-.
--
--    Capa 3 - TESTS. Dos, y hacen cosas distintas:
--               - estatico: `packages/database/test/migration-audit.test.ts`
--                 comprueba sobre el TEXTO de todas las migraciones que
--                 ninguna concede UPDATE o DELETE sobre `audit_events` al rol
--                 de la aplicacion, y `tests/security/src/audit/
--                 audit-events-migration.test.ts` comprueba que las capas 1 y
--                 2 estan efectivamente escritas aqui;
--               - dinamico: `test/integration/audit-events.int.test.ts`
--                 INTENTA el UPDATE y el DELETE contra PostgreSQL real con los
--                 tres roles y exige que fallen. Un control que nadie intenta
--                 romper no esta probado.
--
--    Corregir un evento consiste en escribir OTRO. No hay soft-delete y no hay
--    estado mutable: la tabla entera no se mueve.
--
-- ---------------------------------------------------------------------------
-- 2. LA CADENA VA POR PROMOCION, Y LOS HECHOS SIN PROMOCION TIENEN LA SUYA
-- ---------------------------------------------------------------------------
--
--    DEC-008 encadena por promocion. Pero un cambio de rol, un login fallido o
--    la creacion de una cuenta de personal no pertenecen a ninguna promocion, y
--    son precisamente los hechos que usa quien prepara un fraude. Meterlos en
--    la cadena de una promocion cualquiera seria mentir sobre su alcance;
--    dejarlos sin cadena seria peor.
--
--    Van a la cadena `global`. `chain_key` es esa clave: `promotion_id` en
--    texto, o `global` cuando no hay promocion, y una restriccion CHECK la ata
--    a la columna para que no puedan divergir. La clave entra en el preimage
--    (DEC-035), asi que una fila de `global` no puede presentarse como fila de
--    una promocion ni al reves.
--
-- ---------------------------------------------------------------------------
-- 3. DOS ESCRITORES CONCURRENTES NO PUEDEN BIFURCAR LA CADENA
-- ---------------------------------------------------------------------------
--
--    Es el fallo caracteristico de una hash chain en una base de datos con
--    concurrencia: A y B leen la misma cabeza H, los dos calculan su hash con
--    `prev = H`, los dos insertan. La cadena queda con DOS eslabones que dicen
--    venir del mismo sitio. El verificador lo detecta -bien-, pero para
--    entonces ya hay evidencia rota, y ni siquiera por manipulacion: por una
--    carrera.
--
--    Tres capas, otra vez:
--
--      a) `pg_advisory_xact_lock(hashtext('lsw_audit_chain'), hashtext(clave))`
--         que toma el ADAPTADOR antes de leer la cabeza. Serializa a los
--         escritores de la MISMA cadena, y solo de esa: dos promociones
--         distintas no se estorban. Se libera al terminar la transaccion, asi
--         que un rollback lo suelta con ella.
--
--      b) el mismo cerrojo, tomado otra vez por el trigger de validacion, que
--         ademas comprueba que `chain_prev_hash` ES la cabeza actual. Los locks
--         consultivos son reentrantes dentro de la misma transaccion, asi que
--         al adaptador no le cuesta nada; lo que consigue es que un escritor
--         que se salte (a) siga sin poder bifurcar.
--
--      c) `UNIQUE (chain_key, chain_prev_hash)`. Aunque fallaran las dos
--         anteriores, dos filas no pueden declarar el mismo antecesor. La
--         bifurcacion deja de ser un riesgo y pasa a ser imposible, igual que
--         el solapamiento de rangos en 0006 con la exclusion GiST.
--
--    Por eso `chain_prev_hash` es NOT NULL y la PRIMERA fila guarda el genesis
--    derivado de (dominio, clave) en vez de NULL: en PostgreSQL dos NULL son
--    distintos entre si dentro de un indice unico, de modo que con NULL la
--    cadena SI podria bifurcarse en su primer eslabon, que es el peor sitio.
--
--    ORDEN DE CERROJOS. La transaccion escribe primero su efecto y DESPUES el
--    evento de auditoria, asi que el cerrojo de la cadena se toma el ultimo. Si
--    alguien invirtiera ese orden en un camino y no en otro, PostgreSQL
--    detectaria el interbloqueo y abortaria una de las dos transacciones: el
--    efecto no se confirma, que es el modo correcto de fallar.
--
-- ---------------------------------------------------------------------------
-- 4. LO QUE ESTA TABLA NO GUARDA
-- ---------------------------------------------------------------------------
--
--    No guarda la direccion IP. `source_ip` conserva ese nombre porque
--    `AUDIT_EVENT_CANONICAL_FIELDS_V1` es la version 1 y esta congelada, pero
--    la restriccion `audit_events_source_ip_is_digest` solo admite 64 digitos
--    hexadecimales: un digest, jamas una direccion. La tabla es append-only y
--    se conserva indefinidamente; una direccion IP escrita aqui no se puede
--    retirar despues.
--
--    `before` y `after` no reciben objetos de dominio crudos: los sanea
--    `redactDiff` (`packages/audit/src/safe-diff.ts`) con una allowlist mas un
--    suelo de nombres que nunca se auditan. Volcar el objeto entero es como
--    una tabla de auditoria acaba conteniendo un token de sesion para siempre.
--
--    `actor_id` es un identificador interno. Nunca un correo ni un nombre.
--
-- ---------------------------------------------------------------------------
-- 5. ESTA MIGRACION NO SIEMBRA NINGUNA FILA
-- ---------------------------------------------------------------------------
--
--    Un evento de auditoria sembrado por una migracion seria un hecho que no
--    ocurrio, encadenado como si hubiera ocurrido.
--
-- Referencias: DEC-003, DEC-005, DEC-007, DEC-008, DEC-011, DEC-020, DEC-022,
--              DEC-035, DEC-037, DEC-043, DEC-047. Handoff: HO-028.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Tipo de actor
--
--    Cuatro valores, y NO son los mismos que `entry_actor_type`. Ahi el actor
--    administrativo se llama ADMIN porque escribe en el ledger; aqui se llama
--    STAFF, que es la palabra que usa el ambito de sesion (`PRINCIPAL_SCOPES`)
--    y el catalogo de `@lsw/audit`. Y aqui existe ANONYMOUS, que en el ledger
--    no tiene sentido: un login fallido es un hecho auditable y no tiene autor
--    identificado.
-- ---------------------------------------------------------------------------

CREATE TYPE audit_actor_type AS ENUM ('PARTICIPANT', 'STAFF', 'SYSTEM', 'ANONYMOUS');

COMMENT ON TYPE audit_actor_type IS
  'Quien actua en un hecho auditable. ANONYMOUS existe porque un intento fallido tambien se audita.';


-- ---------------------------------------------------------------------------
-- 2. La tabla
--
--    EL CONJUNTO DE COLUMNAS ES PARTE DEL CONTRATO, EL ORDEN NO.
--
--    La forma canonica ordena las claves (RFC 8785), asi que el orden fisico
--    del DDL es invisible al hash. Lo que si esta congelado es el CONJUNTO:
--    `AUDIT_EVENT_CANONICAL_FIELDS_V1` mas `AUDIT_EVENT_EXCLUDED_FIELDS_V1`
--    debe ser exactamente esta lista, y hay un test que lo comprueba. Una
--    columna nueva no cabe en la version 1 -cambiaria hashes ya escritos-: exige
--    una version 2 de canonicalizacion.
--
--    NINGUNA COLUMNA DEL PAYLOAD TIENE `DEFAULT`. Ni `id`, ni `recorded_at`, ni
--    `metadata`, ni `actor_roles`. DEC-035 y DEC-047 exigen que quien inserta
--    conozca esos valores ANTES del INSERT, porque el hash se calcula antes y
--    la tabla no admite un UPDATE posterior para rellenarlo. Con `DEFAULT`, el
--    olvido es posible y la cadena NACE ROTA; sin `DEFAULT`, el olvido es un
--    error de NOT NULL en el sitio.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_events (
  id                    uuid PRIMARY KEY,

  -- Orden total de escritura. El verificador recorre la cadena en este orden y
  -- exige encadenamiento estricto, que es lo que protege a esta columna: no
  -- entra en el payload porque la base de datos la asigna DURANTE el INSERT.
  sequence_no           bigint GENERATED ALWAYS AS IDENTITY,

  -- Clave de la cadena. Atada a `promotion_id` por CHECK; ver la cabecera.
  chain_key             text NOT NULL,

  -- DEC-011, los dos en UTC. `occurred_at` es cuando ocurrio el hecho;
  -- `recorded_at` cuando se registro, y lo fija quien inserta.
  occurred_at           timestamptz NOT NULL,
  recorded_at           timestamptz NOT NULL,

  actor_type            audit_actor_type NOT NULL,

  -- Identificador INTERNO. Nunca un correo ni un nombre.
  actor_id              text,

  -- Roles efectivos EN EL MOMENTO de la accion, no los de hoy. El orden entra
  -- en el hash, asi que quien escribe debe usar uno estable.
  actor_roles           jsonb NOT NULL,

  -- Clave del catalogo de `packages/audit/src/actions.ts`.
  action                text NOT NULL,

  target_entity_type    text NOT NULL,
  target_entity_id      text,

  promotion_id          uuid REFERENCES promotions (id) ON DELETE RESTRICT,

  -- DEC-022: correlacion con la peticion HTTP (`error.request_id`).
  request_id            text,

  -- Diff YA saneado por `redactDiff`. Objeto o NULL, nunca un array ni un
  -- escalar: un `before` que fuera un numero no describe un estado.
  before                jsonb,
  after                 jsonb,

  -- DEC-022: codigo estable de motivo. Admite las dos formas que conviven en el
  -- proyecto -MAYUSCULAS_CON_GUION del dominio y minusculas.con_punto de
  -- `INTEGRITY_REASON_CODES`- porque las dos son enums, no prosa.
  reason_code           text,

  -- Detalle interno para el operador. No se sirve al participante y NO va al
  -- log: puede contener datos de una persona.
  reason_text           text,

  -- DIGEST de la direccion. Ver el CHECK y la cabecera.
  source_ip             text,

  user_agent            text,

  metadata              jsonb NOT NULL,

  -- ---- DEC-008 / DEC-035: la cadena ---------------------------------------
  canonicalization_version  integer NOT NULL,
  chain_prev_hash           text NOT NULL,
  chain_hash                text NOT NULL,

  -- ---- Restricciones -------------------------------------------------------

  -- La clave de cadena NO puede divergir de la promocion. Con esto, poner una
  -- fila en la cadena equivocada deja de ser posible.
  CONSTRAINT audit_events_chain_key_matches_promotion
    CHECK (chain_key = coalesce(promotion_id::text, 'global')),

  -- La bifurcacion, imposible por construccion. Ver el punto 3 de la cabecera.
  CONSTRAINT audit_events_unique_chain_link
    UNIQUE (chain_key, chain_prev_hash),

  CONSTRAINT audit_events_unique_chain_hash
    UNIQUE (chain_key, chain_hash),

  CONSTRAINT audit_events_hash_shape
    CHECK (
      chain_hash ~ '^[0-9a-f]{64}$'
      AND chain_prev_hash ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT audit_events_canonicalization_version_positive
    CHECK (canonicalization_version >= 1),

  -- Forma del catalogo: `dominio.accion`, minusculas. Una frase no pasa.
  CONSTRAINT audit_events_action_shape
    CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),

  CONSTRAINT audit_events_target_entity_type_shape
    CHECK (length(btrim(target_entity_type)) BETWEEN 1 AND 100),

  CONSTRAINT audit_events_reason_code_shape
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Za-z][A-Za-z0-9_.]{2,63}$'),

  -- Un actor identificado tiene identificador; uno anonimo no puede tenerlo.
  -- Sin esto, un evento ANONYMOUS con `actor_id` relleno seria representable, y
  -- un auditor no sabria si el sistema conocia al autor o no.
  --
  -- SYSTEM queda a proposito en medio: puede llevar identificador -el del job o
  -- el del proceso que actuo, que es util para investigar- o no llevarlo, y las
  -- dos cosas son ciertas segun el caso. Lo que no puede es fingir anonimato.
  CONSTRAINT audit_events_actor_consistent
    CHECK (
      (actor_type = 'ANONYMOUS' AND actor_id IS NULL)
      OR
      (actor_type = 'SYSTEM')
      OR
      (actor_type IN ('PARTICIPANT', 'STAFF') AND actor_id IS NOT NULL)
    ),

  CONSTRAINT audit_events_actor_roles_is_array
    CHECK (jsonb_typeof(actor_roles) = 'array'),

  CONSTRAINT audit_events_metadata_is_object
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT audit_events_before_is_object
    CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),

  CONSTRAINT audit_events_after_is_object
    CHECK (after IS NULL OR jsonb_typeof(after) = 'object'),

  -- LA restriccion de minimizacion: 64 hexadecimales, es decir un digest. Una
  -- direccion IP no pasa por aqui. La tabla se conserva indefinidamente y no
  -- admite DELETE: lo que entre, se queda.
  CONSTRAINT audit_events_source_ip_is_digest
    CHECK (source_ip IS NULL OR source_ip ~ '^[0-9a-f]{64}$'),

  CONSTRAINT audit_events_user_agent_length
    CHECK (user_agent IS NULL OR length(user_agent) <= 512),

  CONSTRAINT audit_events_reason_text_length
    CHECK (reason_text IS NULL OR length(reason_text) <= 2000)
);

-- El recorrido de la cadena y la lectura de la cabeza por el trigger. Es el
-- indice mas usado de la tabla: lo toca CADA insercion.
CREATE INDEX audit_events_chain_idx
  ON audit_events (chain_key, sequence_no);

CREATE INDEX audit_events_promotion_time_idx
  ON audit_events (promotion_id, occurred_at DESC);

CREATE INDEX audit_events_action_time_idx
  ON audit_events (action, occurred_at DESC);

CREATE INDEX audit_events_target_idx
  ON audit_events (target_entity_type, target_entity_id);

CREATE INDEX audit_events_request_idx
  ON audit_events (request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX audit_events_actor_idx
  ON audit_events (actor_type, actor_id)
  WHERE actor_id IS NOT NULL;

COMMENT ON TABLE audit_events IS
  'DEC-007/DEC-008: hechos auditables APPEND-ONLY, encadenados por promocion. Corregir es escribir otra fila.';

COMMENT ON COLUMN audit_events.chain_key IS
  'Clave de cadena: promotion_id en texto, o global. Entra en el preimage (DEC-035) y un CHECK la ata a la columna.';

COMMENT ON COLUMN audit_events.recorded_at IS
  'DEC-035: entra en el preimage, por eso NO tiene DEFAULT. Con DEFAULT el hash cubriria un instante y la fila otro.';

COMMENT ON COLUMN audit_events.source_ip IS
  'DIGEST de la direccion, jamas la direccion. El nombre lo fija la canonicalizacion v1, que esta congelada.';

COMMENT ON COLUMN audit_events.chain_prev_hash IS
  'NOT NULL a proposito: la primera fila guarda el genesis de (dominio, clave). Con NULL, el indice unico no impediria dos filas iniciales.';


-- ---------------------------------------------------------------------------
-- 3. Capa 2 del append-only: el trigger que rechaza UPDATE y DELETE
-- ---------------------------------------------------------------------------

CREATE TRIGGER audit_events_reject_mutation
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();


-- ---------------------------------------------------------------------------
-- 4. Validacion de insercion: el eslabon tiene que enganchar
--
--    Lo que no cabe en un CHECK porque exige mirar OTRA fila.
--
--    NO recalcula el hash. Podria -pgcrypto tiene `digest()`- y seria un error:
--    construir el preimage de DEC-035 en plpgsql seria una SEGUNDA
--    implementacion de la cadena, y dos implementaciones de un hash no son
--    redundancia sino la garantia de que un dia diferiran. Lo que si puede
--    comprobar la base de datos, y comprueba, es la TOPOLOGIA: que el eslabon
--    nuevo declara como antecesor la cabeza real de su cadena.
--
--    Tampoco puede comprobar el genesis de la primera fila por el mismo motivo.
--    Eso lo verifica `verifyChain`, que si conoce el preimage.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_audit_events_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  head_hash text;
  head_id   uuid;
BEGIN
  -- Mismo cerrojo que toma el adaptador antes de leer la cabeza. Es reentrante
  -- dentro de la transaccion, asi que al camino normal no le cuesta nada; lo
  -- que consigue es que un escritor que se lo salte siga sin poder bifurcar.
  PERFORM pg_advisory_xact_lock(hashtext('lsw_audit_chain'), hashtext(NEW.chain_key));

  SELECT chain_hash, id
    INTO head_hash, head_id
    FROM audit_events
   WHERE chain_key = NEW.chain_key
   ORDER BY sequence_no DESC
   LIMIT 1;

  IF head_hash IS NULL THEN
    -- Primera fila de esta cadena. Su `chain_prev_hash` debe ser el genesis, y
    -- eso solo lo puede comprobar quien conoce el preimage.
    RETURN NEW;
  END IF;

  IF NEW.chain_prev_hash <> head_hash THEN
    RAISE EXCEPTION
      'DEC-008: el evento % no engancha con la cadena %. Declara venir de % y la cabeza real es % (evento %). Un eslabon que no engancha bifurcaria la cadena.',
      NEW.id, NEW.chain_key, NEW.chain_prev_hash, head_hash, head_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION lsw_audit_events_validate_insert() IS
  'DEC-008: comprueba la TOPOLOGIA de la cadena en el INSERT. No recalcula el hash: eso seria una segunda implementacion.';

CREATE TRIGGER audit_events_validate_insert
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION lsw_audit_events_validate_insert();


-- ---------------------------------------------------------------------------
-- 5. Capa 1 del append-only: permisos (DEC-003, DEC-007)
-- ---------------------------------------------------------------------------

-- Leer y anadir. Nada mas, jamas.
GRANT SELECT, INSERT ON audit_events TO lsw_app;

-- Redundante frente a la ausencia del privilegio, y escrito a proposito.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM lsw_app;

-- El rol de informes lee la auditoria; no la escribe.
GRANT SELECT ON audit_events TO lsw_readonly_report;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_events FROM lsw_readonly_report;
