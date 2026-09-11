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
STABLE
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
  -- Only ACTIVE staff resolve to a profile. A deactivated member who has a
  -- linked login is therefore signed straight back out by the client, while a
  -- staff row with no auth_uid is unaffected. NULL counts as active (the
  -- column is nullable with DEFAULT true).
  WHERE s.auth_uid = auth.uid()
    AND COALESCE(s.is_active, true)
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
  -- NULL for an inactive (or unlinked) member, which is what makes every
  -- store-scoped RLS policy deny access to a deactivated account. NULL counts
  -- as active, matching the column's DEFAULT true.
  SELECT store_id FROM public.staff
  WHERE auth_uid = auth.uid() AND COALESCE(is_active, true)
$$;
REVOKE ALL ON FUNCTION public.get_my_store_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_store_id() TO authenticated;

-- ============================================================
-- Helper for the shared-catalog policies: is the caller still an ACTIVE staff
-- member? `TO authenticated` in a policy only proves a valid JWT, and a
-- deactivated account keeps its token until it expires which would otherwise
-- leave the catalogue readable straight from PostgREST. Use it wrapped in a
-- scalar subquery — (SELECT public.is_active_staff()) — so the planner evaluates
-- it once per query instead of once per row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE auth_uid = auth.uid() AND COALESCE(is_active, true)
  )
$$;
REVOKE ALL ON FUNCTION public.is_active_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_staff() TO authenticated;

-- ============================================================
-- RPC: log_sale — compound write for a sale.
-- Server auto-assigns in_stock units (per variant) for ready-made
-- items, marks them sold, records the order + line items + payment,
-- and the stock_movement ledger.
--
-- Idempotency: the client sends an opaque per-attempt p_idempotency_key, which
-- is stored separately from the DISPLAYED order number. A retry replays the
-- existing order instead of recording a second one.
--
-- The displayed reference (LGA-260910-0006) is allocated here, atomically,
-- from order_ref_counter — see the note in schema.sql. A legacy caller may still
-- pass p_client_ref to supply its own.
-- ============================================================
DROP FUNCTION IF EXISTS public.log_sale(order_type, varchar, jsonb, jsonb, uuid, varchar, text);
CREATE OR REPLACE FUNCTION public.log_sale(
  p_order_type order_type DEFAULT 'ready_made',
  p_customer_name varchar DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_payment jsonb DEFAULT NULL,
  p_care_of uuid DEFAULT NULL,
  p_client_ref varchar DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
  v_store_id uuid;
  v_store_code varchar;
  v_order_id uuid;
  v_ref varchar;
  v_seq int;
  v_total bigint := 0;
  v_paid bigint := 0;
  v_status order_status := 'pending';
  v_item jsonb;
  v_variant uuid;
  v_unit uuid;
  v_unit_ok uuid;
  v_qty int;
  v_price bigint;
  v_spec text;
  v_units uuid[];
  v_got int;
  v_existing uuid;
BEGIN
  -- Only an ACTIVE staff member may write. A deactivated account gets its own
  -- message instead of the misleading "no store assigned".
  SELECT s.id, s.store_id, st.code
    INTO v_staff_id, v_store_id, v_store_code
  FROM public.staff s
  LEFT JOIN public.store st ON st.id = s.store_id
  WHERE s.auth_uid = auth.uid() AND COALESCE(s.is_active, true);
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'your account is inactive';
  END IF;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  -- Input validation. All of this used to be accepted silently.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'a sale needs at least one item';
  END IF;
  IF p_care_of IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.staff WHERE id = p_care_of AND store_id = v_store_id
  ) THEN
    RAISE EXCEPTION 'care-of must be a staff member of this store';
  END IF;

  -- Idempotency: a replay returns the existing order (new key first, legacy
  -- client_ref second). The existing order number is echoed back so the till can
  -- still display it.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, client_ref INTO v_existing, v_ref
    FROM public.sales_order WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('order_id', v_existing, 'duplicate', true, 'order_number', v_ref);
    END IF;
  ELSIF p_client_ref IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.sales_order WHERE client_ref = p_client_ref;
    IF v_existing IS NOT NULL THEN
      RETURN json_build_object('order_id', v_existing, 'duplicate', true, 'order_number', p_client_ref);
    END IF;
  END IF;

  -- Compute the order total from the items (server-side, so clients
  -- cannot understate the total). Prices arrive in pesos; store centavos.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_price := COALESCE((v_item->>'agreed_price')::bigint, 0) * 100;
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    IF v_qty < 1 THEN
      RAISE EXCEPTION 'line quantity must be >= 1';
    END IF;
    v_total := v_total + v_price * v_qty;
  END LOOP;

  IF p_payment IS NOT NULL THEN
    v_paid := COALESCE((p_payment->>'amount')::bigint, 0) * 100;
  END IF;

  -- A cash-and-carry ready-made sale paid in full is released.
  IF p_order_type = 'ready_made' AND v_paid > 0 AND v_paid >= v_total THEN
    v_status := 'released';
  END IF;

  -- The displayed order number. A legacy caller may supply its own; otherwise
  -- allocate one atomically for this store + local day (Asia/Manila), so two
  -- tills selling at the same moment can never be handed the same reference.
  IF p_client_ref IS NOT NULL THEN
    v_ref := p_client_ref;
  ELSE
    INSERT INTO public.order_ref_counter (store_id, day, next_seq)
    VALUES (v_store_id, (now() AT TIME ZONE 'Asia/Manila')::date, 1)
    ON CONFLICT (store_id, day)
      DO UPDATE SET next_seq = public.order_ref_counter.next_seq + 1
    RETURNING next_seq INTO v_seq;

    IF v_seq > 999 THEN
      RAISE EXCEPTION 'the daily order limit (999) has been reached for this store';
    END IF;

    v_ref := v_store_code || '-' ||
             to_char(now() AT TIME ZONE 'Asia/Manila', 'YYMMDD') || '-' ||
             CASE WHEN p_order_type = 'ready_made' THEN '0' ELSE '1' END ||
             lpad(v_seq::text, 3, '0');
  END IF;

  INSERT INTO public.sales_order
    (client_ref, store_id, customer_name, order_type, status, dispatched_by, notes, idempotency_key)
  VALUES
    (v_ref, v_store_id, p_customer_name, p_order_type, v_status, p_care_of, p_notes, p_idempotency_key)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := NULLIF(v_item->>'variant_id','')::uuid;
    v_price := COALESCE((v_item->>'agreed_price')::bigint, 0) * 100;
    v_spec := v_item->>'spec_note';
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    v_unit := NULLIF(v_item->>'unit_id','')::uuid;

    IF v_unit IS NOT NULL THEN
      -- A pre-assigned physical piece. It must belong to THIS store and still
      -- be sellable, and it must be marked sold + logged like any other sale:
      -- this branch used to write the line item and do nothing else, so a
      -- crafted call could attach another store's unit with no status change
      -- and no ledger row.
      IF v_qty <> 1 THEN
        RAISE EXCEPTION 'a line with a physical unit must have quantity 1';
      END IF;
      SELECT id INTO v_unit_ok
      FROM public.inventory_unit
      WHERE id = v_unit AND current_store_id = v_store_id AND status = 'in_stock'
      FOR UPDATE;
      IF v_unit_ok IS NULL THEN
        RAISE EXCEPTION 'unit % is not available at this store', v_unit;
      END IF;

      INSERT INTO public.order_line_item
        (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
      VALUES (v_order_id, v_variant, v_unit, 1, v_price, v_spec);

      UPDATE public.inventory_unit
        SET status = 'sold', updated_at = now()
        WHERE id = v_unit;

      INSERT INTO public.stock_movement
        (unit_id, movement_type, from_store_id, reference_type, reference_id, performed_by, note)
      VALUES (v_unit, 'sold', v_store_id, 'order', v_order_id, v_staff_id, 'sale');
    ELSIF p_order_type = 'ready_made' THEN
      -- Lock the whole batch of in_stock units for this variant in ONE
      -- statement (oldest first, SKIP LOCKED so concurrent sales never block),
      -- then write line items / status change / ledger rows set-based. This
      -- turns ~4 statements PER UNIT into ~4 statements PER VARIANT.
      SELECT array_agg(s.id ORDER BY s.created_at), COUNT(*)
        INTO v_units, v_got
      FROM (
        SELECT id, created_at
        FROM public.inventory_unit
        WHERE variant_id = v_variant
          AND current_store_id = v_store_id
          AND status = 'in_stock'
        ORDER BY created_at
        LIMIT v_qty
        FOR UPDATE SKIP LOCKED
      ) s;
      IF COALESCE(v_got, 0) < v_qty THEN
        RAISE EXCEPTION 'not enough in_stock for variant %', v_variant;
      END IF;

      -- One line item per physical unit (quantity 1), preserving unit order.
      INSERT INTO public.order_line_item
        (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
      SELECT v_order_id, v_variant, u.unit_id, 1, v_price, v_spec
      FROM unnest(v_units) WITH ORDINALITY AS u(unit_id, ord)
      ORDER BY u.ord;

      UPDATE public.inventory_unit
        SET status = 'sold', updated_at = now()
        WHERE id = ANY(v_units);

      INSERT INTO public.stock_movement
        (unit_id, movement_type, from_store_id, reference_type, reference_id, performed_by, note)
      SELECT u.unit_id, 'sold', v_store_id, 'order', v_order_id, v_staff_id, 'sale'
      FROM unnest(v_units) AS u(unit_id);
    ELSE
      -- MTO / bulk line with no physical unit attached yet.
      INSERT INTO public.order_line_item
        (order_id, product_variant_id, unit_id, quantity, agreed_price, spec_note)
      VALUES (v_order_id, v_variant, NULL, v_qty, v_price, v_spec);
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

  RETURN json_build_object(
    'order_id', v_order_id,
    'duplicate', false,
    'status', v_status::text,
    'order_number', v_ref
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_sale(order_type, varchar, jsonb, jsonb, uuid, varchar, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_sale(order_type, varchar, jsonb, jsonb, uuid, varchar, text, uuid) TO authenticated;

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
  v_units uuid[];
  v_got int;
  v_prior jsonb;
  v_result json;
BEGIN
  SELECT id, store_id INTO v_staff_id, v_from_store
  FROM public.staff WHERE auth_uid = auth.uid() AND COALESCE(is_active, true);
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'your account is inactive';
  END IF;
  IF v_from_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;
  IF p_to_store_id IS NULL OR p_to_store_id = v_from_store THEN
    RAISE EXCEPTION 'invalid destination store';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store WHERE id = p_to_store_id AND is_active) THEN
    RAISE EXCEPTION 'destination store is not active';
  END IF;

  -- Idempotency: this parameter used to be accepted and silently ignored, so a
  -- retried call moved the same stock twice. A replay now returns the ORIGINAL
  -- result instead of repeating the side effect.
  IF p_client_ref IS NOT NULL THEN
    SELECT result INTO v_prior FROM public.rpc_idempotency WHERE client_ref = p_client_ref;
    IF v_prior IS NOT NULL THEN
      RETURN v_prior;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    IF v_qty < 1 THEN
      CONTINUE;
    END IF;

    -- One statement locks the batch (oldest first, SKIP LOCKED); then the
    -- update + ledger insert are set-based — ~3 statements per variant
    -- instead of ~4 statements per unit.
    SELECT array_agg(s.id ORDER BY s.created_at), COUNT(*)
      INTO v_units, v_got
    FROM (
      SELECT id, created_at
      FROM public.inventory_unit
      WHERE variant_id = v_variant
        AND current_store_id = v_from_store
        AND status = 'in_stock'
      ORDER BY created_at
      LIMIT v_qty
      FOR UPDATE SKIP LOCKED
    ) s;
    IF COALESCE(v_got, 0) < v_qty THEN
      RAISE EXCEPTION 'not enough in_stock for variant %', v_variant;
    END IF;

    UPDATE public.inventory_unit
      SET current_store_id = p_to_store_id, status = 'in_transit', updated_at = now()
      WHERE id = ANY(v_units);

    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
    SELECT u.unit_id, 'transferred_out', v_from_store, p_to_store_id, 'transfer', v_op_id, v_staff_id, p_note
    FROM unnest(v_units) AS u(unit_id);
  END LOOP;

  v_result := json_build_object('transfer_id', v_op_id);

  IF p_client_ref IS NOT NULL THEN
    INSERT INTO public.rpc_idempotency (client_ref, rpc, result)
    VALUES (p_client_ref, 'transfer_stock', v_result::jsonb)
    ON CONFLICT (client_ref) DO NOTHING;
  END IF;

  RETURN v_result;
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
  v_units uuid[];
BEGIN
  SELECT id, store_id INTO v_staff_id, v_from_store
  FROM public.staff WHERE auth_uid = auth.uid() AND COALESCE(is_active, true);
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'your account is inactive';
  END IF;
  IF v_from_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  -- Lock the IN-TRANSIT UNITS themselves (the old version locked only the
  -- stock_movement rows, so a concurrent receive_stock could win the race and
  -- this batch would silently no-op while still reporting success).
  SELECT array_agg(t.unit_id) INTO v_units
  FROM (
    SELECT m.unit_id
    FROM public.stock_movement m
    JOIN public.inventory_unit u
      ON u.id = m.unit_id AND u.status = 'in_transit'
    WHERE m.reference_id = p_transfer_id
      AND m.movement_type = 'transferred_out'
      AND m.from_store_id = v_from_store
    FOR UPDATE OF u SKIP LOCKED
  ) t;

  IF v_units IS NULL THEN
    -- Nothing left to cancel (already received, already cancelled, or not ours).
    RETURN json_build_object('cancelled', false, 'units', 0);
  END IF;

  UPDATE public.inventory_unit
    SET status = 'in_stock', current_store_id = v_from_store, updated_at = now()
    WHERE id = ANY(v_units);

  INSERT INTO public.stock_movement
    (unit_id, movement_type, from_store_id, reference_type, reference_id, performed_by, note)
  SELECT u.unit_id, 'adjustment', v_from_store, 'transfer', p_transfer_id, v_staff_id, 'cancelled transfer'
  FROM unnest(v_units) AS u(unit_id);

  RETURN json_build_object('cancelled', true, 'units', array_length(v_units, 1));
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
  v_units uuid[];
BEGIN
  SELECT id, store_id INTO v_staff_id, v_store
  FROM public.staff WHERE auth_uid = auth.uid() AND COALESCE(is_active, true);
  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'your account is inactive';
  END IF;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'staff has no store assigned';
  END IF;

  -- Lock every unit being received in one statement (SKIP LOCKED keeps two
  -- concurrent receive clicks from fighting), then flip them + log the ledger
  -- set-based instead of one update/insert pair per unit.
  SELECT array_agg(t.id) INTO v_units
  FROM (
    SELECT u.id
    FROM public.inventory_unit u
    JOIN LATERAL (
      SELECT sm.from_store_id
      FROM public.stock_movement sm
      WHERE sm.unit_id = u.id AND sm.movement_type = 'transferred_out'
      ORDER BY sm.created_at DESC
      LIMIT 1
    ) m ON true
    WHERE u.current_store_id = v_store
      AND u.status = 'in_transit'
      AND (p_from_store_id IS NULL OR m.from_store_id = p_from_store_id)
    FOR UPDATE OF u SKIP LOCKED
  ) t;

  IF v_units IS NOT NULL THEN
    UPDATE public.inventory_unit
      SET status = 'in_stock', updated_at = now()
      WHERE id = ANY(v_units);

    -- Provenance per unit is re-derived here (same transaction, rows locked).
    INSERT INTO public.stock_movement
      (unit_id, movement_type, from_store_id, to_store_id, reference_type, reference_id, performed_by, note)
    SELECT u.id, 'transferred_in', m.from_store_id, v_store, 'transfer', m.reference_id,
           v_staff_id, p_note
    FROM public.inventory_unit u
    JOIN LATERAL (
      SELECT sm.from_store_id, sm.reference_id
      FROM public.stock_movement sm
      WHERE sm.unit_id = u.id AND sm.movement_type = 'transferred_out'
      ORDER BY sm.created_at DESC
      LIMIT 1
    ) m ON true
    WHERE u.id = ANY(v_units);
  END IF;

  RETURN json_build_object('received', true, 'units', COALESCE(array_length(v_units, 1), 0));
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
--
-- "Today" is the LOCAL (Asia/Manila) day, not the server's UTC day. paid_at is
-- a naive UTC timestamp, so the local day is expressed as a naive-UTC RANGE —
-- which is also what lets the (kind, paid_at) index be used. A `paid_at::date
-- = CURRENT_DATE` predicate can never use an index (and it measured the wrong
-- day for the Philippines).
CREATE OR REPLACE FUNCTION public.get_today_summary()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT public.get_my_store_id() AS store_id,
           (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')
             AT TIME ZONE 'UTC' AS day_start
  ), bounds AS (
    SELECT store_id, day_start, day_start + interval '1 day' AS day_end FROM win
  ), totals AS (
    SELECT COALESCE(SUM(p.amount), 0)                                    AS total,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'cash'), 0)   AS cash,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'gcash'), 0)  AS gcash,
           COALESCE(SUM(p.amount) FILTER (WHERE p.method = 'bank_transfer'), 0) AS bank
    FROM public.payment p
    JOIN public.sales_order o ON o.id = p.order_id
    CROSS JOIN bounds b
    WHERE o.store_id = b.store_id
      AND p.kind = 'payment'
      AND p.paid_at >= b.day_start
      AND p.paid_at <  b.day_end
  )
  SELECT json_build_object(
    'totalSales', totals.total / 100.0,
    'cash',       totals.cash / 100.0,
    'gcash',      totals.gcash / 100.0,
    'bank',       totals.bank / 100.0,
    'incoming',   (SELECT COUNT(*) FROM public.inventory_unit u
                   CROSS JOIN bounds b
                   WHERE u.current_store_id = b.store_id
                     AND u.status = 'in_transit')
  )
  FROM totals
$$;
REVOKE ALL ON FUNCTION public.get_today_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_today_summary() TO authenticated;

-- Catalog with per-variant in_stock counts for THIS store (Sale + Transfers).
--
-- The counts are computed ONCE for the whole catalog and joined in, instead of
-- running a correlated COUNT(*) per variant (was one index scan per variant).
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS MATERIALIZED (
    SELECT u.variant_id, COUNT(*) AS in_stock
    FROM public.inventory_unit u
    WHERE u.current_store_id = public.get_my_store_id()
      AND u.status = 'in_stock'
    GROUP BY u.variant_id
  )
  SELECT COALESCE(json_agg(p ORDER BY p.name), '[]'::json)
  FROM (
    SELECT p.id, p.category_id AS "categoryId", p.name,
      COALESCE(json_agg(json_build_object(
        'id', pv.id,
        'color', pv.color,
        'size', pv.size,
        'regularPrice', pv.regular_price / 100.0,
        'inStock', COALESCE(c.in_stock, 0)
      ) ORDER BY pv.color, pv.size), '[]'::json) AS variants
    FROM public.product p
    JOIN public.product_variant pv ON pv.product_id = p.id
    LEFT JOIN counts c ON c.variant_id = pv.id
    WHERE p.is_active
    GROUP BY p.id, p.category_id, p.name
  ) p
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO authenticated;

-- Stock summary: per-variant counts across ALL stores (Check Stock page).
-- Only variants that actually exist in inventory (ever had a unit, including
-- ones since sold or adjusted away) are returned; matrix-generated color x size
-- combos that were never stocked are omitted, as are products with none.
-- Index details: the per-store counts are aggregated ONCE (MATERIALIZED) and
-- then fanned out, instead of re-aggregating the whole inventory_unit table
-- inside the variant × store join. Inactive stores are no longer reported.
CREATE OR REPLACE FUNCTION public.get_stock_summary()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS MATERIALIZED (
    SELECT u.variant_id, u.current_store_id,
      COUNT(*) FILTER (WHERE u.status = 'in_stock')   AS available,
      COUNT(*) FILTER (WHERE u.status = 'in_transit') AS intransit
    FROM public.inventory_unit u
    GROUP BY u.variant_id, u.current_store_id
  ), active_stores AS MATERIALIZED (
    SELECT st.id, st.code FROM public.store st WHERE st.is_active
  ), variant_stores AS (
    SELECT pv.id AS variant_id,
      COALESCE(json_object_agg(st.code, json_build_object(
        'available', COALESCE(c.available, 0),
        'inTransit', COALESCE(c.intransit, 0)
      )), '{}'::json) AS stores
    FROM public.product_variant pv
    JOIN public.product p ON p.id = pv.product_id AND p.is_active
    CROSS JOIN active_stores st
    LEFT JOIN counts c ON c.variant_id = pv.id AND c.current_store_id = st.id
    GROUP BY pv.id
  )
  SELECT COALESCE(json_agg(p ORDER BY p.name), '[]'::json)
  FROM (
    SELECT p.id, p.category_id AS "categoryId", p.name,
      COALESCE(json_agg(json_build_object(
        'id', pv.id,
        'color', pv.color,
        'size', pv.size,
        'stores', vs.stores
      ) ORDER BY pv.color, pv.size), '[]'::json) AS variants
    FROM public.product p
    JOIN public.product_variant pv ON pv.product_id = p.id
    JOIN variant_stores vs ON vs.variant_id = pv.id
    WHERE p.is_active
      AND EXISTS (SELECT 1 FROM public.inventory_unit u WHERE u.variant_id = pv.id)
    GROUP BY p.id, p.category_id, p.name
    HAVING COUNT(pv.id) > 0
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
  WITH ctx AS (
    SELECT public.get_my_store_id() AS store_id
  ), mv AS (
    -- One row per unit sent out from this store (single scan of the ledger).
    SELECT m.reference_id, m.to_store_id, m.unit_id, m.created_at, m.note
    FROM ctx
    JOIN public.stock_movement m
      ON m.from_store_id = ctx.store_id
     AND m.movement_type = 'transferred_out'
  ), batch AS (
    SELECT mv.reference_id     AS id,
           mv.to_store_id      AS "toStoreId",
           MAX(mv.created_at)  AS "sentAt",
           MAX(mv.note)        AS note
    FROM mv
    GROUP BY mv.reference_id, mv.to_store_id
  ), flags AS (
    -- Batch outcome resolved in ONE grouped pass over the batch's movements
    -- (was two correlated EXISTS subqueries per batch row).
    SELECT b.id,
           bool_or(sm.movement_type = 'adjustment')     AS cancelled,
           bool_or(sm.movement_type = 'transferred_in') AS received
    FROM batch b
    JOIN public.stock_movement sm ON sm.reference_id = b.id
    GROUP BY b.id
  ), items AS (
    SELECT mv.reference_id,
           p.name,
           trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
           COUNT(*) AS qty
    FROM mv
    JOIN public.inventory_unit u ON u.id = mv.unit_id
    JOIN public.product_variant pv ON pv.id = u.variant_id
    JOIN public.product p ON p.id = pv.product_id
    GROUP BY mv.reference_id, p.name, pv.color, pv.size
  )
  SELECT COALESCE(json_agg(r ORDER BY r."sentAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."toStoreId", b."sentAt",
      CASE WHEN f.cancelled THEN 'cancelled'
           WHEN f.received  THEN 'received'
           ELSE 'in_transit' END AS status,
      b.note,
      COALESCE(json_agg(json_build_object('name', i.name, 'detail', i.detail, 'qty', i.qty)
                        ORDER BY i.name), '[]'::json) AS items
    FROM batch b
    LEFT JOIN flags f ON f.id = b.id
    JOIN items i ON i.reference_id = b.id
    GROUP BY b.id, b."toStoreId", b."sentAt", b.note, f.cancelled, f.received
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
  WITH ctx AS (
    SELECT public.get_my_store_id() AS store_id
  ), mv AS (
    -- In-transit units inbound to this store, resolved with a single join
    -- (was an EXISTS subquery repeated in two separate scans of the ledger).
    SELECT m.reference_id, m.from_store_id, m.unit_id, m.created_at, m.note
    FROM ctx
    JOIN public.stock_movement m
      ON m.to_store_id = ctx.store_id
     AND m.movement_type = 'transferred_out'
    JOIN public.inventory_unit u
      ON u.id = m.unit_id AND u.status = 'in_transit'
  ), batch AS (
    SELECT mv.reference_id    AS id,
           mv.from_store_id   AS "fromStoreId",
           MAX(mv.created_at) AS "sentAt",
           MAX(mv.note)       AS note
    FROM mv
    GROUP BY mv.reference_id, mv.from_store_id
  ), items AS (
    SELECT mv.reference_id,
           p.name,
           trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
           COUNT(*) AS qty
    FROM mv
    JOIN public.inventory_unit u ON u.id = mv.unit_id
    JOIN public.product_variant pv ON pv.id = u.variant_id
    JOIN public.product p ON p.id = pv.product_id
    GROUP BY mv.reference_id, p.name, pv.color, pv.size
  )
  SELECT COALESCE(json_agg(r ORDER BY r."sentAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."fromStoreId", b."sentAt", b.note,
      COALESCE(json_agg(json_build_object('name', i.name, 'detail', i.detail, 'qty', i.qty)
                        ORDER BY i.name), '[]'::json) AS items
    FROM batch b
    JOIN items i ON i.reference_id = b.id
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
  WITH ctx AS (
    SELECT public.get_my_store_id() AS store_id
  ), mv AS (
    -- One scan of the ledger for everything checked in at this store.
    SELECT m.reference_id, m.from_store_id, m.unit_id, m.created_at
    FROM ctx
    JOIN public.stock_movement m
      ON m.to_store_id = ctx.store_id
     AND m.movement_type = 'transferred_in'
  ), batch AS (
    SELECT mv.reference_id        AS id,
           mv.from_store_id       AS "fromStoreId",
           MAX(mv.created_at)     AS "receivedAt"
    FROM mv
    GROUP BY mv.reference_id, mv.from_store_id
  ), items AS (
    SELECT mv.reference_id,
           p.name,
           trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size)) AS detail,
           COUNT(*) AS qty
    FROM mv
    JOIN public.inventory_unit u ON u.id = mv.unit_id
    JOIN public.product_variant pv ON pv.id = u.variant_id
    JOIN public.product p ON p.id = pv.product_id
    GROUP BY mv.reference_id, p.name, pv.color, pv.size
  )
  SELECT COALESCE(json_agg(r ORDER BY r."receivedAt" DESC), '[]'::json)
  FROM (
    SELECT b.id, b."fromStoreId", b."receivedAt",
      COALESCE(json_agg(json_build_object('name', i.name, 'detail', i.detail, 'qty', i.qty)
                        ORDER BY i.name), '[]'::json) AS items
    FROM batch b
    JOIN items i ON i.reference_id = b.id
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
  WITH ord AS (
    -- The visible orders (last 2 days at this store). Referenced by every
    -- aggregate below, so it is evaluated once instead of four times.
    SELECT o.id, o.order_date, o.created_at, o.customer_name, o.order_type,
           o.client_ref, o.dispatched_by
    FROM public.sales_order o
    WHERE o.store_id = public.get_my_store_id()
      AND o.order_date >= CURRENT_DATE - 1
  ), line_tot AS (
    SELECT li.order_id, SUM(li.agreed_price * li.quantity) AS total
    FROM public.order_line_item li
    JOIN ord ON ord.id = li.order_id
    GROUP BY li.order_id
  ), pay_tot AS (
    -- Payments for those orders: sum + the method of the most recent one.
    SELECT p.order_id,
           SUM(p.amount) AS paid,
           (array_agg(p.method ORDER BY p.paid_at DESC))[1] AS method
    FROM public.payment p
    JOIN ord ON ord.id = p.order_id
    WHERE p.kind = 'payment'
    GROUP BY p.order_id
  ), line_items AS (
    SELECT li.order_id,
           json_agg(json_build_object(
             'name', COALESCE(pr.name, 'Made-to-Order'),
             'detail', trim(both ' / ' FROM concat_ws(' / ', pv.color, pv.size, li.spec_note)),
             'qty', li.quantity,
             'price', (li.agreed_price / 100.0)
           )) AS items
    FROM public.order_line_item li
    JOIN ord ON ord.id = li.order_id
    LEFT JOIN public.product_variant pv ON pv.id = li.product_variant_id
    LEFT JOIN public.product pr ON pr.id = pv.product_id
    GROUP BY li.order_id
  )
  SELECT COALESCE(json_agg(r ORDER BY r."createdAt" DESC), '[]'::json)
  FROM (
    SELECT o.id,
           o.order_date::text AS "dateKey",
           o.created_at::text AS "createdAt",
           o.customer_name AS customer,
           COALESCE(lt.total, 0) / 100.0 AS total,
           COALESCE(pt.paid, 0) / 100.0 AS paid,
           COALESCE(pt.method::text, 'cash') AS method,
           s.name AS "careOf",
           o.order_type::text AS type,
           COALESCE(o.client_ref, o.id::text) AS "orderNumber",
           COALESCE(li.items, '[]'::json) AS items
    FROM ord o
    LEFT JOIN line_tot lt ON lt.order_id = o.id
    LEFT JOIN pay_tot pt ON pt.order_id = o.id
    LEFT JOIN line_items li ON li.order_id = o.id
    LEFT JOIN public.staff s ON s.id = o.dispatched_by
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

-- Shared reference/catalog data: readable by signed-in users who still have an
-- ACTIVE staff row. A valid JWT is not enough on its own — see is_active_staff().
DROP POLICY IF EXISTS "auth_read" ON public.store;
CREATE POLICY "auth_read" ON public.store
  FOR SELECT TO authenticated USING ((SELECT public.is_active_staff()));

DROP POLICY IF EXISTS "auth_read" ON public.category;
CREATE POLICY "auth_read" ON public.category
  FOR SELECT TO authenticated USING ((SELECT public.is_active_staff()));

DROP POLICY IF EXISTS "auth_read" ON public.product;
CREATE POLICY "auth_read" ON public.product
  FOR SELECT TO authenticated USING ((SELECT public.is_active_staff()));

DROP POLICY IF EXISTS "auth_read" ON public.product_variant;
CREATE POLICY "auth_read" ON public.product_variant
  FOR SELECT TO authenticated USING ((SELECT public.is_active_staff()));

-- staff: users may only read their own row.
DROP POLICY IF EXISTS "own_row" ON public.staff;
CREATE POLICY "own_row" ON public.staff FOR SELECT TO authenticated USING (auth_uid = auth.uid());

-- ---------------------------------------------------------------------------
-- NOTE: every store-scoped policy below wraps the lookup in a scalar subquery:
--
--     (SELECT public.get_my_store_id())
--
-- Written that way the planner evaluates it ONCE per query as an InitPlan.
-- Written as a bare function call it is evaluated FOR EVERY ROW scanned — the
-- function is SECURITY DEFINER, so it cannot be inlined, meaning one `staff`
-- lookup per row (this is the classic Supabase "auth_rls_initplan" finding).
-- ---------------------------------------------------------------------------

-- inventory_unit: only rows currently at my store.
DROP POLICY IF EXISTS "my_store" ON public.inventory_unit;
CREATE POLICY "my_store" ON public.inventory_unit
  FOR SELECT TO authenticated
  USING (current_store_id = (SELECT public.get_my_store_id()));

-- sales_order: only my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.sales_order;
CREATE POLICY "my_store" ON public.sales_order
  FOR SELECT TO authenticated
  USING (store_id = (SELECT public.get_my_store_id()));

-- order_line_item: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.order_line_item;
CREATE POLICY "my_store" ON public.order_line_item
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = order_line_item.order_id
              AND o.store_id = (SELECT public.get_my_store_id()))
  );

-- payment: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.payment;
CREATE POLICY "my_store" ON public.payment
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = payment.order_id
              AND o.store_id = (SELECT public.get_my_store_id()))
  );

-- sales_exception: joinable through my store's orders.
DROP POLICY IF EXISTS "my_store" ON public.sales_exception;
CREATE POLICY "my_store" ON public.sales_exception
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.sales_order o
            WHERE o.id = sales_exception.order_id
              AND o.store_id = (SELECT public.get_my_store_id()))
  );

-- stock_movement: only movements touching my store.
DROP POLICY IF EXISTS "my_store" ON public.stock_movement;
CREATE POLICY "my_store" ON public.stock_movement
  FOR SELECT TO authenticated USING (
    from_store_id = (SELECT public.get_my_store_id())
    OR to_store_id = (SELECT public.get_my_store_id())
  );
