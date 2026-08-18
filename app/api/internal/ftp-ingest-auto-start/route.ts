import { ensureFtpIngestAutoSync, getFtpIngestAutoSyncIntervalMs } from '@/lib/ftpIngestScheduler'
import { requireAdminApiAuth } from '@/lib/auth/session'

export async function GET(req: Request) {
  const auth = req.headers.get('x-openclaw-internal-token') || ''
  const expected = process.env.FTP_INGEST_INTERNAL_TOKEN || ''
  const hasInternalToken = Boolean(expected && auth === expected)

  if (!hasInternalToken) {
    const adminAuth = await requireAdminApiAuth()
    if (adminAuth instanceof Response) return adminAuth
  }

  const origin = new URL(req.url).origin
  ensureFtpIngestAutoSync(origin)

  return Response.json({ success: true, data: { started: true, intervalMs: getFtpIngestAutoSyncIntervalMs() } })
}
