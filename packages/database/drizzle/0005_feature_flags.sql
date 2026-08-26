-- ===========================================================================
-- 0005_feature_flags
--
-- Feature flags persistidos en base de datos (DEC-013) con la lista canonica
-- de DEC-032.
--
-- LAS TRES IDEAS DE ESTA MIGRACION
--
--   1. UN FLAG NO ES UNA VARIABLE DE DESPLIEGUE.
--      DEC-013 lo prohibe explicitamente: un flag legalmente material es una
--      decision de negocio auditable. Por eso vive en una tabla, se lee en el
--      servidor y su cambio deja rastro con motivo obligatorio.
--
--   2. LA LISTA ES CERRADA.
--      `feature_flag_key` es un ENUM, no `text`. Anadir un flag exige una
--      migracion, que pasa por revision de codigo. Con `text` bastaria un
--      INSERT para crear un flag que nadie ha discutido, y el catalogo
--      canonico de DEC-032 se convertiria en una sugerencia.
--
--   3. LO QUE PUEDE CAMBIAR EN CALIENTE ES SOLO EL INTERRUPTOR.
--      El rol de la aplicacion recibe escritura POR COLUMNA sobre `enabled`,
--      el actor y el motivo. Nada mas. La descripcion, el valor por defecto de
--      DEC-032 y la marca de materialidad legal se cambian por migracion.
--
-- SOBRE `amoe_mode`
--
--   DEC-032 dice que `amoe_mode` es un enum con cuatro valores
--   (ONLINE_FORM, MAIL_IN_REVIEW, CODE, EXTERNAL_INSTRUCTIONS) y que
--   `amoe_enabled` es un flag aparte. Se implementa exactamente asi: el enum
--   NO lleva un quinto valor "DISABLED".
--
--   El motivo es el anti-patron que prohibe CLAUDE.md seccion 4. Con un valor
--   DISABLED dentro del enum habria DOS sitios que responden a la pregunta
--   "hay via AMOE?": el flag y la modalidad. El dia que discrepasen -flag
--   encendido y modalidad DISABLED- no existe respuesta correcta. Aqui la
--   pregunta la responde el flag, y la modalidad responde a otra distinta:
--   "que interfaz se renderiza". `NULL` significa "todavia no elegida", que es
--   el estado real mientras `docs/LEGAL_PENDING.md` lo tenga en TBD.
--
-- Referencias: DEC-003, DEC-013, DEC-017, DEC-032, DEC-033.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------------

-- La lista canonica de DEC-032, en el orden de la tabla de esa decision.
--
-- El catalogo del que sale vive en `packages/security/src/flags.ts` (mismo
-- criterio que DEC-027 aplico a los roles: lo que afecta a autorizacion lo
-- revisa `security`). `packages/database/src/domain/feature-flags.ts` lo
-- proyecta a filas y `test/parity.test.ts` compara ambas.
CREATE TYPE feature_flag_key AS ENUM (
  'amoe_enabled',
  'visible_entry_numbers_enabled',
  'internal_draw_enabled',
  'state_eligibility_enforcement_enabled',
  'age_gate_enabled',
  'entry_multipliers_enabled',
  'entry_caps_enabled',
  'entry_expiration_enabled',
  'winner_publication_enabled',
  'manual_adjustments_enabled',
  'provisional_entries_enabled',
  'dual_approval_for_sensitive_actions_enabled'
);

CREATE TYPE amoe_mode AS ENUM (
  'ONLINE_FORM',
  'MAIL_IN_REVIEW',
  'CODE',
  'EXTERNAL_INSTRUCTIONS'
);


-- ---------------------------------------------------------------------------
-- 2. Tabla de flags
-- ---------------------------------------------------------------------------

CREATE TABLE feature_flags (
  key                       feature_flag_key PRIMARY KEY,

  -- Estado vigente. Es lo unico que la aplicacion puede mover.
  enabled                   boolean NOT NULL,

  -- Valor que DEC-032 fija como arranque. Se conserva para que un test de
  -- invariante pueda comprobar que nadie ha cambiado la postura por defecto
  -- del proyecto, y para poder responder "esto se encendio" frente a "esto
  -- nacio encendido".
  dec032_default            boolean NOT NULL,

  -- Un flag legalmente material exige la capacidad
  -- `flag.update.legally_material` y step-up (DEC-006). La columna la consume
  -- `packages/security`.
  is_legally_material       boolean NOT NULL,

  -- Clave i18n para el admin. El copy en ambos idiomas es de `frontend`
  -- (DEC-022): aqui no viaja prosa visible.
  label_key                 text NOT NULL,

  -- Descripcion interna, para el auditor que lee la tabla. No es copy.
  description               text NOT NULL,

  -- Epigrafe de `docs/LEGAL_PENDING.md` del que depende, o NULL.
  legal_dependency          text,

  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_user_id  uuid REFERENCES admin_users (id) ON DELETE RESTRICT,

  -- DEC-013: motivo OBLIGATORIO en cada cambio. Lo impone el trigger.
  update_reason             text,

  CONSTRAINT feature_flags_label_key_shape
    CHECK (label_key ~ '^flags\.[a-z][a-zA-Z0-9]*$'),

  CONSTRAINT feature_flags_update_reason_length
    CHECK (update_reason IS NULL OR length(btrim(update_reason)) BETWEEN 10 AND 1000)
);

COMMENT ON TABLE feature_flags IS
  'DEC-013 y DEC-032: flags persistidos, desactivados por defecto, con cambio auditado y motivo obligatorio.';

COMMENT ON COLUMN feature_flags.dec032_default IS
  'Postura de arranque fijada por DEC-032. Solo cambia por migracion revisada.';


-- ---------------------------------------------------------------------------
-- 3. Modalidad AMOE (singleton)
--
--    Una sola fila, garantizada por la clave primaria mas el CHECK. El patron
--    evita la alternativa habitual -una tabla clave/valor de texto- en la que
--    el tipo de cada ajuste se pierde y hay que reparsear cadenas.
-- ---------------------------------------------------------------------------

CREATE TABLE feature_flag_settings (
  singleton                 boolean PRIMARY KEY DEFAULT true,

  -- NULL = modalidad todavia no elegida. Ver la nota de cabecera.
  amoe_mode                 amoe_mode,

  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_user_id  uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  update_reason             text,

  CONSTRAINT feature_flag_settings_singleton CHECK (singleton),

  CONSTRAINT feature_flag_settings_update_reason_length
    CHECK (update_reason IS NULL OR length(btrim(update_reason)) BETWEEN 10 AND 1000)
);


-- ---------------------------------------------------------------------------
-- 4. Historico de cambios: APPEND-ONLY
--
--    La tabla de flags guarda el estado; esta guarda la historia. Sin ella, un
--    flag legalmente material podria encenderse y apagarse durante una
--    promocion sin dejar ni una linea, y la pregunta "estaba activo el dia 12"
--    no tendria respuesta.
-- ---------------------------------------------------------------------------

CREATE TABLE feature_flag_changes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactamente uno de los dos: o cambio un flag, o cambio un ajuste con tipo
  -- propio (hoy solo `amoe_mode`).
  flag_key                  feature_flag_key,
  setting_key               text,

  -- Se guardan como texto para que la misma tabla sirva a booleanos y a
  -- enums. El tipo real esta en la columna de origen; aqui interesa poder leer
  -- la historia completa de una sentada.
  previous_value            text NOT NULL,
  new_value                 text NOT NULL,

  reason                    text NOT NULL,

  changed_by_admin_user_id  uuid REFERENCES admin_users (id) ON DELETE RESTRICT,

  -- DEC-011: `occurred_at` lo declara quien cambia; `recorded_at` lo pone el
  -- motor. Aqui coinciden porque el cambio es sincrono, pero se distinguen
  -- para que el formato de la fila no cambie cuando deje de serlo.
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  recorded_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT feature_flag_changes_exactly_one_target
    CHECK ((flag_key IS NULL) <> (setting_key IS NULL)),

  CONSTRAINT feature_flag_changes_setting_key_known
    CHECK (setting_key IS NULL OR setting_key = 'amoe_mode'),

  CONSTRAINT feature_flag_changes_value_actually_changed
    CHECK (previous_value IS DISTINCT FROM new_value),

  CONSTRAINT feature_flag_changes_reason_length
    CHECK (length(btrim(reason)) BETWEEN 10 AND 1000)
);

CREATE INDEX feature_flag_changes_flag_idx
  ON feature_flag_changes (flag_key, occurred_at DESC);

-- DEC-007 capa 2, aplicada tambien aqui: la historia de un flag legalmente
-- material es material de auditoria igual que el ledger.
CREATE TRIGGER feature_flag_changes_reject_mutation
  BEFORE UPDATE OR DELETE ON feature_flag_changes
  FOR EACH ROW EXECUTE FUNCTION lsw_reject_mutation();

COMMENT ON TABLE feature_flag_changes IS
  'DEC-013: historico append-only de cambios de flag. Responde a "estaba activo el dia X".';


-- ---------------------------------------------------------------------------
-- 5. Triggers de cambio
--
--    La fila de historico la escribe un trigger SECURITY DEFINER, no la
--    aplicacion. Asi el rol de la aplicacion no puede escribir una entrada que
--    no corresponda a un cambio real, ni omitir la de un cambio que si hizo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_feature_flags_enforce_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Columnas de catalogo: solo por migracion.
  IF NEW.key                 IS DISTINCT FROM OLD.key
     OR NEW.dec032_default      IS DISTINCT FROM OLD.dec032_default
     OR NEW.is_legally_material IS DISTINCT FROM OLD.is_legally_material
     OR NEW.label_key           IS DISTINCT FROM OLD.label_key
     OR NEW.description         IS DISTINCT FROM OLD.description
     OR NEW.legal_dependency    IS DISTINCT FROM OLD.legal_dependency
  THEN
    RAISE EXCEPTION
      'DEC-032: el catalogo de flags se cambia por migracion revisada, no en caliente.'
      USING ERRCODE = '55006';
  END IF;

  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN
    -- Nada material cambio. No se exige motivo ni se escribe historico.
    RETURN NEW;
  END IF;

  IF NEW.update_reason IS NULL OR length(btrim(NEW.update_reason)) < 10 THEN
    RAISE EXCEPTION
      'DEC-013: cambiar el flag "%" exige un motivo escrito de al menos 10 caracteres.',
      NEW.key
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_by_admin_user_id IS NULL THEN
    RAISE EXCEPTION
      'DEC-013: cambiar el flag "%" exige registrar QUIEN lo cambia.',
      NEW.key
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER feature_flags_enforce_change
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION lsw_feature_flags_enforce_change();


CREATE OR REPLACE FUNCTION lsw_feature_flags_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN
    RETURN NULL;
  END IF;

  INSERT INTO feature_flag_changes
    (flag_key, previous_value, new_value, reason, changed_by_admin_user_id)
  VALUES
    (NEW.key, OLD.enabled::text, NEW.enabled::text, NEW.update_reason,
     NEW.updated_by_admin_user_id);

  RETURN NULL;
END
$$;

CREATE TRIGGER feature_flags_record_change
  AFTER UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION lsw_feature_flags_record_change();


CREATE OR REPLACE FUNCTION lsw_feature_flag_settings_enforce_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amoe_mode IS NOT DISTINCT FROM OLD.amoe_mode THEN
    RETURN NEW;
  END IF;

  IF NEW.update_reason IS NULL OR length(btrim(NEW.update_reason)) < 10 THEN
    RAISE EXCEPTION
      'DEC-013: cambiar la modalidad AMOE exige un motivo escrito de al menos 10 caracteres.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.updated_by_admin_user_id IS NULL THEN
    RAISE EXCEPTION
      'DEC-013: cambiar la modalidad AMOE exige registrar QUIEN la cambia.'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER feature_flag_settings_enforce_change
  BEFORE UPDATE ON feature_flag_settings
  FOR EACH ROW EXECUTE FUNCTION lsw_feature_flag_settings_enforce_change();


CREATE OR REPLACE FUNCTION lsw_feature_flag_settings_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.amoe_mode IS NOT DISTINCT FROM OLD.amoe_mode THEN
    RETURN NULL;
  END IF;

  INSERT INTO feature_flag_changes
    (setting_key, previous_value, new_value, reason, changed_by_admin_user_id)
  VALUES
    ('amoe_mode',
     coalesce(OLD.amoe_mode::text, 'NULL'),
     coalesce(NEW.amoe_mode::text, 'NULL'),
     NEW.update_reason,
     NEW.updated_by_admin_user_id);

  RETURN NULL;
END
$$;

CREATE TRIGGER feature_flag_settings_record_change
  AFTER UPDATE ON feature_flag_settings
  FOR EACH ROW EXECUTE FUNCTION lsw_feature_flag_settings_record_change();


-- ---------------------------------------------------------------------------
-- 6. Lectura conveniente
--
--    Una funcion, no un `SELECT` repetido en cada sitio: el dia que un flag
--    dependa ademas de la promocion, cambia aqui y no en veinte llamadas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_feature_flag_enabled(p_key feature_flag_key)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  -- `coalesce(..., false)` no es cosmetico: si por lo que sea la fila no
  -- existiese, la respuesta segura es "apagado", nunca NULL propagandose a un
  -- `IF` que no se cumple ni deja de cumplirse.
  SELECT coalesce((SELECT enabled FROM feature_flags WHERE key = p_key), false);
$$;

COMMENT ON FUNCTION lsw_feature_flag_enabled(feature_flag_key) IS
  'DEC-013: un flag ausente se lee como apagado. La postura por defecto es negativa.';


-- ---------------------------------------------------------------------------
-- 7. Semilla del catalogo (DEC-032)
--
--    Todos arrancan apagados salvo `dual_approval_for_sensitive_actions_enabled`.
--    Principio 12: un flag que hay que acordarse de encender para estar
--    protegido acabara apagado.
--
--    El sorteo interno arranca apagado y ademas no basta con encenderlo:
--    DEC-017 exige cinco cerrojos simultaneos, y uno es una `DrawAuthorization`
--    viva que esta migracion no crea ni podria crear.
-- ---------------------------------------------------------------------------

--    LAS COLUMNAS `enabled`, `dec032_default`, `is_legally_material` y
--    `legal_dependency` SON UNA PROYECCION DE `@lsw/security`, no una decision
--    de esta migracion. `packages/database/src/domain/feature-flags.ts` deriva
--    esas filas del catalogo, y `test/parity.test.ts` compara ambas: si
--    `security` cambia la materialidad legal de un flag y nadie actualiza esta
--    migracion, el test falla, que es lo que debe pasar.
--
--    `description` no se compara: es documentacion interna para quien lea la
--    tabla, no parte del contrato.

INSERT INTO feature_flags
  (key, enabled, dec032_default, is_legally_material, label_key, description, legal_dependency)
VALUES
  ('amoe_enabled', false, false, true,
   'flags.amoeEnabled',
   'Existence of the AMOE path. Principle 8 requires the capability to exist even while switched off.',
   'AMOE'),

  ('visible_entry_numbers_enabled', false, false, true,
   'flags.visibleEntryNumbersEnabled',
   'Participant-visible entry number ranges. Ranges are allocated either way, and this only shows them.',
   'VISIBLE_ENTRY_NUMBERS'),

  ('internal_draw_enabled', false, false, true,
   'flags.internalDrawEnabled',
   'DEC-017 lock 1 of 5. Necessary and NOT sufficient: a live DrawAuthorization is also required.',
   'INTERNAL_DRAW'),

  ('state_eligibility_enforcement_enabled', false, false, true,
   'flags.stateEligibilityEnforcementEnabled',
   'Jurisdiction restriction enforcement. The list of jurisdictions is data, never code.',
   'ELIGIBILITY'),

  ('age_gate_enabled', false, false, true,
   'flags.ageGateEnabled',
   'Minimum age verification. The age itself lives in PromotionRulesVersion, not here.',
   'ELIGIBILITY'),

  ('entry_multipliers_enabled', false, false, true,
   'flags.entryMultipliersEnabled',
   'Multiplier periods in the calculation engine.',
   'OFFICIAL_RULES'),

  ('entry_caps_enabled', false, false, true,
   'flags.entryCapsEnabled',
   'Per-participant and per-order entry caps.',
   'OFFICIAL_RULES'),

  ('entry_expiration_enabled', false, false, true,
   'flags.entryExpirationEnabled',
   'DEC-033. While switched off every expires_at stays NULL and the balance is a plain sum.',
   'OFFICIAL_RULES'),

  ('winner_publication_enabled', false, false, true,
   'flags.winnerPublicationEnabled',
   'Public winner announcement. DEC-017 forbids any automatic publication.',
   'WINNER_PUBLICATION'),

  ('manual_adjustments_enabled', false, false, false,
   'flags.manualAdjustmentsEnabled',
   'Administrative entry adjustments. Always append-only ledger rows, never edits.',
   NULL),

  ('provisional_entries_enabled', false, false, false,
   'flags.provisionalEntriesEnabled',
   'Provisional entries that do not yet count towards the eligible balance.',
   NULL),

  ('dual_approval_for_sensitive_actions_enabled', true, true, false,
   'flags.dualApprovalForSensitiveActionsEnabled',
   'Second approval by a distinct actor. The single flag that starts on, by principle 12.',
   NULL);

INSERT INTO feature_flag_settings (singleton, amoe_mode) VALUES (true, NULL);


-- ---------------------------------------------------------------------------
-- 8. Permisos de base de datos (DEC-003)
--
--    Escritura POR COLUMNA. La aplicacion mueve el interruptor y deja
--    constancia; no toca el catalogo. Con privilegio de tabla completa, un bug
--    de un `SET` con demasiadas columnas podria reescribir la postura por
--    defecto de DEC-032 sin que nadie lo revisara.
-- ---------------------------------------------------------------------------

GRANT SELECT ON feature_flags TO lsw_app;
GRANT UPDATE (enabled, updated_by_admin_user_id, update_reason) ON feature_flags TO lsw_app;

GRANT SELECT ON feature_flag_settings TO lsw_app;
GRANT UPDATE (amoe_mode, updated_by_admin_user_id, update_reason) ON feature_flag_settings TO lsw_app;

-- Historico: la aplicacion lo LEE. Escribirlo es cosa del trigger SECURITY
-- DEFINER, precisamente para que no se pueda escribir a mano.
GRANT SELECT ON feature_flag_changes TO lsw_app;

GRANT SELECT ON feature_flags TO lsw_readonly_report;
GRANT SELECT ON feature_flag_settings TO lsw_readonly_report;
GRANT SELECT ON feature_flag_changes TO lsw_readonly_report;
