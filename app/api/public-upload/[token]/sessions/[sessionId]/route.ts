import { supabase } from '@/lib/supabase/server'
import { findFolderByCustomerUploadToken } from '@/lib/folderSettings'

export async function GET(_req: Request, context: { params: Promise<{ token: string; sessionId: string }> }) {
  try {
    const { token, sessionId } = await context.params
    const folder = await findFolderByCustomerUploadToken(token)
    if (!folder) {
      return Response.json({ success: false, error: 'Upload link not found or disabled' }, { status: 404 })
    }

    const { data: session, error } = await supabase
      .from('upload_sessions')
      .select('id, project_id, folder_id, file_name, status, processing_error, result_photo_id, completed_at, created_at, updated_at')
      .eq('id', sessionId)
      .eq('upload_source', 'customer_qr')
      .maybeSingle()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }
    if (!session || String(session.project_id) !== folder.project_id || String(session.folder_id || '') !== folder.id) {
      return Response.json({ success: false, error: 'Upload session not found' }, { status: 404 })
    }

    return Response.json({ success: true, data: session })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
