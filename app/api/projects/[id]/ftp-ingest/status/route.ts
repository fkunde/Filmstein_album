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

function isMissingImportErrorMessageColumn(error: unknown) {
  const record = asRecord(error)
  const code = toStringValue(record?.code)
  const message = toStringValue(record?.message)
  return code === '42703'
    || code === 'PGRST204'
    || (message.includes('error_message') && message.includes('does not exist'))
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

function describeBufferJobError(job: unknown) {
  const record = asRecord(job)
  const errorMessage = toStringValue(record?.error_message) || toStringValue(record?.error)
  if (!errorMessage) return null

  const jobId = toJobId(record?.id) || toJobId(record?.job_id) || 'unknown job'
  const fileName = toStringValue(record?.filename) || toStringValue(record?.file_name) || toStringValue(record?.relative_path)
  return `${jobId}${fileName ? ` ${fileName}` : ''}: ${errorMessage}`
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
          errorDetails: [],
        },
      })
    }

    const baseUrl = ftpIngest.buffer_api_base_url.replace(/\/+$/, '')
    const requestUrl = `${baseUrl}/api/ingest/jobs?status=stable&project=${encodeURIComponent(ftpIngest.project_code)}`
    const jobsById = new Map<string, unknown>()
    const errorDetails = new Map<string, string>()
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
        const jobError = describeBufferJobError(job)
        if (jobId && jobError) errorDetails.set(jobId, jobError)
      }
    }

    const failedStatusUrl = `${baseUrl}/api/ingest/jobs?status=failed&project=${encodeURIComponent(ftpIngest.project_code)}`
    try {
      const failedJobsRes = await fetch(failedStatusUrl)
      const failedJobsBody = await failedJobsRes.json().catch(() => null)
      if (failedJobsRes.ok) {
        for (const job of extractBufferJobs(failedJobsBody)) {
          const record = asRecord(job)
          const jobId = toJobId(record?.id) || toJobId(record?.job_id)
          const jobError = describeBufferJobError(job)
          if (jobId && jobError) errorDetails.set(jobId, jobError)
        }
      }
    } catch {}

    const jobs = Array.from(jobsById.values())

    let importRowsResult: {
      data: Array<Record<string, unknown>> | null
      error: { code?: string; message?: string } | null
    } = await supabase
      .from('ftp_ingest_import_jobs')
      .select('buffer_job_id, status, updated_at, error_message')
      .eq('project_id', id)

    if (importRowsResult.error && isMissingImportErrorMessageColumn(importRowsResult.error)) {
      importRowsResult = await supabase
        .from('ftp_ingest_import_jobs')
        .select('buffer_job_id, status, updated_at')
        .eq('project_id', id)
    }

    if (importRowsResult.error) return Response.json({ success: false, error: importRowsResult.error.message }, { status: 500 })

    const importRows = importRowsResult.data ?? []

    const importedJobs = importRows.filter((row) => row.status === 'imported').length
    const failedJobs = importRows.filter((row) => row.status === 'failed' || row.status === 'confirm_failed').length
    const inProgressJobs = importRows.filter((row) => row.status === 'claimed').length
    const lastSyncTime = importRows.map((row) => row.updated_at).filter(Boolean).sort().slice(-1)[0] ?? null
    for (const row of importRows) {
      const jobId = toJobId(row.buffer_job_id)
      const errorMessage = toStringValue(row.error_message)
      if (jobId && errorMessage && (row.status === 'failed' || row.status === 'confirm_failed')) {
        const bufferJob = asRecord(jobsById.get(jobId))
        const fileName = toStringValue(bufferJob?.filename) || toStringValue(bufferJob?.file_name) || toStringValue(bufferJob?.relative_path)
        errorDetails.set(jobId, `${jobId}${fileName ? ` ${fileName}` : ''}: ${errorMessage}`)
      }
    }

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
        errorDetails: Array.from(errorDetails.values()).slice(0, 10),
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
