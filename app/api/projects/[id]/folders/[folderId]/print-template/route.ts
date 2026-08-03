export const runtime = 'nodejs'

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { r2 } from '@/lib/r2/client'
import { supabase } from '@/lib/supabase/server'
import { parseFolderSettings, serializeFolderSettings } from '@/lib/folderSettings'

type RouteContext = { params: Promise<{ id: string; folderId: string }> }

const TEMPLATE_RULE = {
  maxBytes: 8 * 1024 * 1024,
  mime: /^image\/(png|jpeg|jpg|webp)$/i,
}

function buildTemplateKey(projectId: string, folderId: string, fileName: string) {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.png'
  return `projects/${projectId}/folders/${folderId}/print-template${ext}`
}

function buildPublicUrl(key: string) {
  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return `${base}/${key}`
}

function resolveStoredKey(asset: { object_key?: string; url?: string }) {
  const publicBase = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  if (asset.object_key) return asset.object_key
  const rawUrl = asset.url || ''
  if (publicBase && rawUrl.startsWith(`${publicBase}/`)) {
    return rawUrl.slice(publicBase.length + 1)
  }
  return rawUrl
}

async function loadFolder(projectId: string, folderId: string) {
  const { data, error } = await supabase
    .from('project_folders')
    .select('id, folder_kind, settings')
    .eq('project_id', projectId)
    .eq('id', folderId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id, folderId } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const folder = await loadFolder(id, folderId)
    if (!folder) return Response.json({ success: false, error: 'Folder not found' }, { status: 404 })

    const settings = parseFolderSettings(folder.settings)
    const asset = settings.print.template_asset
    if (!asset) {
      return Response.json({ success: false, error: 'Template not configured' }, { status: 404 })
    }

    const key = resolveStoredKey(asset)
    const response = await r2.send(new GetObjectCommand({
      Bucket: asset.bucket_name || process.env.R2_BUCKET_NAME!,
      Key: key,
    }))

    if (!response.Body) {
      return Response.json({ success: false, error: 'Template body missing' }, { status: 404 })
    }

    const bytes = await response.Body.transformToByteArray()
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': response.ContentType || asset.mime_type || 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id, folderId } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const folder = await loadFolder(id, folderId)
    if (!folder) return Response.json({ success: false, error: 'Folder not found' }, { status: 404 })
    if (folder.folder_kind !== 'print') {
      return Response.json({ success: false, error: 'Only print albums can store print templates' }, { status: 400 })
    }

    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) {
      return Response.json({ success: false, error: 'Missing template file' }, { status: 400 })
    }
    if (file.size > TEMPLATE_RULE.maxBytes) {
      return Response.json({ success: false, error: 'File too large' }, { status: 400 })
    }
    if (!TEMPLATE_RULE.mime.test(file.type || '')) {
      return Response.json({ success: false, error: 'Invalid file type' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const key = buildTemplateKey(id, folderId, file.name)
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    }))

    const settings = parseFolderSettings(folder.settings)
    settings.print.template_asset = {
      url: buildPublicUrl(key),
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_size_bytes: file.size,
      version_token: new Date().toISOString(),
      bucket_name: process.env.R2_BUCKET_NAME!,
      object_key: key,
    }

    const { error: updateError } = await supabase
      .from('project_folders')
      .update({ settings: serializeFolderSettings(settings) })
      .eq('id', folderId)
      .eq('project_id', id)

    if (updateError) {
      return Response.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return Response.json({ success: true, data: { templateAsset: settings.print.template_asset } })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id, folderId } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const folder = await loadFolder(id, folderId)
    if (!folder) return Response.json({ success: false, error: 'Folder not found' }, { status: 404 })

    const settings = parseFolderSettings(folder.settings)
    const asset = settings.print.template_asset
    if (asset) {
      const key = resolveStoredKey(asset)
      if (key) {
        await r2.send(new DeleteObjectCommand({
          Bucket: asset.bucket_name || process.env.R2_BUCKET_NAME!,
          Key: key,
        })).catch(() => undefined)
      }
    }

    settings.print.template_asset = null
    const { error: updateError } = await supabase
      .from('project_folders')
      .update({ settings: serializeFolderSettings(settings) })
      .eq('id', folderId)
      .eq('project_id', id)

    if (updateError) {
      return Response.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
