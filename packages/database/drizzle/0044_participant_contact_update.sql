-- ===========================================================================
-- 0044_participant_contact_update
--
-- Celular de contacto de un cliente desde el panel (DEC-097).
--
--   Los clientes que se dieron de alta con correo antes de DEC-089 no tienen
--   celular, y la tarjeta "Cliente" del pedido se quedaba sin WhatsApp ni SMS.
--   `participant.contact.update` deja que el personal escriba el celular de
--   CONTACTO (`participants.phone_e164`, sin verificar). No toca el celular de
--   acceso (`identities.phone_e164`): ese solo lo pone el propio cliente con un
--   codigo SMS.
--
--   SENSITIVE, PII y auditada; la tienen los tres roles que ya ven el contacto
--   (`order.contact.read`, 0043). `packages/security` la declara en esta misma
--   ronda y `test/parity.test.ts` compara las dos listas (DEC-027).
--
-- Referencias: DEC-003, DEC-005 (forward-only), DEC-027, DEC-094, DEC-097.
-- ===========================================================================

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('participant.contact.update', 'participant', 'SENSITIVE', 'Anadir o cambiar el celular de CONTACTO de un cliente (para WhatsApp, SMS y llamadas). No es el celular de acceso: no deja entrar en la cuenta.', false, false, false, true, true, NULL);

INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('SUPPORT', 'participant.contact.update'),
  ('PROMOTION_MANAGER', 'participant.contact.update'),
  ('COMPLIANCE_OFFICER', 'participant.contact.update');
