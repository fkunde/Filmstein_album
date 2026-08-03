import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { r2 } from '@/lib/r2/client'
import { supabase } from '@/lib/supabase/server'
import { analyzeUploadMetadata, buildR2PublicUrl, buildUploadTempKey, createPlaceholderPhoto } from '@/lib/uploadDirect'
import { findFolderByCustomerUploadToken, shouldShowCustomerPublicChoice } from '@/lib/folderSettings'

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const folder = await findFolderByCustomerUploadToken(token)
    if (!folder) {
      return Response.json({ success: false, error: 'Upload link not found or disabled' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : ''
    const mimeType = typeof body?.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : 'application/octet-stream'
    const fileSizeBytes = Number(body?.fileSizeBytes)
    const checksumSha256 = typeof body?.checksumSha256 === 'string' ? body.checksumSha256.trim().toLowerCase() : ''
    const displayPreset = body?.displayPreset === 'original' || body?.displayPreset === '6000' || body?.displayPreset === '4000'
      ? body.displayPreset
      : '4000'

    if (!fileName || !Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || !checksumSha256) {
      return Response.json({ success: false, error: 'Missing required upload init fields' }, { status: 400 })
    }

    const showPublicChoice = shouldShowCustomerPublicChoice({
      folderKind: folder.folder_kind,
      accessMode: folder.access_mode,
      settings: folder.settings,
    })
    const customerPublicConsent = showPublicChoice
      ? (body?.customerPublicConsent === false ? false : body?.customerPublicConsent === true ? true : folder.settings.customer_upload.default_public)
      : false

    const analysis = await analyzeUploadMetadata({ projectId: folder.project_id, fileName, checksumSha256 })

    const { data: insertedSession, error: insertError } = await supabase
      .from('upload_sessions')
      .insert([{
        project_id: folder.project_id,
        folder_id: folder.id,
        target_photo_id: null,
        file_name: fileName,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        checksum_sha256: checksumSha256,
        display_preset: displayPreset,
        upload_category: null,
        upload_decision: null,
        classification: analysis.classification,
        upload_source: 'customer_qr',
        customer_public_consent: customerPublicConsent,
        matched_photo_id: analysis.matchedPhotoId,
        matched_version_no: analysis.matchedVersionNo,
        next_version_no: analysis.nextVersionNo,
        normalized_base_name: analysis.normalizedBaseName,
        reason: analysis.reason,
        source_bucket_name: process.env.R2_BUCKET_NAME!,
        created_by_admin_user_id: null,
        warnings: [],
      }])
      .select('id')
      .single()

    if (insertError || !insertedSession) {
      return Response.json({ success: false, error: insertError?.message || 'Failed to create upload session' }, { status: 500 })
    }

    const targetPhotoId = await createPlaceholderPhoto({
      projectId: folder.project_id,
      folderId: folder.id,
      fileName,
      sessionId: insertedSession.id,
      uploadSource: 'customer_qr',
      customerPublicConsent,
      isPublished: customerPublicConsent === true,
    })

    const { error: bindTargetPhotoError } = await supabase
      .from('upload_sessions')
      .update({ target_photo_id: targetPhotoId })
      .eq('id', insertedSession.id)

    if (bindTargetPhotoError) {
      await supabase.from('photos').delete().eq('global_photo_id', targetPhotoId)
      await supabase.from('upload_sessions').delete().eq('id', insertedSession.id)
      return Response.json({ success: false, error: bindTargetPhotoError.message }, { status: 500 })
    }

    const objectKey = buildUploadTempKey({ projectId: folder.project_id, sessionId: insertedSession.id, fileName })
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
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        customerPublicConsent,
        folderId: folder.id,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
