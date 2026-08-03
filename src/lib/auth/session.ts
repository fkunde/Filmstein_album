import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { type AdminRole, findAdminUserById } from '@/lib/auth/adminStore'

export const ADMIN_SESSION_COOKIE = 'snapflare_admin_session'
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const LOCAL_SESSION_SECRET_PATH = path.join(process.cwd(), 'storage', 'admin-session-secret.txt')

type SessionPayload = {
  sub: string
  usr: string
  exp: number
}

export type AuthenticatedAdminUser = {
  id: string
  shortId: string
  username: string
  role: AdminRole
}

function getOrCreateLocalSessionSecret() {
  if (existsSync(LOCAL_SESSION_SECRET_PATH)) {
    return readFileSync(LOCAL_SESSION_SECRET_PATH, 'utf8').trim()
  }

  mkdirSync(path.dirname(LOCAL_SESSION_SECRET_PATH), { recursive: true })
  const generated = randomBytes(32).toString('base64url')
  writeFileSync(LOCAL_SESSION_SECRET_PATH, generated, 'utf8')
  return generated
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || getOrCreateLocalSessionSecret()
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url')
}

function parseSessionToken(token: string): SessionPayload | null {
  const [payloadPart, signaturePart] = token.split('.')
  if (!payloadPart || !signaturePart) return null

  const expectedSignature = sign(payloadPart)
  const providedBuffer = Buffer.from(signaturePart)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload = JSON.parse(decodeBase64Url(payloadPart)) as SessionPayload
    if (!payload?.sub || !payload?.usr || !payload?.exp) return null
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function buildSessionToken(user: AuthenticatedAdminUser) {
  const payload: SessionPayload = {
    sub: user.id,
    usr: user.username,
    exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS,
  }

  const payloadPart = encodeBase64Url(JSON.stringify(payload))
  const signaturePart = sign(payloadPart)
  return `${payloadPart}.${signaturePart}`
}

async function readSessionPayload() {
  const cookieStore = await cookies()
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  if (!token) return null
  return parseSessionToken(token)
}

export async function getAuthenticatedAdminUser(): Promise<AuthenticatedAdminUser | null> {
  const payload = await readSessionPayload()
  if (!payload) return null

  const adminUser = await findAdminUserById(payload.sub)
  if (!adminUser || adminUser.is_active !== true) {
    return null
  }

  return {
    id: adminUser.id,
    shortId: adminUser.short_id,
    username: typeof adminUser.username === 'string' ? adminUser.username : payload.usr,
    role: adminUser.role,
  }
}

export async function createAdminSession(user: AuthenticatedAdminUser) {
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_SESSION_COOKIE, buildSessionToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  })
}

export async function clearAdminSession() {
  const cookieStore = await cookies()
  cookieStore.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  })
}

export async function requireAdminPageAuth(nextPath: string) {
  const user = await getAuthenticatedAdminUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`)
  }
  return user
}

export async function requireAdminApiAuth() {
  const user = await getAuthenticatedAdminUser()
  if (!user) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return user
}

export async function requireSuperAdminPageAuth(nextPath: string) {
  const user = await requireAdminPageAuth(nextPath)
  if (user.role !== 'super_admin') {
    redirect('/dashboard')
  }
  return user
}

export async function requireSuperAdminApiAuth() {
  const user = await requireAdminApiAuth()
  if (user instanceof Response) return user
  if (user.role !== 'super_admin') {
    return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }
  return user
}
