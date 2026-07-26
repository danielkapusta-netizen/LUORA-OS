import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'

import { luoraApi } from '@/domain/api'
import { buildBusinessContext } from '@/domain/context'
import type { BusinessContext } from '@/domain/types'

export const queryKeys = {
  transactions: ['luora', 'transactions'] as const,
  productCosts: ['luora', 'product-costs'] as const,
  summary: ['luora', 'summary'] as const,
  byMonth: ['luora', 'by-month'] as const,
  health: ['luora', 'health'] as const,
}

export interface BusinessContextState {
  context: BusinessContext | null
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  error: Error | null
  /** When the freshest of the underlying queries last resolved. */
  updatedAt: Date | null
  refetch: () => void
}

/**
 * Single entry point for business data.
 *
 * The four source endpoints are fetched in parallel and folded into one derived
 * context. Components consume finished numbers; none of them know an API exists.
 */
export function useBusinessContext(): BusinessContextState {
  const results = useQueries({
    queries: [
      { queryKey: queryKeys.transactions, queryFn: luoraApi.transactions },
      { queryKey: queryKeys.productCosts, queryFn: luoraApi.productCosts },
      { queryKey: queryKeys.summary, queryFn: luoraApi.summary },
      { queryKey: queryKeys.byMonth, queryFn: luoraApi.byMonth },
    ],
  })

  const [transactions, productCosts, summary, byMonth] = results

  // Transactions are the spine: without them there is no business context.
  // Everything else degrades to a locally derived fallback.
  const isLoading = transactions?.isLoading ?? true
  const isError = transactions?.isError ?? false
  const error = (transactions?.error as Error | null) ?? null

  const context = useMemo(() => {
    if (!transactions?.data) return null
    return buildBusinessContext({
      transactions: transactions.data,
      productCosts: productCosts?.data ?? [],
      summary: summary?.data ?? null,
      monthly: byMonth?.data ?? [],
    })
  }, [transactions?.data, productCosts?.data, summary?.data, byMonth?.data])

  const updatedAt = useMemo(() => {
    const stamps = results.map((result) => result.dataUpdatedAt).filter(Boolean)
    return stamps.length ? new Date(Math.max(...stamps)) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((result) => result.dataUpdatedAt).join(',')])

  return {
    context,
    isLoading,
    isFetching: results.some((result) => result.isFetching),
    isError,
    error,
    updatedAt,
    refetch: () => {
      for (const result of results) void result.refetch()
    },
  }
}
