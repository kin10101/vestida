-- ============================================================
-- Admin functions for VESTIDA (idempotent — safe to re-run).
--
-- Run AFTER `supabase_functions_rls.sql`. Everything is gated by
-- `assert_admin()` so only staff rows with role='admin' can call it.
--
-- The admin UI (frontend/src/admin) reads one big `admin_get_state()`
-- JSON and calls the write RPCs below. Prices/amounts are centavos
-- integers (the admin UI already works in cents).
--
-- SCHEMA GAPS (fields the admin UI expects but that don't exist in
-- the DB — mapped to defaults):
--   • product_variant has NO cost_price / is_active → variant
--     costPriceCents=0, isActive=true
--   • staff has NO title → title=''
--   • storeAccess (username/password/devices) has NO table → []
-- ============================================================

-- Guard: only admins may call admin functions.
CREATE OR REPLACE FUNCTION public.assert_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.staff WHERE auth_uid = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assert_admin() TO authenticated;

-- ============================================================
-- Read: full admin dataset, shaped exactly like AdminState.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_state()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  RETURN (
    SELECT json_build_object(
      'stores', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, code, name, is_active AS "isActive", created_at::text AS "createdAt"
        FROM public.store) x), '[]'::json),
      'categories', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, name, created_at::text AS "createdAt"
        FROM public.category) x), '[]'::json),
      'products', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, category_id AS "categoryId", name, COALESCE(description,'') AS description,
               is_active AS "isActive", created_at::text AS "createdAt"
        FROM public.product) x), '[]'::json),
      'productVariants', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, product_id AS "productId", color, size, COALESCE(sku,'') AS sku,
               regular_price AS "regularPriceCents",
               0 AS "costPriceCents", true AS "isActive",
               created_at::text AS "createdAt"
        FROM public.product_variant) x), '[]'::json),
      'inventoryUnits', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, variant_id AS "variantId", unit_code AS "unitCode",
               current_store_id AS "storeId", status,
               cost_price AS "costPriceCents", created_at::text AS "createdAt"
        FROM public.inventory_unit) x), '[]'::json),
      'stockMovements', COALESCE((SELECT json_agg(x) FROM (
        SELECT m.id, m.unit_id AS "unitId", m.movement_type::text AS "kind",
               COALESCE(m.to_store_id, m.from_store_id) AS "storeId",
               m.from_store_id AS "fromStoreId", m.to_store_id AS "toStoreId",
               COALESCE(s.name,'') AS "staffName", COALESCE(m.note,'') AS "note",
               COALESCE(m.reference_type,'') AS "reference",
               m.created_at::text AS "createdAt"
        FROM public.stock_movement m
        LEFT JOIN public.staff s ON s.id = m.performed_by) x), '[]'::json),
      'staff', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, name, '' AS title, store_id AS "storeId",
               is_active AS "isActive", created_at::text AS "createdAt"
        FROM public.staff) x), '[]'::json),
      'storeAccess', '[]'::json,
      'orders', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, store_id AS "storeId", customer_name AS "customerName",
               order_type AS "orderType", status,
               COALESCE(client_ref, id::text) AS "reference",
               COALESCE(notes,'') AS "notes",
               created_at::text AS "createdAt", updated_at::text AS "updatedAt"
        FROM public.sales_order) x), '[]'::json),
      'orderLines', COALESCE((SELECT json_agg(x) FROM (
        SELECT id, order_id AS "orderId", product_variant_id AS "variantId",
               COALESCE(spec_note,'') AS "description", quantity,
               agreed_price AS "agreedPriceCents", unit_id AS "unitId"
        FROM public.order_line_item) x), '[]'::json),
      'payments', COALESCE((SELECT json_agg(x) FROM (
        SELECT p.id, p.order_id AS "orderId", p.amount AS "amountCents", p.method,
               p.kind, p.paid_at::text AS "receivedAt", COALESCE(s.name,'') AS "receivedBy"
        FROM public.payment p
        LEFT JOIN public.staff s ON s.id = p.received_by) x), '[]'::json),
      'salesExceptions', COALESCE((SELECT json_agg(x) FROM (
        SELECT se.id, se.order_id AS "orderId", se.exception_type AS "kind",
               se.reason, se.amount AS "amountCents", se.payment_method AS "method",
               COALESCE(s.name,'') AS "processedBy", se.created_at::text AS "createdAt"
        FROM public.sales_exception se
        LEFT JOIN public.staff s ON s.id = se.processed_by) x), '[]'::json)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_state() TO authenticated;

-- ============================================================
-- Category
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_category(p_id uuid, p_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'name required';
  END IF;
  INSERT INTO public.category (id, name)
  VALUES (COALESCE(p_id, gen_random_uuid()), trim(p_name))
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_category(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_category(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_category(p_id uuid, p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_products int;
BEGIN
  PERFORM public.assert_admin();
  SELECT COUNT(*) INTO v_products FROM public.product WHERE category_id = p_id;
  IF v_products > 0 AND NOT p_force THEN
    RETURN json_build_object('deleted', false, 'reason', 'has_products');
  END IF;
  DELETE FROM public.category WHERE id = p_id;
  RETURN json_build_object('deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_category(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(uuid, boolean) TO authenticated;

-- ============================================================
-- Product
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_product(
  p_id uuid, p_category_id uuid, p_name text,
  p_description text DEFAULT NULL, p_is_active boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'name required';
  END IF;
  INSERT INTO public.product (id, category_id, name, description, is_active)
  VALUES (COALESCE(p_id, gen_random_uuid()), p_category_id, trim(p_name),
          COALESCE(NULLIF(trim(COALESCE(p_description,'')), ''), NULL), p_is_active)
  ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id, name = EXCLUDED.name,
    description = EXCLUDED.description, is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_product(uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_product(uuid, uuid, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_toggle_products_active(p_ids uuid[], p_is_active boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.product SET is_active = p_is_active, updated_at = now()
  WHERE id = ANY(p_ids);
  RETURN json_build_object('updated', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_toggle_products_active(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_products_active(uuid[], boolean) TO authenticated;

-- ============================================================
-- Variant (no cost_price/is_active in DB; those are UI-only fields)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_variant(
  p_id uuid, p_product_id uuid, p_color text, p_size text,
  p_sku text, p_regular_price_cents int
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  INSERT INTO public.product_variant (id, product_id, color, size, sku, regular_price)
  VALUES (COALESCE(p_id, gen_random_uuid()), p_product_id, p_color, p_size,
          NULLIF(trim(COALESCE(p_sku,'')), ''), p_regular_price_cents)
  ON CONFLICT (id) DO UPDATE SET
    product_id = EXCLUDED.product_id, color = EXCLUDED.color, size = EXCLUDED.size,
    sku = EXCLUDED.sku, regular_price = EXCLUDED.regular_price, updated_at = now()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_variant(uuid, uuid, text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_variant(uuid, uuid, text, text, text, int) TO authenticated;

-- ============================================================
-- Store
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_store(
  p_id uuid, p_name text, p_code text, p_is_active boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_name IS NULL OR trim(p_name) = '' OR p_code IS NULL OR trim(p_code) = '' THEN
    RAISE EXCEPTION 'name and code required';
  END IF;
  INSERT INTO public.store (id, name, code, is_active)
  VALUES (COALESCE(p_id, gen_random_uuid()), trim(p_name), upper(trim(p_code)), p_is_active)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, code = EXCLUDED.code, is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_store(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_store(uuid, text, text, boolean) TO authenticated;

-- ============================================================
-- Staff
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_staff(
  p_id uuid, p_name text, p_store_id uuid, p_is_active boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'name required';
  END IF;
  INSERT INTO public.staff (id, name, store_id, is_active)
  VALUES (COALESCE(p_id, gen_random_uuid()), trim(p_name), p_store_id, p_is_active)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, store_id = EXCLUDED.store_id,
    is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_staff(uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_staff(uuid, text, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_toggle_staff_active(p_ids uuid[], p_is_active boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  UPDATE public.staff SET is_active = p_is_active, updated_at = now()
  WHERE id = ANY(p_ids);
  RETURN json_build_object('updated', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_toggle_staff_active(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_staff_active(uuid[], boolean) TO authenticated;

-- ============================================================
-- Intake: create physical units + 'received' movements.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_apply_intake(
  p_variant_id uuid, p_store_id uuid, p_quantity int,
  p_cost_price_cents int, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_unit uuid; v_staff uuid; v_i int;
BEGIN
  PERFORM public.assert_admin();
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  IF p_quantity < 1 THEN RAISE EXCEPTION 'quantity must be >= 1'; END IF;
  FOR v_i IN 1..p_quantity LOOP
    INSERT INTO public.inventory_unit (variant_id, unit_code, cost_price, current_store_id, status)
    VALUES (p_variant_id, NULL, p_cost_price_cents, p_store_id, 'in_stock')
    RETURNING id INTO v_unit;
    INSERT INTO public.stock_movement
      (unit_id, movement_type, to_store_id, reference_type, performed_by, note)
    VALUES (v_unit, 'received', p_store_id, 'manual', v_staff, p_note);
  END LOOP;
  RETURN json_build_object('created', p_quantity);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_apply_intake(uuid, uuid, int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_intake(uuid, uuid, int, int, text) TO authenticated;

-- ============================================================
-- Adjust unit statuses (damaged/returned/lost) via adjustment
-- movements. Supported: in_stock | sold | in_transit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_units(
  p_unit_ids uuid[], p_next_status text, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_unit uuid; v_staff uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_next_status NOT IN ('in_stock','sold','in_transit') THEN
    RAISE EXCEPTION 'unsupported status';
  END IF;
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  FOR v_unit IN SELECT unnest(p_unit_ids) LOOP
    UPDATE public.inventory_unit SET status = p_next_status::public.unit_status, updated_at = now()
    WHERE id = v_unit;
    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, reference_type, performed_by, note)
    VALUES (v_unit, 'adjustment', (SELECT current_store_id FROM public.inventory_unit WHERE id = v_unit),
            'manual', v_staff, p_note);
  END LOOP;
  RETURN json_build_object('updated', array_length(p_unit_ids, 1));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_adjust_units(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_units(uuid[], text, text) TO authenticated;

-- ============================================================
-- Order: create or update an order + its line items.
-- draft json: { id?, storeId, customerName, orderType, status,
--   reference, notes, items: [{variantId?, description, quantity,
--   agreedPriceCents, unitId?}] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_order(p_draft jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_item jsonb;
  v_unit uuid;
  v_variant uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_draft->>'storeId' IS NULL THEN RAISE EXCEPTION 'storeId required'; END IF;

  IF (p_draft->>'id') IS NOT NULL THEN
    v_id := (p_draft->>'id')::uuid;
    UPDATE public.sales_order SET
      store_id = (p_draft->>'storeId')::uuid,
      customer_name = NULLIF(p_draft->>'customerName', ''),
      order_type = COALESCE((p_draft->>'orderType')::public.order_type, 'ready_made'),
      status = COALESCE((p_draft->>'status')::public.order_status, 'pending'),
      client_ref = NULLIF(p_draft->>'reference', ''),
      notes = NULLIF(p_draft->>'notes', ''),
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.sales_order
      (store_id, customer_name, order_type, status, client_ref, notes)
    VALUES (
      (p_draft->>'storeId')::uuid,
      NULLIF(p_draft->>'customerName', ''),
      COALESCE((p_draft->>'orderType')::public.order_type, 'ready_made'),
      COALESCE((p_draft->>'status')::public.order_status, 'pending'),
      NULLIF(p_draft->>'reference', ''),
      NULLIF(p_draft->>'notes', '')
    ) RETURNING id INTO v_id;
  END IF;

  -- Replace line items.
  DELETE FROM public.order_line_item WHERE order_id = v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_draft->'items', '[]'::jsonb))
  LOOP
    v_variant := NULLIF(v_item->>'variantId','')::uuid;
    v_unit := NULLIF(v_item->>'unitId','')::uuid;
    INSERT INTO public.order_line_item
      (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
    VALUES (
      v_id, v_variant, v_unit,
      COALESCE((v_item->>'quantity')::int, 1),
      COALESCE((v_item->>'agreedPriceCents')::int, 0),
      NULLIF(v_item->>'description', '')
    );
  END LOOP;

  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_order(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  IF p_status NOT IN ('pending','in_progress','ready','released','cancelled') THEN
    RAISE EXCEPTION 'unsupported status';
  END IF;
  UPDATE public.sales_order SET status = p_status::public.order_status, updated_at = now()
  WHERE id = p_order_id;
  RETURN json_build_object('updated', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_order_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_order_status(uuid, text) TO authenticated;

-- ============================================================
-- Payment
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_add_payment(
  p_order_id uuid, p_amount_cents int, p_method text,
  p_received_by uuid DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_staff uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_method NOT IN ('cash','gcash','bank_transfer') THEN RAISE EXCEPTION 'bad method'; END IF;
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  INSERT INTO public.payment (order_id, amount, method, received_by, notes)
  VALUES (p_order_id, p_amount_cents, p_method::public.payment_method,
          COALESCE(p_received_by, v_staff), p_note);
  RETURN json_build_object('created', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_add_payment(uuid, int, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_payment(uuid, int, text, uuid, text) TO authenticated;

-- ============================================================
-- Void sale: reverse payments, restock units, cancel the order.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_void_sale(p_order_id uuid, p_reason text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
  v_exception uuid;
  v_unit uuid;
  v_store uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  SELECT store_id INTO v_store FROM public.sales_order WHERE id = p_order_id;

  INSERT INTO public.sales_exception (order_id, exception_type, reason, amount, processed_by)
  SELECT p_order_id, 'void', p_reason, 0, v_staff
  RETURNING id INTO v_exception;

  -- Reverse payments.
  INSERT INTO public.payment (order_id, amount, method, kind, sales_exception_id, received_by, notes)
  SELECT order_id, -amount, method, 'void_reversal', v_exception, v_staff, 'void'
  FROM public.payment WHERE order_id = p_order_id AND kind = 'payment';

  -- Restock sold units at their store.
  FOR v_unit IN SELECT unit_id FROM public.order_line_item WHERE order_id = p_order_id AND unit_id IS NOT NULL
  LOOP
    UPDATE public.inventory_unit SET status = 'in_stock', updated_at = now() WHERE id = v_unit;
    INSERT INTO public.stock_movement
      (unit_id, movement_type, to_store_id, reference_type, reference_id, performed_by, note)
    VALUES (v_unit, 'adjustment', v_store, 'order', p_order_id, v_staff, 'void');
  END LOOP;

  UPDATE public.sales_order SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;
  RETURN json_build_object('voided', true, 'exception_id', v_exception);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_void_sale(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_void_sale(uuid, text) TO authenticated;

-- ============================================================
-- Refund: log a refund exception + a negative payment.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_refund_sale(
  p_order_id uuid, p_amount_cents int, p_method text, p_reason text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
  v_exception uuid;
BEGIN
  PERFORM public.assert_admin();
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  IF p_method NOT IN ('cash','gcash','bank_transfer') THEN RAISE EXCEPTION 'bad method'; END IF;
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();

  INSERT INTO public.sales_exception (order_id, exception_type, reason, amount, payment_method, processed_by)
  VALUES (p_order_id, 'refund', p_reason, p_amount_cents, p_method::public.payment_method, v_staff)
  RETURNING id INTO v_exception;

  INSERT INTO public.payment (order_id, amount, method, kind, sales_exception_id, received_by, notes)
  VALUES (p_order_id, -p_amount_cents, p_method::public.payment_method, 'refund',
          v_exception, v_staff, p_reason);

  RETURN json_build_object('refunded', true, 'exception_id', v_exception);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_refund_sale(uuid, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_refund_sale(uuid, int, text, text) TO authenticated;

-- ============================================================
-- Delete: staff & store.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_staff(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_admin();
  -- References on staff are informational only; clear them so the row is removable.
  UPDATE public.stock_movement SET performed_by = NULL WHERE performed_by = p_id;
  UPDATE public.payment SET received_by = NULL WHERE received_by = p_id;
  UPDATE public.sales_exception SET processed_by = NULL WHERE processed_by = p_id;
  DELETE FROM public.staff WHERE id = p_id;
  RETURN json_build_object('deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid) TO authenticated;

-- Deletes a store: removes its staff and unsold units, then soft-deletes the
-- store. A hard DELETE is blocked by historical rows (sales_order.store_id is
-- NOT NULL and sold units keep history), so the store is deactivated instead.
CREATE OR REPLACE FUNCTION public.admin_delete_store(p_id uuid, p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_exists boolean; v_op int;
BEGIN
  PERFORM public.assert_admin();
  SELECT EXISTS(SELECT 1 FROM public.store WHERE id = p_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN json_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  SELECT COUNT(*) INTO v_op
  FROM (
    SELECT 1 FROM public.staff WHERE store_id = p_id
    UNION ALL
    SELECT 1 FROM public.inventory_unit WHERE current_store_id = p_id AND status <> 'sold'
  ) t;

  IF v_op > 0 AND NOT p_force THEN
    RETURN json_build_object('deleted', false, 'reason', 'has_records');
  END IF;

  -- Clear informational staff references, then remove the store's staff.
  UPDATE public.stock_movement SET performed_by = NULL
    WHERE performed_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  UPDATE public.payment SET received_by = NULL
    WHERE received_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  UPDATE public.sales_exception SET processed_by = NULL
    WHERE processed_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  DELETE FROM public.staff WHERE store_id = p_id;

  -- Remove the store's unsold units and their movements.
  DELETE FROM public.stock_movement
    WHERE unit_id IN (SELECT id FROM public.inventory_unit WHERE current_store_id = p_id AND status <> 'sold');
  DELETE FROM public.inventory_unit WHERE current_store_id = p_id AND status <> 'sold';

  UPDATE public.store SET is_active = false, updated_at = now() WHERE id = p_id;
  RETURN json_build_object('deleted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_store(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_store(uuid, boolean) TO authenticated;
