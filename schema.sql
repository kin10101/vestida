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
