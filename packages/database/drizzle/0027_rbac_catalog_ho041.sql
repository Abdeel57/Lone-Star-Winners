-- ===========================================================================
-- 0027_rbac_catalog_ho041
--
-- Ajustes del catalogo RBAC que trae HO-041: la capacidad de transcripcion
-- (DEC-054 punto 4) y el step-up de `flag.update`.
--
-- POR QUE EXISTE ESTA MIGRACION
--
--   `packages/security` anadio la capacidad al catalogo canonico en esta misma
--   ronda (HO-041). El catalogo de codigo y las filas de `admin_permissions`
--   son la misma lista escrita dos veces por necesidad tecnica -una la lee el
--   autorizador, la otra la impone la base de datos- y `test/parity.test.ts`
--   las compara. Sin esta migracion, la ruta de transcripcion exigiria un
--   permiso que no existe en la base de datos y el registro deny-by-default de
--   DEC-015 se quedaria sin referencia.
--
-- POR QUE UNA MIGRACION NUEVA Y NO UNA EDICION DE 0004 NI DE 0007
--
--   DEC-005: forward-only. El razonamiento completo esta en la cabecera de
--   `0007`, que se escribio por el mismo motivo.
--
-- POR QUE EL INSERT NO NOMBRA `depends_on_feature_flag`
--
--   Desde `0008` esa columna es GENERADA a partir de `feature_flag_key` y no
--   se puede escribir. La dependencia se declara con el UPDATE de abajo, que es
--   la misma forma que usa `0008`.
--
-- LO QUE ESTA MIGRACION NO CONCEDE
--
--   Transcribir NO es aprobar. La capacidad mete una ficha en la cola de
--   revision y no escribe ni una fila del ledger. La regla "quien transcribe no
--   aprueba" es por ENVIO -depende de `metadata.transcribed_by_admin_user_id`-
--   y la impone el dominio (`SEPARATION_OF_DUTIES`), no el catalogo de roles:
--   por eso los dos roles que abren el correo pueden tener ademas
--   `amoe.review.approve` sin que eso rompa nada.
--
-- Referencias: DEC-005, DEC-015, DEC-027, DEC-032, DEC-054, HO-041.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. La capacidad
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('amoe.submission.transcribe', 'amoe', 'SENSITIVE', 'Transcribir al sistema una ficha AMOE recibida por correo, a nombre de otra persona. Entra en la cola de revision; no concede participaciones.', false, false, false, true, true, 'AMOE');


-- ---------------------------------------------------------------------------
-- 2. El flag que la gobierna (DEC-032)
--
--    Con `amoe_enabled` apagado, meter fichas en la cola crearia envios de un
--    metodo que las Official Rules vigentes no ofrecen, y alguien tendria que
--    decidir despues que hacer con ellos.
-- ---------------------------------------------------------------------------

UPDATE admin_permissions SET feature_flag_key = 'amoe_enabled'
  WHERE key = 'amoe.submission.transcribe';


-- ---------------------------------------------------------------------------
-- 3. Que roles la reciben
--
--    Los dos que pueden abrir el correo en un equipo pequeno. Quien ocupa cada
--    rol es decision del usuario, no de esta migracion.
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('PROMOTION_MANAGER', 'amoe.submission.transcribe'),
  ('COMPLIANCE_OFFICER', 'amoe.submission.transcribe');


-- ---------------------------------------------------------------------------
-- 4. `flag.update` deja de exigir step-up
--
--    RELAJA UN CONTROL, asi que la explicacion importa. La escribio
--    `packages/security` al revisar HO-041 y aqui solo se refleja: el catalogo
--    de codigo y estas filas son la misma lista, y `test/parity.test.ts` las
--    compara.
--
--    `flag.update` gobierna los flags NO legalmente materiales. Ninguno de
--    ellos cambia por si solo lo que se le promete al participante -esa es la
--    definicion de `legallyMaterial`- ni abre por si solo una via de escritura:
--    lo que `manual_adjustments_enabled` habilita sigue exigiendo step-up,
--    motivo y aprobacion de OTRO actor. Enfrente, la pantalla de flags de la
--    seccion 13.9 tiene un interruptor por fila, y exigir MFA reciente en cada
--    conmutacion lleva a una ventana de step-up permanentemente abierta, que es
--    peor control que ninguno porque ademas parece que existe.
--
--    Lo que NO cambia: el motivo sigue siendo obligatorio, y todo flag
--    legalmente material sigue pasando por `flag.update.legally_material`, que
--    si exige step-up.
-- ---------------------------------------------------------------------------

UPDATE admin_permissions SET requires_step_up = false
  WHERE key = 'flag.update';


-- ---------------------------------------------------------------------------
-- 5. Permisos de base de datos (DEC-003)
--
--    Ninguno nuevo: `0004` ya fijo los GRANT de `admin_permissions` y
--    `admin_role_permissions`, y el catalogo RBAC solo lo escribe el rol de
--    migracion. Se deja escrito para que quien audite los permisos no tenga
--    que deducir la ausencia.
-- ---------------------------------------------------------------------------
