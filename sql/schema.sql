-- SQL dump generated using DBML (dbml.dbdiagram.io)
-- Database: PostgreSQL
-- Generated at: 2026-09-01T08:42:42.248Z

-- ============================================================
-- Schema recovery: if `DROP SCHEMA public CASCADE` was run, the
-- schema (and everything in it) is gone and subsequent object
-- creation fails with 3F000. Recreate it and restore the default
-- Supabase privileges before creating anything else.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS public;
ALTER SCHEMA public OWNER TO postgres;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

-- Required for gen_random_uuid(); already enabled by default on Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Each type is guarded so the file can be re-run after a partial apply
-- without "type ... already exists" errors.
DO $$
BEGIN
  CREATE TYPE "unit_status" AS ENUM (
    'in_stock',
    'sold',
    'in_transit'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "movement_type" AS ENUM (
    'received',
    'transferred_out',
    'transferred_in',
    'sold',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "order_type" AS ENUM (
    'ready_made',
    'made_to_order'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "order_status" AS ENUM (
    'pending',
    'in_progress',
    'ready',
    'released',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "payment_method" AS ENUM (
    'cash',
    'gcash',
    'bank_transfer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "payment_kind" AS ENUM (
    'payment',
    'refund',
    'void_reversal'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "store" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "name" varchar NOT NULL,
  "code" varchar UNIQUE NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "staff" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "name" varchar NOT NULL,
  "store_id" uuid,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "category" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "name" varchar UNIQUE NOT NULL,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "product" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "category_id" uuid NOT NULL,
  "name" varchar NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true,
  -- Product-level catalog definition: the SKU prefix and the independent
  -- color/size lists that define the full color x size variant matrix.
  "sku_prefix" varchar DEFAULT '',
  "colors" text[] DEFAULT '{}',
  "sizes" text[] DEFAULT '{}',
  -- Product-level pricing (centavos). Concrete product_variant rows inherit
  -- regular_price = this selling price; cost is per piece on inventory_unit.
  "cost_price" integer DEFAULT 0,
  "regular_price" integer DEFAULT 0,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "product_variant" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "product_id" uuid NOT NULL,
  "color" varchar,
  "size" varchar,
  "sku" varchar UNIQUE,
  "regular_price" integer NOT NULL,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

-- One concrete variant per (product, color, size) combination. Used by the
-- product matrix reconciliation so we can upsert the full color x size grid.
CREATE UNIQUE INDEX IF NOT EXISTS "product_variant_matrix_key"
  ON "product_variant" ("product_id", "color", "size");

CREATE TABLE IF NOT EXISTS "inventory_unit" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "variant_id" uuid NOT NULL,
  "unit_code" varchar UNIQUE,
  "cost_price" integer NOT NULL,
  "current_store_id" uuid NOT NULL,
  "status" unit_status NOT NULL DEFAULT 'in_stock',
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "sales_order" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "client_ref" varchar UNIQUE,
  "store_id" uuid NOT NULL,
  "customer_name" varchar,
  "order_type" order_type NOT NULL DEFAULT 'ready_made',
  "status" order_status NOT NULL DEFAULT 'pending',
  "dispatched_by" uuid,
  "order_date" date NOT NULL DEFAULT (now()),
  "notes" text,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "order_line_item" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "order_id" uuid NOT NULL,
  "product_variant_id" uuid,
  "unit_id" uuid,
  "quantity" integer NOT NULL DEFAULT 1,
  "agreed_price" integer NOT NULL,
  "spec_note" text,
  "created_at" timestamp DEFAULT (now()),
  "updated_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "payment" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "order_id" uuid NOT NULL,
  "amount" integer NOT NULL,
  "method" payment_method NOT NULL DEFAULT 'cash',
  "kind" payment_kind NOT NULL DEFAULT 'payment',
  "sales_exception_id" uuid,
  "paid_at" timestamp DEFAULT (now()),
  "received_by" uuid,
  "notes" varchar
);

CREATE TABLE IF NOT EXISTS "sales_exception" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "order_id" uuid NOT NULL,
  "exception_type" varchar NOT NULL,
  "reason" text NOT NULL,
  "amount" integer NOT NULL,
  "payment_method" payment_method,
  "processed_by" uuid,
  "created_at" timestamp DEFAULT (now())
);

CREATE TABLE IF NOT EXISTS "stock_movement" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "unit_id" uuid NOT NULL,
  "movement_type" movement_type NOT NULL,
  "from_store_id" uuid,
  "to_store_id" uuid,
  "reference_type" varchar,
  "reference_id" uuid,
  "performed_by" uuid,
  "note" text,
  "created_at" timestamp DEFAULT (now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "product_variant_product_color_size_uniq"
  ON "product_variant" ("product_id", "color", "size");

CREATE INDEX IF NOT EXISTS "inventory_unit_store_status_idx"
  ON "inventory_unit" ("current_store_id", "status");

CREATE INDEX IF NOT EXISTS "inventory_unit_variant_idx"
  ON "inventory_unit" ("variant_id");

CREATE INDEX IF NOT EXISTS "order_line_item_order_idx"
  ON "order_line_item" ("order_id");

CREATE INDEX IF NOT EXISTS "payment_order_idx"
  ON "payment" ("order_id");

CREATE INDEX IF NOT EXISTS "sales_exception_order_idx"
  ON "sales_exception" ("order_id");

CREATE INDEX IF NOT EXISTS "stock_movement_unit_idx"
  ON "stock_movement" ("unit_id");

CREATE INDEX IF NOT EXISTS "stock_movement_reference_idx"
  ON "stock_movement" ("reference_id");

CREATE INDEX IF NOT EXISTS "stock_movement_type_created_idx"
  ON "stock_movement" ("movement_type", "created_at");

COMMENT ON COLUMN "store"."code" IS 'e.g. B1, LGF, GF, LCA';

COMMENT ON TABLE "staff" IS 'Operational lookup only â€” used to track who handled sales, payments, and stock movements. Authentication is store-based and separate.';

COMMENT ON COLUMN "staff"."store_id" IS 'primary store this person is based at, optional';

COMMENT ON COLUMN "category"."name" IS 'Barong, Gown, Suit, Pants, Accessories...';

COMMENT ON COLUMN "product"."name" IS 'e.g. "Barong Sports Collar", "Mestiza Top - Cazar"';

COMMENT ON COLUMN "product_variant"."regular_price" IS 'centavos; reference/listed price only, never overwritten by a sale';

COMMENT ON COLUMN "inventory_unit"."unit_code" IS 'human-facing tag, e.g. "31702"';

COMMENT ON COLUMN "inventory_unit"."cost_price" IS 'centavos; acquisition cost of THIS specific piece';

COMMENT ON COLUMN "sales_order"."client_ref" IS 'idempotency key generated on-device when queued offline; prevents double-insert if a sync retry fires after the first attempt actually succeeded';

COMMENT ON COLUMN "sales_order"."store_id" IS 'the sale belongs to the store, not to a staff member';

COMMENT ON COLUMN "sales_order"."customer_name" IS 'plain text, e.g. "Vivo", "Mam C." â€” no dedicated customer table';

COMMENT ON COLUMN "sales_order"."dispatched_by" IS '"care of" â€” who handled it, informational only, not enforced';

COMMENT ON COLUMN "order_line_item"."product_variant_id" IS 'null if fully bespoke, no catalog match yet';

COMMENT ON COLUMN "order_line_item"."unit_id" IS 'null until a physical piece is assigned â€” immediate for ready-made, later for MTO';

COMMENT ON COLUMN "order_line_item"."quantity" IS 'must be 1 whenever unit_id is set â€” one row per physical unit sold. Only >1 for bulk/untracked items with no unit_id. Not enforced by DBML; add a CHECK constraint (unit_id IS NULL OR quantity = 1) in migration SQL';

COMMENT ON COLUMN "order_line_item"."agreed_price" IS 'centavos; ACTUAL bargained price per unit â€” independent of regular_price and cost_price';

COMMENT ON COLUMN "order_line_item"."spec_note" IS 'free-text: fabric, measurements, style detail â€” esp. for MTO';

COMMENT ON COLUMN "payment"."amount" IS 'centavos; positive for payments received, negative for refunds and void reversals';

COMMENT ON COLUMN "payment"."sales_exception_id" IS 'links a refund or void reversal to its audit record';

COMMENT ON COLUMN "payment"."received_by" IS 'informational only, not enforced';

COMMENT ON COLUMN "payment"."notes" IS 'e.g. "downpayment", "balance", or refund/void reason';

COMMENT ON COLUMN "sales_exception"."exception_type" IS 'void | refund';

COMMENT ON COLUMN "sales_exception"."amount" IS 'centavos; amount reversed or refunded';

COMMENT ON COLUMN "sales_exception"."payment_method" IS 'required for refunds; null for voids that reverse original payments';

COMMENT ON COLUMN "sales_exception"."processed_by" IS 'informational only, not enforced';

COMMENT ON COLUMN "stock_movement"."reference_type" IS '"order" | "manual" | "physical_count" | "transfer"';

COMMENT ON COLUMN "stock_movement"."reference_id" IS 'sales_order.id for sales, or one shared operation UUID for a transfer';

COMMENT ON COLUMN "stock_movement"."performed_by" IS 'informational only, not enforced';

DO $$
BEGIN
  ALTER TABLE "staff" ADD CONSTRAINT staff_store_id_fkey
    FOREIGN KEY ("store_id") REFERENCES "store" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "product" ADD CONSTRAINT product_category_id_fkey
    FOREIGN KEY ("category_id") REFERENCES "category" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "product_variant" ADD CONSTRAINT product_variant_product_id_fkey
    FOREIGN KEY ("product_id") REFERENCES "product" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "inventory_unit" ADD CONSTRAINT inventory_unit_variant_id_fkey
    FOREIGN KEY ("variant_id") REFERENCES "product_variant" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "inventory_unit" ADD CONSTRAINT inventory_unit_current_store_id_fkey
    FOREIGN KEY ("current_store_id") REFERENCES "store" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "sales_order" ADD CONSTRAINT sales_order_store_id_fkey
    FOREIGN KEY ("store_id") REFERENCES "store" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "sales_order" ADD CONSTRAINT sales_order_dispatched_by_fkey
    FOREIGN KEY ("dispatched_by") REFERENCES "staff" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "order_line_item" ADD CONSTRAINT order_line_item_order_id_fkey
    FOREIGN KEY ("order_id") REFERENCES "sales_order" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "order_line_item" ADD CONSTRAINT order_line_item_product_variant_id_fkey
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variant" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "order_line_item" ADD CONSTRAINT order_line_item_unit_id_fkey
    FOREIGN KEY ("unit_id") REFERENCES "inventory_unit" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "payment" ADD CONSTRAINT payment_order_id_fkey
    FOREIGN KEY ("order_id") REFERENCES "sales_order" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "payment" ADD CONSTRAINT payment_sales_exception_id_fkey
    FOREIGN KEY ("sales_exception_id") REFERENCES "sales_exception" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "payment" ADD CONSTRAINT payment_received_by_fkey
    FOREIGN KEY ("received_by") REFERENCES "staff" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "sales_exception" ADD CONSTRAINT sales_exception_order_id_fkey
    FOREIGN KEY ("order_id") REFERENCES "sales_order" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "sales_exception" ADD CONSTRAINT sales_exception_processed_by_fkey
    FOREIGN KEY ("processed_by") REFERENCES "staff" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "stock_movement" ADD CONSTRAINT stock_movement_unit_id_fkey
    FOREIGN KEY ("unit_id") REFERENCES "inventory_unit" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "stock_movement" ADD CONSTRAINT stock_movement_from_store_id_fkey
    FOREIGN KEY ("from_store_id") REFERENCES "store" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "stock_movement" ADD CONSTRAINT stock_movement_to_store_id_fkey
    FOREIGN KEY ("to_store_id") REFERENCES "store" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "stock_movement" ADD CONSTRAINT stock_movement_performed_by_fkey
    FOREIGN KEY ("performed_by") REFERENCES "staff" ("id") DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- Enforces: one row per physical unit sold. quantity > 1 is only
-- meaningful for bulk / untracked lines that carry no physical unit, so any
-- line with a unit_id must be quantity 1. Added NOT VALID so a re-run can
-- never fail on pre-existing data (it still applies to every new row; run
-- `ALTER TABLE order_line_item VALIDATE CONSTRAINT order_line_item_unit_quantity_chk`
-- once existing data is known clean).
DO $$
BEGIN
  ALTER TABLE "order_line_item" ADD CONSTRAINT order_line_item_unit_quantity_chk
    CHECK ("unit_id" IS NULL OR "quantity" = 1) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

-- ============================================================
-- PERFORMANCE INDEXES
--
-- Each index below backs a concrete predicate/join inside one of the RPCs in
-- supabase_functions_rls.sql / admin_functions.sql (noted per index). Plain
-- CREATE INDEX (not CONCURRENTLY) so the file stays safe to run inside the
-- Supabase SQL editor's transaction wrapper. Drop any you don't need.
-- ============================================================

-- get_history(): WHERE store_id = … AND order_date >= …
CREATE INDEX IF NOT EXISTS "sales_order_store_date_idx"
  ON "sales_order" ("store_id", "order_date" DESC, "created_at" DESC);

-- get_today_summary(): kind = 'payment' AND paid_at in a day range.
CREATE INDEX IF NOT EXISTS "payment_kind_paid_at_idx"
  ON "payment" ("paid_at") WHERE "kind" = 'payment';

-- admin_void_sale(), admin_delete_products(), product matrix reconciliation.
CREATE INDEX IF NOT EXISTS "order_line_item_variant_idx"
  ON "order_line_item" ("product_variant_id");
CREATE INDEX IF NOT EXISTS "order_line_item_unit_idx"
  ON "order_line_item" ("unit_id");

-- Transfer batches: get_outgoing/incoming/received_transfers(),
-- cancel_transfer(), plus the stock_movement RLS policies.
CREATE INDEX IF NOT EXISTS "stock_movement_from_store_idx"
  ON "stock_movement" ("from_store_id", "movement_type", "reference_id");
CREATE INDEX IF NOT EXISTS "stock_movement_to_store_idx"
  ON "stock_movement" ("to_store_id", "movement_type", "reference_id");

-- receive_stock(): the latest 'transferred_out' movement for a given unit.
CREATE INDEX IF NOT EXISTS "stock_movement_unit_type_idx"
  ON "stock_movement" ("unit_id", "movement_type", "created_at" DESC);

-- Unit picking (log_sale / transfer_stock): oldest in_stock unit of a variant
-- at a store. Partial → small index containing exactly the rows those scan.
CREATE INDEX IF NOT EXISTS "inventory_unit_available_idx"
  ON "inventory_unit" ("variant_id", "current_store_id", "created_at")
  WHERE "status" = 'in_stock';

-- get_stock_summary(): the per-variant × per-store aggregate (index-only scan).
CREATE INDEX IF NOT EXISTS "inventory_unit_variant_store_status_idx"
  ON "inventory_unit" ("variant_id", "current_store_id", "status");

-- get_staff() (WHERE store_id = …) and other FK lookups.
CREATE INDEX IF NOT EXISTS "staff_store_idx" ON "staff" ("store_id");
CREATE INDEX IF NOT EXISTS "product_category_idx" ON "product" ("category_id");

-- ============================================================
-- Idempotency ledger for non-order writes (used by transfer_stock()).
--
-- One row per client_ref holding the RPC's result JSON, so a retried call
-- replays the ORIGINAL result instead of repeating the side effect. RLS is
-- enabled with NO policies, so PostgREST can never read or write it; only the
-- SECURITY DEFINER RPCs (which run as the table owner) touch it.
-- ============================================================
CREATE TABLE IF NOT EXISTS "rpc_idempotency" (
  "client_ref" varchar PRIMARY KEY,
  "rpc" varchar NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT (now())
);

ALTER TABLE "rpc_idempotency" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "rpc_idempotency" FROM anon, authenticated;

-- ============================================================
-- Order numbering + integrity constraints
-- ============================================================

-- Per-store, per-day allocator for the human-readable order reference
-- (LGA-260910-0006). log_sale() takes a number from here inside its
-- transaction, so two tills selling at the same instant can never be handed the
-- same reference (previously the client derived it from a COUNT of the day's
-- orders, which silently collided).
CREATE TABLE IF NOT EXISTS "order_ref_counter" (
  "store_id" uuid NOT NULL,
  "day" date NOT NULL,
  "next_seq" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("store_id", "day")
);

ALTER TABLE "order_ref_counter" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "order_ref_counter" FROM anon, authenticated;

-- The client's idempotency key (an opaque per-attempt id) is deliberately kept
-- SEPARATE from the displayed reference, so a retry is detectable without the
-- visible order number having to be unique per attempt. Nullable + unique =
-- many NULLs allowed, so historical rows are unaffected.
ALTER TABLE "sales_order" ADD COLUMN IF NOT EXISTS "idempotency_key" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "sales_order_idempotency_key_uniq"
  ON "sales_order" ("idempotency_key");

-- One physical piece may appear on ONE order line only. Guarded: if a database
-- already holds duplicates this warns and skips instead of failing the script.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.order_line_item
    WHERE unit_id IS NOT NULL
    GROUP BY unit_id HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'order_line_item.unit_id contains duplicates — uniqueness index NOT created';
  ELSE
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS order_line_item_unit_uniq
               ON public.order_line_item (unit_id) WHERE unit_id IS NOT NULL';
  END IF;
END
$$;

-- ============================================================
-- updated_at maintenance. A trigger keeps the column honest for EVERY write path
-- (these RPCs, manual SQL in the editor, future code) instead of relying on each
-- function remembering to set it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store', 'staff', 'category', 'product',
                           'product_variant', 'inventory_unit',
                           'sales_order', 'order_line_item']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at_trg ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER set_updated_at_trg BEFORE UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
    END IF;
  END LOOP;
END
$$;
