import { resolvePrintClientBinding } from '@/lib/printClient'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!token) {
      return Response.json({ success: false, error: 'token is required' }, { status: 400 })
    }

    const binding = await resolvePrintClientBinding(token)
    if (!binding) {
      return Response.json({ success: false, error: 'Invalid print client token' }, { status: 404 })
    }

    return Response.json({
      success: true,
      data: {
        token,
        projectId: binding.projectId,
        projectName: binding.projectName,
        folderId: binding.folderId,
        folderName: binding.folderName,
        printMode: binding.settings.print.mode,
        runnerStatus: binding.settings.print.runner_status,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
