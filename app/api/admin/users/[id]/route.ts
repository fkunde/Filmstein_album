import { updateAdminUser, type AdminRole } from '@/lib/auth/adminStore'
import { requireSuperAdminApiAuth } from '@/lib/auth/session'

type RouteContext = { params: Promise<{ id: string }> }

function normalizeRole(value: unknown): AdminRole | undefined {
  if (value === 'super_admin') return 'super_admin'
  if (value === 'admin') return 'admin'
  return undefined
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const auth = await requireSuperAdminApiAuth()
    if (auth instanceof Response) return auth

    const { id } = await context.params
    const body = await req.json().catch(() => ({}))
    const role = normalizeRole(body?.role)
    const isActive = typeof body?.isActive === 'boolean' ? body.isActive : undefined

    if (id === auth.id && isActive === false) {
      return Response.json({ success: false, error: 'You cannot deactivate your own account' }, { status: 400 })
    }
    if (id === auth.id && role === 'admin') {
      return Response.json({ success: false, error: 'You cannot remove your own super admin role' }, { status: 400 })
    }

    const user = await updateAdminUser(id, { role, isActive }, auth.id)
    if (!user) {
      return Response.json({ success: false, error: 'User not found' }, { status: 404 })
    }

    return Response.json({ success: true, data: user })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
