import { supabase } from '@/lib/supabase/server'

import { parseFolderSettings } from '@/lib/folderSettings'

export type PrintQueueItemStatus = 'queued' | 'printing' | 'completed' | 'cancelled' | 'failed'
export type PrintQueueSourceMode = 'manual' | 'semi_auto' | 'auto'
export type PrintQueueSourceReason = 'admin_click' | 'new_upload' | 'ftp_route' | 'customer_upload'

export type PrintQueueItemRow = {
  id: string
  project_id: string
  folder_id: string
  photo_id: string
  print_code_snapshot: string | null
  requested_copies: number
  completed_copies: number
  status: PrintQueueItemStatus
  source_mode: PrintQueueSourceMode
  source_reason: PrintQueueSourceReason
  error_message: string | null
  created_by_admin_user_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export function normalizePrintQueueStatus(value: unknown): PrintQueueItemStatus {
  return value === 'printing' || value === 'completed' || value === 'cancelled' || value === 'failed'
    ? value
    : 'queued'
}

export function normalizePrintQueueSourceMode(value: unknown): PrintQueueSourceMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'manual'
}

export function normalizePrintQueueSourceReason(value: unknown): PrintQueueSourceReason {
  return value === 'new_upload' || value === 'ftp_route' || value === 'customer_upload'
    ? value
    : 'admin_click'
}

export function mapUploadSourceToQueueReason(source: unknown): PrintQueueSourceReason {
  return source === 'customer_qr'
    ? 'customer_upload'
    : source === 'ftp'
      ? 'ftp_route'
      : 'admin_click'
}

export function mapRowToPrintQueueItem(row: Partial<PrintQueueItemRow>) {
  return {
    id: String(row.id ?? ''),
    projectId: String(row.project_id ?? ''),
    folderId: String(row.folder_id ?? ''),
    photoId: String(row.photo_id ?? ''),
    printCodeSnapshot: typeof row.print_code_snapshot === 'string' ? row.print_code_snapshot : null,
    requestedCopies: Math.max(1, Number(row.requested_copies) || 1),
    completedCopies: Math.max(0, Number(row.completed_copies) || 0),
    status: normalizePrintQueueStatus(row.status),
    sourceMode: normalizePrintQueueSourceMode(row.source_mode),
    sourceReason: normalizePrintQueueSourceReason(row.source_reason),
    errorMessage: typeof row.error_message === 'string' ? row.error_message : null,
    createdByAdminUserId: typeof row.created_by_admin_user_id === 'string' ? row.created_by_admin_user_id : null,
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

export async function loadPrintFolderWithSettings(projectId: string, folderId: string) {
  const { data, error } = await supabase
    .from('project_folders')
    .select('id, folder_kind, settings')
    .eq('project_id', projectId)
    .eq('id', folderId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: String(data.id),
    folderKind: data.folder_kind === 'print' ? 'print' : 'standard',
    settings: parseFolderSettings(data.settings),
  }
}

export async function createPrintQueueItem(params: {
  projectId: string
  folderId: string
  photoId: string
  printCodeSnapshot?: string | null
  requestedCopies: number
  sourceMode: PrintQueueSourceMode
  sourceReason: PrintQueueSourceReason
  createdByAdminUserId?: string | null
}) {
  const payload = {
    project_id: params.projectId,
    folder_id: params.folderId,
    photo_id: params.photoId,
    print_code_snapshot: params.printCodeSnapshot ?? null,
    requested_copies: Math.max(1, Math.floor(params.requestedCopies || 1)),
    completed_copies: 0,
    status: 'queued',
    source_mode: params.sourceMode,
    source_reason: params.sourceReason,
    error_message: null,
    created_by_admin_user_id: params.createdByAdminUserId ?? null,
  }

  const { data, error } = await supabase
    .from('print_queue_items')
    .insert([payload])
    .select('*')
    .single<PrintQueueItemRow>()

  if (error) throw error
  return mapRowToPrintQueueItem(data)
}

export async function maybeAutoQueuePhoto(params: {
  projectId: string
  folderId?: string | null
  photoId: string
  uploadSource: unknown
  printCodeSnapshot?: string | null
}) {
  const folderId = typeof params.folderId === 'string' && params.folderId.trim()
    ? params.folderId.trim()
    : ''
  if (!folderId) return null

  const folder = await loadPrintFolderWithSettings(params.projectId, folderId)
  if (!folder || folder.folderKind !== 'print') return null
  if (folder.settings.print.mode !== 'auto') return null
  if (folder.settings.print.runner_status !== 'running') return null

  return createPrintQueueItem({
    projectId: params.projectId,
    folderId,
    photoId: params.photoId,
    printCodeSnapshot: params.printCodeSnapshot ?? null,
    requestedCopies: 1,
    sourceMode: 'auto',
    sourceReason: mapUploadSourceToQueueReason(params.uploadSource),
    createdByAdminUserId: null,
  })
}
