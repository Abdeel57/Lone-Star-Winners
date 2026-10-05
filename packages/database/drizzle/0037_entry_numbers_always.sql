-- ===========================================================================
-- 0037_entry_numbers_always
--
-- Numero de participacion para TODA participacion, y al azar a la vista
-- (DEC-080).
--
-- QUE CAMBIA
--
--   1. Cada promocion tiene una CLAVE (32 bytes de CSPRNG) con la que se
--      permuta el ordinal interno de cada participacion para obtener el numero
--      que ve el participante. La permutacion vive en TypeScript
--      (`packages/sweepstakes/src/entry-number-cipher.ts`); aqui solo se guarda
--      la clave y se impide cambiarla.
--   2. La secuencia de una promocion se crea con su primera participacion. Antes
--      no la creaba ningun codigo de produccion, y sin ella no se podia numerar.
--   3. Toda transaccion positiva recibe su bloque de numeros al confirmarse,
--      la escriba quien la escriba: compra, correo (AMOE), ajuste manual o un
--      script. Antes solo lo recibian las compras, y solo con
--      `visible_entry_numbers_enabled` encendido. El flag pasa a decidir unicamente
--      si el participante VE sus numeros.
--   4. Las participaciones ya otorgadas sin numero se numeran ahora, en el orden
--      en que se escribieron.
--
-- POR QUE ERA NECESARIO, ADEMAS DE QUE SE VEAN
--
--   El universo que se congela para el Administrador se construye con los
--   bloques (`export_snapshot_entry_ranges.entry_batch_id`). Sin bloques, la
--   reconciliacion declaraba EMPTY_UNIVERSE o TOTAL_MISMATCH y ningun export se
--   podia finalizar: no habia forma de entregar el universo del sorteo
--   (AGENT_HANDOFF, "Finalizar un export exige la numeracion visible encendida").
--
-- LO QUE NO CAMBIA
--
--   Los rangos internos siguen siendo contiguos y la exclusion GiST sigue
--   haciendo imposible el solapamiento. La secuencia sigue sin ser el sorteo
--   (DEC-017): el ganador lo elige el Administrador.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Clave y esquema de la permutacion
--
--    Dos UUID v4 seguidos: 32 bytes, 244 de ellos aleatorios, de
--    `gen_random_uuid()`, que usa el CSPRNG de PostgreSQL. No hace falta
--    pgcrypto. Al ser un DEFAULT volatil, cada fila existente recibe la suya.
--
--    La clave no es lo que hace justo el sorteo -lo hace el Administrador- y
--    conocerla no cambia ninguna probabilidad; solo permitiria saber que
--    ordinal hay detras de un numero. Aun asi no sale nunca de la API.
-- ---------------------------------------------------------------------------

ALTER TABLE promotion_entry_number_sequences
  ADD COLUMN number_key bytea NOT NULL
    DEFAULT (uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())),
  ADD COLUMN number_scheme text NOT NULL
    DEFAULT 'LSW/ENTRY-NUMBER/FEISTEL/v1';

ALTER TABLE promotion_entry_number_sequences
  ADD CONSTRAINT promotion_entry_number_sequences_key_length
    CHECK (octet_length(number_key) = 32),
  ADD CONSTRAINT promotion_entry_number_sequences_scheme_known
    CHECK (number_scheme = 'LSW/ENTRY-NUMBER/FEISTEL/v1');

-- Ocho cifras: cien millones de numeros, diez mil veces el tope por persona de
-- las Reglas. El cifrador trabaja en 32 bits y admite de 6 a 9; el CHECK lo
-- hace cumplir aqui tambien, para que una promocion no nazca con un ancho que
-- la cuenta del participante no sabria mostrar.
ALTER TABLE promotion_entry_number_sequences
  ALTER COLUMN format_digits SET DEFAULT 8;

ALTER TABLE promotion_entry_number_sequences
  DROP CONSTRAINT promotion_entry_number_sequences_digits_range;

ALTER TABLE promotion_entry_number_sequences
  ADD CONSTRAINT promotion_entry_number_sequences_digits_range
    CHECK (format_digits BETWEEN 6 AND 9);

COMMENT ON COLUMN promotion_entry_number_sequences.number_key IS
  'DEC-080: clave de la permutacion de numeros visibles. Inmutable: cambiarla cambiaria los numeros ya mostrados.';


-- ---------------------------------------------------------------------------
-- 2. La clave, el esquema y el ancho no cambian nunca
--
--    `lsw_app` ya solo puede actualizar `next_number` (0006); esto lo extiende a
--    cualquier rol, migraciones incluidas. El prefijo NO entra: no forma parte
--    del numero visible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_number_sequence_monotonic()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.next_number < OLD.next_number THEN
    RAISE EXCEPTION
      'DEC-009: la secuencia de numeros de la promocion % solo avanza (% -> %). Un numero no se reutiliza jamas.',
      OLD.promotion_id, OLD.next_number, NEW.next_number
      USING ERRCODE = '23514';
  END IF;

  IF NEW.number_key IS DISTINCT FROM OLD.number_key
     OR NEW.number_scheme IS DISTINCT FROM OLD.number_scheme
     OR NEW.format_digits IS DISTINCT FROM OLD.format_digits THEN
    RAISE EXCEPTION
      'DEC-080: la clave, el esquema y el ancho de los numeros de la promocion % no cambian: cambiarlos cambiaria los numeros que los participantes ya vieron.',
      OLD.promotion_id
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;


-- ---------------------------------------------------------------------------
-- 3. La primera asignacion crea la secuencia
--
--    Dentro del lock consultivo, para que dos primeras compras simultaneas no
--    compitan por crearla. `ON CONFLICT DO NOTHING` solo exige INSERT, que
--    `lsw_app` ya tiene sobre la tabla.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_allocate_entry_range(p_promotion_id uuid, p_quantity integer)
RETURNS int8range
LANGUAGE plpgsql
AS $$
DECLARE
  start_number bigint;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Un rango de entries exige una cantidad positiva; se pidio %.', p_quantity
      USING ERRCODE = '22023';
  END IF;

  -- Serializa a los asignadores concurrentes de la MISMA promocion. Se libera
  -- al terminar la transaccion: si esta hace rollback, el rango se libera con
  -- ella y la secuencia no avanza.
  PERFORM pg_advisory_xact_lock(hashtext('lsw_entry_range'), hashtext(p_promotion_id::text));

  INSERT INTO promotion_entry_number_sequences (promotion_id, format_prefix)
  VALUES (p_promotion_id, 'LSW')
  ON CONFLICT (promotion_id) DO NOTHING;

  UPDATE promotion_entry_number_sequences
     SET next_number = next_number + p_quantity
   WHERE promotion_id = p_promotion_id
  RETURNING next_number - p_quantity INTO start_number;

  IF start_number IS NULL THEN
    RAISE EXCEPTION
      'La promocion % no tiene secuencia de numeros inicializada.', p_promotion_id
      USING ERRCODE = '23503';
  END IF;

  RETURN int8range(start_number, start_number + p_quantity, '[)');
END
$$;

COMMENT ON FUNCTION lsw_allocate_entry_range(uuid, integer) IS
  'DEC-009 y DEC-080: asignacion de rango con lock consultivo por promocion; crea la secuencia si falta. No es un algoritmo de sorteo (DEC-017).';


-- ---------------------------------------------------------------------------
-- 4. Ninguna participacion se confirma sin numero
--
--    Trigger de restriccion DIFERIDO: corre al confirmar la transaccion, cuando
--    quien inserto ya tuvo ocasion de asignar el bloque el mismo. La compra lo
--    hace (`AwardService`) y aqui no pasa nada; el correo, los ajustes y
--    cualquier script lo reciben aqui. Si el bloque ya existe, no hace nada.
--
--    Asignar en un trigger normal AFTER INSERT chocaria con la compra, que
--    inserta su bloque DESPUES de la fila: dos bloques para una transaccion, y
--    `entry_batches.entry_transaction_id` es UNIQUE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_transactions_ensure_numbers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocated int8range;
BEGIN
  IF NEW.quantity_delta <= 0 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM entry_batches WHERE entry_transaction_id = NEW.id) THEN
    RETURN NULL;
  END IF;

  allocated := lsw_allocate_entry_range(NEW.promotion_id, NEW.quantity_delta);

  INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
  VALUES (NEW.id, NEW.promotion_id, NEW.participant_id, NEW.quantity_delta, allocated);

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER entry_transactions_ensure_numbers
  AFTER INSERT ON entry_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.quantity_delta > 0)
  EXECUTE FUNCTION lsw_entry_transactions_ensure_numbers();

COMMENT ON FUNCTION lsw_entry_transactions_ensure_numbers() IS
  'DEC-080: numera al confirmar cualquier transaccion positiva que llegue sin bloque.';


-- ---------------------------------------------------------------------------
-- 4.1 El cerrojo de numeracion se toma AL INSERTAR, no al confirmar
--
--    Sin esto, el trigger diferido de arriba invertiria el orden de cerrojos que
--    documenta la 0024 ("primero el efecto, despues la auditoria"):
--
--      compra:  INSERT -> cerrojo de numeros -> cerrojo de la cadena de auditoria
--      correo:  INSERT -> cerrojo de la cadena -> COMMIT -> cerrojo de numeros
--
--    Una compra y una aprobacion por correo simultaneas de la misma promocion se
--    esperarian la una a la otra y PostgreSQL abortaria una (interbloqueo).
--    Tomando el cerrojo de numeros en el INSERT de la fila positiva -el mismo
--    que toma `lsw_allocate_entry_range`, y los consultivos son reentrantes-
--    todos los caminos lo toman en el mismo punto: despues del cerrojo del
--    participante y antes del de la cadena.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_entry_transactions_lock_numbers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('lsw_entry_range'), hashtext(NEW.promotion_id::text));
  RETURN NEW;
END
$$;

CREATE TRIGGER entry_transactions_lock_numbers
  BEFORE INSERT ON entry_transactions
  FOR EACH ROW
  WHEN (NEW.quantity_delta > 0)
  EXECUTE FUNCTION lsw_entry_transactions_lock_numbers();

COMMENT ON FUNCTION lsw_entry_transactions_lock_numbers() IS
  'DEC-080: toma el cerrojo de numeracion de la promocion al insertar una fila positiva, para no invertir el orden de cerrojos con la auditoria.';


-- ---------------------------------------------------------------------------
-- 5. Numerar lo ya otorgado
--
--    En el orden en que se escribio (`sequence_no`), que es el orden en que se
--    habria numerado si la asignacion hubiera estado siempre encendida. La
--    migracion corre en una sola transaccion: o se numera todo, o nada.
--
--    Es una funcion y no un bloque anonimo para poder probarla y para poder
--    volver a llamarla si alguna vez una fila llegara sin numero (por ejemplo,
--    escrita con el trigger desactivado a mano). Es idempotente: solo toca lo
--    que no tiene bloque. Devuelve cuantas transacciones numero.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_number_unnumbered_entries()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  pending   record;
  allocated int8range;
  numbered  integer := 0;
BEGIN
  FOR pending IN
    SELECT t.id, t.promotion_id, t.participant_id, t.quantity_delta
      FROM entry_transactions t
     WHERE t.quantity_delta > 0
       AND NOT EXISTS (SELECT 1 FROM entry_batches b WHERE b.entry_transaction_id = t.id)
     ORDER BY t.sequence_no
  LOOP
    allocated := lsw_allocate_entry_range(pending.promotion_id, pending.quantity_delta);

    INSERT INTO entry_batches (entry_transaction_id, promotion_id, participant_id, quantity, number_range)
    VALUES (pending.id, pending.promotion_id, pending.participant_id, pending.quantity_delta, allocated);

    numbered := numbered + 1;
  END LOOP;

  RETURN numbered;
END
$$;

COMMENT ON FUNCTION lsw_number_unnumbered_entries() IS
  'DEC-080: numera, en orden de escritura, las transacciones positivas sin bloque. Idempotente.';

SELECT lsw_number_unnumbered_entries();
