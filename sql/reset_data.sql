-- ============================================================
-- RESET DATA for VESTIDA  (⚠️ destructive — data only, NOT schema)
--
-- Wipes every row from every public table while keeping the schema,
-- enums, indexes, RPCs, RLS policies and triggers intact. Meant for
-- resetting a dev/demo database back to empty before re-seeding.
--
-- Run AFTER the base setup (schema.sql … admin_product_delete.sql).
-- Does NOT touch auth.users — Supabase Auth login accounts survive.
-- The bootstrap store/staff link from seed.sql is removed; re-run
-- seed.sql afterwards if you still need it.
--
-- Everything is in ONE TRUNCATE statement: Postgres can then resolve
-- the foreign-key graph itself and the listed order doesn't matter.
-- RESTART IDENTITY resets sequences (order_ref_counter, etc.).
-- CASCADE also truncates any table referencing these, so dependent
-- tables added later can't block or be silently missed.
--
-- Idempotent: running it on an already-empty database is a no-op.
-- ============================================================

TRUNCATE TABLE
  public.order_line_item,
  public.payment,
  public.sales_exception,
  public.stock_movement,
  public.inventory_unit,
  public.product_variant,
  public.sales_order,
  public.product,
  public.category,
  public.staff,
  public.store,
  public.rpc_idempotency,
  public.order_ref_counter
RESTART IDENTITY CASCADE;

-- Verify (should all be 0):
-- SELECT 'store' AS tbl, count(*) FROM public.store
-- UNION ALL SELECT 'staff', count(*) FROM public.staff
-- UNION ALL SELECT 'category', count(*) FROM public.category
-- UNION ALL SELECT 'product', count(*) FROM public.product
-- UNION ALL SELECT 'product_variant', count(*) FROM public.product_variant
-- UNION ALL SELECT 'inventory_unit', count(*) FROM public.inventory_unit
-- UNION ALL SELECT 'sales_order', count(*) FROM public.sales_order
-- UNION ALL SELECT 'order_line_item', count(*) FROM public.order_line_item
-- UNION ALL SELECT 'payment', count(*) FROM public.payment
-- UNION ALL SELECT 'sales_exception', count(*) FROM public.sales_exception
-- UNION ALL SELECT 'stock_movement', count(*) FROM public.stock_movement
-- UNION ALL SELECT 'rpc_idempotency', count(*) FROM public.rpc_idempotency
-- UNION ALL SELECT 'order_ref_counter', count(*) FROM public.order_ref_counter;
