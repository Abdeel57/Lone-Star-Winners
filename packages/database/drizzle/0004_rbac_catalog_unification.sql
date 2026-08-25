-- ---------------------------------------------------------------------------
-- 0004_rbac_catalog_unification.sql
--
-- DEC-027: unificacion del catalogo de autorizacion.
--
-- CONTEXTO
--   Hasta la migracion 0001, este esquema sembraba el catalogo que habia
--   escrito `backend`: claves tipo `promotion.read` y roles `SUPER_ADMIN`,
--   `OPERATIONS_ADMIN`, `CUSTOMER_SUPPORT`, `READ_ONLY_AUDITOR`. En paralelo,
--   `security` habia escrito otro en `packages/security`, con claves
--   `dominio.recurso.accion` y ocho roles distintos. Dos fuentes de verdad para
--   lo mismo, que es lo que prohibe `CLAUDE.md` seccion 4.
--
--   DEC-027 lo resuelve: gana el catalogo de `packages/security`, y este
--   esquema pasa a SEMBRARLO en vez de definirlo. `packages/database` ya no
--   tiene opinion sobre que capacidades existen.
--
-- QUE CAMBIA, EN CONCRETO
--   1. `admin_permissions` gana los metadatos que el catalogo de `security` si
--      modela y el anterior no: dominio, nivel de sensibilidad de tres valores,
--      motivo obligatorio, SEGUNDA APROBACION, emision de AuditEvent, acceso a
--      PII, dependencia de feature flag y dependencia legal. El booleano
--      `is_sensitive` se sustituye por `sensitivity`, del que se deriva.
--   2. `admin_roles` gana `kind`, `requires_mfa`, `assignable_to_human` y
--      `label_key`. El catalogo ya no describe solo al personal: incluye
--      `PARTICIPANT` y el actor no interactivo `SYSTEM`.
--   3. Se impone por CLAVE AJENA que a una cuenta de `admin_users` solo se le
--      pueda asignar un rol de personal. Sin esto, `SYSTEM` seria asignable a
--      una persona y la auditoria dejaria de poder distinguir un job de un
--      humano; y `PARTICIPANT` seria asignable a un empleado, que es justo lo
--      que DEC-028 separa.
--
-- QUE SE CONSERVA DEL DISENO ANTERIOR (DEC-027 lo adopta explicitamente)
--   - Ningun rol acumula "finalizar el export" y "sortear". Aqui es aun mas
--     fuerte que antes: NO EXISTE un rol con todos los privilegios. El rol que
--     administra cuentas, `SECURITY_ADMIN`, no tiene `export.finalize`, ni
--     `draw.authorization.create`, ni `draw.initiate`.
--   - La incompatibilidad entre roles se guarda como DATO y la impone el
--     trigger de 0001, no el codigo de la aplicacion.
--   - `COMPLIANCE_OFFICER`, no `COMPLIANCE_REVIEWER`.
--
-- SOBRE LA RESIEMBRA
--   Los roles anteriores desaparecen. Si alguna cuenta los tuviera asignados,
--   esta migracion SE DETIENE con un mensaje explicito en vez de borrar la
--   asignacion: quien tuvo que privilegio y cuando es exactamente el dato que
--   un auditor pide despues de un incidente. El remapeo es una decision
--   humana, no un efecto colateral de un despliegue.
--
--   La correspondencia entre estas filas y el catalogo TypeScript la vigila
--   `test/parity.test.ts`. Si divergen, CI falla.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Guardia: ninguna asignacion puede quedar huerfana
--
--    Se miran TODAS las filas, tambien las revocadas. No es una precaucion de
--    mas: `admin_user_roles.role_key` referencia `admin_roles` con ON DELETE
--    RESTRICT, asi que una sola asignacion historica de un rol que desaparece
--    haria fallar el DELETE de la seccion 5 con un error de clave ajena, sin
--    explicar nada. Y la fila revocada TIENE que sobrevivir: quien tuvo que
--    privilegio y cuando es exactamente el dato que un auditor pide despues de
--    un incidente (principio 6).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  stranded text;
BEGIN
  SELECT string_agg(DISTINCT role_key, ', ')
    INTO stranded
  FROM admin_user_roles
  WHERE role_key NOT IN (
      'PARTICIPANT', 'SUPPORT', 'PROMOTION_MANAGER', 'COMPLIANCE_OFFICER',
      'DRAW_OFFICER', 'EXPORT_OFFICER', 'SECURITY_ADMIN', 'SYSTEM'
    );

  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION
      'DEC-027: existen asignaciones de rol (vivas o historicas) para roles que el catalogo unificado ya no contiene (%). Reasignalas o remapealas explicitamente antes de migrar; esta migracion no borra historial de privilegios.',
      stranded
      USING ERRCODE = '23503';
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- 2. admin_permissions: metadatos del catalogo canonico
--
--    `sensitivity` sustituye al booleano anterior. Un booleano no distinguia
--    "toca dinero o PII" de "influye en quien gana", y esa distincion es la que
--    decide que se audita y que exige segunda aprobacion.
-- ---------------------------------------------------------------------------

ALTER TABLE admin_permissions
  DROP CONSTRAINT admin_permissions_step_up_implies_sensitive;

ALTER TABLE admin_permissions
  DROP COLUMN is_sensitive;

ALTER TABLE admin_permissions
  ADD COLUMN domain                   text NOT NULL DEFAULT 'system',
  ADD COLUMN sensitivity              text NOT NULL DEFAULT 'CRITICAL',
  ADD COLUMN requires_reason          boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_second_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN emits_audit_event        boolean NOT NULL DEFAULT true,
  ADD COLUMN touches_pii              boolean NOT NULL DEFAULT false,
  ADD COLUMN depends_on_feature_flag  boolean NOT NULL DEFAULT false,
  ADD COLUMN legal_dependency         text;

-- Los DEFAULT de arriba existen solo para poder anadir columnas NOT NULL a una
-- tabla con filas. El catalogo se reinserta entero mas abajo con valores
-- explicitos, asi que se retiran: un default que sobrevive convierte "se me
-- olvido declararlo" en "es CRITICAL", y esa clase de acierto es casual.
ALTER TABLE admin_permissions
  ALTER COLUMN domain                   DROP DEFAULT,
  ALTER COLUMN sensitivity              DROP DEFAULT,
  ALTER COLUMN requires_reason          DROP DEFAULT,
  ALTER COLUMN requires_second_approval DROP DEFAULT,
  ALTER COLUMN emits_audit_event        DROP DEFAULT,
  ALTER COLUMN touches_pii              DROP DEFAULT,
  ALTER COLUMN depends_on_feature_flag  DROP DEFAULT;

ALTER TABLE admin_permissions
  ADD CONSTRAINT admin_permissions_sensitivity_values
    CHECK (sensitivity IN ('ROUTINE', 'SENSITIVE', 'CRITICAL')),

  -- Equivalente al antiguo step_up_implies_sensitive: si una operacion exige
  -- re-autenticacion, no puede estar clasificada como rutinaria.
  ADD CONSTRAINT admin_permissions_step_up_implies_sensitive
    CHECK (NOT requires_step_up OR sensitivity <> 'ROUTINE'),

  -- Toda capacidad no rutinaria deja rastro. Es la premisa de DEC-008: lo que
  -- no emite AuditEvent no se puede reconstruir despues.
  ADD CONSTRAINT admin_permissions_non_routine_is_audited
    CHECK (sensitivity = 'ROUTINE' OR emits_audit_event),

  -- Una segunda aprobacion sin motivo escrito es una firma sin expediente.
  ADD CONSTRAINT admin_permissions_second_approval_implies_reason
    CHECK (NOT requires_second_approval OR requires_reason);

COMMENT ON COLUMN admin_permissions.sensitivity IS
  'ROUTINE | SENSITIVE | CRITICAL. CRITICAL = influye en quien gana o en la evidencia que ve un tercero.';
COMMENT ON COLUMN admin_permissions.requires_second_approval IS
  'DEC-017: exige aprobacion viva de un actor DISTINTO dentro de su TTL.';
COMMENT ON COLUMN admin_permissions.legal_dependency IS
  'Entrada de docs/LEGAL_PENDING.md de la que depende, si aplica. NULL = ninguna.';


-- ---------------------------------------------------------------------------
-- 3. admin_roles: el catalogo deja de ser solo de personal
--
--    `staff_assignable` es una columna GENERADA, no un dato que alguien
--    mantenga a mano. De ella cuelga la clave ajena compuesta de la seccion 4.
-- ---------------------------------------------------------------------------

ALTER TABLE admin_roles
  ADD COLUMN kind                text NOT NULL DEFAULT 'STAFF',
  ADD COLUMN requires_mfa        boolean NOT NULL DEFAULT true,
  ADD COLUMN assignable_to_human boolean NOT NULL DEFAULT true,
  ADD COLUMN label_key           text NOT NULL DEFAULT 'role.unknown';

ALTER TABLE admin_roles
  ALTER COLUMN kind                DROP DEFAULT,
  ALTER COLUMN requires_mfa        DROP DEFAULT,
  ALTER COLUMN assignable_to_human DROP DEFAULT,
  ALTER COLUMN label_key           DROP DEFAULT;

ALTER TABLE admin_roles
  ADD COLUMN staff_assignable boolean
    GENERATED ALWAYS AS (kind = 'STAFF' AND assignable_to_human) STORED;

ALTER TABLE admin_roles
  ADD CONSTRAINT admin_roles_kind_values
    CHECK (kind IN ('PARTICIPANT', 'STAFF', 'SYSTEM')),

  -- DEC-006: todo rol de personal exige MFA. No es configurable por fila.
  ADD CONSTRAINT admin_roles_staff_requires_mfa
    CHECK (kind <> 'STAFF' OR requires_mfa),

  -- El actor no interactivo nunca se asigna a una persona: si se pudiera, la
  -- auditoria dejaria de distinguir un job de un humano.
  ADD CONSTRAINT admin_roles_system_not_assignable
    CHECK (kind <> 'SYSTEM' OR NOT assignable_to_human),

  ADD CONSTRAINT admin_roles_label_key_shape
    CHECK (label_key ~ '^role\.[a-z][a-z0-9_]*$'),

  -- Necesaria para que la clave ajena compuesta de la seccion 4 pueda apuntar
  -- a (key, staff_assignable).
  ADD CONSTRAINT admin_roles_key_staff_assignable_key
    UNIQUE (key, staff_assignable);

COMMENT ON COLUMN admin_roles.staff_assignable IS
  'Derivada. Solo un rol de personal asignable a humanos puede llegar a admin_user_roles.';


-- ---------------------------------------------------------------------------
-- 4. admin_user_roles: solo roles de personal
--
--    Se impone con una clave ajena compuesta contra
--    admin_roles (key, staff_assignable) y un CHECK que fija el segundo
--    componente a true. Es declarativo: no depende de que la aplicacion se
--    acuerde, ni de un trigger que alguien pueda desactivar.
-- ---------------------------------------------------------------------------

ALTER TABLE admin_user_roles
  ADD COLUMN role_is_staff_assignable boolean NOT NULL DEFAULT true;

ALTER TABLE admin_user_roles
  ADD CONSTRAINT admin_user_roles_only_staff_roles
    CHECK (role_is_staff_assignable),

  -- `ON UPDATE RESTRICT`, no CASCADE: PostgreSQL rechaza CASCADE (y SET NULL /
  -- SET DEFAULT) sobre una clave ajena que referencia una columna GENERADA.
  -- Y ademas es lo que se quiere: si alguien intentara cambiar el `kind` de un
  -- rol que hay asignado a personas, lo correcto es que falle, no que la
  -- asignacion se propague en silencio.
  ADD CONSTRAINT admin_user_roles_role_must_be_staff_assignable
    FOREIGN KEY (role_key, role_is_staff_assignable)
    REFERENCES admin_roles (key, staff_assignable)
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

COMMENT ON COLUMN admin_user_roles.role_is_staff_assignable IS
  'Siempre true. Existe para que la clave ajena compuesta obligue a que el rol referenciado sea de personal (DEC-027, DEC-028).';


-- ---------------------------------------------------------------------------
-- 5. Resiembra del catalogo
--
--    Se vacian las tres tablas y se reinsertan desde cero. El orden respeta las
--    claves ajenas. `admin_user_roles` NO se toca: la seccion 1 ya ha
--    garantizado que no queda ninguna asignacion viva incompatible.
-- ---------------------------------------------------------------------------

DELETE FROM admin_role_conflicts;
DELETE FROM admin_role_permissions;
DELETE FROM admin_roles;
DELETE FROM admin_permissions;


-- ---------------------------------------------------------------------------
-- 6. Capacidades (packages/security/src/capabilities.ts)
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   depends_on_feature_flag, legal_dependency) VALUES
  ('session.self.read', 'session', 'ROUTINE', 'Ver su propia sesion.', false, false, false, false, false, false, NULL),
  ('session.self.revoke', 'session', 'ROUTINE', 'Cerrar sus propias sesiones.', false, false, false, false, false, false, NULL),
  ('participant.self.read', 'participant', 'ROUTINE', 'Ver su propio perfil.', false, false, false, false, true, false, NULL),
  ('participant.self.update', 'participant', 'ROUTINE', 'Editar su propio perfil.', false, false, false, true, true, false, NULL),
  ('entry.self.read', 'entry', 'ROUTINE', 'Ver su propio historial de entries. Nunca el de otro participante.', false, false, false, false, false, false, NULL),
  ('order.self.read', 'order', 'ROUTINE', 'Ver sus propios pedidos.', false, false, false, false, false, false, NULL),
  ('amoe.self.submit', 'amoe', 'SENSITIVE', 'Enviar una participacion sin compra. El metodo exacto lo fijan las Official Rules.', false, false, false, true, false, true, 'AMOE'),
  ('participant.list', 'participant', 'SENSITIVE', 'Listar y buscar participantes.', false, false, false, true, true, false, NULL),
  ('participant.read', 'participant', 'SENSITIVE', 'Ver la ficha de un participante.', false, false, false, true, true, false, NULL),
  ('pii.view.masked', 'pii', 'SENSITIVE', 'Ver datos personales enmascarados (ultimos digitos, dominio de correo).', false, false, false, true, true, false, NULL),
  ('pii.view.full', 'pii', 'CRITICAL', 'Ver datos personales completos. Minimizacion: solo cuando la tarea concreta lo exige.', true, true, false, true, true, false, NULL),
  ('pii.export', 'pii', 'CRITICAL', 'Extraer datos personales fuera del sistema.', true, true, true, true, true, false, NULL),
  ('order.read', 'order', 'SENSITIVE', 'Ver pedidos de cualquier participante.', false, false, false, true, false, false, NULL),
  ('entry.ledger.read', 'entry', 'SENSITIVE', 'Leer el ledger de entries de cualquier participante.', false, false, false, true, false, false, NULL),
  ('reconciliation.read', 'reconciliation', 'SENSITIVE', 'Ver el informe de reconciliacion. Las cifras las produce el backend, nunca el cliente.', false, false, false, true, false, false, NULL),
  ('audit.read', 'audit', 'SENSITIVE', 'Leer la traza de auditoria.', false, false, false, true, false, false, NULL),
  ('audit.integrity.verify', 'audit', 'SENSITIVE', 'Ejecutar la verificacion de la hash chain (DEC-008).', false, false, false, true, false, false, NULL),
  ('order.refund.initiate', 'order', 'SENSITIVE', 'Iniciar un reembolso. Genera la reversal correspondiente en el ledger.', true, true, false, true, false, false, NULL),
  ('payment.webhook.replay', 'payment', 'SENSITIVE', 'Reprocesar un webhook ya persistido. DEC-009: la idempotencia la garantiza la base de datos, no este permiso.', true, true, false, true, false, false, NULL),
  ('entry.adjust.create', 'entry', 'CRITICAL', 'Proponer un ajuste manual de entries. Nunca se aplica solo: exige aprobacion de otro actor.', true, true, true, true, false, true, NULL),
  ('entry.adjust.approve', 'entry', 'CRITICAL', 'Aprobar un ajuste manual propuesto por OTRO actor.', true, true, false, true, false, false, NULL),
  ('entry.reversal.create', 'entry', 'CRITICAL', 'Registrar la reversal de un refund o chargeback. Normalmente la ejecuta SYSTEM desde un webhook verificado.', false, true, false, true, false, false, NULL),
  ('participant.disqualify', 'participant', 'CRITICAL', 'Descalificar a un participante. DEC-007: se registra, no se borra nada.', true, true, false, true, false, false, 'ELIGIBILITY'),
  ('amoe.review.read', 'amoe', 'SENSITIVE', 'Ver la cola de revision de participaciones AMOE.', false, false, false, true, true, false, NULL),
  ('amoe.review.approve', 'amoe', 'CRITICAL', 'Aprobar una participacion AMOE y generar su entry.', false, true, false, true, false, true, 'AMOE'),
  ('amoe.review.reject', 'amoe', 'CRITICAL', 'Rechazar una participacion AMOE. El motivo es obligatorio y el historico se conserva.', false, true, false, true, false, true, 'AMOE'),
  ('promotion.create', 'promotion', 'SENSITIVE', 'Crear una promocion.', false, false, false, true, false, false, NULL),
  ('promotion.update', 'promotion', 'SENSITIVE', 'Editar una promocion que todavia no esta activa.', false, false, false, true, false, false, NULL),
  ('promotion.activate', 'promotion', 'CRITICAL', 'Activar una promocion. DEC-012: se bloquea si queda una clave legal en TBD.', true, true, false, true, false, false, 'OFFICIAL_RULES'),
  ('promotion.close', 'promotion', 'CRITICAL', 'Cerrar la promocion. DEC-011: el deadline se evalua en el servidor contra la timezone legal.', true, true, false, true, false, false, 'OFFICIAL_RULES'),
  ('rules.version.create', 'rules', 'SENSITIVE', 'Crear una version de reglas en DRAFT.', false, false, false, true, false, false, NULL),
  ('rules.version.activate', 'rules', 'CRITICAL', 'Activar una version de reglas aprobada por el abogado del cliente.', true, true, false, true, false, false, 'OFFICIAL_RULES'),
  ('flag.read', 'flag', 'ROUTINE', 'Leer el estado de los feature flags.', false, false, false, false, false, false, NULL),
  ('flag.update', 'flag', 'SENSITIVE', 'Cambiar un feature flag no legalmente material.', true, true, false, true, false, false, NULL),
  ('flag.update.legally_material', 'flag', 'CRITICAL', 'Cambiar un flag legalmente material (AMOE, numeros visibles, publicacion de ganador, sorteo interno).', true, true, true, true, false, false, 'OFFICIAL_RULES'),
  ('export.snapshot.create', 'export', 'SENSITIVE', 'Generar un snapshot en DRAFT. Funcion pura del corte y de la version de reglas.', false, false, false, true, false, false, NULL),
  ('export.snapshot.validate', 'export', 'SENSITIVE', 'Ejecutar la reconciliacion previa a finalizar. Los errores criticos bloquean.', false, false, false, true, false, false, NULL),
  ('export.finalize', 'export', 'CRITICAL', 'Finalizar el snapshot: a partir de aqui es inmutable y su hash es evidencia.', true, true, false, true, false, false, NULL),
  ('export.download', 'export', 'CRITICAL', 'Descargar un export finalizado. Cada acceso deja AuditEvent.', true, true, false, true, true, false, NULL),
  ('export.deliver', 'export', 'CRITICAL', 'Entregar el export al administrador externo por el canal configurado.', true, true, false, true, true, false, NULL),
  ('tpa.config.update', 'tpa', 'CRITICAL', 'Configurar el adaptador del third-party administrator (destino, credenciales, esquema).', true, true, false, true, false, false, 'TPA'),
  ('draw.authorization.create', 'draw', 'CRITICAL', 'Registrar una DrawAuthorization con referencia al documento de aprobacion. Sin ella el sorteo devuelve 403 aunque el flag este activo.', true, true, false, true, false, true, 'INTERNAL_DRAW'),
  ('draw.initiate', 'draw', 'CRITICAL', 'Iniciar un sorteo sobre un snapshot FINALIZED cuyo hash se recalcula en el momento.', true, true, true, true, false, true, 'INTERNAL_DRAW'),
  ('draw.result.read', 'draw', 'SENSITIVE', 'Consultar el registro inmutable de un sorteo.', false, false, false, true, false, false, NULL),
  ('winner.workflow.read', 'winner', 'SENSITIVE', 'Ver el expediente de un ganador potencial.', false, false, false, true, true, false, NULL),
  ('winner.status.update', 'winner', 'CRITICAL', 'Avanzar el estado de verificacion. Sustituir a un seleccionado exige motivo y conserva el historico.', true, true, false, true, false, false, 'WINNER_VERIFICATION'),
  ('winner.publish', 'winner', 'CRITICAL', 'Publicar un ganador confirmado. Nunca automatico.', true, true, true, true, true, true, 'WINNER_PUBLICATION'),
  ('rbac.admin.create', 'rbac', 'CRITICAL', 'Crear una cuenta de personal. DEC-006: MFA obligatoria desde el primer acceso.', true, true, false, true, false, false, NULL),
  ('rbac.role.assign', 'rbac', 'CRITICAL', 'Asignar o retirar roles. Es la via mas corta para saltarse cualquier otro control, asi que exige segunda aprobacion.', true, true, true, true, false, false, NULL),
  ('session.revoke.any', 'session', 'SENSITIVE', 'Revocar la sesion de cualquier usuario. DEC-006: las sesiones son opacas y revocables.', false, true, false, true, false, false, NULL),
  ('system.job.run', 'system', 'SENSITIVE', 'Ejecutar trabajos del sistema (verificador de integridad, sellado diario, reconciliacion).', false, false, false, true, false, false, NULL);


-- ---------------------------------------------------------------------------
-- 7. Roles (packages/security/src/roles.ts)
-- ---------------------------------------------------------------------------

INSERT INTO admin_roles
  (key, kind, requires_mfa, assignable_to_human, label_key, description) VALUES
  ('PARTICIPANT', 'PARTICIPANT', false, true, 'role.participant', 'Solo sus propios datos. Nunca ve el ledger ni el PII de otro participante.'),
  ('SUPPORT', 'STAFF', true, true, 'role.support', 'Atencion al participante. Lectura con PII enmascarado. No ajusta entries, no descalifica, no finaliza exports, no sortea.'),
  ('PROMOTION_MANAGER', 'STAFF', true, true, 'role.promotion_manager', 'Opera promociones, catalogo y versiones de reglas. Puede PROPONER un ajuste manual, nunca aprobarlo.'),
  ('COMPLIANCE_OFFICER', 'STAFF', true, true, 'role.compliance_officer', 'Auditoria, reconciliacion, aprobacion de ajustes, finalizacion de snapshots y autorizacion de sorteo. DEC-017: NO puede iniciar el sorteo que autoriza.'),
  ('DRAW_OFFICER', 'STAFF', true, true, 'role.draw_officer', 'Unico rol que puede iniciar un sorteo interno, y solo con los cinco cerrojos de DEC-017. NO puede finalizar el snapshot sobre el que sortea.'),
  ('EXPORT_OFFICER', 'STAFF', true, true, 'role.export_officer', 'Descarga y entrega al third-party administrator. NO finaliza el snapshot: quien lo declara correcto y quien se lo lleva son personas distintas.'),
  ('SECURITY_ADMIN', 'STAFF', true, true, 'role.security_admin', 'Administra cuentas, roles y sesiones, y lee la auditoria. Deliberadamente SIN capacidades operativas: no ve PII completo, no exporta, no sortea, no ajusta entries.'),
  ('SYSTEM', 'SYSTEM', false, false, 'role.system', 'Jobs, webhooks y verificadores de integridad. Sus acciones se auditan con actor_type=SYSTEM.');


-- ---------------------------------------------------------------------------
-- 8. Matriz rol x capacidad (packages/security/src/permissions.ts)
--
--    Deny-by-default: lo que no aparece aqui, ese rol no lo puede hacer. Las
--    ausencias son tan deliberadas como las presencias.
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  -- PARTICIPANT
  ('PARTICIPANT', 'session.self.read'),
  ('PARTICIPANT', 'session.self.revoke'),
  ('PARTICIPANT', 'participant.self.read'),
  ('PARTICIPANT', 'participant.self.update'),
  ('PARTICIPANT', 'entry.self.read'),
  ('PARTICIPANT', 'order.self.read'),
  ('PARTICIPANT', 'amoe.self.submit'),

  -- SUPPORT
  ('SUPPORT', 'session.self.read'),
  ('SUPPORT', 'session.self.revoke'),
  ('SUPPORT', 'participant.list'),
  ('SUPPORT', 'participant.read'),
  ('SUPPORT', 'pii.view.masked'),
  ('SUPPORT', 'order.read'),
  ('SUPPORT', 'entry.ledger.read'),
  ('SUPPORT', 'amoe.review.read'),

  -- PROMOTION_MANAGER
  ('PROMOTION_MANAGER', 'session.self.read'),
  ('PROMOTION_MANAGER', 'session.self.revoke'),
  ('PROMOTION_MANAGER', 'participant.list'),
  ('PROMOTION_MANAGER', 'participant.read'),
  ('PROMOTION_MANAGER', 'pii.view.masked'),
  ('PROMOTION_MANAGER', 'order.read'),
  ('PROMOTION_MANAGER', 'order.refund.initiate'),
  ('PROMOTION_MANAGER', 'entry.ledger.read'),
  ('PROMOTION_MANAGER', 'entry.adjust.create'),
  ('PROMOTION_MANAGER', 'amoe.review.read'),
  ('PROMOTION_MANAGER', 'amoe.review.approve'),
  ('PROMOTION_MANAGER', 'amoe.review.reject'),
  ('PROMOTION_MANAGER', 'promotion.create'),
  ('PROMOTION_MANAGER', 'promotion.update'),
  ('PROMOTION_MANAGER', 'promotion.activate'),
  ('PROMOTION_MANAGER', 'promotion.close'),
  ('PROMOTION_MANAGER', 'rules.version.create'),
  ('PROMOTION_MANAGER', 'flag.read'),
  ('PROMOTION_MANAGER', 'reconciliation.read'),

  -- COMPLIANCE_OFFICER
  ('COMPLIANCE_OFFICER', 'session.self.read'),
  ('COMPLIANCE_OFFICER', 'session.self.revoke'),
  ('COMPLIANCE_OFFICER', 'participant.list'),
  ('COMPLIANCE_OFFICER', 'participant.read'),
  ('COMPLIANCE_OFFICER', 'pii.view.masked'),
  ('COMPLIANCE_OFFICER', 'pii.view.full'),
  ('COMPLIANCE_OFFICER', 'order.read'),
  ('COMPLIANCE_OFFICER', 'entry.ledger.read'),
  ('COMPLIANCE_OFFICER', 'entry.adjust.approve'),
  ('COMPLIANCE_OFFICER', 'participant.disqualify'),
  ('COMPLIANCE_OFFICER', 'amoe.review.read'),
  ('COMPLIANCE_OFFICER', 'amoe.review.approve'),
  ('COMPLIANCE_OFFICER', 'amoe.review.reject'),
  ('COMPLIANCE_OFFICER', 'rules.version.create'),
  ('COMPLIANCE_OFFICER', 'rules.version.activate'),
  ('COMPLIANCE_OFFICER', 'flag.read'),
  ('COMPLIANCE_OFFICER', 'flag.update.legally_material'),
  ('COMPLIANCE_OFFICER', 'reconciliation.read'),
  ('COMPLIANCE_OFFICER', 'audit.read'),
  ('COMPLIANCE_OFFICER', 'audit.integrity.verify'),
  ('COMPLIANCE_OFFICER', 'export.snapshot.create'),
  ('COMPLIANCE_OFFICER', 'export.snapshot.validate'),
  ('COMPLIANCE_OFFICER', 'export.finalize'),
  ('COMPLIANCE_OFFICER', 'draw.authorization.create'),
  ('COMPLIANCE_OFFICER', 'draw.result.read'),
  ('COMPLIANCE_OFFICER', 'winner.workflow.read'),
  ('COMPLIANCE_OFFICER', 'winner.status.update'),
  ('COMPLIANCE_OFFICER', 'winner.publish'),

  -- DRAW_OFFICER
  ('DRAW_OFFICER', 'session.self.read'),
  ('DRAW_OFFICER', 'session.self.revoke'),
  ('DRAW_OFFICER', 'flag.read'),
  ('DRAW_OFFICER', 'draw.initiate'),
  ('DRAW_OFFICER', 'draw.result.read'),
  ('DRAW_OFFICER', 'winner.workflow.read'),

  -- EXPORT_OFFICER
  ('EXPORT_OFFICER', 'session.self.read'),
  ('EXPORT_OFFICER', 'session.self.revoke'),
  ('EXPORT_OFFICER', 'flag.read'),
  ('EXPORT_OFFICER', 'reconciliation.read'),
  ('EXPORT_OFFICER', 'export.snapshot.validate'),
  ('EXPORT_OFFICER', 'export.download'),
  ('EXPORT_OFFICER', 'export.deliver'),
  ('EXPORT_OFFICER', 'tpa.config.update'),

  -- SECURITY_ADMIN
  ('SECURITY_ADMIN', 'session.self.read'),
  ('SECURITY_ADMIN', 'session.self.revoke'),
  ('SECURITY_ADMIN', 'session.revoke.any'),
  ('SECURITY_ADMIN', 'rbac.admin.create'),
  ('SECURITY_ADMIN', 'rbac.role.assign'),
  ('SECURITY_ADMIN', 'flag.read'),
  ('SECURITY_ADMIN', 'flag.update'),
  ('SECURITY_ADMIN', 'audit.read'),
  ('SECURITY_ADMIN', 'audit.integrity.verify'),

  -- SYSTEM
  ('SYSTEM', 'system.job.run'),
  ('SYSTEM', 'audit.integrity.verify'),
  ('SYSTEM', 'entry.reversal.create'),
  ('SYSTEM', 'payment.webhook.replay');


-- ---------------------------------------------------------------------------
-- 9. Incompatibilidades entre roles (DEC-017 cerrojo 3)
--
--    DERIVADAS de SEPARATION_OF_DUTIES, que packages/security declara en
--    terminos de CAPACIDADES. Para cada restriccion, todo par de roles tal que
--    uno concede la primera capacidad y el otro la segunda.
--
--    Se derivan, no se escriben a mano: escritas a mano, anadir a un rol una
--    capacidad conflictiva no produciria ningun conflicto nuevo y el control se
--    degradaria en silencio. test/parity.test.ts comprueba que estas filas
--    coinciden con la derivacion.
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_conflicts (role_key_a, role_key_b, reason) VALUES
  ('COMPLIANCE_OFFICER', 'DRAW_OFFICER', 'DEC-017: Quien declara inmutable el universo de entries no puede ser quien sortea sobre el. Si lo fuera, la eleccion del corte y la eleccion del ganador tendrian el mismo autor.'),
  ('COMPLIANCE_OFFICER', 'EXPORT_OFFICER', 'DEC-016: Quien declara correcto el contenido y quien se lo lleva al administrador externo deben ser personas distintas.'),
  ('COMPLIANCE_OFFICER', 'PROMOTION_MANAGER', 'DEC-007: Un ajuste manual que se aprueba a si mismo es una edicion del ledger con otro nombre.');


-- ---------------------------------------------------------------------------
-- 10. Permisos de base de datos (DEC-003)
--
--     El catalogo sigue siendo de SOLO LECTURA en tiempo de ejecucion: las
--     columnas nuevas heredan el GRANT de tabla de 0001 y no se concede ningun
--     INSERT ni UPDATE nuevo. Cambiar una capacidad exige una migracion, que
--     pasa por revision de codigo.
-- ---------------------------------------------------------------------------
