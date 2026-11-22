import { currentUser } from '@/server/auth';
import { pickupProtocol } from '@/server/services/pickups';

/** The DPD handover protocol (PDF) for a booked courier pickup. */
export async function GET(_request: Request, { params }: { params: Promise<{ pickupId: string }> }) {
  if (!(await currentUser())) return new Response('Unauthorized', { status: 401 });
  const { pickupId } = await params;
  try {
    const pdf = await pickupProtocol(pickupId);
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="protokol-dpd-${pickupId.slice(0, 8)}.pdf"` },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Could not get the protocol', { status: 400 });
  }
}
