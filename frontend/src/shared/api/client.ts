// API client backed by Supabase (PostgREST + RPC).
//
//   - simple reads  → apiGet('product_variant', { product_id })
//   - compound writes (log_sale, receive_stock, transfer_stock) → apiRpc
//   - Row Level Security provides store scoping

import { supabase } from '../supabase/client'

/** Read rows from a table. `params` becomes an exact-match WHERE filter. */
export async function apiGet<T>(
  table: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  let query = supabase.from(table).select('*')
  if (params) query = query.match(params)
  const { data, error } = await query
  if (error) {
    reportRpcError(error)
    throw error
  }
  return (data ?? []) as T[]
}

// --- Failed-request notifier -------------------------------------------------
// The staff pages load their data with `Promise.all([...]).catch(() => {})`, so a
// failed call used to render as a blank screen with no explanation ("the sale
// screen has no products"). Rather than patching every page, apiRpc reports
// failures to a single handler that StaffLayout renders as a dismissible banner.
// Admin pages keep their own richer banner, so they don't register one.
type ErrorHandler = (message: string) => void
let errorHandler: ErrorHandler | null = null

export function setRpcErrorHandler(handler: ErrorHandler | null) {
  errorHandler = handler
}

function reportRpcError(error: unknown) {
  // Supabase rejects with a PostgrestError (a plain object), not an Error.
  const candidate = error as { message?: unknown } | null
  const message =
    candidate && typeof candidate.message === 'string' && candidate.message
      ? candidate.message
      : 'Something went wrong talking to the server.'
  errorHandler?.(message)
}

/** Call a Postgres function (log_sale, receive_stock, transfer_stock, ...). */
export async function apiRpc<T>(
  fnName: string,
  args: unknown,
): Promise<T> {
  const { data, error } = await supabase.rpc(fnName, args as Record<string, unknown>)
  if (error) {
    reportRpcError(error)
    throw error
  }
  return data as T
}
