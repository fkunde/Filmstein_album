import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { parseFolderSettings } from '@/lib/folderSettings'
import {
  createPrintQueueItem,
  mapRowToPrintQueueItem,
  normalizePrintQueueSourceMode,
  type PrintQueueItemRow,
} from '@/lib/printQueue'
import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

function readBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function mapNodeRow(row: Record<string, unknown>) {
  const metadata = asRecord(row.metadata)
  const lastSeenAt = typeof row.last_seen_at === 'string' ? row.last_seen_at : null
  const lastSeenTime = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN
  const seenRecently = Number.isFinite(lastSeenTime) && Date.now() - lastSeenTime <= 90_000

  return {
    id: String(row.id ?? ''),
    nodeKey: String(row.node_key ?? ''),
    clientName: typeof row.client_name === 'string' ? row.client_name : null,
    appVersion: typeof row.app_version === 'string' ? row.app_version : null,
    platform: typeof row.platform === 'string' ? row.platform : null,
    printerStatus: typeof row.printer_status === 'string' ? row.printer_status : 'disconnected',
    nodeStatus: typeof row.node_status === 'string' ? row.node_status : 'offline',
    isOnline: row.node_status === 'online' && seenRecently,
    printerName: typeof row.printer_name === 'string' ? row.printer_name : null,
    lastCheckAt: typeof row.last_check_at === 'string' ? row.last_check_at : null,
    lastSeenAt,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    acceptNewJobs: readBoolean(metadata.accept_new_jobs, true),
    maintenancePaused: readBoolean(metadata.maintenance_paused, false),
  }
}

export async function GET(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const url = new URL(req.url)
    const folderId = url.searchParams.get('folderId')?.trim() || ''

    let query = supabase
      .from('print_queue_items')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (folderId) {
      query = query.eq('folder_id', folderId)
    }

    const [{ data, error }, { data: nodeRows, error: nodeError }] = await Promise.all([
      query,
      folderId
        ? supabase
            .from('print_client_nodes')
            .select('*')
            .eq('project_id', projectId)
            .eq('folder_id', folderId)
            .order('last_seen_at', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }
    if (nodeError) {
      return Response.json({ success: false, error: nodeError.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: (data ?? []).map((row) => mapRowToPrintQueueItem(row as PrintQueueItemRow)),
      nodes: (nodeRows ?? []).map((row) => mapNodeRow(row as Record<string, unknown>)),
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const folderId = typeof body?.folderId === 'string' ? body.folderId.trim() : ''
    const photoId = typeof body?.photoId === 'string' ? body.photoId.trim() : ''
    const requestedCopies = Math.max(1, Math.floor(Number(body?.requestedCopies) || 1))

    if (!folderId || !photoId) {
      return Response.json({ success: false, error: 'folderId and photoId are required' }, { status: 400 })
    }

    const { data: photoRow, error: photoError } = await supabase
      .from('photos')
      .select('global_photo_id, project_id, folder_id, print_code')
      .eq('global_photo_id', photoId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (photoError) {
      return Response.json({ success: false, error: photoError.message }, { status: 500 })
    }
    if (!photoRow) {
      return Response.json({ success: false, error: 'Photo not found' }, { status: 404 })
    }
    if (photoRow.folder_id !== folderId) {
      return Response.json({ success: false, error: 'Photo does not belong to this album' }, { status: 400 })
    }

    const { data: folderRow, error: folderError } = await supabase
      .from('project_folders')
      .select('id, folder_kind, settings')
      .eq('project_id', projectId)
      .eq('id', folderId)
      .maybeSingle()

    if (folderError) {
      return Response.json({ success: false, error: folderError.message }, { status: 500 })
    }
    if (!folderRow) {
      return Response.json({ success: false, error: 'Album not found' }, { status: 404 })
    }
    if (folderRow.folder_kind !== 'print') {
      return Response.json({ success: false, error: 'Only print albums can use the print queue' }, { status: 400 })
    }

    const folderSettings = parseFolderSettings(folderRow.settings)
    const item = await createPrintQueueItem({
      projectId,
      folderId,
      photoId,
      printCodeSnapshot: typeof photoRow.print_code === 'string' ? photoRow.print_code : null,
      requestedCopies,
      sourceMode: normalizePrintQueueSourceMode(folderSettings.print.mode),
      sourceReason: 'admin_click',
      createdByAdminUserId: auth.id,
    })

    return Response.json({ success: true, data: item })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
