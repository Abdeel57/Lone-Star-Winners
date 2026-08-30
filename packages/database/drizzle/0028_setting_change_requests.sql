-- ===========================================================================
-- 0028_setting_change_requests
--
-- Control dual para los ajustes legalmente materiales (DEC-032, DEC-054).
--
-- EL PROBLEMA QUE RESUELVE
--
--   `flag.update.legally_material` declara `requiresSecondApproval` en el
--   catalogo de `packages/security`. Una capacidad asi se DENIEGA en la puerta
--   salvo que la ruta nombre donde se impone la segunda aprobacion
--   (`secondApprovalEnforcedBy`), y hasta ahora no habia ningun sitio donde
--   imponerla: encender un flag legalmente material era una sola pulsacion de
--   una sola persona.
--
--   La respuesta correcta no era rebajar la capacidad -eso convierte un control
--   acordado en una molestia que se quita-, sino construir el control. Este es
--   el mismo patron que `0022_entry_operations` monto para los ajustes
--   manuales, y por el mismo motivo.
--
-- LOS DOS CERROJOS, Y POR QUE HACEN FALTA LOS DOS
--
--   1. El SERVICIO comprueba que quien aprueba no es quien pidio, porque es el
--      unico que puede devolver un error explicable.
--   2. El CHECK `setting_change_requests_approver_differs` lo impide aunque la
--      aplicacion fallara, tuviera un error o alguien escribiera por otro
--      camino. Un control que solo vive en el codigo de la aplicacion es un
--      control que desaparece con un `UPDATE` suelto.
--
-- QUE NO GUARDA ESTA TABLA
--
--   Ningun valor legal. `requested_value` es el valor SOLICITADO -un booleano
--   de flag o una modalidad AMOE-, no una regla: las reglas siguen viviendo en
--   `PromotionRulesVersion` (DEC-012). Y `amoe_mode` se vuelve a validar contra
--   la version de reglas activa EN EL MOMENTO DE APLICAR, no al solicitar: entre
--   una cosa y otra puede publicarse una version nueva.
--
-- APPEND-ONLY NO, PERO WRITE-ONCE DONDE IMPORTA
--
--   Una solicitud CAMBIA de estado -se aprueba o se rechaza-, igual que un
--   `adjustment`. Lo que no se puede es REESCRIBIR UNA DECISION YA TOMADA, y
--   eso no lo impide ningun CHECK: lo impide el trigger
--   `setting_change_requests_enforce_immutability` de la seccion 3, calcado de
--   `lsw_adjustments_are_write_once_where_it_matters()` de `0022`.
--
--   La version anterior de esta cabecera afirmaba que el CHECK bastaba. No
--   bastaba: las CHECK cubren `approver_differs` y la coherencia de la
--   decision, pero una fila `APPLIED` podia pasar a `REJECTED` y `decided_by`
--   se podia reescribir. El camino de la aplicacion era seguro -el UPDATE solo
--   toca filas `PENDING_APPROVAL`- y el criterio del repositorio es que estas
--   cosas las imponga el motor, no la aplicacion.
--
--   El ledger, que si es append-only, no lo toca esta tabla en ningun caso.
--
-- Referencias: DEC-003, DEC-005, DEC-011, DEC-013, DEC-032, DEC-054, HO-041.
-- ===========================================================================


CREATE TYPE setting_change_kind AS ENUM ('FEATURE_FLAG', 'AMOE_MODE');

CREATE TYPE setting_change_status AS ENUM ('PENDING_APPROVAL', 'APPLIED', 'REJECTED');


CREATE TABLE setting_change_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  setting_kind                setting_change_kind NOT NULL,

  -- La clave del flag, o literalmente `amoe_mode`. Texto y no
  -- `feature_flag_key`: la tabla cubre las DOS clases de ajuste, y una clave
  -- ajena al enum -como `amoe_mode`- no cabria en el tipo enumerado.
  setting_key                 text NOT NULL,

  -- `{ "enabled": bool }` o `{ "amoe_mode": AmoeMode | null }`. Se guarda como
  -- JSON y no en dos columnas tipadas porque son dos formas distintas del mismo
  -- concepto -"lo que se quiere dejar escrito"- y dos columnas obligarian a que
  -- una estuviera siempre nula.
  requested_value             jsonb NOT NULL,

  status                      setting_change_status NOT NULL DEFAULT 'PENDING_APPROVAL',

  -- DEC-013: motivo obligatorio. No hay cambio material sin explicacion.
  reason_code                 text NOT NULL,
  reason_text                 text,

  requested_by_admin_user_id  uuid NOT NULL REFERENCES admin_users (id) ON DELETE RESTRICT,
  requested_at                timestamptz NOT NULL DEFAULT now(),

  decided_by_admin_user_id    uuid REFERENCES admin_users (id) ON DELETE RESTRICT,
  decided_at                  timestamptz,
  decision_notes              text,

  -- El estado ANTES y DESPUES de aplicar, congelado. Sin esto, reconstruir que
  -- valor tenia el ajuste antes de un cambio exigiria reconstruir toda la
  -- cadena de `feature_flag_changes` hacia atras.
  applied_before              jsonb,
  applied_after               jsonb,

  CONSTRAINT setting_change_requests_reason_shape
    CHECK (reason_code ~ '^[a-zA-Z][a-zA-Z0-9_.]{2,63}$'),

  CONSTRAINT setting_change_requests_key_shape
    CHECK (length(btrim(setting_key)) BETWEEN 1 AND 100),

  CONSTRAINT setting_change_requests_value_is_object
    CHECK (jsonb_typeof(requested_value) = 'object'),

  -- LA SEPARACION DE FUNCIONES, EN EL MOTOR.
  CONSTRAINT setting_change_requests_approver_differs
    CHECK (
      decided_by_admin_user_id IS NULL
      OR decided_by_admin_user_id <> requested_by_admin_user_id
    ),

  -- Una solicitud decidida tiene decisor e instante; una pendiente no tiene
  -- ninguno de los dos. El estado intermedio -decidida por nadie, o decidida
  -- sin fecha- no significa nada y no debe poder escribirse.
  CONSTRAINT setting_change_requests_decision_consistency
    CHECK (
      (status = 'PENDING_APPROVAL'
        AND decided_by_admin_user_id IS NULL
        AND decided_at IS NULL)
      OR (status <> 'PENDING_APPROVAL'
        AND decided_by_admin_user_id IS NOT NULL
        AND decided_at IS NOT NULL)
    )
);

CREATE INDEX setting_change_requests_pending_idx
  ON setting_change_requests (setting_kind, setting_key)
  WHERE status = 'PENDING_APPROVAL';

CREATE INDEX setting_change_requests_recent_idx
  ON setting_change_requests (requested_at DESC);

COMMENT ON TABLE setting_change_requests IS
  'DEC-032/DEC-054: control dual de flags legalmente materiales y de amoe_mode. La CHECK approver_differs lo impone aunque la aplicacion fallara.';


-- ---------------------------------------------------------------------------
-- 3. Una decision no se reescribe (calcado de `0022_entry_operations`)
--
--    Transiciones validas, y ninguna mas:
--
--      PENDING_APPROVAL -> APPLIED
--      PENDING_APPROVAL -> REJECTED
--
--    Desde cualquier otro estado, el UPDATE se rechaza ENTERO: ni cambiar el
--    estado, ni el decisor, ni las notas, ni el `applied_before`. Una decision
--    sobre un ajuste legalmente material es evidencia, y la evidencia que se
--    puede editar despues no prueba nada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lsw_setting_change_requests_enforce_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION
      'La solicitud de cambio % ya esta %: una decision tomada no se reescribe.',
      OLD.id, OLD.status
      USING ERRCODE = '55006';
  END IF;

  IF NEW.status NOT IN ('APPLIED', 'REJECTED') THEN
    RAISE EXCEPTION
      'Transicion no permitida para la solicitud %: PENDING_APPROVAL -> %.',
      OLD.id, NEW.status
      USING ERRCODE = '23514';
  END IF;

  -- Lo que se pidio es tan inmutable como quien lo pidio: decidir no es
  -- ocasion para cambiar el valor solicitado ni el motivo con el que se
  -- autorizo la peticion.
  IF NEW.setting_kind IS DISTINCT FROM OLD.setting_kind
     OR NEW.setting_key IS DISTINCT FROM OLD.setting_key
     OR NEW.requested_value IS DISTINCT FROM OLD.requested_value
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.reason_text IS DISTINCT FROM OLD.reason_text
     OR NEW.requested_by_admin_user_id IS DISTINCT FROM OLD.requested_by_admin_user_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION
      'La peticion de la solicitud % es inmutable: decidir no reescribe lo que se pidio.',
      OLD.id
      USING ERRCODE = '55006';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER setting_change_requests_enforce_immutability
  BEFORE UPDATE ON setting_change_requests
  FOR EACH ROW EXECUTE FUNCTION lsw_setting_change_requests_enforce_immutability();

COMMENT ON FUNCTION lsw_setting_change_requests_enforce_immutability() IS
  'DEC-032/DEC-054: una decision tomada no se reescribe. El GRANT de UPDATE existe para PENDING_APPROVAL -> APPLIED | REJECTED y para nada mas.';


-- ---------------------------------------------------------------------------
-- Permisos de base de datos (DEC-003)
--
--   La aplicacion crea y decide solicitudes, asi que necesita INSERT y UPDATE.
--   NO tiene DELETE: una solicitud rechazada es evidencia de que alguien pidio
--   algo y otro dijo que no, y esa es justamente la clase de hecho que un
--   tercero puede querer revisar.
--
--   El UPDATE que concede este GRANT es EXACTAMENTE el de la transicion
--   PENDING_APPROVAL -> APPLIED | REJECTED: el trigger de la seccion 3
--   rechaza cualquier otro, incluido el del propietario de la tabla.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON setting_change_requests TO lsw_app;

GRANT SELECT ON setting_change_requests TO lsw_readonly_report;
