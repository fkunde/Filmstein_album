import QRCode from 'qrcode'
import sharp from 'sharp'

import type { FolderSettings, FolderPrintTemplateAsset } from '@/lib/folderSettings'

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function getPrintQrLayout(params: {
  width: number
  height: number
  sizeRatio: number
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  offsetX: number
  offsetY: number
}) {
  const shortSide = Math.max(1, Math.min(params.width, params.height))
  const qrSize = clampInt(shortSide * params.sizeRatio, 80, Math.max(80, Math.round(shortSide * 0.5)))
  const margin = clampInt(shortSide * 0.04, 12, 120)
  const moveX = Math.round(params.width * (params.offsetX / 100))
  const moveY = Math.round(params.height * (params.offsetY / 100))

  let left = params.width - qrSize - margin + moveX
  let top = params.height - qrSize - margin + moveY

  if (params.position === 'top-left') {
    left = margin + moveX
    top = margin + moveY
  } else if (params.position === 'top-right') {
    left = params.width - qrSize - margin + moveX
    top = margin + moveY
  } else if (params.position === 'bottom-left') {
    left = margin + moveX
    top = params.height - qrSize - margin + moveY
  } else if (params.position === 'center') {
    left = Math.round((params.width - qrSize) / 2) + moveX
    top = Math.round((params.height - qrSize) / 2) + moveY
  }

  return {
    size: qrSize,
    left: clampInt(left, 0, Math.max(0, params.width - qrSize)),
    top: clampInt(top, 0, Math.max(0, params.height - qrSize)),
  }
}

export async function fetchTemplateAssetBuffer(asset: FolderPrintTemplateAsset | null) {
  if (!asset?.url) return null
  const response = await fetch(asset.url)
  if (!response.ok) {
    throw new Error(`template fetch failed (${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function buildPrintQrBuffer(url: string, size: number) {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: size,
    color: {
      dark: '#111111ff',
      light: '#ffffffff',
    },
    errorCorrectionLevel: 'M',
  })
}

export async function buildPrintPreview(params: {
  sourceBuffer: Buffer
  templateBuffer?: Buffer | null
  qrTargetUrl: string
  folderSettings: FolderSettings
  mode?: 'preview' | 'download'
}) {
  const mode = params.mode ?? 'preview'
  const normalizedSource = sharp(params.sourceBuffer).rotate()
  const baseMeta = await normalizedSource.metadata()
  const width = baseMeta.width || 1600
  const height = baseMeta.height || 1200
  const composites: sharp.OverlayOptions[] = []

  if (params.templateBuffer) {
    const templatePng = await sharp(params.templateBuffer)
      .rotate()
      .resize({ width, height, fit: 'fill' })
      .png()
      .toBuffer()
    composites.push({ input: templatePng, left: 0, top: 0, blend: 'over' })
  }

  if (params.folderSettings.print.qr.enabled) {
    const qrLayout = getPrintQrLayout({
      width,
      height,
      sizeRatio: params.folderSettings.print.qr.size_ratio,
      position: params.folderSettings.print.qr.position,
      offsetX: params.folderSettings.print.qr.offset_x,
      offsetY: params.folderSettings.print.qr.offset_y,
    })
    const qrBuffer = await buildPrintQrBuffer(params.qrTargetUrl, qrLayout.size)
    composites.push({ input: qrBuffer, left: qrLayout.left, top: qrLayout.top, blend: 'over' })
  }

  return Buffer.from(await normalizedSource
    .clone()
    .composite(composites)
    .jpeg({ quality: mode === 'download' ? 92 : 86, mozjpeg: true })
    .toBuffer())
}
