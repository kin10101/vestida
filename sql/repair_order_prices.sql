-- ============================================================
-- Repair order_line_item.agreed_price stored in PESOS instead of CENTAVOS
-- ============================================================
-- Cause: log_sale previously stored the line-item agreed_price WITHOUT the
-- *100 conversion, so staff-logged sales saved pesos as if they were cents.
-- That makes every reader (admin gross sales, dashboard, history) divide by
-- 100 and show 1/100th of the real amount (e.g. ₱12,200 shows as ₱122).
--
-- The RPC itself is already fixed (see supabase_functions_rls.sql — re-run it).
-- This script repairs the EXISTING rows.
--
-- IMPORTANT: run the diagnostic first. The repair multiplies agreed_price by
-- 100. That is correct ONLY for rows created through the staff log_sale path.
-- If any order was created via admin_upsert_order (which already stored cents),
-- those rows must NOT be multiplied. This system's admin UI does not create
-- orders, so all rows are from log_sale — but confirm with the diagnostic.

-- --- 1. DIAGNOSTIC: each line item's stored price vs. its variant's regular
-- ---    price (cents). If stored_price is ~1/100 of regular_price, it is in
-- ---    pesos and needs the repair. ---
SELECT
  li.id,
  li.agreed_price AS stored_price,
  pv.regular_price AS variant_regular_price_cents,
  p.name AS product_name,
  pv.color,
  pv.size,
  li.quantity
FROM public.order_line_item li
LEFT JOIN public.product_variant pv ON pv.id = li.product_variant_id
LEFT JOIN public.product p ON p.id = pv.product_id
ORDER BY li.created_at;

-- --- 2. REPAIR: multiply agreed_price by 100 (pesos -> centavos).
-- Uncomment to run. Safe if ALL orders came through the staff log_sale path.
-- UPDATE public.order_line_item SET agreed_price = agreed_price * 100;
