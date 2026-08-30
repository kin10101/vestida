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

## Proposed route map

| Route | Screen | Primary tables |
|---|---|---|
| `/admin` | Dashboard | `sales_order`, `payment`, `stock_movement`, `inventory_unit` (rollups) |
| `/admin/catalog` | Products & Variants | `product`, `product_variant` |
| `/admin/catalog/:productId` | Product detail (variants) | `product_variant`, `inventory_unit` (counts) |
| `/admin/categories` | Categories | `category` |
| `/admin/inventory` | Inventory Units | `inventory_unit` |
| `/admin/inventory/:unitId` | Unit detail | `inventory_unit`, `stock_movement` |
| `/admin/movements` | Stock Movement Ledger | `stock_movement` |
| `/admin/stores` | Stores | `store` |
| `/admin/staff` | Staff | `staff` |
| `/admin/orders` | Sales Orders | `sales_order`, `order_line_item` |
| `/admin/orders/:id` | Order detail | `order_line_item`, `payment`, `inventory_unit` |
| `/admin/payments` | Payments / Reconciliation | `payment` |
| `/admin/reports` | Reports | cross-table aggregates |

Not yet screened: **Reserve** — same as the staff app, this stays unbuilt until the reservation model is decided (see Open Questions).

## Screen-by-screen

### Dashboard — `/admin`

- Store selector: "All stores" (default) or a single store.
- Date range toggle: Today / This week / This month.
- KPI cards: total sales, order count, average order value, payment-method split (cash / GCash / bank / card).
- Attention list: variants low on stock at a store, units sitting `in_transit` past a threshold, MTO orders stuck in `pending`/`in_progress`.
- Recent activity feed: latest `stock_movement` rows and latest `sales_order` rows, interleaved.

### Catalog — `/admin/catalog`

- Table of products: name, category, `is_typically_mto` flag, active toggle, variant count.
- Add/edit product panel: name, category select, description, `is_typically_mto`, active.
- Drill into a product (`/admin/catalog/:productId`) to see its variants: color, size, SKU, `regular_price`, and live unit counts by store/status pulled from `inventory_unit`.
- Add/edit variant: color, size, SKU, `regular_price` (peso input, stored as centavos). Uniqueness on `(product_id, color, size)` should be enforced in the form, not just the DB.
- Deactivate rather than delete, consistent with `product.is_active`.

### Categories — `/admin/categories`

- Simple list: name, product count, created date.
- Add / rename.
- **Open item:** `category` has no `is_active` flag in the current schema, so there's no soft-delete path yet — a category in use can't be safely removed. Flag this before wiring delete in the UI.

### Inventory Units — `/admin/inventory`

This is the physical-piece register — the layer staff never see directly.

- Filters: store, status (`in_stock`, `reserved`, `sold`, `damaged`, `returned`, `in_transit`), category/product/variant, search by `unit_code`.
- **New Stock / Intake** action: pick a variant + store, enter quantity, cost price, source note, acquired date — creates `inventory_unit` rows and a matching `received` `stock_movement` per unit.
- **Manual adjustment** action: change a unit's status (e.g. mark `damaged` or `returned`) with a required note — writes an `adjustment` movement.
- Row expand or detail page (`/admin/inventory/:unitId`) shows the unit's full movement history — the audit trail for that one physical piece.

### Stock Movement Ledger — `/admin/movements`

- Read-only, cross-store audit view: unit code, movement type, from/to store, reference (linked to the order when `movement_type = sold`), who performed it, note, timestamp.
- Filters: date range, store, movement type, staff.
- Purpose: this is where discrepancies between what staff reported and what actually happened get reconciled — the staff app intentionally hides this, admin is where it surfaces.

### Stores — `/admin/stores`

- List: name, code, active toggle.
- Add/edit store.
- Each row links into a store-filtered Dashboard view.

### Staff — `/admin/staff`

- List: name, primary store, active toggle.
- Add/edit staff.
- **Note:** per the schema, `staff` is an informational lookup only (used for "care of" / `dispatched_by` / `performed_by` / `received_by" tagging) — it is not an auth or role model. If admin needs actual staff logins with permissions, that's a separate concern from this table.

### Sales Orders — `/admin/orders`

- Cross-store table: date, store, customer name, order type, status, computed total, balance due.
- Filters: store, status, order type, date range, search by customer or order ref.
- Optional kanban/board view by `order_status` (`pending → in_progress → ready → released`, plus `cancelled`) — useful for tracking made-to-order pieces through prep.
- **Open item:** the schema notes the paper log used a more granular checklist (`ORD, 2ND VEIL, C.LEG, W.BOX, HANDO`) than the current 5-value enum. Decide whether that needs its own checklist table before building the board view, or whether the 5 statuses are enough.
- Order detail (`/admin/orders/:id`): line items (variant or bespoke `spec_note`, quantity, `agreed_price`, assigned unit if any), payments (amount, method, timestamp, received by), `dispatched_by`, order notes, status editor.

### Payments / Reconciliation — `/admin/payments`

- Per-store, per-date-range totals by `payment_method`.
- Cross-check payment totals against order totals to catch under/overpayment.
- **Open item:** the schema explicitly removed `daily_expense` ("Less" section from the paper log) as out of scope for now. If cash reconciliation needs to account for expenses, that table comes back before this screen can be complete.

### Reports — `/admin/reports`

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
- Mobile: the rail becomes a fixed bottom navigation bar, using icon-plus-label items for the four or five highest-frequency destinations. Secondary destinations such as Staff, Reports, and Categories live under a `More` item that opens a sheet or menu.

The mobile bar must account for safe-area insets and reserve bottom padding in the page content so it never covers table rows, forms, or primary actions. Active-route styling and permissions come from the same navigation configuration at every width; only the presentation changes.

**Tables → cards below tablet width** — this is the main risk area (Catalog, Inventory, Movements, Orders, Payments are all table-heavy). Build each row as a single component that:
- renders as a table row with priority columns on tablet/desktop, expanding in place for the rest (same pattern as the staff app's product/order cards), and
- renders as a stacked card on mobile, using the same underlying data and expand behavior.

One component, two outputs — avoids maintaining a separate mobile view per screen.

**Master-detail split on tablet landscape** — Order detail and Unit detail should use a two-pane layout: list on the left, detail on the right, on tablet landscape and desktop. On tablet portrait and phone, the same layout collapses to single-column push navigation (list → tap → detail → back). This is the highest-value tablet-native affordance and degrades to phone for free.

**Everything else reflows rather than redesigns** — chip-scroll filters, segmented toggles, and KPI card grids (4 columns → 2 → 1) just wrap at each breakpoint. The Orders kanban board scrolls horizontally on narrower widths instead of getting a separate mobile layout.

**Touch targets** — keep the staff app's 44px minimum at every width, including desktop. Tablet use is touch-first as often as mouse/keyboard, so this isn't a mobile-only concession.

**Status coloring** — reuse the staff app's restrained palette (amber for pending/in-progress, muted olive for released/paid, pale red for cancelled/damaged) rather than introducing generic dashboard reds/greens.

Money is always entered/displayed in pesos, stored as centavos, same convention as the schema comments.

## Open questions to resolve before build

1. **Admin auth/roles** — the schema has no admin user or role table. How do admins log in, and is there more than one admin role (owner vs. store manager)?
2. **Order status granularity** — does the real handover checklist need its own table, or is the 5-value `order_status` enum sufficient?
3. **Category lifecycle** — no `is_active` flag on `category`; decide an archive convention before allowing edits/deletes in admin.
4. **Cash reconciliation** — confirm whether `daily_expense` needs to come back for the Payments screen to be useful.
5. **Reserve/hold model** — needs a data model decision before either app builds a Reserve screen.
6. **Store topology** (peers vs. hub-and-spoke) — affects whether Dashboard needs a default "HQ" view or a flat all-stores rollup.
