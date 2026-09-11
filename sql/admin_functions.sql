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
  -- Deactivated admins lose admin access immediately (NULL counts as active,
  -- matching the column's DEFAULT true).
  IF NOT EXISTS (
    SELECT 1 FROM public.staff
    WHERE auth_uid = auth.uid() AND role = 'admin' AND COALESCE(is_active, true)
  ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assert_admin() TO authenticated;

-- ============================================================
-- Read: full admin dataset, shaped exactly like AdminState.
--
-- DEFINED IN `product_matrix.sql`, which runs AFTER this file. It is
-- deliberately NOT defined here any more: two files each defining the same RPC
-- meant that re-running this one silently reverted the matrix-aware version
-- (the bug that made SKU prefixes appear to "not save"). product_matrix.sql is
-- now the single owner of admin_get_state() and admin_upsert_product().
-- ============================================================

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

-- ============================================================
-- Delete a category.
--
-- Without p_force a category that still holds products is REFUSED (raises, so
-- the UI shows why). With p_force the products go through exactly the same
-- removal rules as deleting them directly from the Products screen:
--   * current shelf stock (non-sold units) is cleared,
--   * variants never sold / never referenced by an order are hard-deleted,
--   * products WITH sales history are kept and soft-deleted (is_active=false)
--     so historical order rows still resolve.
-- Products that survive for history reasons must live somewhere — the category
-- row's FK is NOT NULL — so they are re-homed to a stable 'Unassigned'
-- category (the same label the admin UI falls back to for a missing category).
--
-- Calls admin_delete_product_rows(), which is defined just below; plpgsql
-- resolves calls at run time and this whole file is applied before either
-- function can be invoked.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_category(p_id uuid, p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_products uuid[];
  v_count int;
  v_survivors int;
  v_result json;
  v_home uuid;
BEGIN
  PERFORM public.assert_admin();

  SELECT COALESCE(array_agg(p.id), ARRAY[]::uuid[]), COUNT(*)
    INTO v_products, v_count
  FROM public.product p
  WHERE p.category_id = p_id;

  IF NOT EXISTS (SELECT 1 FROM public.category WHERE id = p_id) THEN
    RAISE EXCEPTION 'category not found';
  END IF;

  IF v_count > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'category still has % product(s) — remove them first, or force', v_count;
  END IF;

  IF v_count > 0 THEN
    v_result := public.admin_delete_product_rows(v_products, true);
  END IF;

  -- Anything still pointing at this category survived because it has sales
  -- history; re-home it so the category row can actually be deleted.
  SELECT COUNT(*) INTO v_survivors FROM public.product WHERE category_id = p_id;
  IF v_survivors > 0 THEN
    IF (SELECT lower(trim(name)) FROM public.category WHERE id = p_id) = 'unassigned' THEN
      RAISE EXCEPTION
        'the Unassigned category holds % product(s) kept for sales history and cannot be deleted', v_survivors;
    END IF;
    INSERT INTO public.category (name) VALUES ('Unassigned')
      ON CONFLICT (name) DO NOTHING;
    SELECT id INTO v_home FROM public.category WHERE name = 'Unassigned';
    UPDATE public.product SET category_id = v_home, updated_at = now()
      WHERE category_id = p_id;
  END IF;

  DELETE FROM public.category WHERE id = p_id;

  RETURN json_build_object(
    'deleted', true,
    'products', v_count,
    'products_deleted', COALESCE((v_result->>'hard_deleted')::int, 0),
    'products_hidden', COALESCE((v_result->>'hidden')::int, 0),
    'products_rehomed', v_survivors
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_category(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_category(uuid, boolean) TO authenticated;

-- ============================================================
-- Shared product-removal worker.
--
-- Called by admin_delete_products() (see admin_product_delete.sql) and by the
-- force path of admin_delete_category(). INTERNAL: no EXECUTE grant, so only
-- the SECURITY DEFINER callers (which run as the owner) can reach it.
-- Returns {deleted:false, reason:'has_stock', count} when a selected product
-- still has in-stock units and p_force is not set, so the UI can offer to force.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_product_rows(p_ids uuid[], p_force boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  v_kept int := 0;
  v_stock int := 0;
  v_hard int := 0;
  v_hidden int := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN json_build_object('deleted', false, 'reason', 'empty');
  END IF;

  -- Guard: if any selected product currently has in-stock units, require force.
  IF NOT p_force THEN
    SELECT COUNT(*) INTO v_stock
    FROM public.product p
    WHERE p.id = ANY(p_ids)
      AND EXISTS (
        SELECT 1 FROM public.inventory_unit u
        JOIN public.product_variant v ON v.id = u.variant_id
        WHERE v.product_id = p.id AND u.status = 'in_stock'
      );
    IF v_stock > 0 THEN
      RETURN json_build_object('deleted', false, 'reason', 'has_stock', 'count', v_stock);
    END IF;
  END IF;

  FOREACH pid IN ARRAY p_ids LOOP
    -- 1) Remove current / unsold stock of this product's variants (and their
    --    ledger rows). Sold units — and units still referenced by an open
    --    order line — are retained.
    DELETE FROM public.stock_movement
      WHERE unit_id IN (
        SELECT u.id FROM public.inventory_unit u
        JOIN public.product_variant v ON v.id = u.variant_id
        WHERE v.product_id = pid AND u.status <> 'sold'
          AND NOT EXISTS (SELECT 1 FROM public.order_line_item oi WHERE oi.unit_id = u.id)
      );

    DELETE FROM public.inventory_unit
      WHERE id IN (
        SELECT u.id FROM public.inventory_unit u
        JOIN public.product_variant v ON v.id = u.variant_id
        WHERE v.product_id = pid AND u.status <> 'sold'
          AND NOT EXISTS (SELECT 1 FROM public.order_line_item oi WHERE oi.unit_id = u.id)
      );

    -- 2) Hard-delete variants that were never sold and never referenced by an
    --    order line (and now hold no retained units).
    DELETE FROM public.product_variant pv
      WHERE pv.product_id = pid
        AND NOT EXISTS (SELECT 1 FROM public.order_line_item oi WHERE oi.product_variant_id = pv.id)
        AND NOT EXISTS (SELECT 1 FROM public.inventory_unit u WHERE u.variant_id = pv.id AND u.status = 'sold');

    -- 3) Any remaining variants carry sales history -> hide the product.
    --    Otherwise the product row is safe to remove entirely.
    SELECT COUNT(*) INTO v_kept FROM public.product_variant WHERE product_id = pid;

    IF v_kept = 0 THEN
      DELETE FROM public.product WHERE id = pid;
      v_hard := v_hard + 1;
    ELSE
      UPDATE public.product SET is_active = false, updated_at = now() WHERE id = pid;
      v_hidden := v_hidden + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('deleted', true, 'hard_deleted', v_hard, 'hidden', v_hidden);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_product_rows(uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_product_rows(uuid[], boolean) FROM authenticated;

-- ============================================================
-- Product
--
-- admin_upsert_product() is DEFINED IN `product_matrix.sql` ONLY (the 10-arg,
-- matrix-aware version). The legacy 5-arg overload that used to live here is
-- DROPPED: it wrote the product row without reconciling the colour x size grid,
-- and having two signatures meant a 5-arg call silently skipped the matrix.
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_upsert_product(uuid, uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_toggle_products_active(p_ids uuid[], p_is_active boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_updated int;
BEGIN
  PERFORM public.assert_admin();
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no products selected';
  END IF;
  UPDATE public.product SET is_active = p_is_active, updated_at = now()
  WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- Report the truth: the old version returned {updated:true} even when the
  -- ids matched nothing.
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'no matching products';
  END IF;
  RETURN json_build_object('updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_toggle_products_active(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_products_active(uuid[], boolean) TO authenticated;

-- ============================================================
-- Variant writes belong to admin_upsert_product's matrix reconciliation (see
-- product_matrix.sql). Writing a bare product_variant row bypassed
-- product.colors/sizes, so the next product save treated the new colour x size
-- as "removed from the matrix" and deleted it again, and re-adding an existing
-- combo hit the product_variant_matrix_key unique index (the old ON CONFLICT
-- only covered the primary key). Nothing in the UI calls it any more, so the
-- function is dropped rather than left as a trap.
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_upsert_variant(uuid, uuid, text, text, text, int);

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
DECLARE v_updated int;
BEGIN
  PERFORM public.assert_admin();
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no staff selected';
  END IF;
  UPDATE public.staff SET is_active = p_is_active, updated_at = now()
  WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'no matching staff';
  END IF;

  -- Never leave zero active admins: that is the state where nobody can
  -- administer the system any more. (RAISE rolls the UPDATE back.)
  IF (SELECT COUNT(*) FROM public.staff WHERE role = 'admin' AND is_active) = 0 THEN
    RAISE EXCEPTION 'at least one active admin is required';
  END IF;

  RETURN json_build_object('updated', v_updated);
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
DECLARE v_staff uuid; v_created int;
BEGIN
  PERFORM public.assert_admin();
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'quantity must be >= 1'; END IF;

  -- Set-based: one statement creates every unit AND its 'received' ledger row
  -- (was 2 statements per unit, so a 200-piece intake ran 400 statements).
  -- now() is transaction-stable, so all rows still share one created_at —
  -- the grouping the admin activity feed / Sales panels rely on is preserved.
  WITH new_units AS (
    INSERT INTO public.inventory_unit (variant_id, unit_code, cost_price, current_store_id, status)
    SELECT p_variant_id, NULL, p_cost_price_cents, p_store_id, 'in_stock'
    FROM generate_series(1, p_quantity)
    RETURNING id
  )
  INSERT INTO public.stock_movement
    (unit_id, movement_type, to_store_id, reference_type, performed_by, note)
  SELECT nu.id, 'received', p_store_id, 'manual', v_staff, p_note
  FROM new_units nu;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN json_build_object('created', v_created);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_apply_intake(uuid, uuid, int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_intake(uuid, uuid, int, int, text) TO authenticated;

-- ============================================================
-- Adjust a unit's status via adjustment movements. Supported values — these
-- are the ONLY members of the unit_status enum — are:
--   in_stock | sold | in_transit
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_units(
  p_unit_ids uuid[], p_next_status text, p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_staff uuid; v_updated int;
BEGIN
  PERFORM public.assert_admin();
  IF p_next_status NOT IN ('in_stock','sold','in_transit') THEN
    RAISE EXCEPTION 'unsupported status';
  END IF;
  IF p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN json_build_object('updated', 0);
  END IF;
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();

  -- Set-based: the status change and its 'adjustment' ledger rows are written
  -- in one pass (was an UPDATE + a re-SELECT + an INSERT per unit).
  WITH upd AS (
    UPDATE public.inventory_unit
      SET status = p_next_status::public.unit_status, updated_at = now()
    WHERE id = ANY(p_unit_ids)
    RETURNING id, current_store_id
  )
  INSERT INTO public.stock_movement
    (unit_id, movement_type, from_store_id, reference_type, performed_by, note)
  SELECT upd.id, 'adjustment', upd.current_store_id, 'manual', v_staff, p_note
  FROM upd;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN json_build_object('updated', v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_adjust_units(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_units(uuid[], text, text) TO authenticated;

-- ============================================================
-- Admin transfer between boutiques. Moves in_stock units of each
-- variant from one store to another IMMEDIATELY (no in_transit
-- wait for a staff receive) so both stores' on-hand stay accurate
-- in the admin inventory view. Logs a transferred_out +
-- transferred_in pair per unit sharing one reference_id.
-- items json: [{ variant_id: uuid, quantity: int }]
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_transfer_stock(
  p_from_store_id uuid,
  p_to_store_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
  v_op_id uuid := gen_random_uuid();
  v_item jsonb;
  v_variant uuid;
  v_qty int;
  v_units uuid[];
  v_got int;
  v_moved int := 0;
BEGIN
  PERFORM public.assert_admin();
  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();
  IF p_from_store_id IS NULL OR p_to_store_id IS NULL OR p_from_store_id = p_to_store_id THEN
    RAISE EXCEPTION 'invalid source or destination store';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store WHERE id = p_to_store_id AND is_active) THEN
    RAISE EXCEPTION 'destination store is not active';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    -- One statement locks the batch (oldest first, SKIP LOCKED); the relocate
    -- and both ledger inserts are then set-based. Was ~4 statements per unit.
    SELECT array_agg(s.id ORDER BY s.created_at), COUNT(*)
      INTO v_units, v_got
    FROM (
      SELECT id, created_at
      FROM public.inventory_unit
      WHERE variant_id = v_variant
        AND current_store_id = p_from_store_id
        AND status = 'in_stock'
      ORDER BY created_at
      LIMIT v_qty
      FOR UPDATE SKIP LOCKED
    ) s;
    IF COALESCE(v_got, 0) < v_qty THEN
      RAISE EXCEPTION 'not enough in_stock at source for variant %', v_variant;
    END IF;

    -- Immediate relocate: units stay in_stock but change store.
    UPDATE public.inventory_unit
      SET current_store_id = p_to_store_id, updated_at = now()
      WHERE id = ANY(v_units);

    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
    SELECT u.unit_id, 'transferred_out', p_from_store_id, p_to_store_id, 'transfer', v_op_id, v_staff, p_note
    FROM unnest(v_units) AS u(unit_id);

    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
    SELECT u.unit_id, 'transferred_in', p_from_store_id, p_to_store_id, 'transfer', v_op_id, v_staff, p_note
    FROM unnest(v_units) AS u(unit_id);

    v_moved := v_moved + v_got;
  END LOOP;

  IF v_moved = 0 THEN
    RAISE EXCEPTION 'no units to transfer';
  END IF;
  RETURN json_build_object('transfer_id', v_op_id, 'moved', v_moved);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_transfer_stock(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transfer_stock(uuid, uuid, jsonb, text) TO authenticated;

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
  v_qty int;
BEGIN
  PERFORM public.assert_admin();
  IF p_draft->>'storeId' IS NULL THEN RAISE EXCEPTION 'storeId required'; END IF;

  -- client_ref doubles as the idempotency key and is UNIQUE — say so clearly
  -- instead of surfacing a raw constraint violation.
  IF NULLIF(p_draft->>'reference', '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.sales_order o
       WHERE o.client_ref = NULLIF(p_draft->>'reference', '')
         AND (p_draft->>'id' IS NULL OR o.id <> (p_draft->>'id')::uuid)
     )
  THEN
    RAISE EXCEPTION 'reference % is already used by another order', p_draft->>'reference';
  END IF;

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
    -- Previously this silently updated 0 rows, then inserted the line items
    -- against an order that does not exist (raw FK error).
    IF NOT FOUND THEN
      RAISE EXCEPTION 'order % not found', v_id;
    END IF;
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
  --
  -- NOTE: this does NOT reconcile inventory_unit. Dropping or replacing a line
  -- whose unit is already 'sold' leaves that unit sold with no order line (an
  -- orphan that also blocks variant deletion later). Nothing in the admin UI
  -- calls this RPC today, so it is only safe for draft / made-to-order records
  -- that carry no physical units.
  DELETE FROM public.order_line_item WHERE order_id = v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_draft->'items', '[]'::jsonb))
  LOOP
    v_variant := NULLIF(v_item->>'variantId','')::uuid;
    v_unit := NULLIF(v_item->>'unitId','')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'line quantity must be >= 1';
    END IF;
    IF v_unit IS NOT NULL AND v_qty <> 1 THEN
      RAISE EXCEPTION 'a line with a physical unit must have quantity 1';
    END IF;
    INSERT INTO public.order_line_item
      (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
    VALUES (
      v_id, v_variant, v_unit, v_qty,
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
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
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero (a reversal is a refund)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_order WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_exception
             WHERE order_id = p_order_id AND exception_type = 'void') THEN
    RAISE EXCEPTION 'order is voided — no further payments can be recorded';
  END IF;
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
  v_store uuid;
  v_restocked int := 0;
BEGIN
  PERFORM public.assert_admin();
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;

  SELECT store_id INTO v_store FROM public.sales_order WHERE id = p_order_id;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  -- Guard against a second void. Each void reverses every payment AND restocks
  -- every unit, so repeating it double-counted both the money and the stock.
  IF EXISTS (SELECT 1 FROM public.sales_exception
             WHERE order_id = p_order_id AND exception_type = 'void') THEN
    RAISE EXCEPTION 'order has already been voided';
  END IF;

  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();

  INSERT INTO public.sales_exception (order_id, exception_type, reason, amount, processed_by)
  SELECT p_order_id, 'void', p_reason, 0, v_staff
  RETURNING id INTO v_exception;

  -- Reverse payments.
  INSERT INTO public.payment (order_id, amount, method, kind, sales_exception_id, received_by, notes)
  SELECT order_id, -amount, method, 'void_reversal', v_exception, v_staff, 'void'
  FROM public.payment WHERE order_id = p_order_id AND kind = 'payment';

  -- Restock the units still marked sold and log the matching ledger rows in the
  -- same pass, so only units that were actually flipped produce a movement (the
  -- old version restocked unconditionally, including already-restocked units).
  WITH restocked AS (
    UPDATE public.inventory_unit u
      SET status = 'in_stock', updated_at = now()
    WHERE u.status = 'sold'
      AND u.id IN (
        SELECT li.unit_id FROM public.order_line_item li
        WHERE li.order_id = p_order_id AND li.unit_id IS NOT NULL
      )
    RETURNING u.id
  )
  INSERT INTO public.stock_movement
    (unit_id, movement_type, to_store_id, reference_type, reference_id, performed_by, note)
  SELECT r.id, 'adjustment', v_store, 'order', p_order_id, v_staff, 'void'
  FROM restocked r;

  GET DIAGNOSTICS v_restocked = ROW_COUNT;

  UPDATE public.sales_order SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;
  RETURN json_build_object('voided', true, 'exception_id', v_exception, 'units_restocked', v_restocked);
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
  v_paid bigint;
  v_refunded bigint;
BEGIN
  PERFORM public.assert_admin();
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  IF p_method NOT IN ('cash','gcash','bank_transfer') THEN RAISE EXCEPTION 'bad method'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund amount must be greater than zero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_order WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_exception
             WHERE order_id = p_order_id AND exception_type = 'void') THEN
    RAISE EXCEPTION 'order is voided — the void reversal already returned the money';
  END IF;

  -- Refunds may never exceed what was actually paid, cumulatively. Previously
  -- an order could be refunded repeatedly for any amount the client sent.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payment WHERE order_id = p_order_id AND kind = 'payment';
  SELECT COALESCE(-SUM(amount), 0) INTO v_refunded
  FROM public.payment WHERE order_id = p_order_id AND kind = 'refund';
  IF v_refunded + p_amount_cents > v_paid THEN
    RAISE EXCEPTION 'refund of % exceeds the remaining refundable amount of %',
      p_amount_cents, GREATEST(v_paid - v_refunded, 0);
  END IF;

  SELECT id INTO v_staff FROM public.staff WHERE auth_uid = auth.uid();

  INSERT INTO public.sales_exception (order_id, exception_type, reason, amount, payment_method, processed_by)
  VALUES (p_order_id, 'refund', p_reason, p_amount_cents, p_method::public.payment_method, v_staff)
  RETURNING id INTO v_exception;

  INSERT INTO public.payment (order_id, amount, method, kind, sales_exception_id, received_by, notes)
  VALUES (p_order_id, -p_amount_cents, p_method::public.payment_method, 'refund',
          v_exception, v_staff, p_reason);

  RETURN json_build_object(
    'refunded', true,
    'exception_id', v_exception,
    'remaining_refundable', v_paid - v_refunded - p_amount_cents
  );
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
DECLARE v_self boolean;
BEGIN
  PERFORM public.assert_admin();
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id = p_id) THEN
    RAISE EXCEPTION 'staff member not found';
  END IF;

  -- Never remove yourself, and never remove the last admin: either leaves the
  -- system with nobody who can administer it.
  SELECT (auth_uid = auth.uid()) INTO v_self FROM public.staff WHERE id = p_id;
  IF v_self THEN
    RAISE EXCEPTION 'you cannot delete your own account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff WHERE id = p_id AND role = 'admin')
     AND (SELECT COUNT(*) FROM public.staff WHERE role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'cannot delete the last admin';
  END IF;

  -- Every staff reference is informational, but they are still foreign keys and
  -- must be cleared first. sales_order.dispatched_by ("care of") was MISSING —
  -- deleting anyone who had ever dispatched an order failed with a raw FK error.
  UPDATE public.stock_movement SET performed_by = NULL WHERE performed_by = p_id;
  UPDATE public.payment SET received_by = NULL WHERE received_by = p_id;
  UPDATE public.sales_exception SET processed_by = NULL WHERE processed_by = p_id;
  UPDATE public.sales_order SET dispatched_by = NULL WHERE dispatched_by = p_id;

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
  -- sales_order.dispatched_by ("care of") was missing here too.
  UPDATE public.stock_movement SET performed_by = NULL
    WHERE performed_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  UPDATE public.payment SET received_by = NULL
    WHERE received_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  UPDATE public.sales_exception SET processed_by = NULL
    WHERE processed_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  UPDATE public.sales_order SET dispatched_by = NULL
    WHERE dispatched_by IN (SELECT id FROM public.staff WHERE store_id = p_id);
  DELETE FROM public.staff WHERE store_id = p_id;

  -- An admin can end up attached to a store (admin_upsert_staff does not touch
  -- role), so never let this leave the system with zero admins.
  IF (SELECT COUNT(*) FROM public.staff WHERE role = 'admin') = 0 THEN
    RAISE EXCEPTION 'this would remove the last admin';
  END IF;

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
