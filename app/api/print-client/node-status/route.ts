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
    const nodeKey = typeof body?.nodeKey === 'string' ? body.nodeKey.trim() : ''
    if (!token || !nodeKey) {
      return Response.json({ success: false, error: 'token and nodeKey are required' }, { status: 400 })
    }

    const client = createPrintClientSupabase(token)
    const binding = await resolvePrintClientBinding(token, client)
    if (!binding) {
      return Response.json({ success: false, error: 'Invalid print client token' }, { status: 404 })
    }

    const payload = {
      project_id: binding.projectId,
      folder_id: binding.folderId,
      node_key: nodeKey,
      client_name: typeof body?.clientName === 'string' ? body.clientName.trim() : null,
      app_version: typeof body?.appVersion === 'string' ? body.appVersion.trim() : null,
      platform: typeof body?.platform === 'string' ? body.platform.trim() : null,
      printer_status: body?.printerStatus === 'unavailable' || body?.printerStatus === 'idle' || body?.printerStatus === 'printing' || body?.printerStatus === 'paused' || body?.printerStatus === 'error'
        ? body.printerStatus
        : 'disconnected',
      node_status: body?.nodeStatus === 'online' || body?.nodeStatus === 'degraded' ? body.nodeStatus : 'offline',
      printer_name: typeof body?.printerName === 'string' ? body.printerName.trim() : null,
      last_check_at: typeof body?.lastCheckAt === 'string' ? body.lastCheckAt : new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      last_error: typeof body?.lastError === 'string' ? body.lastError.trim() : null,
      metadata: body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
    }

    const { data: existing, error: existingError } = await client
      .from('print_client_nodes')
      .select('id')
      .eq('folder_id', binding.folderId)
      .eq('node_key', nodeKey)
      .maybeSingle()

    if (existingError) {
      return Response.json({ success: false, error: existingError.message }, { status: 500 })
    }

    const operation = existing
      ? client.from('print_client_nodes').update(payload).eq('id', existing.id).select('*').single()
      : client.from('print_client_nodes').insert([payload]).select('*').single()
    const { data, error } = await operation

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, data })
  } catch (error) {
    console.error('[print-client/node-status] failed', error)
    return Response.json({ success: false, error: formatRouteError(error) }, { status: 500 })
  }
}
