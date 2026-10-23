-- ===========================================================================
-- 0043_order_contact_read
--
-- Contacto del cliente de un pedido desde el panel (DEC-094).
--
--   Quien entrega un pedido o quiere avisar al cliente de sus participaciones
--   necesita su celular y su correo. Hasta aqui el correo del pedido salia
--   enmascarado y el completo solo detras de `pii.view.full` (CRITICAL, con
--   segundo factor y motivo), pensada para la ficha entera de un participante.
--   Esta capacidad es mas estrecha: el contacto del cliente de UN pedido,
--   SENSITIVE, auditada y marcada como PII, sin step-up ni motivo porque es
--   trabajo de entrega y de aviso.
--
--   `packages/security` la declara en esta misma ronda y `test/parity.test.ts`
--   compara las dos listas (DEC-027). La tienen los tres roles que despachan
--   mercancia: SUPPORT, PROMOTION_MANAGER y COMPLIANCE_OFFICER.
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-027, DEC-085, DEC-094.
-- ===========================================================================

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('order.contact.read', 'order', 'SENSITIVE', 'Ver el nombre, el celular y el correo del cliente de un pedido concreto, para entregarlo o avisarle de sus participaciones. Solo el contacto de ese pedido: la ficha completa sigue detras de pii.view.full.', false, false, false, true, true, NULL);

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('SUPPORT', 'order.contact.read'),
  ('PROMOTION_MANAGER', 'order.contact.read'),
  ('COMPLIANCE_OFFICER', 'order.contact.read');
