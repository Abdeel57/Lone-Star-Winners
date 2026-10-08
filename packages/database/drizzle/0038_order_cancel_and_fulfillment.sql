-- ===========================================================================
-- 0038_order_cancel_and_fulfillment
--
-- Cancelar pedidos sin cobrar, marcar la mercancia como entregada y el corte
-- de caja diario (DEC-085).
--
-- CANCELAR
--
--   Un pedido que nadie pago -un duplicado, un pago con tarjeta abandonado en
--   la pasarela, un pedido en efectivo al que nadie vino- se queda en
--   PENDING_PAYMENT para siempre y ensucia la cola de pendientes. Cancelarlo no
--   necesita columnas nuevas: el estado CANCELLED ya existe y la maquina de
--   `@lsw/commerce` ya lo admite. Lo nuevo es la CAPACIDAD, con motivo, y la
--   regla que la aplicacion impone con el pedido bloqueado: nunca un pedido con
--   `paid_at`. El pedido no se borra (DELETE sigue revocado).
--
-- ENTREGAR
--
--   `fulfillment_state` existia desde 0020 y nadie lo movia. Ahora el panel lo
--   pasa a FULFILLED -enviado, o entregado en mano si se recoge en el punto de
--   venta- con el instante y, si se envia, transportista y numero de guia.
--   Volver a UNFULFILLED borra esos tres datos; la auditoria guarda cada cambio.
--
-- EL CORTE DE CAJA
--
--   Suma por `paid_at` dentro de un dia de calendario. El indice parcial de
--   abajo es para esa consulta: sin el, cada corte recorre la tabla entera.
--
-- Referencias: DEC-005 (forward-only), DEC-007, DEC-011, DEC-027, DEC-078,
-- DEC-079, DEC-085.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Las capacidades (DEC-027)
--
--    `packages/security` las declara en esta misma ronda y `test/parity.test.ts`
--    compara las dos listas.
-- ---------------------------------------------------------------------------

INSERT INTO admin_permissions
  (key, domain, sensitivity, description, requires_step_up, requires_reason,
   requires_second_approval, emits_audit_event, touches_pii,
   legal_dependency) VALUES
  ('order.cancel', 'order', 'SENSITIVE', 'Cancelar un pedido sin cobrar (duplicado, abandonado o que nadie pago) para sacarlo de la cola de pendientes. Nunca toca un pedido pagado.', false, true, false, true, false, NULL),
  ('order.fulfillment.update', 'order', 'SENSITIVE', 'Marcar la mercancia de un pedido como enviada, con transportista y numero de guia, o devolverla a pendiente de envio.', false, false, false, true, false, NULL);

-- Cancelar: los dos roles que cobran en caja. Entregar: esos dos y atencion al
-- participante, que es quien prepara los paquetes.
INSERT INTO admin_role_permissions (role_key, permission_key) VALUES
  ('PROMOTION_MANAGER', 'order.cancel'),
  ('COMPLIANCE_OFFICER', 'order.cancel'),
  ('PROMOTION_MANAGER', 'order.fulfillment.update'),
  ('COMPLIANCE_OFFICER', 'order.fulfillment.update'),
  ('SUPPORT', 'order.fulfillment.update');


-- ---------------------------------------------------------------------------
-- 2. La entrega
-- ---------------------------------------------------------------------------

ALTER TABLE orders
  ADD COLUMN fulfilled_at timestamptz,
  ADD COLUMN shipping_carrier text,
  ADD COLUMN tracking_number text;

ALTER TABLE orders
  ADD CONSTRAINT orders_shipping_carrier_length
    CHECK (shipping_carrier IS NULL OR char_length(shipping_carrier) BETWEEN 1 AND 60),
  ADD CONSTRAINT orders_tracking_number_length
    CHECK (tracking_number IS NULL OR char_length(tracking_number) BETWEEN 1 AND 100),
  -- El instante va con el estado: un pedido FULFILLED sin fecha, o pendiente con
  -- fecha, seria un dato que el corte no sabria leer. PARTIALLY_FULFILLED y
  -- RETURNED no los mueve nadie todavia y quedan libres.
  ADD CONSTRAINT orders_fulfilled_at_matches_state
    CHECK (
      (fulfillment_state = 'FULFILLED' AND fulfilled_at IS NOT NULL)
      OR (fulfillment_state IN ('UNFULFILLED', 'NOT_APPLICABLE') AND fulfilled_at IS NULL)
      OR fulfillment_state IN ('PARTIALLY_FULFILLED', 'RETURNED')
    ),
  -- Transportista y guia solo con la entrega hecha, y solo si se ENVIA: lo
  -- que se recoge en el punto de venta no viaja.
  ADD CONSTRAINT orders_tracking_requires_delivery
    CHECK (
      (shipping_carrier IS NULL AND tracking_number IS NULL)
      OR (fulfilled_at IS NOT NULL AND fulfillment_method = 'DELIVERY')
    );

GRANT UPDATE (fulfilled_at, shipping_carrier, tracking_number) ON orders TO lsw_app;


-- ---------------------------------------------------------------------------
-- 3. El corte de caja
-- ---------------------------------------------------------------------------

CREATE INDEX orders_paid_at_idx ON orders (paid_at) WHERE paid_at IS NOT NULL;
