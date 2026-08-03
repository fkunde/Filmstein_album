import { randomBytes } from 'node:crypto'

import { supabase } from '@/lib/supabase/server'

export type FolderKind = 'standard' | 'print'
export type PrintMode = 'manual' | 'semi_auto' | 'auto'
export type PrintRunnerStatus = 'running' | 'paused'
export type UploadSource = 'admin' | 'ftp' | 'customer_qr'
export type PrintQrPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

export type FolderPrintTemplateAsset = {
  url?: string
  file_name?: string
  mime_type?: string
  file_size_bytes?: number
  version_token?: string
  bucket_name?: string
  object_key?: string
}

export type PrefixRule = {
  prefix: string
  enabled?: boolean
  sources?: UploadSource[]
}

export type FolderSettings = {
  customer_upload: {
    enabled: boolean
    default_public: boolean
    require_public_choice: boolean
    token: string
  }
  routing: {
    prefix_rules: PrefixRule[]
  }
  print: {
    mode: PrintMode
    runner_status: PrintRunnerStatus
    client_token: string
    template_asset: FolderPrintTemplateAsset | null
    qr: {
      enabled: boolean
      position: PrintQrPosition
      size_ratio: number
      offset_x: number
      offset_y: number
    }
  }
}

type FolderSettingsRecord = Record<string, unknown>

function asRecord(value: unknown): FolderSettingsRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as FolderSettingsRecord
    : null
}

export function buildCustomerUploadToken() {
  return randomBytes(18).toString('base64url')
}

export function buildPrintClientToken() {
  return randomBytes(24).toString('base64url')
}

export function normalizeFolderKind(value: unknown): FolderKind {
  return value === 'print' ? 'print' : 'standard'
}

export function normalizePrintMode(value: unknown): PrintMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'manual'
}

export function normalizePrintRunnerStatus(value: unknown): PrintRunnerStatus {
  return value === 'running' ? 'running' : 'paused'
}

function normalizePrintQrPosition(value: unknown): PrintQrPosition {
  return value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'center'
    ? value
    : 'bottom-right'
}

function clampPrintQrSizeRatio(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0.18
  return Math.min(0.35, Math.max(0.08, numeric))
}

function normalizeTemplateAsset(value: unknown): FolderPrintTemplateAsset | null {
  const record = asRecord(value)
  if (!record) return null
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const objectKey = typeof record.object_key === 'string' ? record.object_key.trim() : ''
  if (!url && !objectKey) return null
  return {
    url: url || undefined,
    file_name: typeof record.file_name === 'string' ? record.file_name : undefined,
    mime_type: typeof record.mime_type === 'string' ? record.mime_type : undefined,
    file_size_bytes: Number.isFinite(Number(record.file_size_bytes)) ? Number(record.file_size_bytes) : undefined,
    version_token: typeof record.version_token === 'string' ? record.version_token : undefined,
    bucket_name: typeof record.bucket_name === 'string' ? record.bucket_name : undefined,
    object_key: objectKey || undefined,
  }
}

export function normalizePrefixRule(value: unknown): PrefixRule | null {
  const record = asRecord(value)
  if (!record) return null
  const prefix = typeof record.prefix === 'string' ? record.prefix.trim().toUpperCase() : ''
  if (!prefix) return null
  const sourceValues = Array.isArray(record.sources)
    ? record.sources.filter((entry): entry is UploadSource => entry === 'admin' || entry === 'ftp' || entry === 'customer_qr')
    : []
  return {
    prefix,
    enabled: record.enabled !== false,
    sources: sourceValues.length > 0 ? sourceValues : ['admin', 'ftp'],
  }
}

export function parseFolderSettings(value: unknown): FolderSettings {
  const record = asRecord(value)
  const customerUpload = asRecord(record?.customer_upload)
  const routing = asRecord(record?.routing)
  const print = asRecord(record?.print)
  const prefixRules = Array.isArray(routing?.prefix_rules)
    ? routing.prefix_rules.map(normalizePrefixRule).filter((rule): rule is PrefixRule => Boolean(rule))
    : []

  return {
    customer_upload: {
      enabled: customerUpload?.enabled === true,
      default_public: customerUpload?.default_public !== false,
      require_public_choice: customerUpload?.require_public_choice !== false,
      token: typeof customerUpload?.token === 'string' ? customerUpload.token.trim() : '',
    },
    routing: {
      prefix_rules: prefixRules,
    },
    print: {
      mode: normalizePrintMode(print?.mode),
      runner_status: normalizePrintRunnerStatus(print?.runner_status),
      client_token: typeof print?.client_token === 'string' ? print.client_token.trim() : '',
      template_asset: normalizeTemplateAsset(print?.template_asset),
      qr: {
        enabled: print?.qr && typeof print.qr === 'object'
          ? (print.qr as Record<string, unknown>).enabled !== false
          : true,
        position: normalizePrintQrPosition(print?.qr && typeof print.qr === 'object' ? (print.qr as Record<string, unknown>).position : undefined),
        size_ratio: clampPrintQrSizeRatio(print?.qr && typeof print.qr === 'object' ? (print.qr as Record<string, unknown>).size_ratio : undefined),
        offset_x: Number(print?.qr && typeof print.qr === 'object' ? (print.qr as Record<string, unknown>).offset_x ?? 0 : 0) || 0,
        offset_y: Number(print?.qr && typeof print.qr === 'object' ? (print.qr as Record<string, unknown>).offset_y ?? 0 : 0) || 0,
      },
    },
  }
}

export function serializeFolderSettings(input: Partial<FolderSettings> | unknown) {
  const normalized = parseFolderSettings(input)
  return {
    customer_upload: {
      enabled: normalized.customer_upload.enabled,
      default_public: normalized.customer_upload.default_public,
      require_public_choice: normalized.customer_upload.require_public_choice,
      token: normalized.customer_upload.token,
    },
    routing: {
      prefix_rules: normalized.routing.prefix_rules,
    },
    print: {
      mode: normalized.print.mode,
      runner_status: normalized.print.runner_status,
      client_token: normalized.print.client_token,
      template_asset: normalized.print.template_asset,
      qr: {
        enabled: normalized.print.qr.enabled,
        position: normalized.print.qr.position,
        size_ratio: normalized.print.qr.size_ratio,
        offset_x: normalized.print.qr.offset_x,
        offset_y: normalized.print.qr.offset_y,
      },
    },
  }
}

export function shouldShowCustomerPublicChoice(params: {
  folderKind: FolderKind
  accessMode?: string | null
  settings: FolderSettings
}) {
  if (params.folderKind === 'print' && params.accessMode === 'hidden') return false
  return params.settings.customer_upload.require_public_choice
}

export async function resolveUploadFolderByPrefix(params: {
  projectId: string
  explicitFolderId?: string | null
  fileName: string
  source: UploadSource
}) {
  const explicitFolderId = typeof params.explicitFolderId === 'string' && params.explicitFolderId.trim()
    ? params.explicitFolderId.trim()
    : null
  if (explicitFolderId) {
    return { folderId: explicitFolderId, matchedByPrefix: false as const }
  }

  const { data, error } = await supabase
    .from('project_folders')
    .select('id, settings')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const upperName = params.fileName.trim().toUpperCase()
  for (const folder of data ?? []) {
    const settings = parseFolderSettings(folder.settings)
    for (const rule of settings.routing.prefix_rules) {
      const allowedSources = rule.sources && rule.sources.length > 0 ? rule.sources : ['admin', 'ftp']
      if (rule.enabled !== false && allowedSources.includes(params.source) && upperName.startsWith(rule.prefix)) {
        return { folderId: String(folder.id), matchedByPrefix: true as const }
      }
    }
  }

  return { folderId: null, matchedByPrefix: false as const }
}

export async function findFolderByCustomerUploadToken(token: string) {
  const normalizedToken = token.trim()
  if (!normalizedToken) return null

  const { data, error } = await supabase
    .from('project_folders')
    .select('id, project_id, name, access_mode, folder_kind, settings')
    .eq('settings->customer_upload->>token', normalizedToken)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const settings = parseFolderSettings(data.settings)
  if (!settings.customer_upload.enabled) return null

  return {
    id: String(data.id),
    project_id: String(data.project_id),
    name: String(data.name ?? ''),
    access_mode: typeof data.access_mode === 'string' ? data.access_mode : 'public',
    folder_kind: normalizeFolderKind(data.folder_kind),
    settings,
  }
}
