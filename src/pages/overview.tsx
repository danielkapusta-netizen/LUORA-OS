import { motion } from 'framer-motion'
import { CheckCircle2, ShieldAlert, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ChannelComparison } from '@/components/channel-comparison'
import { TrendChart, type TrendMetric } from '@/components/charts/trend-chart'
import { DataFreshness } from '@/components/data-freshness'
import { HealthScoreCard } from '@/components/health-score-card'
import { InsightCard } from '@/components/insight-card'
import { MetricCard } from '@/components/metric-card'
import { MorningBriefCard } from '@/components/morning-brief'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { ProductLeaderboard, type LeaderboardMetric } from '@/components/product-leaderboard'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { buildMorningBrief } from '@/domain/brief'
import { useBusinessContext } from '@/hooks/use-business-context'
import { formatNumber, formatPercent, formatPLN } from '@/lib/format'

const TREND_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
  { value: 'orders' as const, label: 'Orders' },
]

const LEADERBOARD_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
]

function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function OverviewPage() {
  const { context, isLoading, isFetching, isError, error, refetch } = useBusinessContext()
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [leaderMetric, setLeaderMetric] = useState<LeaderboardMetric>('revenue')

  const brief = useMemo(() => (context ? buildMorningBrief(context) : null), [context])

  if (isLoading) return <PageSkeleton />

  if (isError || !context || !brief) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Overview"
          title="Luora OS"
          description="Your business, summarised each morning."
        />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const { summary, comparison, health, insights, channels, products, daily, coverage } = context
  const { current, previous, windowDays, isReliable } = comparison

  const marginPointChange = isReliable ? current.marginPct - previous.marginPct : null
  const comparisonCaption = isReliable ? `vs previous ${windowDays} days` : 'no comparable window yet'

  const risks = insights.filter((insight) => insight.kind === 'risk').slice(0, 3)
  const opportunities = insights.filter((insight) => insight.kind === 'opportunity').slice(0, 3)

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Overview"
        title={`${greeting()}, here is where Luora stands`}
        description="Everything below is calculated from settled orders, net of marketplace commission and landed product cost."
        actions={
          <DataFreshness coverage={coverage} isFetching={isFetching} onRefresh={refetch} />
        }
      />

      <MorningBriefCard brief={brief} />

      {/* ── Executive summary ─────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeading
          title="Executive summary"
          description={
            isReliable
              ? `The last ${windowDays} trading days, measured against the ${windowDays} days before them.`
              : 'All trading to date. There is not yet enough history for a period-over-period read.'
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            index={0}
            label="Revenue"
            value={isReliable ? current.revenuePLN : summary.totalRevenuePLN}
            format={formatPLN}
            delta={comparison.revenueChangePct}
            deltaCaption={comparisonCaption}
            hint="Gross sales converted to PLN. Orders in EUR, CZK and HUF are converted at the rate stored with each transaction."
            spark={daily.map((point) => point.revenuePLN)}
            footer={`${formatPLN(summary.totalRevenuePLN)} all time`}
          />
          <MetricCard
            index={1}
            label="Profit"
            value={isReliable ? current.marginPLN : summary.totalMarginPLN}
            format={formatPLN}
            delta={comparison.marginChangePct}
            deltaCaption={comparisonCaption}
            hint="True profit: revenue less marketplace commission and landed product cost. This is money kept, not turnover."
            spark={daily.map((point) => point.marginPLN)}
            sparkTone="positive"
            footer={`${formatPLN(summary.totalMarginPLN)} all time`}
          />
          <MetricCard
            index={2}
            label="Margin rate"
            value={isReliable ? current.marginPct : summary.avgMarginPct}
            format={(value) => formatPercent(value)}
            delta={marginPointChange}
            deltaUnit="pp"
            deltaCaption={comparisonCaption}
            hint="Profit as a share of revenue. Percentage-point movement is shown, since a rate cannot meaningfully change by a percentage of itself."
            spark={daily.map((point) => point.marginPct)}
            sparkTone="neutral"
            footer={`${formatPercent(summary.avgMarginPct)} all time`}
          />
          <MetricCard
            index={3}
            label="Orders"
            value={isReliable ? current.orders : summary.totalOrders}
            format={formatNumber}
            delta={comparison.ordersChangePct}
            deltaCaption={comparisonCaption}
            hint="Settled orders. Multi-item orders count once, and their items are attributed to the leading listing."
            spark={daily.map((point) => point.orders)}
            sparkTone="neutral"
            footer={`${formatNumber(summary.uniqueCustomers)} customers · ${formatNumber(summary.uniqueProducts)} products`}
          />
        </div>
      </section>

      {/* ── Health ────────────────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <HealthScoreCard health={health} />
      </motion.section>

      {/* ── Insights: risks and opportunities side by side ────────────── */}
      <section className="space-y-5">
        <SectionHeading
          title="What needs you today"
          description="Generated from your own numbers. Every item states the evidence that triggered it and what to do about it."
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-negative" aria-hidden="true" />
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
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
                  description="No product, channel or data issue currently meets the threshold to raise here."
                />
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-positive" aria-hidden="true" />
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
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

      {/* ── Trends ────────────────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeading
          title="Business pulse"
          description="Daily trading across the full history Luora holds. Quiet days are shown as zero, never skipped."
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
            {daily.length >= 3 ? (
              <TrendChart data={daily} metric={trendMetric} />
            ) : (
              <EmptyState
                title="Not enough trading history"
                description="A trend needs at least three days of orders. This chart will fill in as data accumulates."
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Comparisons ───────────────────────────────────────────────── */}
      {/* items-start keeps each card at its natural height rather than
          stretching the shorter one into a block of dead space. */}
      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
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

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 pb-5">
            <CardTitle>Top products</CardTitle>
            <Segmented
              options={LEADERBOARD_OPTIONS}
              value={leaderMetric}
              onChange={setLeaderMetric}
              aria-label="Rank products by"
            />
          </CardHeader>
          <CardContent className="pt-0">
            {products.length > 0 ? (
              <ProductLeaderboard products={products} metric={leaderMetric} />
            ) : (
              <EmptyState title="No products yet" />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Confidence footer ─────────────────────────────────────────── */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-col gap-3 border-t border-hairline pt-6 text-[12px] text-ink-subtle sm:flex-row sm:items-center sm:justify-between"
      >
        <p>
          {formatNumber(coverage.completeOrders)} of {formatNumber(coverage.totalOrders)} orders read
          cleanly · {formatPercent(coverage.costCoverage * 100, 0)} of revenue backed by a known
          landed cost
        </p>
        <p>{coverage.tradingDays} trading days on record</p>
      </motion.footer>
    </div>
  )
}
