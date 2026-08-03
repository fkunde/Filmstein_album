import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { loadPrintPhotoById } from '@/lib/printFlow'
import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: photoId } = await context.params
    const body = await req.json().catch(() => ({}))
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''

    if (!projectId) {
      return Response.json({ success: false, error: 'projectId is required' }, { status: 400 })
    }

    const printPhoto = await loadPrintPhotoById(photoId)
    if (!printPhoto) {
      return Response.json({ success: false, error: 'Photo not found' }, { status: 404 })
    }
    if (printPhoto.row.project_id !== projectId) {
      return Response.json({ success: false, error: 'Photo does not belong to this project' }, { status: 400 })
    }
    if (printPhoto.folder?.folderKind !== 'print') {
      return Response.json({ success: false, error: 'Manual print is only available for print albums' }, { status: 400 })
    }

    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const nextPrintCount = (printPhoto.photo.printCount ?? 0) + 1
    const nextLastPrintedAt = new Date().toISOString()

    const { error } = await supabase
      .from('photos')
      .update({
        print_count: nextPrintCount,
        last_printed_at: nextLastPrintedAt,
      })
      .eq('global_photo_id', photoId)
      .eq('project_id', projectId)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: {
        photoId,
        printCount: nextPrintCount,
        lastPrintedAt: nextLastPrintedAt,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
