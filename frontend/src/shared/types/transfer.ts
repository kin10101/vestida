export type MovementType =
  | 'received'
  | 'transferred_out'
  | 'transferred_in'
  | 'sold'
  | 'adjustment'
  | 'returned'

export type MovementReferenceType = 'order' | 'manual' | 'physical_count'

/**
 * Append-only ledger row — never edited, only appended.
 *
 * A transfer is NOT a first-class row: it is a pair of movements —
 * `transferred_out` logged by the sending store, then `transferred_in`
 * logged by the receiving store — with the unit sitting in `in_transit`
 * in between. A cancellation is an `adjustment` reversing the unit to
 * `in_stock` at the sending store.
 */
export interface StockMovement {
  id: string
  unit_id: string
  movement_type: MovementType
  from_store_id: string | null
  to_store_id: string | null
  reference_type: MovementReferenceType
  reference_id: string | null
  performed_by: string | null
  note: string | null
  created_at: string
}

/**
 * Args for the `transfer_stock` RPC.
 *
 * Specific units are auto-assigned server-side: the function picks
 * `in_stock` units of each variant at the sending store, flips them to
 * `in_transit`, and logs one `transferred_out` movement per unit.
 */
export interface TransferStockArgs {
  to_store_id: string
  items: { variant_id: string; quantity: number }[]
  note?: string
  client_ref: string
}

/**
 * Args for the `receive_stock` RPC.
 *
 * Receives a whole inbound batch at once: flips each unit to `in_stock`
 * at this store and logs one `transferred_in` movement per unit.
 */
export interface ReceiveStockArgs {
  from_store_id: string
  unit_ids: string[]
  client_ref: string
}
