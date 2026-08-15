import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Moon, RefreshCw, Sun, XCircle } from 'lucide-react'

import { PageHeader, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { luoraApi, REMOTE_API_URL } from '@/domain/api'
import { queryKeys, useBusinessContext } from '@/hooks/use-business-context'
import { useTheme } from '@/hooks/use-theme'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'
import { SERVER_CACHE_MS } from '@/lib/query-client'
import { cn } from '@/lib/utils'

/**
 * Settings is deliberately small: the connection made visible, the theme, and
 * the facts about how data flows. Configuration for its own sake is clutter.
 */
export function SettingsPage() {
  const { theme, toggleTheme } = useTheme()
  const { context, updatedAt, isFetching, refetch } = useBusinessContext()

  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: luoraApi.health,
    staleTime: 60 * 1000,
    retry: 1,
  })

  const isConnected = health.isSuccess && health.data.status === 'ok'

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Data source, appearance, and how Luora handles your numbers."
      />

      <section className="space-y-5">
        <SectionHeading title="Data source" />
        <Card>
          <CardContent className="space-y-6 p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {health.isLoading ? (
                  <RefreshCw className="h-5 w-5 animate-spin text-ink-subtle" aria-hidden="true" />
                ) : isConnected ? (
                  <CheckCircle2 className="h-5 w-5 text-positive" aria-hidden="true" />
                ) : (
                  <XCircle className="h-5 w-5 text-negative" aria-hidden="true" />
                )}
                <div>
                  <p className="t-body font-medium text-ink">
                    Google Sheets via Apps Script
                  </p>
                  <p className="t-caption text-ink-muted">
                    {health.isLoading
                      ? 'Checking connection…'
                      : isConnected
                        ? `Connected · server time ${new Date(health.data.time).toLocaleTimeString('en-GB')}`
                        : 'Unreachable — the Apps Script deployment may be redeploying.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={isConnected ? 'positive' : 'negative'} size="md">
                  {isConnected ? 'Live' : 'Offline'}
                </Badge>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void health.refetch()
                    refetch()
                  }}
                  disabled={isFetching}
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
                    aria-hidden="true"
                  />
                  Re-check
                </Button>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 border-t border-hairline pt-6 sm:grid-cols-2">
              <Fact label="Endpoint" value={REMOTE_API_URL} mono />
              <Fact
                label="Server cache"
                value={`${SERVER_CACHE_MS / 60000} minutes — Luora refetches no faster, since sooner requests return identical bytes.`}
              />
              <Fact
                label="Last refreshed"
                value={updatedAt ? updatedAt.toLocaleString('en-GB') : '—'}
              />
              <Fact
                label="Data through"
                value={context ? formatDate(context.coverage.lastOrder) : '—'}
              />
            </dl>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-5">
        <SectionHeading title="Appearance" />
        <Card>
          <CardContent className="flex items-center justify-between p-7">
            <div>
              <p className="t-body font-medium text-ink">Theme</p>
              <p className="t-caption text-ink-muted">
                Follows your system preference until you choose one here.
              </p>
            </div>
            <Button variant="secondary" onClick={toggleTheme}>
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
              Switch to {theme === 'dark' ? 'light' : 'dark'}
            </Button>
          </CardContent>
        </Card>
      </section>

      {context && (
        <section className="space-y-5">
          <SectionHeading
            title="Data quality"
            description="The facts behind every figure Luora shows. These update with each refresh."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <QualityCard
              title="Rows read cleanly"
              value={`${formatNumber(context.coverage.completeLineItems)} / ${formatNumber(context.coverage.totalLineItems)}`}
              detail="Orders whose PLN price and margin parsed. The remainder are excluded from totals and flagged in the Action Centre."
            />
            <QualityCard
              title="Cost coverage"
              value={formatPercent(context.coverage.costCoverage * 100, 0)}
              detail="Share of revenue matched to a landed cost. Unmatched orders report margin without COGS, overstated."
            />
            <QualityCard
              title="Trading days"
              value={formatNumber(context.coverage.tradingDays)}
              detail="Days with at least one dated order. Longer-window analytics unlock automatically as this grows."
            />
          </div>
        </section>
      )}

      <section className="space-y-5">
        <SectionHeading title="Calculation principles" />
        <Card>
          <CardContent className="space-y-3 p-7 t-small text-ink-muted">
            <p>
              All aggregation uses PLN-converted figures; original currencies are preserved and
              shown in the Transactions explorer.
            </p>
            <p>
              Profit means revenue minus marketplace commission and landed product cost — money
              kept, not turnover.
            </p>
            <p>
              Rates move in percentage points, absolute figures in percent. Comparisons only run
              between equal-length windows, and label themselves unreliable otherwise.
            </p>
            <p>
              No business calculation lives in the interface. Every number is produced by the
              domain layer and is traceable to one function.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="t-label text-ink-subtle">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 t-small text-ink',
          mono && 'truncate font-mono t-micro text-ink-muted',
        )}
        title={mono ? value : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

function QualityCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="t-caption font-semibold uppercase tracking-[0.06em] text-ink-subtle">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <p className="tnum text-[24px] font-semibold tracking-[-0.02em] text-ink">{value}</p>
        <p className="mt-2 t-caption text-ink-muted">{detail}</p>
      </CardContent>
    </Card>
  )
}
