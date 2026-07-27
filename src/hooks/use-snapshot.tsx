import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { buildBusinessContext } from '@/domain/context'
import type { BusinessContext } from '@/domain/context'
import { resolvePeriod, type CustomRange, type PeriodKey, type ResolvedPeriod } from '@/domain/period'
import { buildSnapshot, type Snapshot } from '@/domain/snapshot'
import { useBusinessContext } from '@/hooks/use-business-context'

/**
 * One period selection, shared by every page.
 *
 * The Business Snapshot is application state, not page state: navigating from
 * Overview to Products must not silently change what "this month" means. The
 * period lives here; pages read a finished `Snapshot` and render it.
 *
 * Re-scoping is a pure recomputation over already-fetched orders — changing
 * period never triggers a network request.
 */
interface SnapshotContextValue {
  context: BusinessContext | null
  snapshot: Snapshot | null
  period: ResolvedPeriod | null
  periodKey: PeriodKey
  setPeriodKey: (key: PeriodKey) => void
  customRange: CustomRange | null
  setCustomRange: (range: CustomRange | null) => void
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  error: Error | null
  updatedAt: Date | null
  refetch: () => void
}

const SnapshotContext = createContext<SnapshotContextValue | null>(null)

export function SnapshotProvider({ children }: { children: ReactNode }) {
  const { context, isLoading, isFetching, isError, error, updatedAt, refetch } =
    useBusinessContext()
  const [periodKey, setPeriodKey] = useState<PeriodKey>('month')
  const [customRange, setCustomRange] = useState<CustomRange | null>(null)

  const period = useMemo(() => {
    if (!context) return null
    return resolvePeriod(
      periodKey,
      context.coverage.lastOrder,
      context.coverage.firstOrder,
      customRange ?? undefined,
    )
  }, [context, periodKey, customRange])

  const snapshot = useMemo(() => {
    if (!context || !period) return null
    return buildSnapshot({
      allOrders: context.orders,
      costs: context.costs,
      period,
      coverage: context.coverage,
      comparison: context.comparison,
    })
  }, [context, period])

  const value: SnapshotContextValue = {
    context,
    snapshot,
    period,
    periodKey,
    setPeriodKey,
    customRange,
    setCustomRange,
    isLoading,
    isFetching,
    isError,
    error,
    updatedAt,
    refetch,
  }

  return <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>
}

export function useSnapshot(): SnapshotContextValue {
  const value = useContext(SnapshotContext)
  if (!value) throw new Error('useSnapshot must be used inside a SnapshotProvider')
  return value
}

export { buildBusinessContext }
