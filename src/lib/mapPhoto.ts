import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapRowToPhoto(row: Record<string, unknown>) {
  const latestOriginalFile = asRecord(row.latest_original_file);
  const latestThumbFile = asRecord(row.latest_thumb_file);
  const latestDisplayFile = asRecord(row.latest_display_file);
  const latestClientPreviewFile = asRecord(row.latest_client_preview_file);
  const firstOriginalFile = asRecord(row.first_original_file);
  const metadata = asRecord(row.metadata);
  const pendingUpload = asRecord(metadata?.pending_upload);

  const cardFile = latestThumbFile ?? latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;
  const displayActiveFile = latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;
  const downloadFile = latestDisplayFile ?? latestOriginalFile ?? firstOriginalFile ?? row;

  const thumbUrl = resolvePhotoPublicUrl(cardFile as Record<string, unknown>);
  const displayUrl = resolvePhotoPublicUrl(displayActiveFile as Record<string, unknown>);
  const downloadUrl = resolvePhotoPublicUrl(downloadFile as Record<string, unknown>);
  const versionCount = Number(row.version_count) || 1;
  const latestVersionNo = Number(row.latest_version_no) || 1;
  const firstVersionNo = Number(row.first_version_no) || latestVersionNo;
  const projectWatermarkSignature = toStringValue(row.project_watermark_signature)
  const clientPreviewWatermarkSignature = asRecord(latestClientPreviewFile?.processing_meta)?.watermark_signature
  const resolvedClientPreviewUrl = latestClientPreviewFile ? resolvePhotoPublicUrl(latestClientPreviewFile) : ""
  const clientPreviewUrl = resolvedClientPreviewUrl && (!projectWatermarkSignature || projectWatermarkSignature === clientPreviewWatermarkSignature)
    ? `${resolvedClientPreviewUrl}${resolvedClientPreviewUrl.includes('?') ? '&' : '?'}wv=${encodeURIComponent(projectWatermarkSignature || String(latestVersionNo))}`
    : "";
  const retouchedOriginalUrl = latestOriginalFile ? resolvePhotoPublicUrl(latestOriginalFile) : "";
  const originalUrl = firstOriginalFile ? resolvePhotoPublicUrl(firstOriginalFile) : retouchedOriginalUrl;

  const fileName =
    toStringValue(displayActiveFile?.file_name) ||
    toStringValue(displayActiveFile?.original_file_name) ||
    toStringValue(latestOriginalFile?.file_name) ||
    toStringValue(latestOriginalFile?.original_file_name) ||
    toStringValue(firstOriginalFile?.file_name) ||
    toStringValue(firstOriginalFile?.original_file_name) ||
    toStringValue(pendingUpload?.file_name) ||
    "untitled";

  const processingStateRaw = toStringValue(pendingUpload?.status);
  const processingState = processingStateRaw === 'uploading' || processingStateRaw === 'uploaded' || processingStateRaw === 'processing' || processingStateRaw === 'failed'
    ? processingStateRaw
    : undefined;
  const photoStatus = versionCount > 1 ? "edited" : "original";
  const adminColorTags = Array.isArray(row.admin_color_tags)
    ? row.admin_color_tags.filter((value): value is string => typeof value === 'string')
    : []
  const clientMarkDetails = Array.isArray(row.client_mark_details)
    ? row.client_mark_details
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => Boolean(value))
        .map((value) => {
          const viewerSessionId = toStringValue(value.viewer_session_id)
          const createdAt = toStringValue(value.created_at)
          const shortId = viewerSessionId ? viewerSessionId.slice(0, 8) : 'unknown'
          return {
            viewerSessionId,
            createdAt: createdAt || undefined,
            label: toStringValue(value.label) || `viewer:${shortId}`,
          }
        })
        .filter((value) => value.viewerSessionId)
    : []
  const clientMarkCount = Number(row.client_mark_count) || clientMarkDetails.length || 0

  return {
    id: toStringValue(row.global_photo_id) || toStringValue(row.id),
    projectId: toStringValue(row.project_id),
    url: thumbUrl || displayUrl || downloadUrl,
    file_url: downloadUrl || displayUrl || thumbUrl,
    thumbUrl,
    displayUrl,
    clientPreviewUrl,
    downloadUrl,
    retouchedOriginalUrl,
    originalUrl,
    fileName,
    tag: toStringValue(row.tag),
    selected: false,
    uploadedAt: toStringValue(displayActiveFile?.created_at) || toStringValue(latestOriginalFile?.created_at) || toStringValue(pendingUpload?.created_at) || toStringValue(row.updated_at),
    status: toStringValue(row.status) || "1",
    photoStatus,
    colorLabel: toStringValue(row.color_label) || "none",
    albumId: toStringValue(row.folder_id) || undefined,
    folder: undefined,
    folderId: toStringValue(row.folder_id) || undefined,
    originalFileId: toStringValue(firstOriginalFile?.id) || toStringValue(row.original_file_id),
    retouchedFileId: toStringValue(latestDisplayFile?.id) || toStringValue(row.retouched_file_id),
    thumbFileId: toStringValue(latestThumbFile?.id),
    displayFileId: toStringValue(latestDisplayFile?.id),
    clientPreviewFileId: toStringValue(latestClientPreviewFile?.id),
    clientPreviewWatermarkSignature: typeof clientPreviewWatermarkSignature === 'string' ? clientPreviewWatermarkSignature : undefined,
    projectWatermarkSignature,
    versionCount,
    latestVersionNo,
    firstVersionNo,
    isPublished: row.is_published === true,
    uploadSource: row.upload_source === 'ftp' || row.upload_source === 'customer_qr' ? row.upload_source : 'admin',
    customerPublicConsent: row.customer_public_consent === null || row.customer_public_consent === undefined ? null : row.customer_public_consent === true,
    printCode: toStringValue(row.print_code) || undefined,
    printCount: Number(row.print_count) || 0,
    lastPrintedAt: toStringValue(row.last_printed_at) || undefined,
    clientMarked: row.client_marked === true,
    clientMarkCount,
    hasClientMarks: clientMarkCount > 0,
    clientMarkDetails,
    adminColorTags,
    isPlaceholder: !thumbUrl && !displayUrl && !downloadUrl && Boolean(processingState),
    processingState,
    processingMessage: toStringValue(pendingUpload?.message) || undefined,
    uploadSessionId: toStringValue(pendingUpload?.session_id) || undefined,
  };
}
