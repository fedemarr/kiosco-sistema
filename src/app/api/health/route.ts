export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(
    { success: true, data: { status: 'ok', service: 'kiosco', time: new Date().toISOString() } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
