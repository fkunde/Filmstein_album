import { resolvePhotoPublicUrl } from '@/lib/resolvePhotoPublicUrl'
import { getLatestVersionFiles, groupPhotoFilesByVersion, type PhotoFileRow } from '@/lib/photoVersions'
import { parseFolderSettings } from '@/lib/folderSettings'
import { mapRowToPrintQueueItem, type PrintQueueItemRow } from '@/lib/printQueue'
import { createSupabaseServerClient, supabase, type SupabaseServerClient } from '@/lib/supabase/server'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

export function createPrintClientSupabase(token: string) {
  return createSupabaseServerClient({
    'x-print-client-token': token.trim(),
  })
}

export async function resolvePrintClientBinding(token: string, client: SupabaseServerClient = supabase) {
  const normalizedToken = token.trim()
  if (!normalizedToken) return null

  const { data, error } = await client
    .from('project_folders')
    .select('id, project_id, name, folder_kind, settings, projects:project_id(id, name)')
    .eq('settings->print->>client_token', normalizedToken)
    .eq('folder_kind', 'print')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const settings = parseFolderSettings(data.settings)
  if (!settings.print.client_token || settings.print.client_token !== normalizedToken) return null

  const projectRecord = Array.isArray(data.projects) ? data.projects[0] : data.projects
  return {
    token: normalizedToken,
    projectId: String(data.project_id),
    projectName: typeof projectRecord?.name === 'string' ? projectRecord.name : 'Project',
    folderId: String(data.id),
    folderName: String(data.name || 'Print album'),
    settings,
  }
}

export async function loadPrintClientStateByToken(token: string) {
  const client = createPrintClientSupabase(token)
  const binding = await resolvePrintClientBinding(token, client)
  if (!binding) return null

  const [{ data: queueRows, error: queueError }, { data: nodeRows, error: nodeError }] = await Promise.all([
    client
      .from('print_queue_items')
      .select('*')
      .eq('project_id', binding.projectId)
      .eq('folder_id', binding.folderId)
      .order('created_at', { ascending: false }),
    client
      .from('print_client_nodes')
      .select('*')
      .eq('project_id', binding.projectId)
      .eq('folder_id', binding.folderId)
      .order('last_seen_at', { ascending: false })
      .limit(5),
  ])

  if (queueError) throw queueError
  if (nodeError) throw nodeError

  const queueItems = (queueRows ?? []).map((row) => mapRowToPrintQueueItem(row as PrintQueueItemRow))
  const photoIds = Array.from(new Set(queueItems.map((item) => item.photoId)))

  const photoMap = new Map<string, {
    id: string
    fileName: string
    printCode: string | null
    previewUrl: string | null
    uploadedAt: string | null
  }>()

  if (photoIds.length > 0) {
    const [{ data: photoRows, error: photoError }, { data: fileRows, error: fileError }] = await Promise.all([
      client
        .from('photos')
        .select('global_photo_id, print_code, updated_at')
        .in('global_photo_id', photoIds),
      client
        .from('photo_files')
        .select('id, photo_id, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, branch_type, version_no, file_size_bytes, checksum_sha256, processing_meta')
        .in('photo_id', photoIds),
    ])

    if (photoError) throw photoError
    if (fileError) throw fileError

    const filesByPhotoId = new Map<string, PhotoFileRow[]>()
    for (const row of (fileRows ?? []) as PhotoFileRow[]) {
      const list = filesByPhotoId.get(row.photo_id) ?? []
      list.push(row)
      filesByPhotoId.set(row.photo_id, list)
    }

    for (const row of photoRows ?? []) {
      const photoId = String(row.global_photo_id)
      const versions = groupPhotoFilesByVersion(filesByPhotoId.get(photoId) ?? [])
      const latest = versions.length > 0 ? getLatestVersionFiles(filesByPhotoId.get(photoId) ?? []) : null
      const previewFile = latest?.byBranch.thumb ?? latest?.byBranch.display ?? latest?.byBranch.original ?? null
      photoMap.set(photoId, {
        id: photoId,
        fileName: typeof previewFile?.file_name === 'string'
          ? previewFile.file_name
          : typeof previewFile?.original_file_name === 'string'
            ? previewFile.original_file_name
            : photoId,
        printCode: typeof row.print_code === 'string' ? row.print_code : null,
        previewUrl: previewFile ? resolvePhotoPublicUrl(previewFile as unknown as Record<string, unknown>) : null,
        uploadedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      })
    }
  }

  const queue = queueItems.map((item) => ({
    ...item,
    assignedNodeKey: null,
    routingState: item.status === 'queued' ? 'unassigned' : item.status === 'printing' ? 'claimed' : 'finished',
    canMigrate: item.status === 'queued',
    photo: photoMap.get(item.photoId) ?? {
      id: item.photoId,
      fileName: item.photoId,
      printCode: item.printCodeSnapshot,
      previewUrl: null,
      uploadedAt: null,
    },
  }))

  const nodes = (nodeRows ?? []).map((row) => ({
    metadata: asRecord(row.metadata) ?? {},
    id: String(row.id),
    nodeKey: String(row.node_key),
    clientName: typeof row.client_name === 'string' ? row.client_name : null,
    appVersion: typeof row.app_version === 'string' ? row.app_version : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    printerStatus: typeof row.printer_status === 'string' ? row.printer_status : 'disconnected',
    nodeStatus: typeof row.node_status === 'string' ? row.node_status : 'offline',
    printerName: typeof row.printer_name === 'string' ? row.printer_name : null,
    lastCheckAt: typeof row.last_check_at === 'string' ? row.last_check_at : null,
    lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    acceptNewJobs: readBoolean(asRecord(row.metadata)?.accept_new_jobs, true),
    maintenancePaused: readBoolean(asRecord(row.metadata)?.maintenance_paused, false),
  }))

  return {
    binding: {
      projectId: binding.projectId,
      projectName: binding.projectName,
      folderId: binding.folderId,
      folderName: binding.folderName,
    },
    print: {
      mode: binding.settings.print.mode,
      runnerStatus: binding.settings.print.runner_status,
      clientTokenHint: binding.settings.print.client_token ? `${binding.settings.print.client_token.slice(0, 6)}...` : '',
    },
    queue,
    nodes,
  }
}
