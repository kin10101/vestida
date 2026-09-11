-- ============================================================
-- PRODUCT DELETION for VESTIDA  (run AFTER product_matrix.sql)
--
-- "Deleting" a product removes it from the active catalog. Because sold
-- history links order_line_item / sold inventory_unit rows up to the product
-- via product_variant, a product that was ever sold can't be physically
-- deleted without breaking history. So:
--
-- NOTE: these rules live in public.admin_delete_product_rows()
-- (admin_functions.sql, which runs BEFORE this file) so that
-- admin_delete_category(force => true) reuses exactly the same logic — this
-- function is now just an admin-gated wrapper around that worker.
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
BEGIN
  PERFORM public.assert_admin();
  -- The removal rules live in ONE place: public.admin_delete_product_rows(),
  -- which is also what the force path of admin_delete_category() calls. That
  -- worker is defined in admin_functions.sql, which runs BEFORE this file.
  -- Return contract is unchanged: {deleted:false, reason:'has_stock', count}
  -- when in-stock units exist and p_force is not set, otherwise
  -- {deleted:true, hard_deleted, hidden}.
  RETURN public.admin_delete_product_rows(p_ids, p_force);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_products(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_products(uuid[], boolean) TO authenticated;
