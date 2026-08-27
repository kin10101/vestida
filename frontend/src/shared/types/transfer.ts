export type MovementType = 'receive' | 'transfer' | 'sale' | 'adjustment'

/** Append-only ledger row — never edited, only appended. */
export interface StockMovement {
  id: string
  unit_id: string
  type: MovementType
  from_store_id: string | null
  to_store_id: string | null
  noted_by: string
  created_at: string
}

/** A staff-initiated transfer between two stores. */
export interface TransferRequest {
  from_store_id: string
  to_store_id: string
  unit_ids: string[]
}
