import { CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { InsightCard } from '@/components/insight-card'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import type { Insight } from '@/domain/types'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatPLN } from '@/lib/format'

type Filter = 'all' | 'risks' | 'opportunities'

const FILTER_OPTIONS = [
  { value: 'all' as const, label: 'Everything' },
  { value: 'risks' as const, label: 'Risks' },
  { value: 'opportunities' as const, label: 'Opportunities' },
]

function matches(insight: Insight, filter: Filter): boolean {
  if (filter === 'all') return true
  return filter === 'risks' ? insight.kind === 'risk' : insight.kind === 'opportunity'
}

/**
 * The Action Centre is a worklist, not a feed: every finding is ranked by
 * severity and money at stake, and the header quantifies the total so the
 * founder knows what a clear list is worth before reading a single card.
 */
export function ActionCentrePage() {
  const { snapshot, isLoading, isError, error, refetch } = useSnapshot()
  const [filter, setFilter] = useState<Filter>('all')

  const totals = useMemo(() => {
    if (!snapshot) return null
    const risks = snapshot.insights.filter((insight) => insight.kind === 'risk')
    const opportunities = snapshot.insights.filter((insight) => insight.kind === 'opportunity')
    return {
      risks: risks.length,
      opportunities: opportunities.length,
      critical: snapshot.insights.filter((insight) => insight.severity === 'critical').length,
      atStake: snapshot.insights.reduce((total, insight) => total + (insight.impactPLN ?? 0), 0),
    }
  }, [snapshot])

  if (isLoading) return <PageSkeleton />

  if (isError || !snapshot || !totals) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Action Centre" title="Action Centre" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const visible = snapshot.insights.filter((insight) => matches(insight, filter))

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Action Centre"
        title="What is worth your attention, priced"
        description={
          <>
            {snapshot.insights.length} findings from your live numbers —{' '}
            <span className="font-medium text-ink">{formatPLN(totals.atStake)}</span> of profit at
            stake across all of them. Each one states its evidence and the next step.
          </>
        }
        actions={
          <Segmented
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
            aria-label="Filter findings"
          />
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {totals.critical > 0 && (
          <Badge variant="negative" size="md">
            {totals.critical} critical
          </Badge>
        )}
        <Badge variant="caution" size="md">
          {totals.risks} risk{totals.risks === 1 ? '' : 's'}
        </Badge>
        <Badge variant="positive" size="md">
          {totals.opportunities} opportunit{totals.opportunities === 1 ? 'y' : 'ies'}
        </Badge>
      </div>

      {visible.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {visible.map((insight, index) => (
            <InsightCard key={insight.id} insight={insight} index={index} />
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5 text-positive" />}
            title="Nothing in this category right now"
            description="Findings appear here the moment your numbers cross a threshold worth acting on."
          />
        </Card>
      )}

      <section className="space-y-4 border-t border-hairline pt-8">
        <SectionHeading
          title="How findings are generated"
          description="Eight rules run against every data refresh. A rule only fires when it can cite a number, and it must propose an action — observations without actions are suppressed."
        />
        <div className="grid grid-cols-1 gap-x-10 gap-y-3 t-small text-ink-muted sm:grid-cols-2">
          <p>Margin leaks — material products earning far below the portfolio rate.</p>
          <p>Profit concentration — too much profit resting on a single listing.</p>
          <p>Unverified costs — revenue whose margin is reported without COGS.</p>
          <p>Channel gaps — the same catalogue converting differently by marketplace.</p>
          <p>Under-scaled winners — proven margin that volume has not caught up with.</p>
          <p>Momentum shifts — revenue swings large enough to act on.</p>
          <p>Unreadable rows — orders excluded from totals because they failed parsing.</p>
          <p>Thin-order share — fulfilment effort going to near-zero-margin orders.</p>
        </div>
      </section>
    </div>
  )
}
