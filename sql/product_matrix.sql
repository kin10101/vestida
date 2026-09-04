-- ============================================================
-- PRODUCT MATRIX migration for VESTIDA (idempotent — safe to re-run).
--
-- Redefines a product as: a SKU prefix + an independent list of COLORS and
-- SIZES. The sellable product_variant rows are treated as ONE CONCRETE
-- VARIANT PER (color x size) COMBINATION, auto-generated on save.
--
--   SKU  =  [SKU_PREFIX]-[first 3 letters of color]-[SIZE]
--   e.g.  LUNA-IVO-L  (prefix "LUNA", color "Ivory", size "L")
--
-- The Product Details admin screen reads the product-level fields below and
-- edits them (colors/sizes/sku prefix/cost/selling price). Concrete variant
-- rows are reconciled automatically; rows that still carry physical units or
-- order history are never deleted (they are kept for history).
--
-- Run AFTER `schema.sql` + `supabase_functions_rls.sql` + `admin_functions.sql`
-- in the Supabase SQL editor. Fresh installs get the columns from schema.sql;
-- this file upgrades an existing database and swaps in the new RPCs.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Add product-level matrix columns (no-op if already present).
-- ------------------------------------------------------------
ALTER TABLE public.product
  ADD COLUMN IF NOT EXISTS sku_prefix varchar DEFAULT '',
  ADD COLUMN IF NOT EXISTS colors text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sizes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cost_price integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regular_price integer DEFAULT 0;

-- One concrete variant per (product, color, size) combo.
CREATE UNIQUE INDEX IF NOT EXISTS product_variant_matrix_key
  ON public.product_variant (product_id, color, size);

-- ------------------------------------------------------------
-- 2) Backfill colors/sizes from the existing (legacy) variant rows so the
--    matrix screen has a starting point. SKU prefix can't be derived
--    reliably from old SKUs, so it stays '' until the user sets it.
-- ------------------------------------------------------------
UPDATE public.product p
SET colors = COALESCE((
      SELECT array_agg(DISTINCT v.color ORDER BY v.color)
      FROM public.product_variant v
      WHERE v.product_id = p.id AND v.color IS NOT NULL AND trim(v.color) <> ''
    ), ARRAY[]::text[]),
    sizes = COALESCE((
      SELECT array_agg(DISTINCT v.size ORDER BY v.size)
      FROM public.product_variant v
      WHERE v.product_id = p.id AND v.size IS NOT NULL AND trim(v.size) <> ''
    ), ARRAY[]::text[]),
    cost_price = COALESCE((
      SELECT MIN(u.cost_price) FROM public.inventory_unit u
      JOIN public.product_variant v ON v.id = u.variant_id
      WHERE v.product_id = p.id
    ), 0)
WHERE p.colors IS NULL OR p.sizes IS NULL OR p.colors = '{}' OR p.sizes = '{}';

-- ------------------------------------------------------------
-- 3) Replace admin_get_state: expose product-level fields; variants report
--    inherited cost & active state (active is product-level now).
-- ------------------------------------------------------------
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
               is_active AS "isActive", created_at::text AS "createdAt",
               COALESCE(sku_prefix,'') AS "skuPrefix",
               COALESCE(colors, ARRAY[]::text[]) AS "colors",
               COALESCE(sizes, ARRAY[]::text[]) AS "sizes",
               COALESCE(cost_price,0) AS "costPriceCents",
               COALESCE(regular_price,0) AS "regularPriceCents"
        FROM public.product) x), '[]'::json),
      'productVariants', COALESCE((SELECT json_agg(x) FROM (
        SELECT v.id, v.product_id AS "productId", v.color, v.size, COALESCE(v.sku,'') AS sku,
               v.regular_price AS "regularPriceCents",
               COALESCE(p.cost_price,0) AS "costPriceCents",
               COALESCE(p.is_active,true) AS "isActive",
               v.created_at::text AS "createdAt"
        FROM public.product_variant v
        LEFT JOIN public.product p ON p.id = v.product_id) x), '[]'::json),
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

-- ------------------------------------------------------------
-- 4) Replace admin_upsert_product: takes the product-level matrix fields and
--    reconciles the concrete color x size variant rows in one transaction.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_product(
  p_id uuid, p_category_id uuid, p_name text,
  p_description text DEFAULT NULL, p_is_active boolean DEFAULT true,
  p_sku_prefix text DEFAULT NULL, p_colors text[] DEFAULT NULL,
  p_sizes text[] DEFAULT NULL, p_cost_price_cents int DEFAULT 0,
  p_regular_price_cents int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_color text;
  v_size text;
  v_sku text;
  r record;
BEGIN
  PERFORM public.assert_admin();
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'name required';
  END IF;

  -- Upsert the product row (including the product-level matrix definition).
  INSERT INTO public.product
    (id, category_id, name, description, is_active, sku_prefix, colors, sizes, cost_price, regular_price)
  VALUES
    (COALESCE(p_id, gen_random_uuid()), p_category_id, trim(p_name),
     NULLIF(trim(COALESCE(p_description,'')), ''),
     p_is_active,
     upper(NULLIF(trim(COALESCE(p_sku_prefix,'')), '')),
     COALESCE(p_colors, ARRAY[]::text[]),
     COALESCE(p_sizes, ARRAY[]::text[]),
     COALESCE(p_cost_price_cents,0),
     COALESCE(p_regular_price_cents,0))
  ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    sku_prefix = EXCLUDED.sku_prefix,
    colors = EXCLUDED.colors,
    sizes = EXCLUDED.sizes,
    cost_price = EXCLUDED.cost_price,
    regular_price = EXCLUDED.regular_price,
    updated_at = now()
  RETURNING id INTO v_id;

  -- Reconcile the full color x size grid into concrete product_variant rows.
  IF p_colors IS NOT NULL AND p_sizes IS NOT NULL THEN
    FOREACH v_color IN ARRAY p_colors LOOP
      IF trim(v_color) = '' THEN CONTINUE; END IF;
      FOREACH v_size IN ARRAY p_sizes LOOP
        IF trim(v_size) = '' THEN CONTINUE; END IF;
        v_sku := upper(trim(COALESCE(p_sku_prefix,'')))
                 || '-' || upper(left(trim(v_color), 3))
                 || '-' || upper(trim(v_size));
        INSERT INTO public.product_variant (product_id, color, size, sku, regular_price)
        VALUES (v_id, trim(v_color), trim(v_size), v_sku, COALESCE(p_regular_price_cents,0))
        ON CONFLICT (product_id, color, size) DO UPDATE SET
          sku = EXCLUDED.sku,
          regular_price = EXCLUDED.regular_price,
          updated_at = now();
      END LOOP;
    END LOOP;

    -- Remove combos that are no longer part of the matrix — but only when the
    -- variant has no physical units and no order history (kept otherwise).
    FOR r IN
      SELECT pv.id
      FROM public.product_variant pv
      WHERE pv.product_id = v_id
        AND NOT (pv.color = ANY(p_colors) AND pv.size = ANY(p_sizes))
        AND NOT EXISTS (SELECT 1 FROM public.inventory_unit u WHERE u.variant_id = pv.id)
        AND NOT EXISTS (SELECT 1 FROM public.order_line_item oi WHERE oi.product_variant_id = pv.id)
    LOOP
      DELETE FROM public.product_variant WHERE id = r.id;
    END LOOP;
  END IF;

  RETURN json_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_upsert_product(uuid, uuid, text, text, boolean, text, text[], text[], int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_product(uuid, uuid, text, text, boolean, text, text[], text[], int, int) TO authenticated;
