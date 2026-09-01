# Vestida Admin UI — Screen Layout Plan

## Purpose

The staff app is deliberately store-scoped and hides ledger/unit-level detail. The admin app is the cross-store back-office counterpart — where catalog, pricing, physical inventory, and the underlying stock ledger actually get managed, and where owner/managers get visibility across all five stores at once.

This document proposes a screen layout and route map for `/admin/*`, using `STAFF_UI_HANDOFF.md` as the sibling reference and `boutique-schema.dbml` as the source of truth for what data each screen needs to read and write. Nothing here is implemented yet — this is a layout plan for engineering handoff, same spirit as the staff doc.

## How admin differs from staff

| | Staff app | Admin app |
|---|---|---|
| Scope | Single store (`currentUser.storeCode`) | All stores, with per-store drill-down |
| Device | Phone-first | Tablet-first, phone-friendly, scales up to desktop |
| Unit IDs / ledger | Hidden — staff pick variants + quantities only | Fully exposed — this is where the ledger lives |
| Pricing | Enters `agreed_price` only | Manages `regular_price` and `cost_price` |
| Density | One task at a time, expandable cards | Tables, filters, dashboards |

Visual language should stay consistent (warm off-white background, taupe primary, DM Serif Display / DM Sans, pill chips, restrained status colors) so the two apps feel like one product — just tuned for a different job.

## Fixed five-screen information architecture

Keep exactly five primary destinations in the admin navigation. Secondary areas are contextual sub-tabs or drill-downs inside their parent screen, not additional navigation choices.

| Primary route | Screen | Nested areas | Primary tables |
|---|---|---|---|
| `/admin` | Dashboard | — | `sales_order`, `payment`, `stock_movement`, `inventory_unit` (rollups) |
| `/admin/products` | Products | Product detail and variants | `product`, `product_variant` |
| `/admin/inventory` | Inventory | Units, Categories, Movements, unit detail | `inventory_unit`, `category`, `stock_movement` |
| `/admin/sales` | Sales | Orders, Payments, Reports, order detail | `sales_order`, `order_line_item`, `payment` |
| `/admin/stores` | Stores | Locations, Staff, Access | `store`, `staff` |

Reserve is scrapped and has no planned route.

## Screen-by-screen

### Dashboard — `/admin`

- Store selector: "All stores" (default) or a single store.
- Date range toggle: Today / This week / This month.
- KPI cards: total sales, order count, average order value, payment-method split (cash / GCash / bank transfer).
- Attention list: variants low on stock at a store, units sitting `in_transit` past a threshold, MTO orders stuck in `pending`/`in_progress`.
- Recent activity feed: latest `stock_movement` rows and latest `sales_order` rows, interleaved.

### Catalog — `/admin/catalog`

- Table of products: name, category, active toggle, variant count.
- Add/edit product panel: name, category select, description, active.
- Drill into a product (`/admin/catalog/:productId`) to see its variants: color, size, SKU, `regular_price`, and live unit counts by store/status pulled from `inventory_unit`.
- Add/edit variant: color, size, SKU, `regular_price` (peso input, stored as centavos). Uniqueness on `(product_id, color, size)` should be enforced in the form, not just the DB.
- Deactivate rather than delete, consistent with `product.is_active`.

### Inventory — Categories sub-tab

- Simple list: name, product count, created date.
- Add / rename.
- **Open item:** `category` has no `is_active` flag in the current schema, so there's no soft-delete path yet — a category in use can't be safely removed. Flag this before wiring delete in the UI.

### Inventory Units — `/admin/inventory`

This is the physical-piece register — the layer staff never see directly.

- Filters: store, status (`in_stock`, `sold`, `in_transit`), category/product/variant, search by `unit_code`.
- **New Stock / Intake** action: pick a variant + store, enter quantity and cost price — creates `inventory_unit` rows and a matching `received` `stock_movement` per unit.
- **Manual adjustment** action: change a unit's supported status with a required note — writes an `adjustment` movement.
- Row expand or detail page (`/admin/inventory/:unitId`) shows the unit's full movement history — the audit trail for that one physical piece.

### Inventory — Stock Movement Ledger sub-tab

- Read-only, cross-store audit view: unit code, movement type, from/to store, reference (linked to the order when `movement_type = sold`), who performed it, note, timestamp.
- Filters: date range, store, movement type, staff.
- Purpose: this is where discrepancies between what staff reported and what actually happened get reconciled — the staff app intentionally hides this, admin is where it surfaces.

### Stores — Locations sub-tab

- **Locations sub-tab:** list name, code, active state, and link to a store-filtered Dashboard view.
- Add/edit store with touch-friendly form controls.
- **Access sub-area:** manage the shared store login's active/reset-access state without exposing passwords.

### Stores — Staff sub-tab

- **Staff sub-tab:** list name, assigned store, active state, and care-of eligibility.
- Add/edit staff records and assign them to a store for `care of`, `dispatched_by`, `performed_by`, and `received_by` tagging.
- Staff records are distinct from the shared store login account; they do not expose or manage individual passwords.

### Sales — Orders sub-tab

- Cross-store table: date, store, customer name, order type, status, computed total, balance due.
- Filters: store, status, order type, date range, search by customer or order ref.
- Optional kanban/board view by `order_status` (`pending → in_progress → ready → released`, plus `cancelled`) — useful for tracking made-to-order pieces through prep.
- Keep the current five-value order status (`pending → in_progress → ready → released`, plus `cancelled`) for the first UI; do not add a persisted handover checklist yet.
- Order detail (`/admin/orders/:id`): line items (variant or bespoke `spec_note`, quantity, `agreed_price`, assigned unit if any), payments (amount, method, timestamp, received by), `dispatched_by`, order notes, status editor.

### Sales — Payments / Reconciliation sub-tab

- Per-store, per-date-range totals by `payment_method`.
- Cross-check payment totals against order totals to catch under/overpayment.
- Reconcile payments, balances, tender-method totals, and mismatch alerts. `daily_expense` remains explicitly out of scope.

### Sales — Reports sub-tab

- Sales by store, by category, by product, and by staff (informational breakdown only).
- Inventory valuation: `sum(cost_price)` by store/status, compared against `regular_price` potential value.
- Slow-moving stock: units sitting `in_stock` past N days.
- Best/worst sellers by units sold and revenue.

## Design system & responsive strategy

Reuse the same tokens as staff (`#F4F1EC` background, `#807163` taupe primary, DM Serif Display headings, DM Sans body) so the two apps read as one product. Design against tablet width first, then let it scale up to desktop and down to phone — not the other way around.

**Breakpoints**

| | Width | Role |
|---|---|---|
| Mobile | < 640px | Supported, not the primary canvas |
| Tablet | 640–1024px | Primary design target |
| Desktop | > 1024px | Tablet layout with more breathing room, not a separate design |

**Navigation** — use one route configuration with responsive presentations:
- Desktop: a collapsed icon rail (~64px), always visible, with an optional labeled expansion past ~1200px.
- Tablet: the icon rail remains visible and stays collapsed to preserve working space.
- Mobile: the rail becomes a fixed bottom navigation bar with exactly five icon-plus-label items: Dashboard, Products, Inventory, Sales, and Stores. Secondary areas stay as contextual sub-tabs inside their parent screen.

The mobile bar must account for safe-area insets and reserve bottom padding in the page content so it never covers table rows, forms, or primary actions. Active-route styling and permissions come from the same navigation configuration at every width; only the presentation changes.

**Tables → cards below tablet width** — this is the main risk area (Catalog, Inventory, Movements, Orders, Payments are all table-heavy). Build each row as a single component that:
- renders as a table row with priority columns on tablet/desktop, expanding in place for the rest (same pattern as the staff app's product/order cards), and
- renders as a stacked card on mobile, using the same underlying data and expand behavior.

One component, two outputs — avoids maintaining a separate mobile view per screen. Optimize for quick operational control: show the primary action and highest-value fields first, then reveal secondary detail on demand.

**Editing pattern** — use a prominent page-level action. Short forms open in a sheet; complex product, intake, order, and staff forms open full-screen with sticky Save/Cancel controls. Use tablet/desktop bulk mode for frequent multi-record actions; on phones, bulk mode is explicit rather than always visible.

**Master-detail split on tablet landscape** — Product detail, Order detail, and Unit detail should use a two-pane layout: list on the left, detail on the right, on tablet landscape and desktop. On tablet portrait and phone, the same layout collapses to single-column push navigation (list → tap → detail → back). This is the highest-value tablet-native affordance and degrades to phone for free.

**Everything else reflows rather than redesigns** — chip-scroll filters, segmented toggles, and KPI card grids (4 columns → 2 → 1) just wrap at each breakpoint. The Orders kanban board scrolls horizontally on narrower widths instead of getting a separate mobile layout.

**Touch targets** — keep the staff app's 44px minimum at every width, including desktop. Tablet use is touch-first as often as mouse/keyboard, so this isn't a mobile-only concession.

**Status coloring** — reuse the staff app's restrained palette (amber for pending/in-progress, muted olive for released/paid, pale red for cancelled/damaged) rather than introducing generic dashboard reds/greens.

Money is always entered/displayed in pesos, stored as centavos, same convention as the schema comments.

## Resolved product decisions before build

1. **Admin access** — the first admin UI targets one owner-level admin with cross-store visibility and management.
2. **Store access** — staff use a shared login per store; admin manages access state/reset flow without exposing passwords.
3. **Staff records** — individual staff are assigned to stores for care-of selection and operational tagging; they are separate from store login accounts.
4. **Order status** — use the current five-value enum; defer the paper handover checklist model.
5. **Category lifecycle** — create and rename only; defer delete/archive until the schema supports a safe lifecycle.
6. **Cash reconciliation** — payments, balances, tender totals, and mismatch alerts only; `daily_expense` stays out of scope.
7. **Store topology** — stores are peers with a flat `All stores` rollup by default.
8. **Reserve** — scrapped from the admin information architecture.
