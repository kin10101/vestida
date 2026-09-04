-- ============================================================
-- PRODUCT DELETION for VESTIDA  (run AFTER product_matrix.sql)
--
-- "Deleting" a product removes it from the active catalog. Because sold
-- history links order_line_item / sold inventory_unit rows up to the product
-- via product_variant, a product that was ever sold can't be physically
-- deleted without breaking history. So:
--
--   * Force delete removes current shelf stock (in_stock units) and
--     hard-deletes variants that were never sold and never referenced by an
--     order (plus any non-sold units they still hold).
--   * Sold history is preserved: variants with order/sold history are kept,
--     and if any remain the product row is SOFT-DELETED (is_active=false,
--     hidden from the catalog) so those history rows still resolve.
--   * If nothing historical remains, the product row is hard-deleted.
--
-- The RPC returns {deleted:false, reason:'has_stock', count} when any selected
-- product currently has in-stock units and p_force is not set, so the UI can
-- show the in-stock warning with Cancel / Force-delete.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_products(p_ids uuid[], p_force boolean DEFAULT false)
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
  PERFORM public.assert_admin();
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
REVOKE ALL ON FUNCTION public.admin_delete_products(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_products(uuid[], boolean) TO authenticated;
