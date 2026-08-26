-- ===========================================================================
-- 0007_rbac_read_capabilities
--
-- Resuelve HO-013: el catalogo canonico de packages/security no tenia NINGUNA
-- capacidad de lectura para promociones, versiones de reglas, catalogo, panel,
-- webhooks, snapshots, configuracion del TPA, cuentas de personal ni sesiones
-- ajenas.
--
-- La consecuencia concreta era absurda y real: PROMOTION_MANAGER podia crear y
-- activar una promocion, pero no podia leerla. DRAW_OFFICER podia iniciar un
-- sorteo sin poder saber sobre que snapshot iba a sortear. Y
-- session.revoke.any obligaba a revocar a ciegas.
--
-- POR QUE UNA MIGRACION NUEVA Y NO UNA EDICION DE 0004
--
--   DEC-005 fija migraciones SQL forward-only. Editar 0004 haria que dos
--   entornos con la misma version de esquema tuvieran catalogos distintos segun
--   cuando aplicaron la migracion, y el journal no podria detectarlo. Una
--   migracion nueva es mas larga de leer y es la unica que se puede auditar.
--
-- QUE SE ANADE, Y DE DONDE SALE
--
--   Las 11 capacidades y los 31 pares rol-capacidad de abajo estan DERIVADOS
--   del catalogo de @lsw/security (DEC-027), no escritos a mano.
--   test/parity.test.ts compara la union de lo sembrado por 0004 y 0007 contra
--   ese catalogo: si security anade una capacidad y nadie escribe la migracion,
--   el test falla, que es lo que debe pasar.
--
--   Ninguna de estas capacidades concede escritura sobre el ledger, ni sobre el
--   sorteo, ni relaja ninguna separacion de funciones de DEC-017: son todas de
--   LECTURA salvo product.write y product.publish, que operan sobre el catalogo
--   de mercancia y ya pertenecian conceptualmente a PROMOTION_MANAGER.
--
-- Referencias: DEC-005, DEC-015, DEC-017, DEC-027.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Capacidades que faltaban
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   depends_on_feature_flag, legal_dependency) VALUES
  ('dashboard.read', 'dashboard', 'ROUTINE', 'Entrar al panel y ver sus agregados de cabecera. No devuelve PII ni cifras del ledger: la reconciliacion vive detras de reconciliation.read.', false, false, false, false, false, false, NULL),
  ('promotion.read', 'promotion', 'ROUTINE', 'Ver promociones desde el panel, incluidas las que estan en DRAFT. La vista publica del storefront NO usa esta capacidad: es una ruta PUBLIC que solo expone promociones ya activas.', false, false, false, false, false, false, NULL),
  ('product.read', 'product', 'ROUTINE', 'Ver el catalogo desde el panel, incluidos borradores y archivados. El storefront publico tampoco usa esta capacidad.', false, false, false, false, false, false, NULL),
  ('payment.webhook.read', 'payment', 'SENSITIVE', 'Inspeccionar los webhooks de pago ya persistidos y su resultado de proceso. Reprocesar sin poder leer seria operar a ciegas sobre dinero.', false, false, false, true, false, false, NULL),
  ('product.write', 'product', 'SENSITIVE', 'Crear y editar productos, variantes y traducciones. No cambia lo que se puede comprar: eso es product.publish.', false, false, false, true, false, false, NULL),
  ('product.publish', 'product', 'SENSITIVE', 'Cambiar el estado de un producto o variante: publicar, retirar, archivar. Se separa de product.write porque es lo unico que altera la mercancia realmente adquirible durante una promocion viva.', false, false, false, true, false, false, NULL),
  ('rules.version.read', 'rules', 'SENSITIVE', 'Leer una version de reglas, incluidas las que estan en DRAFT. Sensible porque un borrador es texto legal todavia no aprobado por el abogado del cliente, y porque un tercero debe poder reconstruir quien consulto que version antes de un corte.', false, false, false, true, false, false, NULL),
  ('export.snapshot.read', 'export', 'SENSITIVE', 'Listar snapshots y leer su manifiesto: estado, corte, version de reglas, recuentos y hash. No descarga el contenido, que es export.download. Sin ella, DRAW_OFFICER no podria ni siquiera saber sobre que snapshot va a sortear.', false, false, false, true, false, false, NULL),
  ('tpa.config.read', 'tpa', 'SENSITIVE', 'Leer la configuracion del administrador externo: destino, esquema y version. NUNCA devuelve credenciales; los secretos viven fuera del repositorio y no se exponen por API.', false, false, false, true, false, false, NULL),
  ('rbac.admin.read', 'rbac', 'SENSITIVE', 'Listar cuentas de personal y sus roles vigentes. Es la evidencia con la que se le demuestra a un tercero que la separacion de funciones se cumplio de verdad, y no solo que estaba configurada.', false, false, false, true, true, false, NULL),
  ('session.read.any', 'session', 'SENSITIVE', 'Listar las sesiones vivas de cualquier usuario. Sin ella, session.revoke.any obligaria a revocar a ciegas.', false, false, false, true, true, false, NULL);


-- ---------------------------------------------------------------------------
-- 2. Que rol recibe cada una
--
--    La atribucion la decide packages/security; aqui solo se persiste.
-- ---------------------------------------------------------------------------

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('SUPPORT', 'dashboard.read'),
  ('SUPPORT', 'promotion.read'),
  ('SUPPORT', 'product.read'),
  ('PROMOTION_MANAGER', 'dashboard.read'),
  ('PROMOTION_MANAGER', 'product.read'),
  ('PROMOTION_MANAGER', 'product.write'),
  ('PROMOTION_MANAGER', 'product.publish'),
  ('PROMOTION_MANAGER', 'promotion.read'),
  ('PROMOTION_MANAGER', 'rules.version.read'),
  ('COMPLIANCE_OFFICER', 'dashboard.read'),
  ('COMPLIANCE_OFFICER', 'promotion.read'),
  ('COMPLIANCE_OFFICER', 'product.read'),
  ('COMPLIANCE_OFFICER', 'payment.webhook.read'),
  ('COMPLIANCE_OFFICER', 'rules.version.read'),
  ('COMPLIANCE_OFFICER', 'rbac.admin.read'),
  ('COMPLIANCE_OFFICER', 'tpa.config.read'),
  ('COMPLIANCE_OFFICER', 'export.snapshot.read'),
  ('DRAW_OFFICER', 'dashboard.read'),
  ('DRAW_OFFICER', 'promotion.read'),
  ('DRAW_OFFICER', 'rules.version.read'),
  ('DRAW_OFFICER', 'export.snapshot.read'),
  ('EXPORT_OFFICER', 'dashboard.read'),
  ('EXPORT_OFFICER', 'promotion.read'),
  ('EXPORT_OFFICER', 'rules.version.read'),
  ('EXPORT_OFFICER', 'export.snapshot.read'),
  ('EXPORT_OFFICER', 'tpa.config.read'),
  ('SECURITY_ADMIN', 'dashboard.read'),
  ('SECURITY_ADMIN', 'session.read.any'),
  ('SECURITY_ADMIN', 'rbac.admin.read'),
  ('SYSTEM', 'entry.ledger.read'),
  ('SYSTEM', 'payment.webhook.read');


-- ---------------------------------------------------------------------------
-- 3. Permisos de base de datos (DEC-003)
--
--    El catalogo sigue siendo de SOLO LECTURA en tiempo de ejecucion: las filas
--    nuevas heredan el privilegio de tabla de 0001 y esta migracion no concede
--    ninguno nuevo. Cambiar una capacidad exige otra migracion, que pasa por
--    revision de codigo.
-- ---------------------------------------------------------------------------
