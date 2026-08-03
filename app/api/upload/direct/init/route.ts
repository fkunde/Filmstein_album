import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { supabase } from '@/lib/supabase/server'
import { r2 } from '@/lib/r2/client'
import { analyzeUploadMetadata, buildR2PublicUrl, buildUploadTempKey, createPlaceholderPhoto } from '@/lib/uploadDirect'
import type { UploadAnalysisResult } from '@/lib/uploadAnalysis'
import { resolveUploadFolderByPrefix } from '@/lib/folderSettings'

export async function POST(req: Request) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const body = await req.json().catch(() => null)
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
    const folderId = typeof body?.folderId === 'string' && body.folderId.trim() ? body.folderId.trim() : null
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : ''
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'application/octet-stream'
    const fileSizeBytes = Number(body?.fileSizeBytes)
    const checksumSha256 = typeof body?.checksumSha256 === 'string' ? body.checksumSha256.trim().toLowerCase() : ''
    const displayPreset = body?.displayPreset === 'original' || body?.displayPreset === '6000' || body?.displayPreset === '4000'
      ? body.displayPreset
      : '4000'
    const uploadDecision = body?.uploadDecision === 'overwrite' || body?.uploadDecision === 'skip' ? body.uploadDecision : null
    const analysis = body?.analysis as UploadAnalysisResult | undefined

    if (!projectId || !fileName || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || !checksumSha256) {
      return Response.json({ success: false, error: 'Missing required upload init fields' }, { status: 400 })
    }

    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const resolvedFolder = await resolveUploadFolderByPrefix({
      projectId,
      explicitFolderId: folderId,
      fileName,
      source: 'admin',
    })

    const normalizedAnalysis = analysis && analysis.fileName === fileName && analysis.checksumSha256 === checksumSha256
      ? analysis
      : await analyzeUploadMetadata({ projectId, fileName, checksumSha256 })

    if (normalizedAnalysis.classification === 'invalid_retouch_reference') {
      return Response.json({ success: false, error: normalizedAnalysis.reason || 'Invalid retouch reference', data: normalizedAnalysis }, { status: 409 })
    }

    if (normalizedAnalysis.classification === 'duplicate_original' && uploadDecision !== 'overwrite') {
      return Response.json({
        success: false,
        error: 'Duplicate original requires overwrite confirmation before upload',
        code: 'DUPLICATE_NEEDS_DECISION',
        data: normalizedAnalysis,
      }, { status: 409 })
    }

    const uploadCategory = uploadDecision === 'overwrite'
      ? 'overwrite-original'
      : normalizedAnalysis.classification === 'retouch_upload'
        ? 'retouch'
        : null

    const shouldCreatePlaceholderPhoto = !uploadDecision
      && normalizedAnalysis.classification !== 'duplicate_original'
      && normalizedAnalysis.classification !== 'retouch_upload'
      && !normalizedAnalysis.matchedPhotoId

    const { data: insertedSession, error: insertError } = await supabase
      .from('upload_sessions')
      .insert([{
        project_id: projectId,
        folder_id: resolvedFolder.folderId,
        target_photo_id: uploadDecision === 'overwrite' ? normalizedAnalysis.matchedPhotoId : normalizedAnalysis.classification === 'retouch_upload' ? normalizedAnalysis.matchedPhotoId : null,
        file_name: fileName,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        checksum_sha256: checksumSha256,
        display_preset: displayPreset,
        upload_category: uploadCategory,
        upload_decision: uploadDecision,
        classification: normalizedAnalysis.classification,
        upload_source: 'admin',
        customer_public_consent: null,
        matched_photo_id: normalizedAnalysis.matchedPhotoId,
        matched_version_no: normalizedAnalysis.matchedVersionNo,
        next_version_no: normalizedAnalysis.nextVersionNo,
        normalized_base_name: normalizedAnalysis.normalizedBaseName,
        reason: normalizedAnalysis.reason,
        source_bucket_name: process.env.R2_BUCKET_NAME!,
        created_by_admin_user_id: auth.id,
        warnings: [],
      }])
      .select('id')
      .single()

    if (insertError || !insertedSession) {
      return Response.json({ success: false, error: insertError?.message || 'Failed to create upload session' }, { status: 500 })
    }

    let targetPhotoId = uploadDecision === 'overwrite'
      ? normalizedAnalysis.matchedPhotoId
      : normalizedAnalysis.classification === 'retouch_upload'
        ? normalizedAnalysis.matchedPhotoId
        : null

    if (shouldCreatePlaceholderPhoto) {
      try {
        targetPhotoId = await createPlaceholderPhoto({
          projectId,
          folderId: resolvedFolder.folderId,
          fileName,
          sessionId: insertedSession.id,
          uploadSource: 'admin',
          customerPublicConsent: null,
          isPublished: false,
        })
      } catch (error) {
        await supabase.from('upload_sessions').delete().eq('id', insertedSession.id)
        return Response.json({ success: false, error: error instanceof Error ? error.message : 'Failed to create placeholder photo' }, { status: 500 })
      }
    }

    if (targetPhotoId) {
      const { error: bindTargetPhotoError } = await supabase
        .from('upload_sessions')
        .update({ target_photo_id: targetPhotoId })
        .eq('id', insertedSession.id)

      if (bindTargetPhotoError) {
        if (shouldCreatePlaceholderPhoto) {
          await supabase.from('photos').delete().eq('global_photo_id', targetPhotoId)
        }
        await supabase.from('upload_sessions').delete().eq('id', insertedSession.id)
        return Response.json({ success: false, error: bindTargetPhotoError.message }, { status: 500 })
      }
    }

    const objectKey = buildUploadTempKey({ projectId, sessionId: insertedSession.id, fileName })
    const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: objectKey,
      ContentType: mimeType,
    }), { expiresIn: 900 })

    const sourcePublicUrl = buildR2PublicUrl(objectKey)
    const { error: updateError } = await supabase
      .from('upload_sessions')
      .update({ source_object_key: objectKey, source_public_url: sourcePublicUrl })
      .eq('id', insertedSession.id)

    if (updateError) {
      return Response.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: {
        sessionId: insertedSession.id,
        status: 'initiated',
        uploadUrl,
        method: 'PUT',
        objectKey,
        sourcePublicUrl,
        headers: {
          'Content-Type': mimeType,
        },
        analysis: normalizedAnalysis,
        resolvedFolderId: resolvedFolder.folderId,
        matchedByPrefix: resolvedFolder.matchedByPrefix,
      },
    })
  } catch (error) {
    console.error('[upload/direct/init] error:', error)
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
