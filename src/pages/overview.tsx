import { motion } from 'framer-motion'
import { CheckCircle2, Clock, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChannelComparison } from '@/components/channel-comparison'
import { TrendChart, type TrendMetric } from '@/components/charts/trend-chart'
import { ExecutiveBriefCard } from '@/components/executive-brief'
import { HealthScoreCard } from '@/components/health-score-card'
import { InsightCard } from '@/components/insight-card'
import { KpiCard } from '@/components/kpi-card'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { PeriodSelector } from '@/components/period-selector'
import { ProductTable, type ProductTableMetric } from '@/components/product-table'
import { QuestionCard } from '@/components/question-card'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import { buildExecutiveBrief } from '@/domain/brief'
import { buildExecutiveQuestions } from '@/domain/questions'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

const TREND_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
  { value: 'orders' as const, label: 'Orders' },
]

const LEADERBOARD_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
]

/**
 * The CEO homepage.
 *
 * Ordered strictly: brief → summary → questions → what needs a decision →
 * analytics. Nothing that requires interpretation appears above something that
 * states its own conclusion.
 */
export function OverviewPage() {
  const {
    snapshot,
    context,
    period,
    periodKey,
    setPeriodKey,
    setCustomRange,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useSnapshot()

  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [leaderMetric, setLeaderMetric] = useState<ProductTableMetric>('revenue')

  const brief = useMemo(() => (snapshot ? buildExecutiveBrief(snapshot) : null), [snapshot])
  const questions = useMemo(
    () => (snapshot ? buildExecutiveQuestions(snapshot) : []),
    [snapshot],
  )

  if (isLoading) return <PageSkeleton />

  if (isError || !snapshot || !brief || !period || !context) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Overview" title="Luora OS" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const { totals, kpis, series, health, insights, products, channels } = snapshot

  const risks = insights.filter((insight) => insight.kind === 'risk').slice(0, 3)
  const opportunities = insights.filter((insight) => insight.kind === 'opportunity').slice(0, 3)
  const atStake = insights.reduce((total, insight) => total + (insight.impactPLN ?? 0), 0)

  const periodSelector = (
    <div className="flex items-center gap-2">
      <PeriodSelector
        value={periodKey}
        label={period.label}
        onChange={(key) => {
          setCustomRange(null)
          setPeriodKey(key)
        }}
        onCustom={(from, to) => {
          setCustomRange({ from, to })
          setPeriodKey('custom')
        }}
      />
      <Button
        variant="secondary"
        size="icon"
        onClick={refetch}
        disabled={isFetching}
        aria-label="Refresh data"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
      </Button>
    </div>
  )

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Overview"
        title="Business snapshot"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {period.key === 'all'
                ? 'Every order on record'
                : `${formatDate(period.from)} – ${formatDate(period.to)}`}
              , compared {period.comparisonLabel}.
            </span>
            {period.isAnchoredToData && (
              <Tooltip content="The feed has not updated today, so periods are measured from the most recent order rather than the wall clock.">
                <span className="inline-flex cursor-help items-center gap-1.5 rounded-full bg-caution-soft px-2 py-0.5 t-micro font-medium text-caution">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Dated to last order
                </span>
              </Tooltip>
            )}
          </span>
        }
        actions={periodSelector}
      />

      {snapshot.isEmpty ? (
        <Card>
          <EmptyState
            title="No orders in this period"
            description="Nothing traded in the selected window. Widen the snapshot to see recent activity."
            action={
              <Button variant="secondary" onClick={() => setPeriodKey('month')}>
                Switch to this month
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* ── 1. Executive brief ────────────────────────────────────── */}
          <ExecutiveBriefCard brief={brief} atStakePLN={atStake} />

          {/* ── 2. Executive summary ──────────────────────────────────── */}
          <section className="space-y-5">
            <SectionHeading
              title="Executive summary"
              description={`${formatNumber(totals.orders)} orders from ${formatNumber(totals.customers)} customers, ${formatNumber(totals.lineItems)} product lines in total.`}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {kpis.map((kpi, index) => (
                <KpiCard
                  key={kpi.key}
                  kpi={kpi}
                  comparisonLabel={period.comparisonLabel}
                  index={index}
                />
              ))}
            </div>
          </section>

          {/* ── 3. Product detail, kept beside the summary it explains ── */}
          <section className="space-y-5">
            <SectionHeading
              title="Top products"
              description={`What the ${formatNumber(totals.revenuePLN > 0 ? products.length : 0)} products traded in this period actually returned. Full catalogue lives on the Products page.`}
              actions={
                <div className="flex items-center gap-2">
                  <Segmented
                    options={LEADERBOARD_OPTIONS}
                    value={leaderMetric}
                    onChange={setLeaderMetric}
                    aria-label="Rank products by"
                  />
                  <Button asChild variant="secondary" size="sm">
                    <Link to="/products">All products</Link>
                  </Button>
                </div>
              }
            />
            <Card className="overflow-hidden">
              {products.length > 0 ? (
                <ProductTable products={products} metric={leaderMetric} />
              ) : (
                <EmptyState title="No products in this period" />
              )}
            </Card>
          </section>

          {/* ── 4. Executive questions ────────────────────────────────── */}
          {questions.length > 0 && (
            <section className="space-y-5">
              <SectionHeading
                title="Executive questions"
                description="The questions worth asking about this period, answered from your own numbers. Cards only appear when the data can genuinely support an answer."
              />
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 xl:grid-cols-3">
                {questions.map((answer, index) => (
                  <QuestionCard key={answer.id} answer={answer} index={index} />
                ))}
              </div>
            </section>
          )}

          {/* ── 5. Health ─────────────────────────────────────────────── */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <HealthScoreCard health={health} />
          </motion.section>

          {/* ── 6. Recommendations ────────────────────────────────────── */}
          <section className="space-y-5">
            <SectionHeading
              title="What needs a decision"
              description="The highest-priority findings for this period. The full worklist lives in the Action Centre."
              actions={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/action-centre">See all {insights.length}</Link>
                </Button>
              }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-negative" aria-hidden="true" />
                  <h3 className="t-small font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    Risks to your profit
                  </h3>
                </div>
                {risks.length > 0 ? (
                  <div className="space-y-4">
                    {risks.map((insight, index) => (
                      <InsightCard key={insight.id} insight={insight} index={index} />
                    ))}
                  </div>
                ) : (
                  <Card>
                    <EmptyState
                      icon={<CheckCircle2 className="h-5 w-5 text-positive" />}
                      title="No profit risks detected"
                      description="Nothing in this period meets the threshold to raise here."
                    />
                  </Card>
                )}
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-positive" aria-hidden="true" />
                  <h3 className="t-small font-semibold uppercase tracking-[0.06em] text-ink-muted">
                    Opportunities
                  </h3>
                </div>
                {opportunities.length > 0 ? (
                  <div className="space-y-4">
                    {opportunities.map((insight, index) => (
                      <InsightCard key={insight.id} insight={insight} index={index} />
                    ))}
                  </div>
                ) : (
                  <Card>
                    <EmptyState
                      title="No scaling opportunities yet"
                      description="Opportunities appear once a product shows margin headroom that volume has not caught up with."
                    />
                  </Card>
                )}
              </div>
            </div>
          </section>

          {/* ── 7. Interactive analytics ──────────────────────────────── */}
          <section className="space-y-5">
            <SectionHeading
              title="Business pulse"
              description={`Trading across the period, by ${period.granularity}. Quiet ${period.granularity}s show as zero, never skipped.`}
              actions={
                <Segmented
                  options={TREND_OPTIONS}
                  value={trendMetric}
                  onChange={setTrendMetric}
                  aria-label="Choose trend metric"
                />
              }
            />
            <Card>
              <CardContent className="p-6 pt-7">
                {series.length >= 3 ? (
                  <TrendChart data={series} metric={trendMetric} />
                ) : (
                  <EmptyState
                    title="Not enough buckets to plot"
                    description="Choose a longer period to see a trend."
                  />
                )}
              </CardContent>
            </Card>
          </section>

          {/* Products have already been covered in detail above, so this row
              carries only the channel split. */}
          <section className="grid grid-cols-1 items-start gap-6">
            <Card>
              <CardHeader className="pb-5">
                <CardTitle>Where you sell</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {channels.length > 0 ? (
                  <ChannelComparison channels={channels} />
                ) : (
                  <EmptyState title="No channel data" />
                )}
              </CardContent>
            </Card>
          </section>

          <motion.footer
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col gap-3 border-t border-hairline pt-6 t-caption text-ink-subtle sm:flex-row sm:items-center sm:justify-between"
          >
            <p>
              {formatNumber(context.coverage.completeLineItems)} of{' '}
              {formatNumber(context.coverage.totalLineItems)} product lines read cleanly ·{' '}
              {formatPercent(context.coverage.costCoverage * 100, 0)} of revenue backed by a known
              landed cost
            </p>
            <p>
              {formatNumber(context.coverage.tradingDays)} trading days on record · latest order{' '}
              {formatDate(context.coverage.lastOrder)}
            </p>
          </motion.footer>
        </>
      )}
    </div>
  )
}
