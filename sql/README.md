# Vestida SQL — run order & ownership

Everything here is **idempotent** and meant to be run in the **Supabase SQL
Editor**. `DATABASE_SETUP.md` (repo root) is the full setup guide; this file is
the short version plus the traps that have actually bitten this repo.

## Order

| # | File | Needs |
|---|------|-------|
| 1 | `schema.sql` | — |
| 2 | `supabase_functions_rls.sql` | 1 |
| 3 | `admin_functions.sql` | 2 |
| 4 | `product_matrix.sql` | 3 |
| 5 | `account_management.sql` | 4 (`assert_admin`) |
| 6 | `admin_product_delete.sql` | 3 (`admin_delete_product_rows`) |
| 7 | `seed.sql` *(optional)* | 2 |

Then, only if needed: `repair_order_prices.sql` (a one-off data repair — read its
diagnostic first).

## Who owns what (do not duplicate these)

Two files defining the same `CREATE OR REPLACE FUNCTION` means **whichever runs
last wins, silently**. That is exactly how the "SKU prefix doesn't save" bug
happened (re-running `admin_functions.sql` restored the pre-matrix RPCs).

- `admin_get_state()` — **only** `product_matrix.sql`
- `admin_upsert_product()` (10-arg, matrix-aware) — **only** `product_matrix.sql`
- `log_sale` / `transfer_stock` / `cancel_transfer` / `receive_stock` / all
  `get_*` reads / RLS policies — **only** `supabase_functions_rls.sql`
- every other `admin_*` RPC — **only** `admin_functions.sql`

**Why both `cancel_transfer`/`receive_stock` AND
`admin_cancel_transfer`/`admin_receive_transfer`:** the staff pair is scoped to
`get_my_store_id()`, and an admin's `staff.store_id` is NULL by design (admins
are cross-store), so an admin can never call them. The `admin_*` pair is
`assert_admin()`-gated and works on any batch — that is what the Inventory
page's in-transit card uses.

If you add a file that redefines an existing RPC, either fold it into the owning
file or say so loudly in both headers.

## Function inventory

- `schema.sql` — tables, types, indexes, integrity constraints, `updated_at`
  triggers, `rpc_idempotency`, `order_ref_counter`, `sales_order.idempotency_key`.
  Defines just one function: the `set_updated_at()` trigger.
- `supabase_functions_rls.sql` — auth helpers (`get_current_user`,
  `get_my_store_id`, `is_active_staff`), the staff write RPCs, the store-scoped
  read models, and every RLS policy.
- `admin_functions.sql` — `assert_admin()` + the admin write API, including the
  shared product-removal worker `admin_delete_product_rows()` (also used by
  `admin_delete_category(force => true)`) and the in-transit finishers
  `admin_cancel_transfer()` / `admin_receive_transfer()`.
- `product_matrix.sql` — the product×variant matrix, `admin_get_state()`
  (`stockMovements[]` carries `referenceId` = the transfer batch),
  `admin_upsert_product()`.
- `account_management.sql` — `admin_list_accounts()`, `admin_configure_account()`,
  `resolve_login_identifier()`.
- `admin_product_delete.sql` — `admin_delete_products()`.

## Things worth knowing

- **Money is centavos in the DB**, pesos at the API boundary for staff RPCs and
  the admin UI. Read RPCs divide by 100; `log_sale` multiplies by 100.
- **PostgREST binds argument names.** A client must pass the *exact* parameter
  name (`p_*`). A mismatch fails the call — and if the caller swallows the error
  it looks like nothing happened.
- **Timestamps are naive UTC.** Use the `Asia/Manila` day-boundary idiom in
  `get_today_summary` for anything "today"-shaped; never `column::date = CURRENT_DATE`.
- **`is_active` is enforced server-side**: `get_current_user`, `get_my_store_id`,
  `assert_admin` and the staff write RPCs all check it (NULL counts as active,
  matching the column default), so deactivating someone really revokes access.
- **RLS policies** must wrap function calls in a scalar subquery —
  `(SELECT public.get_my_store_id())` — or the planner evaluates them **per row**.
- Adding an RPC parameter changes the signature. `CREATE OR REPLACE` can't do
  that in place: `DROP FUNCTION IF EXISTS <old signature>` first (see how
  `log_sale` gained `p_idempotency_key`).

## Verifying a change

There is no test harness. Minimum bar before applying:

1. `EXPLAIN (ANALYZE, BUFFERS)` on any read you changed.
2. Supabase Dashboard → **Advisors** (it flags `auth_rls_initplan` and unindexed
   foreign keys).
3. Exercise the affected screen end-to-end, then check the data directly.
