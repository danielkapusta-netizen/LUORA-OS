/**
 * Transport layer for the Luora Apps Script API.
 *
 * The backend is a single Web App URL where an `action` query parameter selects
 * the endpoint. Two operational details matter:
 *
 *  - Apps Script answers every request with a 302 to `script.googleusercontent.com`.
 *    Browsers follow it transparently; server-side callers must opt in.
 *  - Responses are cached upstream for five minutes, so aggressive client
 *    refetching buys nothing. React Query is tuned to match in `queryClient.ts`.
 *
 * In development all traffic goes through a Vite proxy (`/luora-api`) so the app
 * is immune to Apps Script's CORS behaviour changing underneath us.
 */

import type { MonthlyPoint, SourcePoint, Summary, TopProduct } from './types'

export const REMOTE_API_URL =
  (import.meta.env.VITE_LUORA_API_URL as string | undefined) ??
  'https://script.google.com/macros/s/AKfycbxM8GUKKRaprp8MVAP7V5fL1JnBA6l-X8DdKUJsW_y7XGIjsfeo4GBAESTrwB73nB3Fnw/exec'

const BASE_URL = import.meta.env.DEV ? '/luora-api' : REMOTE_API_URL

const REQUEST_TIMEOUT_MS = 20_000

export class ApiError extends Error {
  readonly action: string
  readonly status: number | null

  constructor(action: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.action = action
    this.status = status
  }
}

/** Raw transaction row, exactly as the sheet serialises it. */
export interface RawTransaction {
  sku?: unknown
  qty?: unknown
  price?: unknown
  currency?: unknown
  shipment?: unknown
  total?: unknown
  customerName?: unknown
  source?: unknown
  date?: unknown
  netPrice?: unknown
  commission?: unknown
  margin?: unknown
  pricePLN?: unknown
}

/** Raw product cost row. Most numeric fields are optional in practice. */
export interface RawProductCost {
  sku?: unknown
  totalCost?: unknown
  costEUR?: unknown
  costUSD?: unknown
  costPLN?: unknown
  shipmentUSD?: unknown
  higherMoq?: unknown
  price?: unknown
  shipment?: unknown
}

export interface HealthResponse {
  status: string
  time: string
}

async function request<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE_URL, window.location.origin)
  url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(action, 'The request timed out before Luora responded.')
    }
    throw new ApiError(action, 'Could not reach the Luora data service.')
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new ApiError(action, `Luora data service returned ${response.status}.`, response.status)
  }

  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    // Apps Script serves an HTML error page when a deployment is stale or the
    // script throws — surface that as a first-class failure, not a parse crash.
    throw new ApiError(action, 'Luora returned an unexpected response instead of data.')
  }
}

/** Ensures an array response even if the backend hands back a single object. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export const luoraApi = {
  health: () => request<HealthResponse>('health'),
  transactions: async () => asArray<RawTransaction>(await request<unknown>('transactions')),
  productCosts: async () => asArray<RawProductCost>(await request<unknown>('productCosts')),
  summary: () => request<Summary>('summary'),
  byMonth: async () => asArray<MonthlyPoint>(await request<unknown>('byMonth')),
  bySource: async () => asArray<SourcePoint>(await request<unknown>('bySource')),
  topProducts: async (metric: 'revenue' | 'margin' = 'revenue', limit = 10) =>
    asArray<TopProduct>(await request<unknown>('topProducts', { metric, limit: String(limit) })),
}
