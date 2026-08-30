# Vestida Staff UI Handoff

## Purpose

The staff UI is a phone-first store operations app for the LGA bridal boutique team. It helps staff log sales, inspect inventory across stores, receive inbound stock, send transfers, and review recent sales without needing to understand inventory unit IDs or backend ledger details.

This document describes the current frontend behavior and visual language as implemented in `frontend/src/staff/`.

## Current Capabilities

### Staff home

Route: `/staff`

- Shows the current store identity: LGA Bridal Boutique.
- Shows today's sales total and a cash / GCash breakdown.
- Provides a prominent `Log a Sale` action.
- Provides shortcuts for:
  - Transfer Stock
  - Receive Stock
  - Check Stock
  - Sales History
- Shows a notification dot on `Receive Stock` when inbound stock exists.
- Provides a direct phone link to Gina.
- Opens an in-app help guide from the help icon.

Current limitation: the sales summary and inbound-stock indicator are placeholder values. They must be sourced from the API.

### Log a Sale

Route: `/staff/sale`

The flow has four states:

1. **Gate**
   - Choose `Ready-made` or `Made-to-Order`.
2. **Entry**
   - Ready-made: search products, filter by category, choose color and size, set quantity, enter an agreed per-unit price, and add the item to the order.
   - Made-to-Order: enter the style / item, specification notes, and agreed price.
   - Review and remove items from the current order.
3. **Checkout**
   - Review items and total.
   - Select Cash, GCash, or Bank Transfer.
   - Enter payment amount or fill the full amount automatically.
   - Show balance due or paid-in-full state.
   - Optionally add customer name, staff member (`Care of`), and a note.
4. **Done**
   - Show generated order reference, order summary, payment details, balance, customer, and staff member.
   - Start another sale or return home.

Interaction details:

- Product detail panels expand in place inside the product grid.
- Only one product panel is expanded at a time.
- The expanded product is focused and scrolled into view after the animation.
- Quantity controls are bounded by available stock.
- The checkout footer remains visible when an order is ready to continue.

Current limitation: the catalog, staff list, stock counts, and order completion are mock-backed. `Complete Sale` does not yet call the backend `log_sale` RPC.

### Check Stock

Route: `/staff/stock`

- Shows a simulated loading state before content appears.
- Searches products by name.
- Filters by category: All, Barong, Suit, Pants, Accessories.
- Filters by store: All stores, LGA, B1, LGF, GF, LCA.
- Displays the selected store context and total available count.
- Expands products to show variant-level color, size, available, reserved, and in-transit counts.
- Supports viewing stock across all stores or one store at a time.

Current limitation: stock data is local placeholder data. Replace it with an API query grouped by product variant and inventory status.

### Receive Stock

Route: `/staff/receive`

- Uses `Incoming` and `Received` tabs.
- Shows the incoming piece count in the tab label.
- Groups incoming batches by sending store.
- Expands a batch to show pieces, quantities, sent timestamp, and notes.
- Supports `Receive all` for an individual batch.
- Supports `Receive all incoming` from the footer.
- Confirms receiving in a modal before changing state.
- Moves received batches into the Received tab.
- Groups received batches by date with Today, Yesterday, or formatted date labels.
- Shows a friendly empty state when nothing is incoming.

Backend model: receiving should move inbound `in_transit` units to `in_stock` at the current store and write a `transferred_in` stock movement.

Current limitation: batches are local placeholder data and receive actions are local state updates. Wire the page to an idempotent `receive_stock` RPC.

### Transfer Stock

Route: `/staff/transfers`

List view:

- Shows outgoing transfers grouped by sent date.
- Displays destination store, piece count, and status: in transit, received, or cancelled.
- Expands a transfer to show its pieces, timestamp, note, and cancellation action.
- Allows cancelling an in-transit transfer after confirmation.

New transfer flow:

1. Select the destination store.
2. Search and filter the current store's available catalog.
3. Select color, size, and quantity for each product.
4. Review the transfer contents and optional note.
5. Send the transfer and show a generated transfer reference.

Important UX rule: staff choose product variants and quantities, not physical unit IDs. The server should auto-assign eligible inventory units.

Backend model: a transfer is represented by paired `transferred_out` and `transferred_in` movements; units remain `in_transit` between those events. Cancellation should create an `adjustment` movement returning units to `in_stock` at the sender.

Current limitation: outgoing transfers and cancellation are local placeholder state. Wire the page to a `transfer_stock` RPC and ledger-backed queries.

### Sales History

Route: `/staff/history`

- Switches between Today and Yesterday.
- Searches by customer, order number, or product name.
- Filters by staff member: All, Gina, Cel, Ian.
- Shows time, customer / Walk-in label, and total for each order.
- Expands an order to show payment method, paid-in-full or balance state, line items, staff member, order number, and order type.
- Uses date-appropriate currency and payment labels.

Current limitation: order history is local placeholder data. Replace it with a store-scoped sales query.

### Reserve Item

A `Reserve.tsx` component exists with the intended capability to hold a piece for a customer, release it, or convert the hold into a sale. It is currently a placeholder and is not included in the active staff route map.

## Navigation And Access

- Staff routes are nested under `StaffLayout`.
- Non-home pages show a back button and dynamic page title / subtitle.
- Home shows the LGA badge, Gina phone pill, and help button.
- Staff access is guarded by `RequireRole` and redirects unauthenticated or incorrectly authorized users to `/login`.
- Authentication is currently in-memory demo authentication. A hard browser navigation to a protected route can clear the session; use client-side navigation while testing the current demo.

Active staff routes are declared in `frontend/src/App.tsx`:

| Route | Component | Status |
| --- | --- | --- |
| `/staff` | Home | Implemented, mock summary data |
| `/staff/sale` | Sale | Implemented flow, mock catalog, API pending |
| `/staff/receive` | Receive | Implemented flow, mock batches, API pending |
| `/staff/stock` | Stock | Implemented filters and detail views, API pending |
| `/staff/transfers` | Transfers | Implemented flow, mock ledger, API pending |
| `/staff/history` | History | Implemented filters and detail views, API pending |
| Not routed | Reserve | Placeholder component |

## Design Direction

The visual language is warm, quiet, and boutique-oriented rather than dashboard-heavy. It is designed to feel approachable to store staff while still supporting dense operational information.

### Color system

Defined in `frontend/src/index.css`:

- Background: warm off-white `#F4F1EC`
- Surface: white `#FFFFFF`
- Border: beige `#CBB9A4`
- Primary taupe: `#807163`
- Dark taupe: `#6D5F52`
- Main ink: `#515151`
- Dark ink: `#2F2B26`
- Taupe tint: `#ECE4D9`
- Shadow: soft neutral shadow with low opacity

Error states use a restrained pale red background and dark red text. Balance states use warm amber; paid-in-full states use muted olive green.

### Typography

- Display headings use DM Serif Display through `--font-serif`.
- Body and controls use DM Sans through `--font-sans`.
- Large page titles are serif-led and editorial.
- Supporting labels are compact, muted, and generally semibold.
- Uppercase micro-labels and store codes provide hierarchy without heavy borders.

### Layout

- Mobile-first, phone / tablet-oriented layout.
- Warm page background with white cards and rounded corners.
- Main content is centered and constrained on larger screens.
- Primary actions use taupe-filled buttons.
- Secondary actions are lighter outlined or surface buttons.
- Chips and segmented controls use pill geometry.
- Operational lists use compact rows that can expand in place.
- Sticky or persistent footers are used for checkout and receiving actions.
- Touch targets are intentionally generous, generally at least 44px.

### Motion

Framer Motion is used for purposeful state changes rather than decoration:

- Page entrance: short fade and upward movement.
- Expandable product, order, stock, and transfer cards: animated height and opacity.
- Segmented controls: a moving taupe selection pill.
- Modals: fade backdrop plus scale / translate entrance.
- Buttons and chips: small press and active-state scale feedback.
- Reduced motion is respected through `MotionConfig reducedMotion="user"` and `useReducedMotion` where needed.

Keep transitions short, normally under 250ms, with ease-out or the existing ease curve `[0.65, 0, 0.35, 1]` for expandable panels.

## Reusable UI Patterns

- `staff-header`: shared page header with home and non-home variants.
- `segmented-toggle`: two-state view or date switcher.
- `chip-scroll`: horizontal category, store, or staff filter row.
- `product-card`: expandable product selection card.
- `order-card`: item summary used by sales and transfers.
- `transfer-card`: expandable movement / receipt batch card.
- `primary-btn` and `secondary-btn`: shared action hierarchy.
- `gate-overlay` and `gate-card`: confirmation and entry modals.
- `empty-note` / `receive-empty`: empty-state messaging.
- `date-group`: date headings for historical transfer and receipt lists.

Important CSS maintenance notes:

- Keep `flex-shrink: 0` on `.chip-scroll`; otherwise horizontal chip rows can collapse when the page becomes vertically scrollable.
- Keep `scrollbar-gutter: stable` on scroll containers such as `.staff-page` and `.sale-body` to prevent content width jumps when overflow appears.
- Preserve the mobile-first behavior and avoid replacing the warm palette with generic dashboard colors.

## Data And Backend Handoff

The current UI is ready for API integration at the page action boundaries. The main pending work is:

- Replace in-memory auth with Supabase Auth or the final auth provider.
- Scope all reads and writes to `currentUser.storeCode` and the authenticated user.
- Replace Home summary placeholders with today's store sales aggregates.
- Replace Sale catalog data with live products, variants, prices, and available units.
- Implement `log_sale` and update inventory atomically.
- Replace Stock data with variant counts split by available, reserved, and in-transit status.
- Implement `receive_stock` with idempotency for offline retries.
- Implement `transfer_stock` with server-side unit assignment and idempotency.
- Query transfer and receive history from the stock movement ledger.
- Replace Sales History mock orders with a store-scoped order query.
- Decide the product and reservation model before routing the Reserve page.
- Add loading, error, retry, and optimistic-update handling around each API boundary.

The database domain assumption already reflected in the UI is that there is no standalone transfer table. Transfers are represented through `stock_movement` rows and inventory-unit state transitions.

## QA Checklist

- Sign in as staff before testing protected routes.
- Test each flow using client-side navigation rather than direct protected URL loads in the current demo auth setup.
- Verify all filter chips remain visible when the page is vertically scrollable.
- Verify expanded cards keep the opener accessible and do not cause abrupt layout width changes.
- Test empty results for every search and filter combination.
- Test incomplete sale, zero stock, partial payment, and paid-in-full payment states.
- Test receiving confirmation cancel and confirm paths.
- Test transfer cancellation only appears for in-transit transfers.
- Test reduced-motion behavior with the operating system preference enabled.
- Test mobile widths and a larger tablet / desktop width.
- After API integration, test duplicate submissions and offline retry behavior using client references.

## Useful Files

- `frontend/src/App.tsx` - route map
- `frontend/src/staff/StaffLayout.tsx` - shared staff shell, header, and help modal
- `frontend/src/staff/pages/Home.tsx` - staff landing page
- `frontend/src/staff/pages/Sale.tsx` - sale entry and checkout flow
- `frontend/src/staff/pages/Receive.tsx` - inbound stock workflow
- `frontend/src/staff/pages/Stock.tsx` - inventory search and store filters
- `frontend/src/staff/pages/Transfers.tsx` - outgoing transfer workflow
- `frontend/src/staff/pages/History.tsx` - sales history filters and detail cards
- `frontend/src/staff/pages/Reserve.tsx` - reservation placeholder
- `frontend/src/index.css` - design tokens and base styles
- `frontend/src/App.css` - staff and shared component styles
- `frontend/src/shared/types/` - domain types used by the frontend
- `frontend/src/shared/api/client.ts` - API client boundary
