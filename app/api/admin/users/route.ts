import { createAdminInviteCode, listAdminInviteCodes, listAdminUsers, type AdminInviteCodeRecord, type AdminRole } from '@/lib/auth/adminStore'
import { requireSuperAdminApiAuth } from '@/lib/auth/session'

function normalizeRole(value: unknown): AdminRole {
  return value === 'super_admin' ? 'super_admin' : 'admin'
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Invite code data is unavailable'
}

export async function GET() {
  try {
    const auth = await requireSuperAdminApiAuth()
    if (auth instanceof Response) return auth

    const users = await listAdminUsers()
    let inviteCodes: AdminInviteCodeRecord[] = []
    let warning: string | null = null

    try {
      inviteCodes = await listAdminInviteCodes(auth.id)
    } catch (error) {
      const message = getErrorMessage(error)
      warning = message.includes('list_admin_invite_codes_for_super_admin')
        ? 'Run the latest admin invite SQL migration to enable invite code data.'
        : message
    }

    return Response.json({ success: true, data: { users, inviteCodes }, warning })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdminApiAuth()
    if (auth instanceof Response) return auth

    const body = await req.json().catch(() => ({}))
    const inviteCode = await createAdminInviteCode(auth.id, normalizeRole(body?.role))

    return Response.json({ success: true, data: inviteCode })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
