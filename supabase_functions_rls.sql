-- ============================================================
-- Supabase layer for VESTIDA (idempotent — safe to re-run).
--
-- RUN THIS AFTER `schema.sql` (the base schema). It adds:
--   • Auth wiring   — staff.auth_uid + role, get_current_user()
--   • Store scoping — get_my_store_id() helper
--   • Write RPCs    — log_sale, transfer_stock, cancel_transfer,
--                     receive_stock (SECURITY DEFINER, store-scoped)
--   • Read models   — get_categories, get_stores, get_staff,
--                     get_today_summary, get_catalog,
--                     get_stock_summary, get_*_transfers, get_history
--   • RLS           — store-scoped SELECT policies on every table
--
-- Everything here uses CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS, so it can be run repeatedly.
-- ============================================================

-- ============================================================
-- Supabase Auth wiring (idempotent — safe to re-run after the
-- base schema above).
-- ============================================================

-- Link each staff member to a Supabase Auth user, and carry their role.
-- Admin = the owner (Gina); everyone else is staff.
ALTER TABLE "staff"
  ADD COLUMN IF NOT EXISTS "auth_uid" uuid UNIQUE REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS "role" varchar NOT NULL DEFAULT 'staff'
    CHECK ("role" IN ('staff', 'admin'));

-- Return the signed-in user's profile (name, role, storeCode).
-- SECURITY DEFINER + owned by postgres so it can read `staff` without
-- exposing the table itself via RLS.
CREATE OR REPLACE FUNCTION public.get_current_user()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'name',      s.name,
    'role',      s.role,
    'storeCode', st.code
  )
  FROM public.staff s
  LEFT JOIN public.store st ON st.id = s.store_id
  WHERE s.auth_uid = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user() TO authenticated;

-- ============================================================
-- Store scoping helper (used by RLS policies + SECURITY DEFINER
-- functions). Returns the store_id of the signed-in staff member.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT store_id FROM public.staff WHERE auth_uid = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.get_my_store_id() TO authenticated;

-- ============================================================
-- RPC: log_sale — compound write for a sale.
-- Server auto-assigns in_stock units (per variant) for ready-made
-- items, marks them sold, records the order + line items + payment,
-- and the stock_movement ledger. Idempotent via client_ref.
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_sale(
  p_order_type order_type DEFAULT 'ready_made',
  p_customer_name varchar DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_payment jsonb DEFAULT NULL,
  p_care_of uuid DEFAULT NULL,
  p_client_ref varchar DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_store_id uuid;
  v_order_id uuid;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_status order_status := 'pending';
  v_item jsonb;
  v_variant uuid;
  v_unit uuid;
  v_qty int;
  v_price bigint;
  v_spec text;
  v_taken int;
  v_existing uuid;
BEGIN
  SELECT id, store_id INTO v_staff_id, v_store_id
  FROM public.staff WHERE auth_uid = auth.uid();
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  -- Idempotency: a retried client_ref returns the existing order.
  IF p_client_ref IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.sales_order WHERE client_ref = p_client_ref;
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('order_id', v_existing, 'duplicate', true);
    END IF;
  END IF;

  -- Compute the order total from the items (server-side, so clients
  -- cannot understate the total). Prices arrive in pesos; store centavos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_price := COALESCE((v_item->>'agreed_price')::bigint, 0) * 100;
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    v_total := v_total + v_price * v_qty;
  END LOOP;

  IF p_payment IS NOT NULL THEN
    v_paid := COALESCE((p_payment->>'amount')::bigint, 0) * 100;
  END IF;

  -- A cash-and-carry ready-made sale paid in full is released.
  IF p_order_type = 'ready_made' AND v_paid > 0 AND v_paid >= v_total THEN
    v_status := 'released';
  END IF;

  INSERT INTO public.sales_order
    (client_ref, store_id, customer_name, order_type, status, dispatched_by, notes)
  VALUES
    (p_client_ref, v_store_id, p_customer_name, p_order_type, v_status, p_care_of, p_notes)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_price := COALESCE((v_item->>'agreed_price')::bigint, 0);
    v_spec := v_item->>'spec_note';
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    v_unit := (v_item->>'unit_id')::uuid;

    IF v_unit IS NULL AND p_order_type = 'ready_made' THEN
      -- Auto-assign in_stock units of this variant at this store.
      FOR v_taken IN 1..v_qty
      LOOP
        SELECT id INTO v_unit
        FROM public.inventory_unit
        WHERE variant_id = v_variant AND current_store_id = v_store_id AND status = 'in_stock'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
        IF v_unit IS NULL THEN
          RAISE EXCEPTION 'not enough in_stock for variant %', v_variant;
        END IF;
        INSERT INTO public.order_line_item
          (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
        VALUES (v_order_id, v_variant, v_unit, 1, v_price, v_spec);
        UPDATE public.inventory_unit SET status = 'sold' WHERE id = v_unit;
        INSERT INTO public.stock_movement
          (unit_id, movement_type, from_store_id, reference_type, reference_id, performed_by, note)
        VALUES (v_unit, 'sold', v_store_id, 'order', v_order_id, v_staff_id, 'sale');
      END LOOP;
    ELSE
      -- MTO / bulk / pre-assigned unit.
      INSERT INTO public.order_line_item
        (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
      VALUES (v_order_id, v_variant, v_unit, v_qty, v_price, v_spec);
    END IF;
  END LOOP;

  IF p_payment IS NOT NULL AND COALESCE((p_payment->>'amount')::bigint, 0) > 0 THEN
    INSERT INTO public.payment (order_id, amount, method, received_by, notes)
    VALUES (
      v_order_id,
      (p_payment->>'amount')::bigint * 100,
      COALESCE((p_payment->>'method')::payment_method, 'cash'),
      v_staff_id,
      p_payment->>'note'
    );
  END IF;

  RETURN json_build_object('order_id', v_order_id, 'duplicate', false, 'status', v_status::text);
END;
$$;
REVOKE ALL ON FUNCTION public.log_sale(order_type, varchar, jsonb, jsonb, uuid, varchar, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_sale(order_type, varchar, jsonb, jsonb, uuid, varchar, text) TO authenticated;

-- ============================================================
-- RPC: transfer_stock — compound write for a transfer.
-- Auto-assigns in_stock units of each variant from this store, sets
-- them in_transit to the destination, and logs transferred_out.
-- One shared reference_id groups the batch (no transfer table).
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_stock(
  p_to_store_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL,
  p_client_ref varchar DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_from_store uuid;
  v_op_id uuid := gen_random_uuid();
  v_item jsonb;
  v_variant uuid;
  v_qty int;
  v_unit uuid;
  v_taken int;
BEGIN
  SELECT id, store_id INTO v_staff_id, v_from_store
  FROM public.staff WHERE auth_uid = auth.uid();
  IF v_from_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;
  IF p_to_store_id IS NULL OR p_to_store_id = v_from_store THEN
    RAISE EXCEPTION 'invalid destination store';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    FOR v_taken IN 1..v_qty
    LOOP
      SELECT id INTO v_unit
      FROM public.inventory_unit
      WHERE variant_id = v_variant AND current_store_id = v_from_store AND status = 'in_stock'
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
      IF v_unit IS NULL THEN
        RAISE EXCEPTION 'not enough in_stock for variant %', v_variant;
      END IF;
      UPDATE public.inventory_unit
        SET current_store_id = p_to_store_id, status = 'in_transit'
        WHERE id = v_unit;
      INSERT INTO public.stock_movement
        (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
      VALUES (v_unit, 'transferred_out', v_from_store, p_to_store_id, 'transfer', v_op_id, v_staff_id, p_note);
    END LOOP;
  END LOOP;

  RETURN json_build_object('transfer_id', v_op_id);
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_stock(uuid, jsonb, text, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_stock(uuid, jsonb, text, varchar) TO authenticated;

-- ============================================================
-- RPC: cancel_transfer — reverse an in-transit batch back to
-- in_stock at the sending store (an 'adjustment' movement).
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_transfer(
  p_transfer_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_from_store uuid;
  v_unit uuid;
BEGIN
  SELECT id, store_id INTO v_staff_id, v_from_store
  FROM public.staff WHERE auth_uid = auth.uid();
  IF v_from_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  FOR v_unit IN
    SELECT m.unit_id
    FROM public.stock_movement m
    WHERE m.reference_id = p_transfer_id
      AND m.movement_type = 'transferred_out'
      AND m.from_store_id = v_from_store
      AND EXISTS (
        SELECT 1 FROM public.inventory_unit u
        WHERE u.id = m.unit_id AND u.status = 'in_transit'
      )
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    UPDATE public.inventory_unit
      SET status = 'in_stock', current_store_id = v_from_store
      WHERE id = v_unit;
    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, reference_type, reference_id, performed_by, note)
    VALUES (v_unit, 'adjustment', v_from_store, 'transfer', p_transfer_id, v_staff_id, 'cancelled transfer');
  END LOOP;

  RETURN json_build_object('cancelled', true);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_transfer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_transfer(uuid) TO authenticated;

-- ============================================================
-- RPC: receive_stock — check in-bound in_transit units.
-- If p_from_store_id is null, receives ALL inbound to this store.
-- ============================================================
CREATE OR REPLACE FUNCTION public.receive_stock(
  p_from_store_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_store uuid;
  v_unit uuid;
  v_ref uuid;
  v_from uuid;
BEGIN
  SELECT id, store_id INTO v_staff_id, v_store
  FROM public.staff WHERE auth_uid = auth.uid();
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  FOR v_unit, v_from, v_ref IN
    SELECT u.id, m.from_store_id, m.reference_id
    FROM public.inventory_unit u
    JOIN LATERAL (
      SELECT from_store_id, reference_id
      FROM public.stock_movement
      WHERE unit_id = u.id AND movement_type = 'transferred_out'
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON true
    WHERE u.current_store_id = v_store
      AND u.status = 'in_transit'
      AND (p_from_store_id IS NULL OR m.from_store_id = p_from_store_id)
    FOR UPDATE OF u SKIP LOCKED
  LOOP
    UPDATE public.inventory_unit SET status = 'in_stock' WHERE id = v_unit;
    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
    VALUES (v_unit, 'transferred_in', v_from, v_store, 'transfer', v_ref, v_staff_id, p_note);
  END LOOP;

  RETURN json_build_object('received', true);
END;
$$;
REVOKE ALL ON FUNCTION public.receive_stock(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_stock(uuid, text) TO authenticated;

-- ============================================================
-- Read models (all scoped to the signed-in user's store).
-- ============================================================

-- Categories shared across stores.
CREATE OR REPLACE FUNCTION public.get_categories()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(c ORDER BY c.name), '[]'::json)
  FROM (
    SELECT id, name FROM public.category ORDER BY name
  ) c
$$;
REVOKE ALL ON FUNCTION public.get_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_categories() TO authenticated;

-- All active stores (for filters + transfer destination).
CREATE OR REPLACE FUNCTION public.get_stores()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(s ORDER BY s.code), '[]'::json)
  FROM (
    SELECT id, code, name FROM public.store WHERE is_active
  ) s
$$;
REVOKE ALL ON FUNCTION public.get_stores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stores() TO authenticated;

-- Active staff at this store (names, for "Care of" + History filter).
CREATE OR REPLACE FUNCTION public.get_staff()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(name ORDER BY name), '[]'::json)
  FROM (
    SELECT s.name FROM public.staff s
    WHERE s.is_active AND s.store_id = public.get_my_store_id()
  ) s
$$;
REVOKE ALL ON FUNCTION public.get_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff() TO authenticated;

-- Today's sales totals + inbound in-transit count for this store.
CREATE OR REPLACE FUNCTION public.get_today_summary()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'totalSales', COALESCE(SUM(p.amount), 0) / 100.0,
    'cash',       COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'cash'), 0) / 100.0,
    'gcash',      COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'gcash'), 0) / 100.0,
    'incoming',   (SELECT COUNT(*) FROM public.inventory_unit u
                   WHERE u.current_store_id = public.get_my_store_id()
                     AND u.status = 'in_transit')
  )
  FROM public.payment p
  JOIN public.sales_order o ON o.id = p.order_id
  WHERE o.store_id = public.get_my_store_id()
    AND p.paid_at::date = CURRENT_DATE
    AND p.kind = 'payment'
$$;
REVOKE ALL ON FUNCTION public.get_today_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_today_summary() TO authenticated;

-- Catalog with per-variant in_stock counts for THIS store (Sale + Transfers).
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(p ORDER BY p.name), '[]'::json)
  FROM (
    SELECT p.id, p.category_id AS "categoryId", p.name,
      COALESCE(json_agg(v ORDER BY v.color, v.size), '[]'::json) AS variants
    FROM public.product p
    JOIN (
      SELECT pv.id, pv.product_id, pv.color, pv.size,
        (pv.regular_price / 100.0) AS "regularPrice",
        (SELECT COUNT(*) FROM public.inventory_unit u
          WHERE u.variant_id = pv.id
            AND u.current_store_id = public.get_my_store_id()
            AND u.status = 'in_stock') AS "inStock"
      FROM public.product_variant pv
    ) v ON v.product_id = p.id
    WHERE p.is_active
    GROUP BY p.id, p.category_id, p.name
  ) p
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO authenticated;

-- Stock summary: per-variant counts across ALL stores (Check Stock page).
CREATE OR REPLACE FUNCTION public.get_stock_summary()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(p ORDER BY p.name), '[]'::json)
  FROM (
    SELECT p.id, p.category_id AS "categoryId", p.name,
      COALESCE(json_agg(v ORDER BY v.color, v.size), '[]'::json) AS variants
    FROM public.product p
    JOIN (
      SELECT pv.id, pv.product_id, pv.color, pv.size,
        json_object_agg(st.code, json_build_object(
          'available', COALESCE(x.available, 0),
          'inTransit', COALESCE(x.intransit, 0)
        )) AS stores
      FROM public.product_variant pv
      CROSS JOIN public.store st
      LEFT JOIN (
        SELECT variant_id, current_store_id,
          COUNT(*) FILTER (WHERE status = 'in_stock') AS available,
          COUNT(*) FILTER (WHERE status = 'in_transit') AS intransit
        FROM public.inventory_unit
        GROUP BY variant_id, current_store_id
      ) x ON x.variant_id = pv.id AND x.current_store_id = st.id
      GROUP BY pv.id, pv.product_id, pv.color, pv.size
    ) v ON v.product_id = p.id
    WHERE p.is_active
    GROUP BY p.id, p.category_id, p.name
  ) p
$$;
REVOKE ALL ON FUNCTION public.get_stock_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stock_summary() TO authenticated;

-- Outgoing transfers (sent from this store), grouped by batch.
CREATE OR REPLACE FUNCTION public.get_outgoing_transfers()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(r ORDER BY r."sentAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."toStoreId", b."sentAt", b.status, b.note,
      COALESCE(json_agg(item ORDER BY item.name), '[]'::json) AS items
    FROM (
      SELECT m.reference_id AS id,
             m.to_store_id AS "toStoreId",
             MAX(m.created_at) AS "sentAt",
             MAX(m.note) AS note,
             CASE
               WHEN EXISTS (SELECT 1 FROM public.stock_movement sm
                            WHERE sm.reference_id = m.reference_id AND sm.movement_type = 'adjustment')
                 THEN 'cancelled'
               WHEN EXISTS (SELECT 1 FROM public.stock_movement sm
                            WHERE sm.reference_id = m.reference_id AND sm.movement_type = 'transferred_in')
                 THEN 'received'
               ELSE 'in_transit'
             END AS status
      FROM public.stock_movement m
      WHERE m.movement_type = 'transferred_out'
        AND m.from_store_id = public.get_my_store_id()
      GROUP BY m.reference_id, m.to_store_id
    ) b
    JOIN (
      SELECT m.reference_id, p.name,
             trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
             COUNT(*) AS qty
      FROM public.stock_movement m
      JOIN public.inventory_unit u ON u.id = m.unit_id
      JOIN public.product_variant pv ON pv.id = u.variant_id
      JOIN public.product p ON p.id = pv.product_id
      WHERE m.movement_type = 'transferred_out'
        AND m.from_store_id = public.get_my_store_id()
      GROUP BY m.reference_id, p.name, pv.color, pv.size
    ) item ON item.reference_id = b.id
    GROUP BY b.id, b."toStoreId", b."sentAt", b.status, b.note
  ) r
$$;
REVOKE ALL ON FUNCTION public.get_outgoing_transfers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_outgoing_transfers() TO authenticated;

-- Incoming transfers (in_transit units inbound to this store), grouped by batch.
CREATE OR REPLACE FUNCTION public.get_incoming_transfers()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(r ORDER BY r."sentAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."fromStoreId", b."sentAt", b.note,
      COALESCE(json_agg(item ORDER BY item.name), '[]'::json) AS items
    FROM (
      SELECT m.reference_id AS id,
             m.from_store_id AS "fromStoreId",
             MAX(m.created_at) AS "sentAt",
             MAX(m.note) AS note
      FROM public.stock_movement m
      WHERE m.movement_type = 'transferred_out'
        AND m.to_store_id = public.get_my_store_id()
        AND EXISTS (SELECT 1 FROM public.inventory_unit u
                    WHERE u.id = m.unit_id AND u.status = 'in_transit')
      GROUP BY m.reference_id, m.from_store_id
    ) b
    JOIN (
      SELECT m.reference_id, p.name,
             trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
             COUNT(*) AS qty
      FROM public.stock_movement m
      JOIN public.inventory_unit u ON u.id = m.unit_id
      JOIN public.product_variant pv ON pv.id = u.variant_id
      JOIN public.product p ON p.id = pv.product_id
      WHERE m.movement_type = 'transferred_out'
        AND m.to_store_id = public.get_my_store_id()
        AND EXISTS (SELECT 1 FROM public.inventory_unit u2
                    WHERE u2.id = m.unit_id AND u2.status = 'in_transit')
      GROUP BY m.reference_id, p.name, pv.color, pv.size
    ) item ON item.reference_id = b.id
    GROUP BY b.id, b."fromStoreId", b."sentAt", b.note
  ) r
$$;
REVOKE ALL ON FUNCTION public.get_incoming_transfers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_incoming_transfers() TO authenticated;

-- Received transfers (checked in at this store), grouped by batch.
CREATE OR REPLACE FUNCTION public.get_received_transfers()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(r ORDER BY r."receivedAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."fromStoreId", b."receivedAt",
      COALESCE(json_agg(item ORDER BY item.name), '[]'::json) AS items
    FROM (
      SELECT m.reference_id AS id,
             m.from_store_id AS "fromStoreId",
             MAX(m.created_at) AS "receivedAt"
      FROM public.stock_movement m
      WHERE m.movement_type = 'transferred_in'
        AND m.to_store_id = public.get_my_store_id()
      GROUP BY m.reference_id, m.from_store_id
    ) b
    JOIN (
      SELECT m.reference_id, p.name,
             trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
             COUNT(*) AS qty
      FROM public.stock_movement m
      JOIN public.inventory_unit u ON u.id = m.unit_id
      JOIN public.product_variant pv ON pv.id = u.variant_id
      JOIN public.product p ON p.id = pv.product_id
      WHERE m.movement_type = 'transferred_in'
        AND m.to_store_id = public.get_my_store_id()
      GROUP BY m.reference_id, p.name, pv.color, pv.size
    ) item ON item.reference_id = b.id
    GROUP BY b.id, b."fromStoreId", b."receivedAt"
  ) r
$$;
REVOKE ALL ON FUNCTION public.get_received_transfers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_received_transfers() TO authenticated;

-- Sales history for this store (last 2 days) with totals + items in pesos.
CREATE OR REPLACE FUNCTION public.get_history()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(r ORDER BY r."createdAt" DESC), '[]'::json)
  FROM (
    SELECT o.id,
           o.order_date::text AS "dateKey",
           o.created_at::text AS "createdAt",
           o.customer_name AS customer,
           COALESCE((SELECT SUM(li.agreed_price * li.quantity)
                     FROM public.order_line_item li WHERE li.order_id = o.id), 0) / 100.0 AS total,
           COALESCE((SELECT SUM(p.amount) FROM public.payment p
                     WHERE p.order_id = o.id AND p.kind = 'payment'), 0) / 100.0 AS paid,
           COALESCE((SELECT p.method::text FROM public.payment p
                     WHERE p.order_id = o.id AND p.kind = 'payment'
                     ORDER BY p.paid_at DESC LIMIT 1), 'cash') AS method,
           s.name AS "careOf",
           o.order_type::text AS type,
           COALESCE(o.client_ref, o.id::text) AS "orderNumber",
           COALESCE((SELECT json_agg(json_build_object(
                       'name', COALESCE(p.name, 'Made-to-Order'),
                       'detail', trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size, li.spec_note)),
                       'qty', li.quantity,
                       'price', (li.agreed_price / 100.0)
                     ))
                     FROM public.order_line_item li
                     LEFT JOIN public.product_variant pv ON pv.id = li.product_variant_id
                     LEFT JOIN public.product p ON p.id = pv.product_id
                     WHERE li.order_id = o.id), '[]'::json) AS items
    FROM public.sales_order o
    LEFT JOIN public.staff s ON s.id = o.dispatched_by
    WHERE o.store_id = public.get_my_store_id()
      AND o.order_date >= CURRENT_DATE - 1
  ) r
$$;
REVOKE ALL ON FUNCTION public.get_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_history() TO authenticated;

-- ============================================================
-- Row Level Security.
-- Users only see rows belonging to their own store (or shared
-- catalog data). Writes go through the SECURITY DEFINER RPCs above,
-- which bypass RLS; these policies gate direct PostgREST reads.
-- ============================================================
ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_line_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_exception ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movement ENABLE ROW LEVEL SECURITY;

-- Shared reference/catalog data: any authenticated user may read.
DROP POLICY IF EXISTS "auth_read" ON public.store;
CREATE POLICY "auth_read" ON public.store FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read" ON public.category;
CREATE POLICY "auth_read" ON public.category FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read" ON public.product;
CREATE POLICY "auth_read" ON public.product FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read" ON public.product_variant;
CREATE POLICY "auth_read" ON public.product_variant FOR SELECT TO authenticated USING (true);

-- staff: users may only read their own row.
DROP POLICY IF EXISTS "own_row" ON public.staff;
CREATE POLICY "own_row" ON public.staff FOR SELECT TO authenticated USING (auth_uid = auth.uid());

-- inventory_unit: only rows currently at my store.
DROP POLICY IF EXISTS "my_store" ON public.inventory_unit;
CREATE POLICY "my_store" ON public.inventory_unit
  FOR SELECT TO authenticated USING (current_store_id = public.get_my_store_id());

-- sales_order: only my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.sales_order;
CREATE POLICY "my_store" ON public.sales_order
  FOR SELECT TO authenticated USING (store_id = public.get_my_store_id());

-- order_line_item: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.order_line_item;
CREATE POLICY "my_store" ON public.order_line_item
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = order_id AND o.store_id = public.get_my_store_id())
  );

-- payment: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.payment;
CREATE POLICY "my_store" ON public.payment
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = order_id AND o.store_id = public.get_my_store_id())
  );

-- sales_exception: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.sales_exception;
CREATE POLICY "my_store" ON public.sales_exception
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = order_id AND o.store_id = public.get_my_store_id())
  );

-- stock_movement: only movements touching my store.
DROP POLICY IF EXISTS "my_store" ON public.stock_movement;
CREATE POLICY "my_store" ON public.stock_movement
  FOR SELECT TO authenticated USING (
    from_store_id = public.get_my_store_id()
    OR to_store_id = public.get_my_store_id()
  );
