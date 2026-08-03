import { serializeFolderSettings } from '@/lib/folderSettings'
import { createPrintClientSupabase, resolvePrintClientBinding } from '@/lib/printClient'

function formatRouteError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return typeof record.message === 'string' ? record.message : JSON.stringify(record)
  }
  return typeof error === 'string' ? error : 'Server error'
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body?.token === 'string' ? body.token.trim() : req.headers.get('x-print-client-token')?.trim() || ''
    const action = body?.action === 'start' ? 'start' : body?.action === 'pause' ? 'pause' : ''
    if (!token || !action) {
      return Response.json({ success: false, error: 'token and action are required' }, { status: 400 })
    }

    const client = createPrintClientSupabase(token)
    const binding = await resolvePrintClientBinding(token, client)
    if (!binding) {
      return Response.json({ success: false, error: 'Invalid print client token' }, { status: 404 })
    }

    const settings = binding.settings
    settings.print.runner_status = action === 'start' ? 'running' : 'paused'

    const { error } = await client
      .from('project_folders')
      .update({ settings: serializeFolderSettings(settings) })
      .eq('id', binding.folderId)
      .eq('project_id', binding.projectId)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: {
        runnerStatus: settings.print.runner_status,
        printMode: settings.print.mode,
      },
    })
  } catch (error) {
    console.error('[print-client/runner] failed', error)
    return Response.json({ success: false, error: formatRouteError(error) }, { status: 500 })
  }
}
