import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import sharp from 'sharp'
import type { SupabaseServerClient } from '@/lib/supabase/server'

export type FtpIngestConfig = {
  enabled?: boolean
  buffer_api_base_url?: string
  project_code?: string
}

export type FtpIngestSummary = {
  foundJobs: number
  importedSuccess: number
  failedCount: number
  confirmFailedCount: number
  errors: string[]
  requestUrl: string
  rawJobsResponse: unknown
}

type JsonObject = Record<string, unknown>

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toJobId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function getErrorMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
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

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: JsonObject | null = null
  try {
    const parsed: unknown = text ? JSON.parse(text) : null
    json = asRecord(parsed)
  } catch {}
  return { res, json, text }
}

function buildInternalUploadHeaders() {
  const token = process.env.FTP_INGEST_INTERNAL_TOKEN
  return token ? { 'x-openclaw-internal-token': token } : undefined
}

function describeUploadHttpError(status: number, body: JsonObject | null) {
  const errorMessage = getErrorMessage(body?.error, `upload failed (${status})`)
  if (status === 401) {
    return `upload unauthorized: check FTP_INGEST_INTERNAL_TOKEN on the Snapflare server (${errorMessage})`
  }
  if (status === 413) {
    return `upload rejected as too large by the HTTP proxy (${errorMessage}); set FTP_INGEST_UPLOAD_BASE_URL to a local loopback URL so FTP ingest bypasses the public proxy`
  }
  return errorMessage
}

function normalizeUploadUrl(url: URL) {
  if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1'
  }
  return url.toString()
}

function buildUploadUrls(uploadBaseUrl: string) {
  const internalUploadBaseUrl = process.env.FTP_INGEST_UPLOAD_BASE_URL?.trim()
  if (internalUploadBaseUrl) {
    return [normalizeUploadUrl(new URL('/api/upload', internalUploadBaseUrl))]
  }

  const url = new URL('/api/upload', uploadBaseUrl)
  const candidates: string[] = []

  if (url.hostname !== '127.0.0.1' && !process.env.VERCEL) {
    const ports = [process.env.PORT, process.env.NEXT_PORT, '3000', '3001']
      .map((port) => port?.trim())
      .filter((port): port is string => Boolean(port))

    for (const port of Array.from(new Set(ports))) {
      const localUrl = new URL('/api/upload', uploadBaseUrl)
      localUrl.protocol = 'http:'
      localUrl.hostname = '127.0.0.1'
      localUrl.port = port
      candidates.push(localUrl.toString())

      const localhostUrl = new URL('/api/upload', uploadBaseUrl)
      localhostUrl.protocol = 'http:'
      localhostUrl.hostname = 'localhost'
      localhostUrl.port = port
      candidates.push(localhostUrl.toString())
    }
  }

  candidates.push(normalizeUploadUrl(url))

  return Array.from(new Set(candidates))
}

function describeFetchError(error: unknown) {
  if (!(error instanceof Error)) return String(error)

  const cause = error.cause
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`
  }

  return error.message
}

function buildUploadForm(params: { projectId: string; fileBuffer: Buffer; fileName: string; contentType: string }) {
  const form = new FormData()
  const fileBytes = new Uint8Array(params.fileBuffer.byteLength)
  fileBytes.set(params.fileBuffer)
  form.append('projectId', params.projectId)
  form.append('file', new File([fileBytes], params.fileName, { type: params.contentType }))
  return form
}

async function postUploadForm(uploadBaseUrl: string, upload: { projectId: string; fileBuffer: Buffer; fileName: string; contentType: string }) {
  const uploadUrls = buildUploadUrls(uploadBaseUrl)
  const headers = buildInternalUploadHeaders()
  let lastError: unknown = null
  const attempts: string[] = []

  for (const uploadUrl of uploadUrls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers,
          body: buildUploadForm(upload),
        })

        if (res.ok || ![404, 405, 502, 503, 504].includes(res.status)) {
          return res
        }

        const text = await res.clone().text().catch(() => '')
        attempts.push(`${uploadUrl} -> HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ''}`)
        lastError = new Error(`HTTP ${res.status}`)
      } catch (error) {
        lastError = error
        attempts.push(`${uploadUrl} -> ${describeFetchError(error)}`)
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    }
  }

  throw new Error(`upload fetch failed after ${attempts.length} attempts: ${attempts.join(' | ') || describeFetchError(lastError)}`)
}

async function validateDownloadedImage(params: { tempPath: string; fileName: string; buffer: Buffer }) {
  const stat = await fs.stat(params.tempPath)
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error('invalid image file: downloaded file missing or empty')
  }

  const ext = path.extname(params.fileName).toLowerCase()
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff'])
  if (ext && !allowedExt.has(ext)) {
    throw new Error(`invalid image file: unsupported extension ${ext}`)
  }

  let metadata: sharp.Metadata
  try {
    metadata = await sharp(params.buffer, { failOn: 'error' }).metadata()
  } catch {
    throw new Error('metadata read failed')
  }

  if (!metadata.format || !['jpeg', 'png', 'webp', 'gif', 'tiff'].includes(metadata.format)) {
    throw new Error('invalid image file: unsupported or unreadable image format')
  }

  if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
    throw new Error('invalid image file: missing image dimensions')
  }

  try {
    await sharp(params.buffer, { failOn: 'error' }).resize({ width: 64 }).toBuffer()
  } catch {
    throw new Error('thumb generation failed')
  }

  try {
    await sharp(params.buffer, { failOn: 'error' }).resize({ width: 1600, withoutEnlargement: true }).toBuffer()
  } catch {
    throw new Error('display generation failed')
  }
}

async function cleanupPartialUpload(params: {
  uploadBaseUrl: string
  projectId: string
  supabaseAdmin: SupabaseServerClient
  recentBeforeIso: string
  fileName: string
}) {
  const cleanupCandidates = await params.supabaseAdmin
    .from('photo_files')
    .select('id, photo_id, file_name, original_file_name, created_at')
    .gte('created_at', params.recentBeforeIso)
    .or(`file_name.eq.${params.fileName},original_file_name.eq.${params.fileName}`)

  const rows = Array.isArray(cleanupCandidates.data) ? cleanupCandidates.data : []
  const photoIds = Array.from(new Set(rows
    .map((row) => toStringValue(asRecord(row)?.photo_id))
    .filter(Boolean)))

  for (const photoId of photoIds) {
    try {
      await fetch(`${params.uploadBaseUrl}/api/photos/${photoId}?mode=all-versions`, { method: 'DELETE' })
    } catch {
      // best-effort cleanup only
    }
  }
}

export async function runProjectFtpIngest(params: {
  projectId: string
  ftpIngest: FtpIngestConfig
  uploadBaseUrl: string
  supabaseAdmin: SupabaseServerClient
}) : Promise<FtpIngestSummary> {
  const config = params.ftpIngest
  if (!config.enabled) throw new Error('FTP ingest is not enabled')
  if (!config.buffer_api_base_url?.trim()) throw new Error('Missing buffer API base URL')
  if (!config.project_code?.trim()) throw new Error('Missing project code')

  const baseUrl = config.buffer_api_base_url.replace(/\/+$/, '')
  const projectCode = config.project_code.trim()
  const requestUrl = `${baseUrl}/api/ingest/jobs?status=stable&project=${encodeURIComponent(projectCode)}`
  const requestedStatuses = ['stable', 'claimed']
  const jobsById = new Map<string, unknown>()
  const rawJobsResponse: Record<string, unknown> = {}

  for (const status of requestedStatuses) {
    const statusUrl = `${baseUrl}/api/ingest/jobs?status=${encodeURIComponent(status)}&project=${encodeURIComponent(projectCode)}`
    const jobsRes = await fetch(statusUrl)
    const jobsBody = await jobsRes.json().catch(() => null)
    rawJobsResponse[status] = jobsBody
    if (!jobsRes.ok) throw new Error(getErrorMessage(asRecord(jobsBody)?.error, `Failed to list buffer jobs (${jobsRes.status})`))

    for (const job of extractBufferJobs(jobsBody)) {
      const record = asRecord(job)
      const jobId = toJobId(record?.id) || toJobId(record?.job_id)
      if (jobId) jobsById.set(jobId, job)
    }
  }

  const jobs = Array.from(jobsById.values())
  const summary: FtpIngestSummary = {
    foundJobs: jobs.length,
    importedSuccess: 0,
    failedCount: 0,
    confirmFailedCount: 0,
    errors: [],
    requestUrl,
    rawJobsResponse,
  }

  for (const job of jobs) {
    const jobRecord = asRecord(job)
    const jobId = toJobId(jobRecord?.id) || toJobId(jobRecord?.job_id)
    if (!jobId) {
      summary.failedCount++
      summary.errors.push('Encountered buffer job without id')
      continue
    }

    try {
      const existingImport = await params.supabaseAdmin
        .from('ftp_ingest_import_jobs')
        .select('id, status, updated_at, error_message')
        .eq('project_id', params.projectId)
        .eq('buffer_job_id', jobId)
        .maybeSingle()

      if (existingImport.data?.id && (existingImport.data?.status === 'imported' || existingImport.data?.status === 'confirm_failed')) {
        const confirm = await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/confirm`, {})
        if (!confirm.res.ok) {
          const errorMessage = getErrorMessage(confirm.json?.error, `confirm failed (${confirm.res.status})`)
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'confirm_failed', error_message: errorMessage, updated_at: new Date().toISOString() }).eq('id', existingImport.data.id)
          summary.confirmFailedCount++
          summary.errors.push(`${jobId}: already imported but confirm failed: ${errorMessage}`)
        } else {
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'imported', error_message: null, updated_at: new Date().toISOString() }).eq('id', existingImport.data.id)
          summary.importedSuccess++
        }
        continue
      }

      if (existingImport.data?.id && existingImport.data?.status === 'failed') {
        const failedAt = existingImport.data.updated_at ? new Date(existingImport.data.updated_at).getTime() : 0
        if (failedAt && Date.now() - failedAt < 60_000) {
          const lastError = toStringValue(existingImport.data.error_message)
          summary.errors.push(`${jobId}: failed recently, waiting before retry${lastError ? `; last error: ${lastError}` : ''}`)
          continue
        }
      }

      if (existingImport.data?.id) {
        await params.supabaseAdmin
          .from('ftp_ingest_import_jobs')
          .update({ status: 'claimed', error_message: null, updated_at: new Date().toISOString() })
          .eq('id', existingImport.data.id)
      } else {
        await params.supabaseAdmin
          .from('ftp_ingest_import_jobs')
          .insert([{ project_id: params.projectId, buffer_job_id: jobId, status: 'claimed' }])
      }

      const claim = await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/claim`, {})
      if (!claim.res.ok) throw new Error(getErrorMessage(claim.json?.error, `claim failed (${claim.res.status})`))

      const fileRes = await fetch(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/file`)
      if (!fileRes.ok) {
        const errorMessage = `download failed (${fileRes.status})`
        await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: errorMessage })
        await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', error_message: errorMessage, updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
        summary.failedCount++
        summary.errors.push(`${jobId}: ${errorMessage}`)
        continue
      }

      const arrayBuffer = await fileRes.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)
      const fileName = toStringValue(jobRecord?.file_name) || toStringValue(jobRecord?.filename)
      if (!fileName.trim()) {
        throw new Error('invalid image file: missing file name')
      }

      const tempPath = path.join(os.tmpdir(), `filmstein-ftp-${jobId}-${fileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`)
      await fs.writeFile(tempPath, fileBuffer)

      try {
        await validateDownloadedImage({ tempPath, fileName, buffer: fileBuffer })

        const beforeUploadIso = new Date().toISOString()
        const uploadRes = await postUploadForm(params.uploadBaseUrl, {
          projectId: params.projectId,
          fileBuffer,
          fileName,
          contentType: toStringValue(jobRecord?.content_type) || 'application/octet-stream',
        })
        const uploadBody = await uploadRes.json().catch(() => null)

        if (!uploadRes.ok || uploadBody?.success !== true) {
          const errorMessage = describeUploadHttpError(uploadRes.status, asRecord(uploadBody))
          await cleanupPartialUpload({
            uploadBaseUrl: params.uploadBaseUrl,
            projectId: params.projectId,
            supabaseAdmin: params.supabaseAdmin,
            recentBeforeIso: beforeUploadIso,
            fileName,
          })
          await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: errorMessage })
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', error_message: errorMessage, updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.failedCount++
          summary.errors.push(`${jobId}: ${errorMessage}`)
          continue
        }

        const confirm = await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/confirm`, {})
        if (!confirm.res.ok) {
          const errorMessage = getErrorMessage(confirm.json?.error, `confirm failed (${confirm.res.status})`)
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'confirm_failed', error_message: errorMessage, updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.confirmFailedCount++
          summary.errors.push(`${jobId}: imported but confirm failed: ${errorMessage}`)
        } else {
          await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'imported', error_message: null, updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
          summary.importedSuccess++
        }
      } finally {
        await fs.rm(tempPath, { force: true })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      try {
        await postJson(`${baseUrl}/api/ingest/jobs/${encodeURIComponent(jobId)}/fail`, { error: errorMessage })
      } catch {}
      await params.supabaseAdmin.from('ftp_ingest_import_jobs').update({ status: 'failed', error_message: errorMessage, updated_at: new Date().toISOString() }).eq('project_id', params.projectId).eq('buffer_job_id', jobId)
      summary.failedCount++
      summary.errors.push(`${jobId}: ${errorMessage}`)
    }
  }

  return summary
}
