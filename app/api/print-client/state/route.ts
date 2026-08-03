import { loadPrintClientStateByToken } from '@/lib/printClient'

function formatRouteError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return typeof record.message === 'string' ? record.message : JSON.stringify(record)
  }
  return typeof error === 'string' ? error : 'Server error'
}

function readToken(req: Request) {
  return req.headers.get('x-print-client-token')?.trim() || new URL(req.url).searchParams.get('token')?.trim() || ''
}

export async function GET(req: Request) {
  try {
    const token = readToken(req)
    if (!token) {
      return Response.json({ success: false, error: 'Missing print client token' }, { status: 401 })
    }

    const state = await loadPrintClientStateByToken(token)
    if (!state) {
      return Response.json({ success: false, error: 'Invalid print client token' }, { status: 404 })
    }

    return Response.json({ success: true, data: state })
  } catch (error) {
    console.error('[print-client/state] failed', error)
    return Response.json({ success: false, error: formatRouteError(error) }, { status: 500 })
  }
}
