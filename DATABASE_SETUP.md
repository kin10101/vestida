# Vestida — Supabase Database Setup Guide

This guide explains **which SQL scripts to run, and in what order**, to set up the
Vestida database in Supabase. All scripts live in the repo root and are meant to
be pasted/run in the **Supabase SQL Editor** (Dashboard → SQL Editor → New query).

> Most scripts are **idempotent** — they use `CREATE OR REPLACE`,
> `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`, etc., so it is safe to
> re-run them (or the whole list) without breaking anything. You can run the
> whole ordered list end-to-end on a fresh database.

---

## Prerequisites

1. Create a Supabase project and note its **Project URL** and keys.
2. Put them in the frontend:
   - `frontend/.env` (local, gitignored) with:
     - `VITE_SUPABASE_URL=https://<project>.supabase.co`
     - `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
   - See `frontend/.env.example` for the shape.
3. Open the **SQL Editor** and confirm you are on the correct project/database.

---

## Run order

Run these top-to-bottom. Each file's header comment also states what it needs.

| # | Script | What it does | Run after | Re-runnable |
|---|--------|--------------|-----------|-------------|
| 1 | `schema.sql` | **Base schema**: recovers the `public` schema + default privileges, then creates all enums, tables (store, category, product + matrix columns, product_variant, inventory_unit, stock_movement, staff, sales_order, order_line_item, payment, sales_exception), constraints, the performance indexes, `rpc_idempotency` + `order_ref_counter`, the `order_line_item.unit_id` uniqueness index and the `updated_at` triggers. | — (first) | ✅ |
| 2 | `supabase_functions_rls.sql` | **Auth wiring + app layer**: adds `staff.auth_uid`/`staff.role`, `get_current_user()`, `get_my_store_id()`, `is_active_staff()`; store-scoped read/write RPCs (`log_sale`, `transfer_stock`, `cancel_transfer`, `receive_stock`, `get_catalog`, `get_stock_summary`, history, etc.); and RLS policies. | 1 | ✅ |
| 3 | `admin_functions.sql` | **Admin API**: `assert_admin()` guard plus the admin RPCs (category/store/staff writes, intake, adjustments, transfers, orders, payments, voids/refunds, deletes) and the shared product-removal worker `admin_delete_product_rows()` used by both product and category deletion. **No longer defines** `admin_get_state` / `admin_upsert_product` — see #4. | 2 | ✅ |
| 4 | `product_matrix.sql` | **Product matrix**: **sole owner** of `admin_get_state` and `admin_upsert_product` (SKU prefix + colours × sizes grid) and of the variant matrix unique key. | 3 | ✅ |
| 5 | `account_management.sql` | **Account management**: `admin_list_accounts()`, `admin_configure_account(...)`, and `resolve_login_identifier(...)` — lets the admin UI reflect Supabase Auth accounts and configure display name / role / store. | 4 | ✅ |
| 6 | `admin_product_delete.sql` | **Product deletion**: `admin_delete_products()` — an admin-gated wrapper over the worker defined in #3. The Products screen's delete needs it. | 3 (needs `admin_delete_product_rows` from #3) | ✅ |
| 7 | `seed.sql` *(optional)* | **Bootstrap**: creates the first store (`LGA`) and links an existing Supabase Auth user to an admin staff row. Adjust the email/name/code first. Only needed for initial dev setup. | 2 | ✅ |

> ⚠️ `admin_product_delete.sql` used to be **missing from this list**. Without it,
> deleting a product fails with *"function public.admin_delete_products does not
> exist"*. If your database was set up before this guide listed it, run it now
> (it only depends on #3).

### Recommended full run for a fresh database

```
1. schema.sql
2. supabase_functions_rls.sql
3. admin_functions.sql
4. product_matrix.sql
5. account_management.sql
6. admin_product_delete.sql
7. seed.sql            (optional — first store + admin link)
```

---

## Optional / conditional scripts (do NOT run by default)

These are **data repairs** or diagnostics, not part of the base setup. Only run
them when you actually hit the described problem.

| Script | When to use |
|--------|-------------|
| `repair_order_prices.sql` | **Only if** historical `order_line_item.agreed_price` values were stored in **pesos** instead of **centavos** (symptom: admin/dashboard shows amounts at 1/100th, e.g. ₱12,200 shows as ₱122). Run its **diagnostic query first** to confirm, then the repair (×100). Re-running `supabase_functions_rls.sql` already prevents this for new sales. |

> Always verify the diagnostic output before running any data-repair UPDATE.

---

## After the SQL is applied

1. **Create login accounts in Supabase Auth**
   Dashboard → Authentication → Users → **Add user** (email + password).
   The app holds only the publishable key and **cannot** create Auth users itself.
2. **Configure each account's profile in the app**
   Admin UI → **Stores → Accounts**. Each new Auth user appears as
   *“No profile”* → click **Configure** to set **display name**, **role**
   (Admin or Staff), and **store** (Staff only; Admins have no store and see all).
   Saving creates/links the person’s `staff` record so they can sign in.
   **Deactivating** an account (`is_active = false`) removes the person from the
   *“Care of”* list, blocks sign-in if they have a linked login, and hides all
   store data from them. The last **active** admin can't be deactivated, deleted
   or demoted — the system always keeps one way in.
3. **Sign in**
   The login screen accepts **email or display name**.
   - Admin → `/admin` (cross-store). Staff → `/staff` (their assigned store).

---

## Re-running & upgrading

- The 7 core scripts are **safe to re-run** in order at any time (idempotent).
- **Upgrading an existing DB**: the recommended practice is to re-run the whole
  list top-to-bottom — schema/function statements are guarded, so already-applied
  changes are no-ops while newer definitions are brought up to date.
- **Apply the SQL before deploying new frontend code.** Some releases add RPC
  parameters (e.g. `log_sale`'s `p_idempotency_key`), and a client that sends a
  parameter the database doesn't know yet gets a hard error from PostgREST.
- If you ever run `DROP SCHEMA public CASCADE`, `schema.sql`’s opening block
  recreates the `public` schema and restores default privileges automatically —
  but it will **not** restore dropped data; re-seed after.
- The old trap where re-running `admin_functions.sql` silently reverted the
  matrix RPCs is gone: `admin_get_state` and `admin_upsert_product` are defined
  **only** in `product_matrix.sql` now. Don't re-add them elsewhere.

---

## Quick reference: what each layer is for

- **schema.sql** — tables, types, indexes, integrity constraints and the
  `updated_at` triggers (no RPCs, no RLS).
- **supabase_functions_rls.sql** — the staff-facing (store-scoped) app layer + RLS.
- **admin_functions.sql** — admin RPCs + the shared product-removal worker.
- **product_matrix.sql** — the product matrix, and the two admin RPCs it owns.
- **admin_product_delete.sql** — `admin_delete_products()`.
- **account_management.sql** — bridging Supabase Auth accounts ↔ app staff/roles.
- **seed.sql** — optional first-run demo/bootstrapping data.
