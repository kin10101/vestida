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
  if (error) throw error
  return (data ?? []) as T[]
}

/** Call a Postgres function (log_sale, receive_stock, transfer_stock, ...). */
export async function apiRpc<T>(
  fnName: string,
  args: unknown,
): Promise<T> {
  const { data, error } = await supabase.rpc(fnName, args as Record<string, unknown>)
  if (error) throw error
  return data as T
}
