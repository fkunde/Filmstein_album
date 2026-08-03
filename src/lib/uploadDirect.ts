import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'
import {
  BRANCH_TYPE_CLIENT_PREVIEW,
  buildWatermarkedClientPreview,
  getClientPreviewFileName,
  getClientPreviewKey,
} from '@/lib/clientPreviewAsset'
import { getWatermarkVersionSignature } from '@/lib/clientWatermark'
import {
  extractPhotoIdFromFileName,
  extractVersionNoFromFileName,
  looksLikeRetouchFile,
  normalizeBaseName,
  type UploadAnalysisResult,
} from '@/lib/uploadAnalysis'
import type { Project } from '@/data/mockData'
import type { UploadSource } from '@/lib/folderSettings'
import { generateUniquePrintCode } from '@/lib/printCode'
import { maybeAutoQueuePhoto } from '@/lib/printQueue'

const BRANCH_TYPE_ORIGINAL = 'original'
const BRANCH_TYPE_RAW = 'raw'
const BRANCH_TYPE_THUMB = 'thumb'
const BRANCH_TYPE_DISPLAY = 'display'
const GLOBAL_PHOTO_ID_RE = /GP-[A-Z0-9]{12,}/i

export type DirectUploadStatus = 'initiated' | 'uploaded' | 'processing' | 'completed' | 'failed'

export type UploadSessionRow = {
  id: string
  project_id: string
  folder_id: string | null
  target_photo_id: string | null
  file_name: string
  mime_type: string | null
  file_size_bytes: number
  checksum_sha256: string
  display_preset: 'original' | '6000' | '4000'
  upload_category: string | null
  upload_decision: 'skip' | 'overwrite' | null
  upload_source: UploadSource
  customer_public_consent: boolean | null
  classification: UploadAnalysisResult['classification']
  matched_photo_id: string | null
  matched_version_no: number | null
  next_version_no: number | null
  normalized_base_name: string | null
  reason: string | null
  source_bucket_name: string | null
  source_object_key: string | null
  source_public_url: string | null
  status: DirectUploadStatus
  processing_error: string | null
  result_photo_id: string | null
  result_original_file_id: string | null
  result_thumb_file_id: string | null
  result_display_file_id: string | null
  result_client_preview_file_id: string | null
  warnings: string[] | null
}

type PendingUploadStatus = 'uploading' | 'uploaded' | 'processing' | 'failed'

function buildPendingUploadMetadata(params: {
  sessionId: string
  fileName: string
  status: PendingUploadStatus
  message: string
  createdAt?: string
}) {
  return {
    pending_upload: {
      session_id: params.sessionId,
      file_name: params.fileName,
      status: params.status,
      message: params.message,
      created_at: params.createdAt || new Date().toISOString(),
    },
  }
}

function buildGlobalPhotoId() {
  return `GP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

export async function createPlaceholderPhoto(params: {
  projectId: string
  folderId?: string | null
  fileName: string
  sessionId: string
  uploadSource?: UploadSource
  customerPublicConsent?: boolean | null
  isPublished?: boolean
}) {
  const photoId = buildGlobalPhotoId()
  const now = new Date().toISOString()
  const printCode = await generateUniquePrintCode()
  const { error } = await supabase.from('photos').insert([{
    global_photo_id: photoId,
    project_id: params.projectId,
    folder_id: params.folderId || null,
    star_rating: 0,
    status: 1,
    is_published: params.isPublished === true,
    upload_source: params.uploadSource || 'admin',
    customer_public_consent: params.customerPublicConsent ?? null,
    print_code: printCode,
    print_count: 0,
    metadata: buildPendingUploadMetadata({
      sessionId: params.sessionId,
      fileName: params.fileName,
      status: 'uploading',
      message: 'Upload in progress…',
      createdAt: now,
    }),
    updated_at: now,
  }])

  if (error) throw error
  return photoId
}

export async function setPhotoPendingUploadState(params: {
  photoId: string
  sessionId: string
  fileName: string
  status: PendingUploadStatus
  message: string
}) {
  const { error } = await supabase
    .from('photos')
    .update({
      metadata: buildPendingUploadMetadata({
        sessionId: params.sessionId,
        fileName: params.fileName,
        status: params.status,
        message: params.message,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('global_photo_id', params.photoId)

  if (error) throw error
}

export async function clearPhotoPendingUploadState(photoId: string) {
  const { error } = await supabase
    .from('photos')
    .update({ metadata: {}, updated_at: new Date().toISOString() })
    .eq('global_photo_id', photoId)

  if (error) throw error
}

export function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

export function appendVersionSuffix(fileName: string, versionNo: number) {
  const ext = path.extname(fileName)
  const base = fileName.slice(0, fileName.length - ext.length) || fileName
  return `${sanitizeFileName(base)}_v${versionNo}${ext}`
}

export function detectUploadKindByName(fileName: string): 'raw' | 'image' {
  const lower = fileName.toLowerCase()
  if (/\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef|srw)$/.test(lower)) return 'raw'
  if (/\.(jpg|jpeg|png|webp)$/.test(lower)) return 'image'
  return 'image'
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function buildPhotoLifecycleFields(params: {
  uploadSource: UploadSource
  customerPublicConsent: boolean | null
  printCode: string
  isPublished: boolean
}) {
  return {
    is_published: params.isPublished,
    upload_source: params.uploadSource,
    customer_public_consent: params.customerPublicConsent,
    print_code: params.printCode,
    print_count: 0,
    last_printed_at: null,
  }
}

export function buildR2PublicUrl(key: string) {
  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return `${base}/${key}`
}

export function buildUploadTempKey(params: { projectId: string; sessionId: string; fileName: string }) {
  return `uploads/${params.projectId}/${params.sessionId}/${sanitizeFileName(params.fileName)}`
}

async function getProjectPhotoIds(projectId: string) {
  const { data, error } = await supabase
    .from('photos')
    .select('global_photo_id')
    .eq('project_id', projectId)

  if (error) throw error

  return (data ?? [])
    .map((row) => String(row.global_photo_id ?? ''))
    .filter(Boolean)
}

export async function analyzeUploadMetadata(params: {
  projectId?: string | null
  fileName: string
  checksumSha256: string
}): Promise<UploadAnalysisResult> {
  const embeddedPhotoId = extractPhotoIdFromFileName(params.fileName)
  const embeddedVersionNo = extractVersionNoFromFileName(params.fileName)
  const hasSystemPhotoIdPrefix = Boolean(embeddedPhotoId)
  const normalizedBaseName = normalizeBaseName(params.fileName)

  let matchedPhotoId: string | null = null
  let matchedVersionNo: number | null = embeddedVersionNo
  let nextVersionNo: number | null = null
  let classification: UploadAnalysisResult['classification'] = 'unknown'
  let reason = 'no matching rule'
  let targetProjectId = params.projectId?.trim() || null

  if (embeddedPhotoId) {
    const { data: matchedPhoto, error: matchedPhotoError } = await supabase
      .from('photos')
      .select('global_photo_id, project_id')
      .eq('global_photo_id', embeddedPhotoId)
      .maybeSingle()

    if (matchedPhotoError) throw matchedPhotoError

    if (matchedPhoto) {
      matchedPhotoId = String(matchedPhoto.global_photo_id)
      targetProjectId = String(matchedPhoto.project_id ?? targetProjectId ?? '')
    }
  }

  if (hasSystemPhotoIdPrefix) {
    if (matchedPhotoId) {
      const { data: existingVersions, error: existingVersionsError } = await supabase
        .from('photo_files')
        .select('version_no')
        .eq('photo_id', matchedPhotoId)

      if (existingVersionsError) throw existingVersionsError

      const maxVersion = Math.max(0, ...((existingVersions ?? []).map((row) => Number(row.version_no) || 0)))
      nextVersionNo = maxVersion + 1
      classification = 'retouch_upload'
      reason = 'matched system photoId prefix'
    } else {
      classification = 'invalid_retouch_reference'
      reason = 'system photoId prefix found but target photo not found'
    }
  } else {
    const scopedPhotoIds = targetProjectId ? await getProjectPhotoIds(targetProjectId) : []
    const duplicateFileRows = scopedPhotoIds.length > 0
      ? (await supabase
          .from('photo_files')
          .select('photo_id, version_no, checksum_sha256')
          .eq('checksum_sha256', params.checksumSha256)
          .in('photo_id', scopedPhotoIds)
          .limit(5)).data
      : []

    if (duplicateFileRows && duplicateFileRows.length > 0) {
      matchedPhotoId = String(duplicateFileRows[0].photo_id)
      matchedVersionNo = Number(duplicateFileRows[0].version_no) || null
      classification = 'duplicate_original'
      reason = 'exact checksum duplicate'
    } else {
      const candidateOriginalNames = Array.from(new Set([
        params.fileName,
        `${normalizedBaseName}${params.fileName.match(/\.[^.]+$/)?.[0] ?? ''}`,
      ]))
      const duplicateNameRows = scopedPhotoIds.length > 0
        ? (await supabase
            .from('photo_files')
            .select('photo_id, version_no, original_file_name')
            .in('original_file_name', candidateOriginalNames)
            .eq('branch_type', 'original')
            .in('photo_id', scopedPhotoIds)
            .limit(5)).data
        : []

      if (duplicateNameRows && duplicateNameRows.length > 0) {
        matchedPhotoId = String(duplicateNameRows[0].photo_id)
        matchedVersionNo = Number(duplicateNameRows[0].version_no) || null
        classification = 'duplicate_original'
        reason = 'matched existing original filename'
      } else if (looksLikeRetouchFile(params.fileName) && matchedPhotoId) {
        classification = 'retouch_upload'
        reason = 'retouch hint matched existing photo'
      } else {
        classification = 'new_original'
        reason = 'no system prefix and no duplicate match'
      }
    }
  }

  return {
    fileName: params.fileName,
    checksumSha256: params.checksumSha256,
    classification,
    matchedPhotoId,
    matchedVersionNo,
    normalizedBaseName,
    reason,
    nextVersionNo,
  }
}

async function getImageMetadata(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata()
  const exifPayload: Record<string, unknown> = {
    format: metadata.format ?? null,
    space: metadata.space ?? null,
    channels: metadata.channels ?? null,
    density: metadata.density ?? null,
    hasProfile: metadata.hasProfile ?? null,
    hasAlpha: metadata.hasAlpha ?? null,
    orientation: metadata.orientation ?? null,
  }

  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    exif: exifPayload,
  }
}

async function buildThumb(buffer: Buffer) {
  let quality = 82
  let output = await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()

  while (output.length > 100 * 1024 && quality > 40) {
    quality -= 8
    output = await sharp(buffer)
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
  }

  return output
}

async function buildDisplay(buffer: Buffer, preset: 'original' | '6000' | '4000') {
  const targetMaxBytes = 1024 * 1024

  if (preset === 'original') {
    let quality = 92
    let output = await sharp(buffer).rotate().jpeg({ quality, mozjpeg: true }).toBuffer()
    while (output.length > targetMaxBytes && quality > 55) {
      quality -= 6
      output = await sharp(buffer).rotate().jpeg({ quality, mozjpeg: true }).toBuffer()
    }
    return output
  }

  const maxEdge = preset === '6000' ? 6000 : 4000
  let quality = 82
  let output = await sharp(buffer)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer()

  while (output.length > targetMaxBytes && quality > 50) {
    quality -= 6
    output = await sharp(buffer)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
  }

  return output
}

async function uploadToR2(params: { key: string; body: Buffer; contentType: string }) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
  }))

  return buildR2PublicUrl(params.key)
}

function extractR2ObjectKey(objectKeyOrUrl: string) {
  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (base && objectKeyOrUrl.startsWith(base + '/')) {
    return objectKeyOrUrl.slice(base.length + 1)
  }
  return objectKeyOrUrl
}

async function copyR2Object(params: { sourceBucket: string; sourceKey: string; destinationKey: string; contentType?: string | null }) {
  await r2.send(new CopyObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.destinationKey,
    CopySource: `/${params.sourceBucket}/${params.sourceKey}`,
    ContentType: params.contentType || undefined,
    MetadataDirective: params.contentType ? 'REPLACE' : 'COPY',
  }))

  return buildR2PublicUrl(params.destinationKey)
}

async function deleteStoredAsset(file: { storage_provider?: string | null; bucket_name?: string | null; object_key?: string | null }) {
  if (file.storage_provider === 'r2' && file.bucket_name && file.object_key) {
    await r2.send(new DeleteObjectCommand({ Bucket: file.bucket_name, Key: extractR2ObjectKey(file.object_key) }))
  }
}

async function readR2ObjectBuffer(bucket: string, key: string) {
  const object = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = object.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined
  if (!body?.transformToByteArray) {
    throw new Error('Uploaded object stream is unavailable')
  }
  return Buffer.from(await body.transformToByteArray())
}

async function buildClientPreviewAsset(params: {
  projectId: string
  photoId: string
  versionNo: number
  versionedBaseName: string
  originalFileName: string
  displayBuffer: Buffer
}) {
  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('project_assets, visual_settings')
    .eq('id', params.projectId)
    .maybeSingle()

  if (projectError) {
    return { ok: false as const, skipped: false as const, reason: `project watermark config lookup failed: ${projectError.message}` }
  }

  const projectAssets = asRecord(projectRow?.project_assets) ?? {}
  const visualSettings = asRecord(projectRow?.visual_settings) ?? {}
  const watermark = asRecord(visualSettings.watermark) ?? {}
  const watermarkLogo = asRecord(projectAssets.watermark_logo)
  const logoUrl = typeof watermarkLogo?.url === 'string' ? watermarkLogo.url : undefined
  const watermarkEnabled = Boolean(watermark.enabled && logoUrl)
  const watermarkSignature = getWatermarkVersionSignature({
    project_assets: (projectRow?.project_assets as Project['project_assets']) || undefined,
    visual_settings: (projectRow?.visual_settings as Project['visual_settings']) || undefined,
  } as Project)

  if (!watermarkEnabled || !logoUrl) {
    return { ok: false as const, skipped: true as const, reason: 'watermark disabled or logo missing' }
  }

  const logoRes = await fetch(logoUrl)
  if (!logoRes.ok) {
    return { ok: false as const, skipped: false as const, reason: `watermark logo fetch failed (${logoRes.status})` }
  }

  const logoBuffer = Buffer.from(await logoRes.arrayBuffer())
  const outputBuffer = await buildWatermarkedClientPreview({
    sourceBuffer: params.displayBuffer,
    logoBuffer,
    watermark,
    mode: 'preview',
  })

  const fileName = getClientPreviewFileName(params.versionedBaseName)
  const key = getClientPreviewKey({
    projectId: params.projectId,
    photoId: params.photoId,
    versionedBaseName: params.versionedBaseName,
  })

  const url = await uploadToR2({
    key,
    body: outputBuffer,
    contentType: 'image/jpeg',
  })

  const metadata = await getImageMetadata(outputBuffer)
  const row = {
    photo_id: params.photoId,
    branch_type: BRANCH_TYPE_CLIENT_PREVIEW,
    version_no: params.versionNo,
    variant_type: 1,
    file_name: fileName,
    original_file_name: params.originalFileName,
    storage_provider: 'r2',
    bucket_name: process.env.R2_BUCKET_NAME!,
    object_key: url,
    mime_type: 'image/jpeg',
    file_size_bytes: outputBuffer.length,
    width: metadata.width,
    height: metadata.height,
    checksum_sha256: sha256(outputBuffer),
    exif: metadata.exif,
    processing_meta: {
      derived_from: 'display',
      preset: 'client-preview-watermarked-v1',
      watermark_signature: watermarkSignature,
    },
    created_by: null,
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from('photo_files')
    .insert([row])
    .select('id, object_key')
    .single()

  if (insertError || !insertedRow) {
    await deleteStoredAsset({ storage_provider: 'r2', bucket_name: process.env.R2_BUCKET_NAME!, object_key: url }).catch(() => undefined)
    return { ok: false as const, skipped: false as const, reason: insertError?.message || 'Failed to create client preview row' }
  }

  return { ok: true as const, id: insertedRow.id, url: insertedRow.object_key as string }
}

async function setUploadSessionStatus(sessionId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('upload_sessions').update(patch).eq('id', sessionId)
  if (error) throw error
}

export async function claimUploadSessionForProcessing(sessionId: string) {
  const { data, error } = await supabase
    .from('upload_sessions')
    .update({ status: 'processing', processing_error: null })
    .eq('id', sessionId)
    .eq('status', 'uploaded')
    .select('*')
    .maybeSingle<UploadSessionRow>()

  if (error) throw error
  return data
}

export async function runDirectUploadProcessingBatch(limit = 3) {
  const { data: candidates, error } = await supabase
    .from('upload_sessions')
    .select('id')
    .eq('status', 'uploaded')
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 20)))

  if (error) throw error

  const results: Array<{ sessionId: string; success: boolean; error?: string }> = []

  for (const candidate of candidates ?? []) {
    const claimed = await claimUploadSessionForProcessing(String(candidate.id))
    if (!claimed) continue

    try {
      await processDirectUploadSession(String(candidate.id), { alreadyClaimed: true })
      results.push({ sessionId: String(candidate.id), success: true })
    } catch (error) {
      results.push({ sessionId: String(candidate.id), success: false, error: error instanceof Error ? error.message : 'Server error' })
    }
  }

  return results
}

export async function processDirectUploadSession(sessionId: string, options?: { alreadyClaimed?: boolean }) {
  const session = options?.alreadyClaimed
    ? await (async () => {
        const { data, error } = await supabase
          .from('upload_sessions')
          .select('*')
          .eq('id', sessionId)
          .maybeSingle<UploadSessionRow>()

        if (error) throw error
        return data
      })()
    : await claimUploadSessionForProcessing(sessionId)

  if (!session) throw new Error('Upload session is not ready for processing')
  if (!session.source_bucket_name || !session.source_object_key) throw new Error('Upload source is missing')

  const shouldUsePlaceholderState = Boolean(session.target_photo_id)
    && session.upload_decision !== 'overwrite'
    && session.classification !== 'retouch_upload'
    && !session.matched_photo_id

  if (shouldUsePlaceholderState && session.target_photo_id) {
    await setPhotoPendingUploadState({
      photoId: session.target_photo_id,
      sessionId,
      fileName: session.file_name,
      status: 'processing',
      message: 'Generating previews…',
    }).catch(() => undefined)
  }

  let createdNewPhoto = false
  let targetPhotoPrintCode: string | null = null
  let targetPhotoId = session.target_photo_id?.trim() || null
  let targetProjectId = session.project_id
  const createdFileIds: Record<'original' | 'thumb' | 'display' | 'clientPreview', string | null> = {
    original: null,
    thumb: null,
    display: null,
    clientPreview: null,
  }
  const createdStoredAssets: Array<{ storage_provider: string; bucket_name: string | null; object_key: string | null }> = []
  const warnings: string[] = []

  const rollback = async (reason: string) => {
    for (const asset of createdStoredAssets.slice().reverse()) {
      await deleteStoredAsset(asset).catch(() => undefined)
    }

    const fileIds = Object.values(createdFileIds).filter((value): value is string => Boolean(value))
    if (fileIds.length > 0) {
      await supabase.from('photo_files').delete().in('id', fileIds)
    }

    if (createdNewPhoto && targetPhotoId) {
      await supabase.from('photos').delete().eq('global_photo_id', targetPhotoId)
    }

    await setUploadSessionStatus(sessionId, { status: 'failed', processing_error: reason, warnings })
    return { success: false as const, error: reason }
  }

  try {
    if (!targetPhotoId) {
      const embeddedPhotoId = session.file_name.match(GLOBAL_PHOTO_ID_RE)?.[0]?.toUpperCase() || null
      if (embeddedPhotoId) {
        let existingPhotoQuery = supabase
          .from('photos')
          .select('global_photo_id, project_id')
          .eq('global_photo_id', embeddedPhotoId)

        if (targetProjectId) {
          existingPhotoQuery = existingPhotoQuery.eq('project_id', targetProjectId)
        }

        const { data: matchedPhoto, error: matchedPhotoError } = await existingPhotoQuery.maybeSingle()
        if (matchedPhotoError) return rollback(matchedPhotoError.message)
        if (matchedPhoto) {
          targetPhotoId = String(matchedPhoto.global_photo_id)
          targetProjectId = String(matchedPhoto.project_id)
        }
      }
    }

    if (targetPhotoId) {
      const { data: existingPhoto, error: existingPhotoError } = await supabase
        .from('photos')
        .select('global_photo_id, project_id, print_code')
        .eq('global_photo_id', targetPhotoId)
        .maybeSingle()

      if (existingPhotoError) return rollback(existingPhotoError.message)
      if (!existingPhoto) return rollback('Photo not found')
      targetProjectId = String(existingPhoto.project_id)
      targetPhotoPrintCode = typeof existingPhoto.print_code === 'string' ? existingPhoto.print_code : null
    } else {
      targetPhotoId = buildGlobalPhotoId()
      const printCode = await generateUniquePrintCode()
      targetPhotoPrintCode = printCode
      const isPublished = session.upload_source === 'customer_qr'
        ? session.customer_public_consent === true
        : false
      const { error: photoError } = await supabase.from('photos').insert([{
        global_photo_id: targetPhotoId,
        project_id: targetProjectId,
        folder_id: session.folder_id || null,
        star_rating: 0,
        status: 1,
        ...buildPhotoLifecycleFields({
          uploadSource: session.upload_source || 'admin',
          customerPublicConsent: session.customer_public_consent ?? null,
          printCode,
          isPublished,
        }),
        updated_at: new Date().toISOString(),
      }])

      if (photoError) return rollback(photoError.message)
      createdNewPhoto = true
    }

    if (shouldUsePlaceholderState && targetPhotoId) {
      await setPhotoPendingUploadState({
        photoId: targetPhotoId,
        sessionId,
        fileName: session.file_name,
        status: 'processing',
        message: 'Generating previews…',
      }).catch(() => undefined)
    }

    const uploadKind = detectUploadKindByName(session.file_name)
    const needsImageBuffer = uploadKind === 'image'
    const originalBuffer = needsImageBuffer
      ? await readR2ObjectBuffer(session.source_bucket_name, session.source_object_key)
      : null
    const checksum = session.checksum_sha256
    const hasSystemPhotoIdPrefix = Boolean(session.file_name.match(GLOBAL_PHOTO_ID_RE)?.[0]?.toUpperCase())
    const overwriteOriginal = session.upload_decision === 'overwrite' || session.upload_category === 'overwrite-original'
    const originalBranchType = uploadKind === 'raw' ? BRANCH_TYPE_RAW : BRANCH_TYPE_ORIGINAL

    const scopedPhotoIds = await getProjectPhotoIds(targetProjectId)
    const duplicateCheckResult = scopedPhotoIds.length > 0
      ? await supabase
          .from('photo_files')
          .select('id, photo_id, version_no, checksum_sha256')
          .eq('checksum_sha256', checksum)
          .in('photo_id', scopedPhotoIds)
          .limit(5)
      : { data: [], error: null }

    const duplicateFileRows = duplicateCheckResult.data ?? []
    const duplicateCheckError = duplicateCheckResult.error
    if (duplicateCheckError) return rollback(duplicateCheckError.message)

    if (!hasSystemPhotoIdPrefix && duplicateFileRows.length > 0) {
      if (overwriteOriginal) {
        targetPhotoId = session.matched_photo_id?.trim() || String(duplicateFileRows[0].photo_id)
      } else {
        return rollback('Exact duplicate detected')
      }
    }

    let nextVersionNo = 1
    let overwrittenVersionCleanupCount = 0
    if (targetPhotoId) {
      const { data: existingVersions, error: existingVersionsError } = await supabase
        .from('photo_files')
        .select('id, version_no, storage_provider, bucket_name, object_key')
        .eq('photo_id', targetPhotoId)

      if (existingVersionsError) return rollback(existingVersionsError.message)

      const versionNos = Array.from(new Set((existingVersions ?? []).map((row) => Number(row.version_no) || 0).filter(Boolean))).sort((a, b) => a - b)

      if (overwriteOriginal && versionNos.length > 0) {
        const versionsToDelete = versionNos.filter((versionNo) => versionNo > 1)
        if (versionsToDelete.length > 0) {
          const filesToDelete = (existingVersions ?? []).filter((row) => versionsToDelete.includes(Number(row.version_no) || 0))
          const { error: deleteVersionRowsError } = await supabase
            .from('photo_files')
            .delete()
            .eq('photo_id', targetPhotoId)
            .in('version_no', versionsToDelete)

          if (deleteVersionRowsError) return rollback(deleteVersionRowsError.message)
          for (const fileRow of filesToDelete) await deleteStoredAsset(fileRow)
          overwrittenVersionCleanupCount = versionsToDelete.length
        }

        nextVersionNo = 1
        const { error: deleteOriginalRowsError } = await supabase
          .from('photo_files')
          .delete()
          .eq('photo_id', targetPhotoId)
          .eq('version_no', 1)

        if (deleteOriginalRowsError) return rollback(deleteOriginalRowsError.message)

        const originalFilesToDelete = (existingVersions ?? []).filter((row) => (Number(row.version_no) || 0) === 1)
        for (const fileRow of originalFilesToDelete) await deleteStoredAsset(fileRow)
      } else {
        const maxVersion = Math.max(0, ...((existingVersions ?? []).map((row) => Number(row.version_no) || 0)))
        nextVersionNo = maxVersion + 1
      }
    }

    const originalStorageName = appendVersionSuffix(session.file_name, nextVersionNo)
    const baseKey = `${targetProjectId}/${targetPhotoId}`
    const originalDir = originalBranchType === BRANCH_TYPE_RAW ? 'raw' : 'original'
    const originalKey = `${baseKey}/${originalDir}/${originalStorageName}`
    const originalUrl = await copyR2Object({
      sourceBucket: session.source_bucket_name,
      sourceKey: session.source_object_key,
      destinationKey: originalKey,
      contentType: session.mime_type || 'application/octet-stream',
    })
    createdStoredAssets.push({ storage_provider: 'r2', bucket_name: process.env.R2_BUCKET_NAME!, object_key: originalUrl })

    let originalWidth: number | null = null
    let originalHeight: number | null = null
    let originalExif: Record<string, unknown> = {}
    if (uploadKind === 'image' && originalBuffer) {
      const originalMeta = await getImageMetadata(originalBuffer)
      originalWidth = originalMeta.width
      originalHeight = originalMeta.height
      originalExif = originalMeta.exif
    }

    const { data: originalFileRow, error: originalFileError } = await supabase
      .from('photo_files')
      .insert([{
        photo_id: targetPhotoId,
        branch_type: originalBranchType,
        version_no: nextVersionNo,
        variant_type: 1,
        file_name: originalStorageName,
        original_file_name: session.file_name,
        storage_provider: 'r2',
        bucket_name: process.env.R2_BUCKET_NAME!,
        object_key: originalUrl,
        mime_type: session.mime_type || null,
        file_size_bytes: session.file_size_bytes,
        width: originalWidth,
        height: originalHeight,
        checksum_sha256: checksum,
        exif: originalExif,
        processing_meta: { source: 'direct-upload-r2-phase1' },
        created_by: null,
      }])
      .select('id')
      .single()

    if (originalFileError || !originalFileRow) return rollback(originalFileError?.message || 'Failed to create original file row')
    createdFileIds.original = originalFileRow.id

    let displayUrl = ''

    if (uploadKind === 'image' && originalBuffer) {
      const isRetouchUpload = session.upload_category === 'retouch' || (hasSystemPhotoIdPrefix && targetPhotoId !== null) || (targetPhotoId !== null && (looksLikeRetouchFile(session.file_name) || extractVersionNoFromFileName(session.file_name) !== null))
      const thumbBuffer = await buildThumb(originalBuffer)
      const displayBuffer = isRetouchUpload ? originalBuffer : await buildDisplay(originalBuffer, session.display_preset)
      const thumbMeta = await getImageMetadata(thumbBuffer)
      const displayMeta = await getImageMetadata(displayBuffer)
      const safeName = sanitizeFileName(session.file_name.replace(/\.[^.]+$/, ''))
      const versionedBaseName = `${safeName}_v${nextVersionNo}`
      const displayExt = isRetouchUpload ? (path.extname(session.file_name) || '.bin') : '.jpg'
      const displayFileName = `${versionedBaseName}${displayExt}`
      const thumbKey = `${baseKey}/thumb/${versionedBaseName}.jpg`
      const displayKey = `${baseKey}/display/${displayFileName}`

      const thumbUrl = await uploadToR2({ key: thumbKey, body: thumbBuffer, contentType: 'image/jpeg' })
      createdStoredAssets.push({ storage_provider: 'r2', bucket_name: process.env.R2_BUCKET_NAME!, object_key: thumbUrl })

      displayUrl = await uploadToR2({
        key: displayKey,
        body: displayBuffer,
        contentType: isRetouchUpload ? (session.mime_type || 'application/octet-stream') : 'image/jpeg',
      })
      createdStoredAssets.push({ storage_provider: 'r2', bucket_name: process.env.R2_BUCKET_NAME!, object_key: displayUrl })

      const { data: thumbRow, error: thumbError } = await supabase
        .from('photo_files')
        .insert([{
          photo_id: targetPhotoId,
          branch_type: BRANCH_TYPE_THUMB,
          version_no: nextVersionNo,
          variant_type: 1,
          file_name: `${versionedBaseName}.jpg`,
          original_file_name: session.file_name,
          storage_provider: 'r2',
          bucket_name: process.env.R2_BUCKET_NAME!,
          object_key: thumbUrl,
          mime_type: 'image/jpeg',
          file_size_bytes: thumbBuffer.length,
          width: thumbMeta.width,
          height: thumbMeta.height,
          checksum_sha256: sha256(thumbBuffer),
          exif: thumbMeta.exif,
          processing_meta: { derived_from: 'original', preset: 'thumb-400px-100kb' },
          created_by: null,
        }])
        .select('id')
        .single()

      if (thumbError || !thumbRow) return rollback(thumbError?.message || 'Failed to create thumb row')
      createdFileIds.thumb = thumbRow.id

      const { data: displayRow, error: displayError } = await supabase
        .from('photo_files')
        .insert([{
          photo_id: targetPhotoId,
          branch_type: BRANCH_TYPE_DISPLAY,
          version_no: nextVersionNo,
          variant_type: 1,
          file_name: displayFileName,
          original_file_name: session.file_name,
          storage_provider: 'r2',
          bucket_name: process.env.R2_BUCKET_NAME!,
          object_key: displayUrl,
          mime_type: isRetouchUpload ? (session.mime_type || null) : 'image/jpeg',
          file_size_bytes: displayBuffer.length,
          width: displayMeta.width,
          height: displayMeta.height,
          checksum_sha256: isRetouchUpload ? checksum : sha256(displayBuffer),
          exif: displayMeta.exif,
          processing_meta: isRetouchUpload
            ? { derived_from: 'original', preset: 'retouch-direct-display', reused_original_buffer: true }
            : { derived_from: 'original', preset: session.display_preset },
          created_by: null,
        }])
        .select('id')
        .single()

      if (displayError || !displayRow) return rollback(displayError?.message || 'Failed to create display row')
      createdFileIds.display = displayRow.id

      const clientPreviewAsset = await buildClientPreviewAsset({
        projectId: targetProjectId,
        photoId: targetPhotoId,
        versionNo: nextVersionNo,
        versionedBaseName,
        originalFileName: session.file_name,
        displayBuffer,
      })

      if (clientPreviewAsset.ok) {
        createdFileIds.clientPreview = clientPreviewAsset.id
      } else {
        warnings.push(`${clientPreviewAsset.skipped ? 'client preview asset skipped' : 'client preview asset generation failed'}: ${clientPreviewAsset.reason}`)
      }
    }

    const photoUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      folder_id: session.folder_id || null,
    }
    if (session.upload_source === 'customer_qr') {
      photoUpdates.upload_source = 'customer_qr'
      photoUpdates.customer_public_consent = session.customer_public_consent ?? false
      photoUpdates.is_published = session.customer_public_consent === true
    }
    if (createdFileIds.original) photoUpdates.original_file_id = createdFileIds.original
    if (createdFileIds.display) {
      photoUpdates.retouched_file_id = createdFileIds.display
    } else if (!session.target_photo_id && createdFileIds.original) {
      photoUpdates.retouched_file_id = createdFileIds.original
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update(photoUpdates)
      .eq('global_photo_id', targetPhotoId)

    if (updateError) return rollback(updateError.message)

    if (shouldUsePlaceholderState) {
      await clearPhotoPendingUploadState(targetPhotoId).catch(() => undefined)
    }
    await deleteStoredAsset({ storage_provider: 'r2', bucket_name: session.source_bucket_name, object_key: session.source_object_key }).catch(() => undefined)

    await setUploadSessionStatus(sessionId, {
      status: 'completed',
      processing_error: null,
      completed_at: new Date().toISOString(),
      result_photo_id: targetPhotoId,
      result_original_file_id: createdFileIds.original,
      result_thumb_file_id: createdFileIds.thumb,
      result_display_file_id: createdFileIds.display,
      result_client_preview_file_id: createdFileIds.clientPreview,
      warnings,
      next_version_no: nextVersionNo,
      target_photo_id: targetPhotoId,
      reason: warnings.length > 0 ? `completed with ${warnings.length} warning(s)` : session.reason,
    })

    if (createdNewPhoto) {
      await maybeAutoQueuePhoto({
        projectId: targetProjectId,
        folderId: session.folder_id,
        photoId: targetPhotoId,
        uploadSource: session.upload_source,
        printCodeSnapshot: targetPhotoPrintCode,
      }).catch((queueError) => {
        console.error('[print-queue:auto-enqueue] failed:', queueError)
      })
    }

    return {
      success: true as const,
      photoId: targetPhotoId,
      originalFileId: createdFileIds.original,
      thumbFileId: createdFileIds.thumb,
      displayFileId: createdFileIds.display,
      clientPreviewFileId: createdFileIds.clientPreview,
      overwriteOriginal,
      overwrittenVersionCleanupCount,
      warnings,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error'
    if (shouldUsePlaceholderState && session.target_photo_id) {
      await setPhotoPendingUploadState({
        photoId: session.target_photo_id,
        sessionId,
        fileName: session.file_name,
        status: 'failed',
        message: message || 'Processing failed',
      }).catch(() => undefined)
    }
    await setUploadSessionStatus(sessionId, { status: 'failed', processing_error: message, warnings }).catch(() => undefined)
    throw error
  }
}

export async function headDirectUploadObject(bucket: string, key: string) {
  const object = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-0' }))
  return object
}
