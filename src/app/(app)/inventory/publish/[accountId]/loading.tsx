import { Card, CardBody } from '@/components/ui';
import { getT } from '@/lib/i18n/server';

/** Shown at once while the products are read from Shopify and the marketplace, which can take a while. */
export default async function Loading() {
  const t = await getT();
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-slate-600" role="status">
          <span className="mr-2 inline-block size-3 animate-pulse rounded-full bg-brand-600 align-middle" />
          {t('Reading the products from Shopify and the marketplace…')}
        </p>
      </CardBody>
    </Card>
  );
}
