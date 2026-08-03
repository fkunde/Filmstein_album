import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { mapRowToPrintQueueItem, type PrintQueueItemRow } from '@/lib/printQueue'
import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

async function loadQueueItem(projectId: string, itemId: string) {
  const { data, error } = await supabase
    .from('print_queue_items')
    .select('*')
    .eq('project_id', projectId)
    .eq('id', itemId)
    .maybeSingle<PrintQueueItemRow>()

  if (error) throw error
  return data
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId, itemId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const current = await loadQueueItem(projectId, itemId)
    if (!current) {
      return Response.json({ success: false, error: 'Queue item not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const updates: Record<string, unknown> = {}
    const nextStatus = typeof body?.status === 'string' ? body.status.trim() : null
    const nextRequestedCopies = body?.requestedCopies === undefined ? null : Math.max(1, Math.floor(Number(body.requestedCopies) || 1))
    const errorMessage = typeof body?.errorMessage === 'string' ? body.errorMessage.trim() : ''

    if (nextRequestedCopies !== null) {
      if (current.status !== 'queued') {
        return Response.json({ success: false, error: 'Only queued items can change requested copies' }, { status: 400 })
      }
      updates.requested_copies = nextRequestedCopies
      updates.completed_copies = Math.min(Number(current.completed_copies) || 0, nextRequestedCopies)
    }

    if (nextStatus) {
      const now = new Date().toISOString()
      if (nextStatus === 'cancelled') {
        if (current.status !== 'queued') {
          return Response.json({ success: false, error: 'Only queued items can be cancelled' }, { status: 400 })
        }
        updates.status = 'cancelled'
        updates.completed_at = now
      } else if (nextStatus === 'printing') {
        if (current.status !== 'queued') {
          return Response.json({ success: false, error: 'Only queued items can move to printing' }, { status: 400 })
        }
        updates.status = 'printing'
        updates.started_at = current.started_at || now
        updates.error_message = null
      } else if (nextStatus === 'completed') {
        if (current.status !== 'queued' && current.status !== 'printing') {
          return Response.json({ success: false, error: 'Only queued or printing items can be completed' }, { status: 400 })
        }
        const completedCopies = Math.max(1, Math.min(
          Math.floor(Number(body?.completedCopies) || Number(current.requested_copies) || 1),
          Number(updates.requested_copies ?? current.requested_copies) || 1,
        ))
        updates.status = 'completed'
        updates.started_at = current.started_at || now
        updates.completed_at = now
        updates.completed_copies = completedCopies
        updates.error_message = null
      } else if (nextStatus === 'failed') {
        if (current.status !== 'queued' && current.status !== 'printing') {
          return Response.json({ success: false, error: 'Only queued or printing items can fail' }, { status: 400 })
        }
        updates.status = 'failed'
        updates.started_at = current.started_at || now
        updates.completed_at = now
        updates.error_message = errorMessage || current.error_message || 'Queue item failed'
      } else {
        return Response.json({ success: false, error: 'Invalid queue status' }, { status: 400 })
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: false, error: 'No changes provided' }, { status: 400 })
    }

    const completingCopies = updates.status === 'completed'
      ? Math.max(0, Number(updates.completed_copies) || 0)
      : null

    if (completingCopies !== null) {
      const delta = Math.max(0, completingCopies - (Number(current.completed_copies) || 0))
      if (delta > 0) {
        const { data: photoRow, error: photoError } = await supabase
          .from('photos')
          .select('print_count')
          .eq('global_photo_id', current.photo_id)
          .eq('project_id', projectId)
          .maybeSingle()

        if (photoError) {
          return Response.json({ success: false, error: photoError.message }, { status: 500 })
        }
        if (!photoRow) {
          return Response.json({ success: false, error: 'Photo not found' }, { status: 404 })
        }

        const nextPrintCount = (Number(photoRow.print_count) || 0) + delta
        const lastPrintedAt = String(updates.completed_at || new Date().toISOString())
        const { error: photoUpdateError } = await supabase
          .from('photos')
          .update({
            print_count: nextPrintCount,
            last_printed_at: lastPrintedAt,
          })
          .eq('global_photo_id', current.photo_id)
          .eq('project_id', projectId)

        if (photoUpdateError) {
          return Response.json({ success: false, error: photoUpdateError.message }, { status: 500 })
        }
      }
    }

    const { data: updatedRow, error: updateError } = await supabase
      .from('print_queue_items')
      .update(updates)
      .eq('project_id', projectId)
      .eq('id', itemId)
      .select('*')
      .single<PrintQueueItemRow>()

    if (updateError) {
      return Response.json({ success: false, error: updateError.message }, { status: 500 })
    }

    let photoData: { photoId: string; printCount: number; lastPrintedAt: string | null } | null = null
    if (updates.status === 'completed') {
      const { data: refreshedPhoto, error: refreshedPhotoError } = await supabase
        .from('photos')
        .select('global_photo_id, print_count, last_printed_at')
        .eq('global_photo_id', current.photo_id)
        .eq('project_id', projectId)
        .maybeSingle()

      if (refreshedPhotoError) {
        return Response.json({ success: false, error: refreshedPhotoError.message }, { status: 500 })
      }
      if (refreshedPhoto) {
        photoData = {
          photoId: String(refreshedPhoto.global_photo_id),
          printCount: Number(refreshedPhoto.print_count) || 0,
          lastPrintedAt: typeof refreshedPhoto.last_printed_at === 'string' ? refreshedPhoto.last_printed_at : null,
        }
      }
    }

    return Response.json({
      success: true,
      data: {
        item: mapRowToPrintQueueItem(updatedRow),
        photo: photoData,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
