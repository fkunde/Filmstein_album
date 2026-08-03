export const runtime = 'nodejs'

import { requireAdminApiAuth } from '@/lib/auth/session'
import { buildPrintPreview, fetchTemplateAssetBuffer } from '@/lib/printPreview'
import { loadPrintPhotoById } from '@/lib/printFlow'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import type { FolderSettings } from '@/lib/folderSettings'

type RouteContext = { params: Promise<{ id: string }> }

function getDefaultFolderSettings(): FolderSettings {
  return {
    customer_upload: {
      enabled: false,
      default_public: true,
      require_public_choice: true,
      token: '',
    },
    routing: {
      prefix_rules: [],
    },
    print: {
      mode: 'manual' as const,
      runner_status: 'paused' as const,
      client_token: '',
      template_asset: null,
      qr: {
        enabled: true,
        position: 'bottom-right' as const,
        size_ratio: 0.18,
        offset_x: 0,
        offset_y: 0,
      },
    },
  }
}

export async function GET(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const printPhoto = await loadPrintPhotoById(id)
    if (!printPhoto) {
      return Response.json({ success: false, error: 'Photo not found' }, { status: 404 })
    }
    const permission = await getProjectPermissionContext(auth, printPhoto.row.project_id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const sourceUrl = printPhoto.photo.originalUrl || printPhoto.photo.retouchedOriginalUrl || printPhoto.photo.displayUrl || printPhoto.photo.file_url || printPhoto.photo.url
    if (!sourceUrl) {
      return Response.json({ success: false, error: 'Photo source unavailable' }, { status: 404 })
    }

    const sourceResponse = await fetch(sourceUrl)
    if (!sourceResponse.ok) {
      return Response.json({ success: false, error: 'Failed to fetch source image' }, { status: 502 })
    }

    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
    const templateBuffer = await fetchTemplateAssetBuffer(printPhoto.folder?.settings.print.template_asset ?? null)
    const qrTargetUrl = new URL(`/print/p/${printPhoto.photo.printCode || id}`, req.url).toString()
    const imageBuffer = await buildPrintPreview({
      sourceBuffer,
      templateBuffer,
      qrTargetUrl,
      folderSettings: printPhoto.folder?.settings ?? getDefaultFolderSettings(),
      mode: 'preview',
    })

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
