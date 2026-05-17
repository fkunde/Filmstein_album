import fs from 'node:fs'
import path from 'node:path'

export const dynamic = 'force-dynamic'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/svg+xml'

export default function AppleIcon() {
  const svgPath = path.join(process.cwd(), 'public', 'branding', 'snapflare-mark.svg')
  return new Response(fs.readFileSync(svgPath), {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
