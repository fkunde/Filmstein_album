import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

export const size = {
  width: 64,
  height: 64,
}

export const contentType = 'image/svg+xml'

export default function Icon() {
  const svgPath = path.join(process.cwd(), 'public', 'branding', 'snapflare-mark.svg')
  return new Response(fs.readFileSync(svgPath), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
