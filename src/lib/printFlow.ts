import path from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { parseFolderSettings, type FolderSettings } from '@/lib/folderSettings'
import { mapRowToPhoto } from '@/lib/mapPhoto'
import { getFirstVersionFiles, getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import type { Photo } from '@/data/mockData'

type PhotoLookupRow = {
  global_photo_id: string
  project_id: string
  folder_id?: string | null
  metadata?: unknown
  updated_at?: string | null
  color_label?: string | null
  status?: string | null
  original_file_id?: string | null
  retouched_file_id?: string | null
  is_published?: boolean | null
  upload_source?: string | null
  customer_public_consent?: boolean | null
  print_code?: string | null
  print_count?: number | null
  last_printed_at?: string | null
  project_folders?: {
    id: string
    name: string
    folder_kind?: string | null
    settings?: unknown
    access_mode?: string | null
  } | Array<{
    id: string
    name: string
    folder_kind?: string | null
    settings?: unknown
    access_mode?: string | null
  }> | null
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env')
  }

  return createClient(supabaseUrl, supabaseKey)
}

function normalizeFolderRelation(value: PhotoLookupRow['project_folders']) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

export function stripPrintFilenamePrefixes(photoId: string, baseName: string) {
  let name = baseName.trim()

  const escapedPhotoId = photoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^${escapedPhotoId}_v\\d+_`, 'i'),
    new RegExp(`^${escapedPhotoId}_(?:original|retouched_original)_`, 'i'),
    new RegExp(`^${escapedPhotoId}_`, 'i'),
    /^\\d+_(?:original|retouched_original)_/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of patterns) {
      const next = name.replace(pattern, '')
      if (next !== name) {
        name = next
        changed = true
      }
    }
  }

  return name || 'photo'
}

function resolveDownloadName(photoId: string, sourceName: string) {
  const ext = path.extname(sourceName).toLowerCase() || '.jpg'
  const readableBase = stripPrintFilenamePrefixes(photoId, path.basename(sourceName, ext).replace(/\\s+/g, '_'))
  return `${photoId}_print_${readableBase}${ext}`
}

async function loadPhotoFiles(supabase: ReturnType<typeof getSupabaseAdmin>, photoId: string) {
  const { data, error } = await supabase
    .from('photo_files')
    .select('id, photo_id, branch_type, version_no, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, processing_meta, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
    .eq('photo_id', photoId)
    .order('version_no', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as PhotoFileRow[]
}

async function inflatePrintPhoto(row: PhotoLookupRow) {
  const supabase = getSupabaseAdmin()
  const fileRows = await loadPhotoFiles(supabase, row.global_photo_id)
  const latestVersion = getLatestVersionFiles(fileRows)
  const firstVersion = getFirstVersionFiles(fileRows)
  const folder = normalizeFolderRelation(row.project_folders)
  const mappedPhoto = mapRowToPhoto({
    ...(row as unknown as Record<string, unknown>),
    latest_original_file: latestVersion?.byBranch.original ?? null,
    latest_thumb_file: latestVersion?.byBranch.thumb ?? null,
    latest_display_file: latestVersion?.byBranch.display ?? null,
    first_original_file: firstVersion?.byBranch.original ?? null,
  }) as Photo

  const sourceFile = firstVersion?.byBranch.original ?? latestVersion?.byBranch.original ?? latestVersion?.byBranch.display ?? null
  const sourceName = sourceFile?.original_file_name || sourceFile?.file_name || sourceFile?.object_key?.split('/').pop() || `${row.global_photo_id}.jpg`

  return {
    row,
    photo: mappedPhoto,
    fileRows,
    latestVersion,
    firstVersion,
    folder: folder ? {
      id: folder.id,
      name: folder.name,
      folderKind: folder.folder_kind === 'print' ? 'print' as const : 'standard' as const,
      accessMode: folder.access_mode || 'public',
      settings: parseFolderSettings(folder.settings) as FolderSettings,
    } : null,
    sourceFile,
    downloadName: resolveDownloadName(row.global_photo_id, sourceName),
  }
}

export async function loadPrintPhotoByCode(printCode: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photos')
    .select('global_photo_id, project_id, folder_id, metadata, updated_at, color_label, status, original_file_id, retouched_file_id, is_published, upload_source, customer_public_consent, print_code, print_count, last_printed_at, project_folders:folder_id(id, name, folder_kind, settings, access_mode)')
    .eq('print_code', printCode)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return inflatePrintPhoto(data as PhotoLookupRow)
}

export async function loadPrintPhotoById(photoId: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('photos')
    .select('global_photo_id, project_id, folder_id, metadata, updated_at, color_label, status, original_file_id, retouched_file_id, is_published, upload_source, customer_public_consent, print_code, print_count, last_printed_at, project_folders:folder_id(id, name, folder_kind, settings, access_mode)')
    .eq('global_photo_id', photoId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return inflatePrintPhoto(data as PhotoLookupRow)
}
