import { supabase } from '@/lib/supabase/server'
import { requireAdminApiAuth } from '@/lib/auth/session'

type RouteContext = { params: Promise<{ id: string }> }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toJobId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractBufferJobs(jobsBody: unknown) {
  const body = asRecord(jobsBody)
  const data = asRecord(body?.data)
  if (Array.isArray(body?.items)) return body.items
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(body?.jobs)) return body.jobs
  if (Array.isArray(data?.jobs)) return data.jobs
  if (Array.isArray(body?.data)) return body.data
  return []
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params

    const { data: projectRow, error } = await supabase
      .from('projects')
      .select('id, ftp_ingest')
      .eq('id', id)
      .maybeSingle()

    if (error) return Response.json({ success: false, error: error.message }, { status: 500 })
    if (!projectRow) return Response.json({ success: false, error: 'Project not found' }, { status: 404 })

    const ftpIngest = (projectRow.ftp_ingest ?? {}) as { enabled?: boolean; buffer_api_base_url?: string; project_code?: string; last_sync_at?: string | null }
    if (!ftpIngest.enabled || !ftpIngest.buffer_api_base_url || !ftpIngest.project_code) {
      return Response.json({
        success: true,
        data: {
          pendingJobs: 0,
          inProgressJobs: 0,
          importedJobs: 0,
          failedJobs: 0,
          lastSyncTime: ftpIngest.last_sync_at ?? null,
          requestUrl: null,
          error: 'FTP ingest not fully configured',
        },
      })
    }

    const baseUrl = ftpIngest.buffer_api_base_url.replace(/\/+$/, '')
    const requestUrl = `${baseUrl}/api/ingest/jobs?status=stable&project=${encodeURIComponent(ftpIngest.project_code)}`
    const jobsById = new Map<string, unknown>()
    let statusError: string | null = null
    for (const status of ['stable', 'claimed']) {
      const statusUrl = `${baseUrl}/api/ingest/jobs?status=${encodeURIComponent(status)}&project=${encodeURIComponent(ftpIngest.project_code)}`
      let jobsRes: Response
      try {
        jobsRes = await fetch(statusUrl)
      } catch (error) {
        statusError = `Failed to reach buffer API: ${error instanceof Error ? error.message : String(error)}`
        continue
      }

      const jobsBody = await jobsRes.json().catch(() => null)
      if (!jobsRes.ok) {
        statusError = toStringValue(asRecord(jobsBody)?.error) || `Status endpoint error: failed to load ${status} jobs (${jobsRes.status})`
        continue
      }

      for (const job of extractBufferJobs(jobsBody)) {
        const record = asRecord(job)
        const jobId = toJobId(record?.id) || toJobId(record?.job_id)
        if (jobId) jobsById.set(jobId, job)
      }
    }
    const jobs = Array.from(jobsById.values())

    const { data: importRows, error: importError } = await supabase
      .from('ftp_ingest_import_jobs')
      .select('status, updated_at')
      .eq('project_id', id)

    if (importError) return Response.json({ success: false, error: importError.message }, { status: 500 })

    const importedJobs = (importRows ?? []).filter((row) => row.status === 'imported').length
    const failedJobs = (importRows ?? []).filter((row) => row.status === 'failed' || row.status === 'confirm_failed').length
    const inProgressJobs = (importRows ?? []).filter((row) => row.status === 'claimed').length
    const lastSyncTime = (importRows ?? []).map((row) => row.updated_at).filter(Boolean).sort().slice(-1)[0] ?? null

    return Response.json({
      success: true,
      data: {
        pendingJobs: jobs.length,
        inProgressJobs,
        importedJobs,
        failedJobs,
        lastSyncTime: ftpIngest.last_sync_at ?? lastSyncTime,
        requestUrl,
        error: statusError,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
