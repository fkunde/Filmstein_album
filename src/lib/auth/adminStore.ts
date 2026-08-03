import { randomBytes } from 'node:crypto'

import { supabase, hasSupabaseServiceRoleKey } from '@/lib/supabase/server'

export type AdminRole = 'super_admin' | 'admin'

export type AdminUserRecord = {
  id: string
  short_id: string
  username: string
  password: string
  is_active: boolean
  role: AdminRole
}

export type AdminUserPublicRecord = Omit<AdminUserRecord, 'password'>

export type AdminInviteCodeRecord = {
  id: string
  code: string
  role: AdminRole
  is_active: boolean
  expires_at: string | null
  created_at: string
  created_by_admin_user_id: string | null
  used_by_admin_user_id: string | null
  used_at: string | null
  used_by_username: string | null
}

function normalizeRole(value: unknown): AdminRole {
  return value === 'super_admin' ? 'super_admin' : 'admin'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeDbUser(row: Record<string, unknown>): AdminUserRecord {
  const password = typeof row.password === 'string'
    ? row.password
    : typeof row.password_hash === 'string'
      ? row.password_hash
      : ''

  return {
    id: String(row.id ?? ''),
    short_id: typeof row.short_id === 'string' ? row.short_id : '',
    username: typeof row.username === 'string' ? row.username : '',
    password,
    is_active: row.is_active !== false,
    role: normalizeRole(row.role),
  }
}

function normalizePublicUser(row: Record<string, unknown>): AdminUserPublicRecord {
  return {
    id: String(row.id ?? ''),
    short_id: typeof row.short_id === 'string' ? row.short_id : '',
    username: typeof row.username === 'string' ? row.username : '',
    is_active: row.is_active !== false,
    role: normalizeRole(row.role),
  }
}

function normalizeInviteCode(row: Record<string, unknown>): AdminInviteCodeRecord {
  const usedBy = row.used_by_admin_users
  const usedByUser = typeof usedBy === 'object' && usedBy !== null ? usedBy as Record<string, unknown> : null
  const directUsedByUsername = typeof row.used_by_username === 'string' ? row.used_by_username : null

  return {
    id: String(row.id ?? ''),
    code: typeof row.code === 'string' ? row.code : '',
    role: normalizeRole(row.role),
    is_active: row.is_active !== false,
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    created_by_admin_user_id: typeof row.created_by_admin_user_id === 'string' ? row.created_by_admin_user_id : null,
    used_by_admin_user_id: typeof row.used_by_admin_user_id === 'string' ? row.used_by_admin_user_id : null,
    used_at: typeof row.used_at === 'string' ? row.used_at : null,
    used_by_username: directUsedByUsername ?? (typeof usedByUser?.username === 'string' ? usedByUser.username : null),
  }
}

export async function authenticateAdminUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase()

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .ilike('username', normalizedUsername)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('authenticate_admin_user', {
    input_username: normalizedUsername,
    input_password: password,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? normalizeDbUser(row as Record<string, unknown>) : null
}

export async function findAdminUserById(id: string) {
  const normalizedId = id.trim()
  if (!isUuid(normalizedId)) {
    return null
  }

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .eq('id', normalizedId)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('get_admin_user_by_id', {
    input_id: normalizedId,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { ...normalizePublicUser(row as Record<string, unknown>), password: '' } : null
}

export async function findAdminUserByShortId(shortId: string) {
  const normalizedShortId = shortId.trim().toUpperCase()
  if (!normalizedShortId) return null

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .eq('short_id', normalizedShortId)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('get_admin_user_by_short_id', {
    input_short_id: normalizedShortId,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { ...normalizePublicUser(row as Record<string, unknown>), password: '' } : null
}

export async function listAdminUsers() {
  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, is_active, role')
      .order('username', { ascending: true })

    if (error) throw error

    return (data ?? []).map((row) => normalizePublicUser(row as Record<string, unknown>))
  }

  const { data, error } = await supabase.rpc('list_admin_users_public')
  if (error) throw error
  return (Array.isArray(data) ? data : []).map((row) => normalizePublicUser(row as Record<string, unknown>))
}

export async function updateAdminUser(id: string, updates: { isActive?: boolean; role?: AdminRole }, requestedByAdminUserId?: string) {
  if (!hasSupabaseServiceRoleKey) {
    if (!requestedByAdminUserId) {
      throw new Error('Admin user management requires SUPABASE_SERVICE_ROLE_KEY')
    }

    const { data, error } = await supabase.rpc('update_admin_user_for_super_admin', {
      input_requesting_admin_user_id: requestedByAdminUserId,
      input_target_admin_user_id: id,
      input_role: updates.role ?? null,
      input_is_active: typeof updates.isActive === 'boolean' ? updates.isActive : null,
    })

    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    return row ? normalizePublicUser(row as Record<string, unknown>) : null
  }

  const payload: Record<string, unknown> = {}
  if (typeof updates.isActive === 'boolean') payload.is_active = updates.isActive
  if (updates.role) payload.role = updates.role

  if (Object.keys(payload).length === 0) {
    return findAdminUserById(id)
  }

  const { data, error } = await supabase
    .from('admin_users')
    .update(payload)
    .eq('id', id)
    .select('id, short_id, username, is_active, role')
    .maybeSingle()

  if (error) throw error
  return data ? normalizePublicUser(data as Record<string, unknown>) : null
}

export async function listAdminInviteCodes(requestedByAdminUserId?: string) {
  if (!hasSupabaseServiceRoleKey) {
    if (!requestedByAdminUserId) {
      throw new Error('Invite code management requires SUPABASE_SERVICE_ROLE_KEY')
    }

    const { data, error } = await supabase.rpc('list_admin_invite_codes_for_super_admin', {
      input_requesting_admin_user_id: requestedByAdminUserId,
    })

    if (error) throw error
    return (Array.isArray(data) ? data : []).map((row) => normalizeInviteCode(row as Record<string, unknown>))
  }

  const { data, error } = await supabase
    .from('admin_invite_codes')
    .select('id, code, role, is_active, expires_at, created_at, created_by_admin_user_id, used_by_admin_user_id, used_at, used_by_admin_users:used_by_admin_user_id(username)')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => normalizeInviteCode(row as Record<string, unknown>))
}

export async function createAdminInviteCode(createdByAdminUserId: string, role: AdminRole = 'admin') {
  if (!hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase.rpc('create_admin_invite_code_for_super_admin', {
      input_requesting_admin_user_id: createdByAdminUserId,
      input_role: role,
    })

    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    return row ? normalizeInviteCode(row as Record<string, unknown>) : null
  }

  const code = `SF-${randomBytes(5).toString('hex').toUpperCase()}`
  const { data, error } = await supabase
    .from('admin_invite_codes')
    .insert([{ code, role, created_by_admin_user_id: createdByAdminUserId, is_active: true }])
    .select('id, code, role, is_active, expires_at, created_at, created_by_admin_user_id, used_by_admin_user_id, used_at')
    .maybeSingle()

  if (error) throw error
  return data ? normalizeInviteCode(data as Record<string, unknown>) : null
}

export async function findUsableAdminInviteCode(code: string) {
  if (!hasSupabaseServiceRoleKey) {
    return null
  }

  const normalizedCode = code.trim().toUpperCase()
  const { data, error } = await supabase
    .from('admin_invite_codes')
    .select('id, code, role, is_active, expires_at, used_by_admin_user_id')
    .ilike('code', normalizedCode)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as Record<string, unknown>
  const expiresAt = typeof row.expires_at === 'string' ? new Date(row.expires_at) : null
  if (row.is_active === false) return null
  if (typeof row.used_by_admin_user_id === 'string' && row.used_by_admin_user_id.length > 0) return null
  if (expiresAt && expiresAt.getTime() <= Date.now()) return null
  return normalizeInviteCode(row)
}

export async function markAdminInviteCodeUsed(codeId: string, usedByAdminUserId: string) {
  if (!hasSupabaseServiceRoleKey) {
    throw new Error('Invite code management requires SUPABASE_SERVICE_ROLE_KEY')
  }

  const { error } = await supabase
    .from('admin_invite_codes')
    .update({ used_by_admin_user_id: usedByAdminUserId, used_at: new Date().toISOString(), is_active: false })
    .eq('id', codeId)

  if (error) throw error
}
