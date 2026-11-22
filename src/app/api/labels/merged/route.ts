import { currentUser } from '@/server/auth';
import { batchShipmentIds, mergedLabelsFor } from '@/server/services/shipping';

/** One printable file for many labels, in the order of the list they were printed from: ?shipments=id,id or ?batch=id */
export async function GET(request: Request) {
  if (!(await currentUser())) return new Response('Unauthorized', { status: 401 });
  const url = new URL(request.url);
  let ids = (url.searchParams.get('shipments') ?? '').split(',').filter(Boolean);
  const batch = url.searchParams.get('batch');
  if (batch) ids = await batchShipmentIds(batch);
  if (ids.length === 0) return new Response('No labels selected', { status: 400 });
  try {
    const merged = await mergedLabelsFor(ids);
    const pdf = merged.format === 'pdf';
    return new Response(new Uint8Array(merged.content), {
      headers: {
        'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream',
        'Content-Disposition': `${pdf ? 'inline' : 'attachment'}; filename="labels-${new Date().toISOString().slice(0, 10)}.${merged.format}"`,
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Could not merge labels', { status: 400 });
  }
}
