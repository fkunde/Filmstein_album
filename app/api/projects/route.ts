import { randomUUID } from 'node:crypto'

import { supabase } from '@/lib/supabase/server'
import { mapRowToProject } from '@/lib/mapProject'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { getAccessibleProjectIdsForAdmin } from '@/lib/auth/projectPermissions'

function sumProjectStorageUsedBytes(fileRows: Array<{ file_size_bytes?: unknown }>) {
  return fileRows.reduce((total, row) => total + (typeof row.file_size_bytes === 'number' ? row.file_size_bytes : 0), 0)
}

const PROJECT_TYPES = new Set(['Wedding', 'Event', 'Campaign'])

export async function GET() {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const accessibleProjectIds = await getAccessibleProjectIdsForAdmin(auth)
    if (Array.isArray(accessibleProjectIds) && accessibleProjectIds.length === 0) {
      return Response.json({ success: true, data: [] })
    }

    let projectsQuery = supabase
      .from('projects')
      .select('id, name, client_name, description, type, status, cover_url, ftp_ingest, project_assets, visual_settings, created_at, created_by_admin_user_id')
      .order('created_at', { ascending: false })

    if (Array.isArray(accessibleProjectIds)) {
      projectsQuery = projectsQuery.in('id', accessibleProjectIds)
    }

    const { data, error } = await projectsQuery

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const projectIds = (data ?? []).map((row) => String(row.id ?? '')).filter(Boolean)

    let storageStateByProjectId = new Map<string, { location_mode?: 'r2' | 'node_local'; holder_node_id?: string | null; holder_node_name?: string | null; holder_node_key?: string | null }>()
    if (projectIds.length > 0) {
      const { data: storageStates } = await supabase
        .from('project_storage_state')
        .select('project_id, location_mode, holder_node_id')
        .in('project_id', projectIds)

      const holderNodeIds = Array.from(new Set((storageStates ?? []).map((row) => typeof row.holder_node_id === 'string' ? row.holder_node_id : '').filter(Boolean)))
      const holderNodeMap = new Map<string, { name?: string | null; node_key?: string | null }>()

      if (holderNodeIds.length > 0) {
        const { data: holderNodes } = await supabase
          .from('storage_nodes')
          .select('id, name, node_key')
          .in('id', holderNodeIds)

        for (const node of holderNodes ?? []) {
          holderNodeMap.set(String(node.id), {
            name: typeof node.name === 'string' ? node.name : null,
            node_key: typeof node.node_key === 'string' ? node.node_key : null,
          })
        }
      }

      storageStateByProjectId = new Map((storageStates ?? []).map((row) => {
        const holderNodeId = typeof row.holder_node_id === 'string' ? row.holder_node_id : null
        const holderNode = holderNodeId ? holderNodeMap.get(holderNodeId) : null
        return [String(row.project_id), {
          location_mode: row.location_mode === 'node_local' ? 'node_local' : 'r2',
          holder_node_id: holderNodeId,
          holder_node_name: holderNode?.name ?? null,
          holder_node_key: holderNode?.node_key ?? null,
        }]
      }))
    }

    const projectsWithStats = await Promise.all((data ?? []).map(async (row) => {
      const projectId = String(row.id ?? '')

      const { count: photoCount, error: photoError } = await supabase
        .from('photos')
        .select('global_photo_id', { count: 'exact', head: true })
        .eq('project_id', projectId)

      if (photoError) throw new Error(photoError.message)

      const { data: photoRowsForFiles, error: photoRowsError } = await supabase
        .from('photos')
        .select('global_photo_id')
        .eq('project_id', projectId)

      if (photoRowsError) throw new Error(photoRowsError.message)

      const photoIds = (photoRowsForFiles ?? [])
        .map((photo) => String(photo.global_photo_id ?? ''))
        .filter(Boolean)

      let fileRows: Array<{ file_size_bytes?: unknown }> = []
      if (photoIds.length > 0) {
        const fileRes = await supabase
          .from('photo_files')
          .select('file_size_bytes')
          .in('photo_id', photoIds)

        if (fileRes.error) {
          fileRows = []
        } else {
          fileRows = (fileRes.data ?? []) as Array<{ file_size_bytes?: unknown }>
        }
      }

      const isOwner = typeof row.created_by_admin_user_id === 'string' && row.created_by_admin_user_id === auth.id
      return mapRowToProject({
        ...(row as Record<string, unknown>),
        photo_count: photoCount ?? 0,
        storage_used_bytes: sumProjectStorageUsedBytes(fileRows),
        permissions: {
          canDelete: auth.role === 'super_admin' || isOwner,
          canManageAssignments: auth.role === 'super_admin' || isOwner,
        },
        storage_state: storageStateByProjectId.get(projectId) ?? { location_mode: 'r2', holder_node_id: null, holder_node_name: null, holder_node_key: null },
      })
    }))

    return Response.json({
      success: true,
      data: projectsWithStats,
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
    const type = typeof body.type === 'string' && PROJECT_TYPES.has(body.type)
      ? body.type
      : 'Campaign'

    if (!name) {
      return Response.json({ success: false, error: 'Project name is required' }, { status: 400 })
    }

    const projectId = randomUUID()
    const insertPayload: Record<string, unknown> = {
      id: projectId,
      name,
      client_name: clientName,
      type,
      created_by_admin_user_id: auth.id,
      ftp_ingest: {
        enabled: false,
        buffer_api_base_url: '',
        project_code: projectId,
        auto_sync_interval_seconds: 15,
      },
    }

    const { data, error } = await supabase
      .from('projects')
      .insert([insertPayload])
      .select()

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const project = data && data[0]
      ? mapRowToProject(data[0] as Record<string, unknown>)
      : null
    return Response.json({ success: true, data: project })
  } catch {
    return Response.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
