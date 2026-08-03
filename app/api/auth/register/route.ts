import { createAdminSession } from '@/lib/auth/session'
import { supabase } from '@/lib/supabase/server'

function normalizeNextPath(nextPath: unknown) {
  if (typeof nextPath !== 'string' || !nextPath.startsWith('/')) return '/'
  if (nextPath.startsWith('//')) return '/'
  return nextPath
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const inviteCode = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : ''
    const nextPath = normalizeNextPath(body?.next)

    if (!username || !password || !inviteCode) {
      return Response.json({ success: false, error: 'Username, password, and invite code are required' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('register_admin_user', {
      input_username: username,
      input_password: password,
      input_invite_code: inviteCode,
    })

    if (error) {
      if (error.message.includes('INVITE_CODE_INVALID')) {
        return Response.json({ success: false, error: 'Invalid invite code' }, { status: 403 })
      }
      if (error.message.includes('USERNAME_TAKEN')) {
        return Response.json({ success: false, error: 'Username already exists' }, { status: 409 })
      }
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      return Response.json({ success: false, error: 'Registration failed' }, { status: 500 })
    }

    await createAdminSession({
      id: String(row.id ?? ''),
      shortId: typeof row.short_id === 'string' ? row.short_id : '',
      username: typeof row.username === 'string' ? row.username : username,
      role: row.role === 'super_admin' ? 'super_admin' : 'admin',
    })

    return Response.json({ success: true, next: nextPath })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
