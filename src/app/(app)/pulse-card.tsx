'use client';

// Business pulse with its money / orders switch handled in place, so the chart redraws (with its own animation)
// instead of the page reloading.
import { useState } from 'react';
import { PulseChart } from '@/components/analytics/lazy-charts';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { useT } from '@/lib/i18n/client';
import { SegmentedToggle } from './segmented-toggle';

type Metric = 'money' | 'orders';

export function PulseCard({
  granularity,
  showProfit,
  data,
}: {
  granularity: string;
  showProfit: boolean;
  data: { date: string; revenue: number; profit: number; orders: number }[];
}) {
  const t = useT();
  const [metric, setMetric] = useState<Metric>('money');
  return (
    <Card>
      <CardHeader
        title={t('Business pulse')}
        description={granularity === 'month' ? t('By month; quiet months show as zero.') : granularity === 'week' ? t('By week; quiet weeks show as zero.') : t('By day; quiet days show as zero.')}
        actions={
          <SegmentedToggle
            label={t('Pulse metric')}
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'money', label: showProfit ? t('Revenue & profit') : t('Revenue') },
              { value: 'orders', label: t('Orders') },
            ]}
          />
        }
      />
      <CardBody className="pb-5">
        <PulseChart metric={metric} granularity={granularity} showProfit={showProfit} data={data} />
      </CardBody>
    </Card>
  );
}
