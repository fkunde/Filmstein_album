import { ensureFtpIngestAutoSync, getFtpIngestAutoSyncIntervalMs } from '@/lib/ftpIngestScheduler'

export async function GET(req: Request) {
  const auth = req.headers.get('x-openclaw-internal-token') || ''
  const expected = process.env.FTP_INGEST_INTERNAL_TOKEN || ''
  if (!expected || auth !== expected) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const origin = new URL(req.url).origin
  ensureFtpIngestAutoSync(origin)

  return Response.json({ success: true, data: { started: true, intervalMs: getFtpIngestAutoSyncIntervalMs() } })
}
