export const runtime = 'nodejs'

import { loadPrintPhotoByCode } from '@/lib/printFlow'

type RouteContext = { params: Promise<{ printCode: string }> }

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { printCode } = await context.params
    const printPhoto = await loadPrintPhotoByCode(printCode)
    if (!printPhoto) {
      return Response.json({ success: false, error: 'Print code not found' }, { status: 404 })
    }

    const sourceUrl = printPhoto.photo.originalUrl || printPhoto.photo.retouchedOriginalUrl || printPhoto.photo.displayUrl || printPhoto.photo.file_url || printPhoto.photo.url
    if (!sourceUrl) {
      return Response.json({ success: false, error: 'Original source unavailable' }, { status: 404 })
    }

    const upstream = await fetch(sourceUrl)
    if (!upstream.ok || !upstream.body) {
      return Response.json({ success: false, error: 'Failed to fetch original source' }, { status: 502 })
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(printPhoto.downloadName)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
