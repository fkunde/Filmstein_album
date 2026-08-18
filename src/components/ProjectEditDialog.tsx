"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Upload, Loader2, Download, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import type { Project, ProjectType, ProjectStatus } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { buildProjectAssetApiUrl, type ProjectAssetKey } from '@/lib/projectAssetUrl'
import { clampWatermarkOpacity, clampWatermarkScale, getClientWatermarkConfig, getWatermarkStyle } from '@/lib/clientWatermark'
import type { ProjectStorageSummary, StorageBranchSummary } from '@/lib/storageManagement'
import type { StorageMigrationBranchType } from '@/lib/storageMigrations'
import type { CurrentStorageNodeInfo, ProjectStoragePermissions, ProjectStorageStateInfo } from '@/lib/currentStorageNode'
import type { ProjectStorageOperationRow } from '@/lib/storageOperations'

interface ProjectEditDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  onSaved: (updated: Project) => void;
}

interface ProjectAssignmentItem {
  adminUserId: string;
  shortId: string;
  username: string;
  role: "super_admin" | "admin";
  isActive: boolean;
  isOwner: boolean;
  assignedAt?: string;
}

interface AssignmentPermissions {
  canManageAssignments: boolean;
  isOwner: boolean;
  isAssigned: boolean;
  isSuperAdmin: boolean;
  ownerAdminUserId: string | null;
}

type StorageMigrationStatusPayload = {
  activeMigration: ProjectStorageOperationRow | null
  migrations: ProjectStorageOperationRow[]
  currentNode: CurrentStorageNodeInfo
  projectStorageState: ProjectStorageStateInfo | null
  permissions: ProjectStoragePermissions
  createdOperation?: ProjectStorageOperationRow | null
}

type AssetKey = 'cover' | 'banner' | 'splash_poster' | 'loading_gif' | 'watermark_logo'
type AssetValue = { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; duration_seconds?: number; version_token?: string }
type ProjectAssetsState = NonNullable<Project['project_assets']>

const PROJECT_TYPES: ProjectType[] = ["Wedding", "Event", "Campaign"];
const PROJECT_STATUSES: ProjectStatus[] = ["Draft", "Reviewing", "Delivered"];

const EMPTY_ASSETS: ProjectAssetsState = {}

const ASSET_ACCEPT: Record<AssetKey, string> = {
  cover: 'image/jpeg,image/png,image/webp',
  banner: 'image/jpeg,image/png,image/webp',
  splash_poster: 'image/jpeg,image/png,image/webp',
  loading_gif: 'image/gif',
  watermark_logo: 'image/png,image/svg+xml',
}

const ASSET_SPECS: Record<AssetKey, { label: string; recommendedSize?: string; maxMb: number }> = {
  cover: { label: 'Cover', recommendedSize: '500 × 500 px', maxMb: 2 },
  banner: { label: 'Banner', recommendedSize: '1500 × 844 px', maxMb: 3 },
  splash_poster: { label: 'Splash Poster', recommendedSize: '1500 × 2668 px', maxMb: 5 },
  loading_gif: { label: 'Loading GIF', maxMb: 10 },
  watermark_logo: { label: 'Watermark Logo', maxMb: 5 },
}

const STORAGE_LOCATION_LABELS = {
  r2: 'R2',
  local_backup_server: 'Node local',
  other_remote_storage: 'Other remote storage',
  app_local_storage: 'App local storage',
} as const

const STORAGE_BRANCH_LABELS: Record<'thumb' | 'display' | 'original', string> = {
  thumb: 'thumb',
  display: 'display',
  original: 'original',
}


function formatBytesToMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatEta(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

function formatNodeModeLabel(locationMode?: 'r2' | 'node_local' | null) {
  if (locationMode === 'node_local') return 'Held by node'
  return 'R2'
}

function AssetPreview({ asset, label, previewUrl }: { asset?: AssetValue; label: string; previewUrl?: string }) {
  if (!asset?.url && !previewUrl) {
    return (
      <div className="flex aspect-[4/3] w-28 items-center justify-center rounded-md border border-dashed border-border bg-muted text-[11px] text-muted-foreground">
        No preview
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted">
      <img src={previewUrl || asset?.url || ''} alt={label} className="aspect-[4/3] w-28 object-cover" />
    </div>
  )
}

function AssetSection({
  title,
  assetKey,
  asset,
  enabled,
  setEnabled,
  expanded,
  setExpanded,
  onUpload,
  onDelete,
  uploading,
  children,
  alwaysVisible = false,
  previewUrl,
}: {
  title: string
  assetKey: AssetKey
  asset?: AssetValue
  enabled: boolean
  setEnabled?: (next: boolean) => void
  expanded: boolean
  setExpanded: (next: boolean) => void
  onUpload: (assetKey: AssetKey, file: File | null) => void
  onDelete: (assetKey: AssetKey) => void
  uploading: boolean
  children?: React.ReactNode
  alwaysVisible?: boolean
  previewUrl?: string
}) {
  const showContent = alwaysVisible || enabled

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {!alwaysVisible && setEnabled ? (
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          ) : null}
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">
                {asset?.file_name ? `${asset.file_name} · ${formatBytesToMb(asset.file_size_bytes || 0)}` : 'No file uploaded'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Recommended: {ASSET_SPECS[assetKey].recommendedSize ? `${ASSET_SPECS[assetKey].recommendedSize} · ` : ''}max {ASSET_SPECS[assetKey].maxMb} MB
              </p>
            </div>
          </button>
        </div>
        {alwaysVisible || enabled ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted">
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="hidden"
                accept={ASSET_ACCEPT[assetKey]}
                onChange={(e) => {
                  void onUpload(assetKey, e.target.files?.[0] || null)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => onDelete(assetKey)} disabled={!asset?.url || uploading}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {showContent && expanded ? (
        <div className="border-t border-border px-4 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
            <AssetPreview asset={asset} label={title} previewUrl={previewUrl} />
            <div className="min-w-0 flex-1 space-y-2 text-xs text-muted-foreground sm:min-w-[180px]">
              <p>{asset?.url ? 'Uploaded and linked to project assets.' : 'No file uploaded yet.'}</p>
              {asset?.url ? <p className="break-all">{asset.url}</p> : null}
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function ProjectEditDialog({
  open,
  onClose,
  project,
  onSaved,
}: ProjectEditDialogProps) {
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const [description, setDescription] = useState(project.description || '');
  const [type, setType] = useState<ProjectType>(project.type);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [ftpEnabled, setFtpEnabled] = useState(Boolean((project as Project & { ftp_ingest?: { enabled?: boolean } }).ftp_ingest?.enabled));
  const [projectAssets, setProjectAssets] = useState<ProjectAssetsState>((project.project_assets || EMPTY_ASSETS) as ProjectAssetsState);
  const [watermarkEnabled, setWatermarkEnabled] = useState(Boolean(project.visual_settings?.watermark?.enabled));
  const [watermarkPosition, setWatermarkPosition] = useState(project.visual_settings?.watermark?.position || 'bottom-right');
  const [watermarkOffsetX, setWatermarkOffsetX] = useState(String(project.visual_settings?.watermark?.offset_x ?? 0));
  const [watermarkOffsetY, setWatermarkOffsetY] = useState(String(project.visual_settings?.watermark?.offset_y ?? 0));
  const [watermarkScale, setWatermarkScale] = useState(String(project.visual_settings?.watermark?.scale ?? 1));
  const [watermarkOpacity, setWatermarkOpacity] = useState(String(project.visual_settings?.watermark?.opacity ?? 1));
  const [sharePasswordEnabled, setSharePasswordEnabled] = useState(Boolean(project.visual_settings?.share_access?.enabled));
  const [sharePasswordValue, setSharePasswordValue] = useState('');
  const [assetUploading, setAssetUploading] = useState<string | null>(null);
  const [ftpBufferApiBaseUrl, setFtpBufferApiBaseUrl] = useState((project as Project & { ftp_ingest?: { buffer_api_base_url?: string } }).ftp_ingest?.buffer_api_base_url || "");
  const ftpProjectCode = project.id;
  const [ftpAutoSyncIntervalSeconds, setFtpAutoSyncIntervalSeconds] = useState(String((project as Project & { ftp_ingest?: { auto_sync_interval_seconds?: number } }).ftp_ingest?.auto_sync_interval_seconds ?? 15));
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [ftpStatusSummary, setFtpStatusSummary] = useState<string | null>(null);
  const [ftpStatusError, setFtpStatusError] = useState<string | null>(null);
  const [ftpErrorDetails, setFtpErrorDetails] = useState<string[]>([]);
  const [orphanScanSummary, setOrphanScanSummary] = useState<string | null>(null);
  const [orphanScanResult, setOrphanScanResult] = useState<null | {
    r2_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
    local_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
    db_orphans: { count: number; totalBytes: number; items: Array<{ path: string; size: number; sourceType: string; reason: string }> };
  }>(null);
  const [scanningOrphans, setScanningOrphans] = useState(false);
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [orphanCleanupSummary, setOrphanCleanupSummary] = useState<string | null>(null);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [storageSummary, setStorageSummary] = useState<ProjectStorageSummary | null>(null)
  const [storageSummaryLoading, setStorageSummaryLoading] = useState(false)
  const [storageSummaryError, setStorageSummaryError] = useState<string | null>(null)
  const [storageMigrationStatus, setStorageMigrationStatus] = useState<StorageMigrationStatusPayload | null>(null)
  const [storageMigrationLoading, setStorageMigrationLoading] = useState(false)
  const [storageMigrationError, setStorageMigrationError] = useState<string | null>(null)
  const [storageMigrationSubmitting, setStorageMigrationSubmitting] = useState(false)
  const [storageMigrationSelection, setStorageMigrationSelection] = useState<Record<StorageMigrationBranchType, boolean>>({ thumb: false, display: false, original: false })
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<ProjectAssignmentItem[]>([]);
  const [assignmentPermissions, setAssignmentPermissions] = useState<AssignmentPermissions | null>(null);
  const [assignmentInput, setAssignmentInput] = useState("");
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsSaving, setAssignmentsSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<string | null>(null);
  const [bannerEnabled, setBannerEnabled] = useState(Boolean(project.project_assets?.banner?.url));
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [posterEnabled, setPosterEnabled] = useState(Boolean(project.project_assets?.splash_poster?.url));
  const [posterExpanded, setPosterExpanded] = useState(false);
  const [posterDurationSeconds, setPosterDurationSeconds] = useState(String(project.project_assets?.splash_poster?.duration_seconds ?? 3));
  const [gifEnabled, setGifEnabled] = useState(Boolean(project.project_assets?.loading_gif?.url));
  const [gifExpanded, setGifExpanded] = useState(false);
  const [watermarkSectionEnabled, setWatermarkSectionEnabled] = useState(Boolean(project.project_assets?.watermark_logo?.url || project.visual_settings?.watermark?.enabled));
  const [watermarkExpanded, setWatermarkExpanded] = useState(false);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null)
  const [useAlbumPhotoPreview, setUseAlbumPhotoPreview] = useState(false)
  const [watermarkLogoAspectRatio, setWatermarkLogoAspectRatio] = useState(2)

  const handleScanOrphans = async () => {
    setScanningOrphans(true);
    setError(null);
    setOrphanScanSummary(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storage/orphans/scan`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Orphan scan failed');
        return;
      }
      const data = body.data;
      setOrphanScanResult(data);
      setOrphanScanSummary(`R2 ${data.r2_orphans.count} · ${formatBytesToMb(data.r2_orphans.totalBytes)} · Local ${data.local_orphans.count} · ${formatBytesToMb(data.local_orphans.totalBytes)} · DB ${data.db_orphans.count}`);
    } catch {
      setError('Orphan scan failed. Please try again.');
    } finally {
      setScanningOrphans(false);
    }
  };

  const handleCleanupOrphans = async (cleanTypes: Array<'r2' | 'local' | 'db'>) => {
    if (!orphanScanResult) return;
    setCleaningOrphans(true);
    setError(null);
    setOrphanCleanupSummary(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storage/orphans/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanResult: orphanScanResult, cleanTypes }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Orphan cleanup failed');
        return;
      }
      const data = body.data as { deletedCount?: number; freedBytes?: number; skippedCount?: number; failedItems?: Array<{ path: string }> };
      setOrphanCleanupSummary(`Deleted ${data.deletedCount ?? 0} · Freed ${formatBytesToMb(data.freedBytes ?? 0)} · Skipped ${data.skippedCount ?? 0} · Failed ${data.failedItems?.length ?? 0}`);
      await handleScanOrphans();
    } catch {
      setError('Orphan cleanup failed. Please try again.');
    } finally {
      setCleaningOrphans(false);
    }
  };

  const handleLoadFtpStatus = async () => {
    try {
      const statusUrl = `/api/projects/${project.id}/ftp-ingest/status`
      const res = await fetch(statusUrl)
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.success !== true) {
        setFtpStatusError(body?.error ?? `Status endpoint error (${res.status})`)
        return
      }
      const data = body.data as { pendingJobs?: number; inProgressJobs?: number; importedJobs?: number; failedJobs?: number; lastSyncTime?: string | null; requestUrl?: string | null; error?: string | null; errorDetails?: string[] }
      setFtpStatusSummary(`Pending ${data.pendingJobs ?? 0} · In progress ${data.inProgressJobs ?? 0} · Imported ${data.importedJobs ?? 0} · Failed ${data.failedJobs ?? 0}${data.lastSyncTime ? ` · Last sync ${data.lastSyncTime}` : ''}${data.requestUrl ? ` · URL ${data.requestUrl}` : ''}`)
      setFtpStatusError(data.error ?? null)
      setFtpErrorDetails(Array.isArray(data.errorDetails) ? data.errorDetails : [])
    } catch (error) {
      setFtpStatusError(`Status fetch failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  };

  useEffect(() => {
    if (open && ftpEnabled) {
      void fetch('/api/internal/ftp-ingest-auto-start').catch(() => null);
      void handleLoadFtpStatus();
    }
  }, [open, ftpEnabled]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const loadAssignments = async () => {
      setAssignmentsLoading(true);
      setAssignmentError(null);
      setAssignmentNotice(null);
      try {
        const res = await fetch(`/api/projects/${project.id}/assignments`);
        const body = await res.json().catch(() => null) as {
          success?: boolean;
          error?: string;
          data?: { assignments?: ProjectAssignmentItem[]; permissions?: AssignmentPermissions };
        } | null;

        if (cancelled) return;
        if (!res.ok || body?.success !== true) {
          setAssignmentError(body?.error ?? 'Could not load assigned users');
          return;
        }

        setAssignments(Array.isArray(body.data?.assignments) ? body.data!.assignments! : []);
        setAssignmentPermissions(body.data?.permissions ?? null);
      } catch {
        if (!cancelled) setAssignmentError('Could not load assigned users');
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    };

    void loadAssignments();
    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}`)
        const body = await res.json().catch(() => null)
        const firstPhoto = Array.isArray(body?.data?.photos) ? body.data.photos[0] : null
        const nextPreviewPhotoUrl = firstPhoto?.displayUrl || firstPhoto?.file_url || firstPhoto?.url || null
        if (!cancelled) {
          setPreviewPhotoUrl(nextPreviewPhotoUrl)
          setUseAlbumPhotoPreview(Boolean(nextPreviewPhotoUrl))
        }
      } catch {
        if (!cancelled) {
          setPreviewPhotoUrl(null)
          setUseAlbumPhotoPreview(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, project.id])

  useEffect(() => {
    if (!open || assignmentPermissions?.isSuperAdmin !== true) {
      if (!open) {
        setStorageSummary(null)
        setStorageSummaryError(null)
        setStorageMigrationStatus(null)
        setStorageMigrationError(null)
      }
      return
    }

    let cancelled = false

    const loadStoragePanel = async (isInitial: boolean) => {
      if (isInitial) {
        setStorageSummaryLoading(true)
        setStorageMigrationLoading(true)
      }
      setStorageSummaryError(null)
      setStorageMigrationError(null)
      try {
        const [summaryRes, migrationRes] = await Promise.all([
          fetch(`/api/projects/${project.id}/storage/summary`),
          fetch(`/api/projects/${project.id}/storage/migrations`),
        ])
        const summaryBody = await summaryRes.json().catch(() => null) as { success?: boolean; error?: string; data?: ProjectStorageSummary } | null
        const migrationBody = await migrationRes.json().catch(() => null) as { success?: boolean; error?: string; data?: StorageMigrationStatusPayload } | null
        if (cancelled) return

        if (!summaryRes.ok || summaryBody?.success !== true || !summaryBody.data) {
          setStorageSummaryError(summaryBody?.error ?? 'Could not load storage summary')
          setStorageSummary(null)
        } else {
          setStorageSummary(summaryBody.data)
        }

        if (!migrationRes.ok || migrationBody?.success !== true || !migrationBody.data) {
          setStorageMigrationError(migrationBody?.error ?? 'Could not load storage migrations')
          setStorageMigrationStatus(null)
        } else {
          setStorageMigrationStatus(migrationBody.data)
        }
      } catch {
        if (!cancelled) {
          setStorageSummaryError('Could not load storage summary')
          setStorageMigrationError('Could not load storage migrations')
          setStorageSummary(null)
          setStorageMigrationStatus(null)
        }
      } finally {
        if (!cancelled && isInitial) {
          setStorageSummaryLoading(false)
          setStorageMigrationLoading(false)
        }
      }
    }

    void loadStoragePanel(true)
    const poll = window.setInterval(() => {
      void loadStoragePanel(false)
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [open, project.id, assignmentPermissions?.isSuperAdmin])

  useEffect(() => {
    const previewUrl = buildProjectAssetApiUrl(project.id, 'watermark_logo', projectAssets.watermark_logo?.version_token || projectAssets.watermark_logo?.file_name || projectAssets.watermark_logo?.file_size_bytes || '1')
    if (!projectAssets.watermark_logo?.url) {
      setWatermarkLogoAspectRatio(2)
      return
    }
    const img = new Image()
    img.onload = () => {
      setWatermarkLogoAspectRatio(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 2)
    }
    img.onerror = () => setWatermarkLogoAspectRatio(2)
    img.src = previewUrl
  }, [project.id, projectAssets.watermark_logo?.url, projectAssets.watermark_logo?.version_token, projectAssets.watermark_logo?.file_name, projectAssets.watermark_logo?.file_size_bytes])

  const handleAssetUpload = async (assetType: AssetKey, file: File | null) => {
    if (!file) return;
    setAssetUploading(assetType);
    setError(null);
    try {
      const maxBytes = ASSET_SPECS[assetType].maxMb * 1024 * 1024
      if (file.size > maxBytes) {
        setError(`${ASSET_SPECS[assetType].label} must be smaller than ${ASSET_SPECS[assetType].maxMb} MB`)
        return
      }

      if (['cover', 'banner', 'splash_poster'].includes(assetType)) {
        const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
          const img = new Image()
          img.onload = () => resolve({ width: img.width, height: img.height })
          img.onerror = () => resolve(null)
          img.src = URL.createObjectURL(file)
        })
        if (!size) {
          setError(`Could not read ${ASSET_SPECS[assetType].label} image dimensions`)
          return
        }
      }

      const form = new FormData();
      form.append('assetType', assetType);
      form.append('file', file);
      const res = await fetch(`/api/projects/${project.id}/assets`, { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'Asset upload failed');
        return;
      }
      setProjectAssets((prev) => {
        const next = {
          ...prev,
          [assetType]: {
            ...(prev?.[assetType] || {}),
            url: body.data.url,
            file_name: body.data.fileName,
            mime_type: file.type || undefined,
            file_size_bytes: body.data.size,
            version_token: body.data.versionToken,
          },
        }
        return next
      });
      if (assetType === 'banner') setBannerEnabled(true)
      if (assetType === 'splash_poster') setPosterEnabled(true)
      if (assetType === 'loading_gif') setGifEnabled(true)
      if (assetType === 'watermark_logo') setWatermarkSectionEnabled(true)
    } catch {
      setError('Asset upload failed. Please try again.');
    } finally {
      setAssetUploading(null);
    }
  };

  const handleDeleteAsset = (assetType: AssetKey) => {
    setProjectAssets((prev) => {
      const next = { ...prev }
      delete next[assetType]
      return next
    })

    if (assetType === 'banner') setBannerEnabled(false)
    if (assetType === 'splash_poster') setPosterEnabled(false)
    if (assetType === 'loading_gif') setGifEnabled(false)
    if (assetType === 'watermark_logo') setWatermarkSectionEnabled(watermarkEnabled)
  }

  const handleRunFtpIngest = async () => {
    setIngesting(true);
    setError(null);
    setIngestResult(null);
    setFtpErrorDetails([]);
    try {
      const res = await fetch(`/api/projects/${project.id}/ftp-ingest`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.success !== true) {
        setError(body?.error ?? 'FTP ingest failed');
        return;
      }
      const data = body.data as { foundJobs?: number; importedSuccess?: number; failedCount?: number; confirmFailedCount?: number; errors?: string[] };
      setIngestResult(`Found ${data.foundJobs ?? 0} jobs · Imported ${data.importedSuccess ?? 0} · Failed ${data.failedCount ?? 0}${(data.confirmFailedCount ?? 0) > 0 ? ` · Confirm failed ${data.confirmFailedCount}` : ''}`);
      setFtpErrorDetails(Array.isArray(data.errors) ? data.errors : []);
    } catch {
      setError('FTP ingest failed. Please try again.');
    } finally {
      setIngesting(false);
    }
  };

  const handleAddAssignment = async () => {
    const adminUserShortId = assignmentInput.trim().toUpperCase();
    if (!adminUserShortId) return;

    setAssignmentsSaving(true);
    setAssignmentError(null);
    setAssignmentNotice(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUserShortId }),
      });
      const body = await res.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        data?: { assignments?: ProjectAssignmentItem[] };
      } | null;

      if (!res.ok || body?.success !== true) {
        setAssignmentError(body?.error ?? 'Could not assign user');
        return;
      }

      setAssignments(Array.isArray(body.data?.assignments) ? body.data!.assignments! : []);
      setAssignmentInput('');
      setAssignmentNotice('User assigned successfully');
    } catch {
      setAssignmentError('Could not assign user');
    } finally {
      setAssignmentsSaving(false);
    }
  };

  const handleRemoveAssignment = async (adminUserId: string) => {
    setAssignmentsSaving(true);
    setAssignmentError(null);
    setAssignmentNotice(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/assignments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUserId }),
      });
      const body = await res.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        data?: { assignments?: ProjectAssignmentItem[] };
      } | null;

      if (!res.ok || body?.success !== true) {
        setAssignmentError(body?.error ?? 'Could not remove user');
        return;
      }

      setAssignments(Array.isArray(body.data?.assignments) ? body.data!.assignments! : []);
      setAssignmentNotice('User removed successfully');
    } catch {
      setAssignmentError('Could not remove user');
    } finally {
      setAssignmentsSaving(false);
    }
  };

  const renderLocationBreakdown = (counts: Record<'r2' | 'local_backup_server' | 'other_remote_storage' | 'app_local_storage', number>) => {
    const visibleEntries = Object.entries(counts).filter(([, value]) => value > 0) as Array<[keyof typeof counts, number]>
    if (visibleEntries.length === 0) {
      return <p className="text-xs text-muted-foreground">None detected</p>
    }

    return (
      <div className="flex flex-wrap gap-2">
        {visibleEntries.map(([key, value]) => (
          <span key={key} className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground">
            {STORAGE_LOCATION_LABELS[key]} · {value}
          </span>
        ))}
      </div>
    )
  }

  const handleToggleStorageMigrationBranch = (branchType: StorageMigrationBranchType) => {
    setStorageMigrationSelection((current) => ({ ...current, [branchType]: !current[branchType] }))
  }

  const handleStartStorageMigration = async () => {
    const branchTypes = (Object.entries(storageMigrationSelection) as Array<[StorageMigrationBranchType, boolean]>)
      .filter(([, checked]) => checked)
      .map(([branchType]) => branchType)

    if (branchTypes.length === 0) return

    setStorageMigrationSubmitting(true)
    setStorageMigrationError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/storage/migrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchTypes }),
      })
      const body = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: StorageMigrationStatusPayload } | null
      if (!res.ok || body?.success !== true || !body.data) {
        setStorageMigrationError(body?.error ?? 'Could not start pull-to-current-node')
        return
      }
      setStorageMigrationStatus(body.data)
      setStorageMigrationSelection({ thumb: false, display: false, original: false })
    } catch {
      setStorageMigrationError('Could not start pull-to-current-node')
    } finally {
      setStorageMigrationSubmitting(false)
    }
  }

  const renderStorageBranchCard = (branch: StorageBranchSummary) => (
    <div key={branch.branchType} className="rounded-md border border-border bg-background p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground capitalize">{STORAGE_BRANCH_LABELS[branch.branchType]}</p>
        <p className="text-xs text-muted-foreground">{branch.totalFiles} files in this project</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Primary read source</p>
          {renderLocationBreakdown(branch.primaryReadSource)}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Copy distribution</p>
          {renderLocationBreakdown(branch.copyDistribution.byLocation)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Readable</p>
          <p className="mt-1 font-medium text-foreground">{branch.readableFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Verified</p>
          <p className="mt-1 font-medium text-foreground">{branch.verifiedFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">Failed / abnormal</p>
          <p className="mt-1 font-medium text-foreground">{branch.failedFiles} / {branch.abnormalFiles}</p>
        </div>
        <div className="rounded border border-border/70 px-2 py-2">
          <p className="text-muted-foreground">No primary / no readable</p>
          <p className="mt-1 font-medium text-foreground">{branch.noPrimaryFiles} / {branch.noReadableFiles}</p>
        </div>
      </div>

      <div className="rounded border border-border/70 px-3 py-3 text-xs text-muted-foreground">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <span>Total copies: {branch.copyDistribution.totalCopies}</span>
          <span>Available: {branch.copyDistribution.availableCopies}</span>
          <span>Queued: {branch.copyDistribution.queuedCopies}</span>
          <span>Copying: {branch.copyDistribution.copyingCopies}</span>
          <span>Verifying: {branch.copyDistribution.verifyingCopies}</span>
        </div>
      </div>
    </div>
  )

  const selectedStorageMigrationBranchCount = Object.values(storageMigrationSelection).filter(Boolean).length
  const activeStorageMigration = storageMigrationStatus?.activeMigration ?? null
  const currentStorageNode = storageMigrationStatus?.currentNode ?? null
  const projectStorageState = storageMigrationStatus?.projectStorageState ?? null
  const storagePermissions = storageMigrationStatus?.permissions ?? null

  const renderStorageMigrationCard = (operation: ProjectStorageOperationRow, compact = false) => {
    const progress = operation.total_files > 0 ? Math.min(100, Math.round((operation.done_files / operation.total_files) * 100)) : 0

    return (
      <div key={operation.id} className={`rounded-md border border-border bg-background p-4 ${compact ? 'space-y-2' : 'space-y-3'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Pull to current node</p>
            <p className="text-[11px] text-muted-foreground">{operation.requested_branch_types.join(', ')} · {operation.status}{operation.current_phase ? ` · phase ${operation.current_phase}` : ''}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">{operation.created_at ? new Date(operation.created_at).toLocaleString() : ''}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{operation.done_files} / {operation.total_files} files</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/80 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Failed files</p>
            <p className="mt-1 font-medium text-foreground">{operation.failed_files}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Transferred</p>
            <p className="mt-1 font-medium text-foreground">{formatBytes(operation.transferred_bytes)} / {formatBytes(operation.total_bytes)}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">Node</p>
            <p className="mt-1 font-medium text-foreground">{operation.node_name || operation.node_key || '—'}</p>
          </div>
          <div className="rounded border border-border/70 px-2 py-2">
            <p className="text-muted-foreground">State switch</p>
            <p className="mt-1 font-medium text-foreground">{projectStorageState?.transitionState || 'idle'}</p>
          </div>
        </div>

        {operation.error_message ? (
          <p className="text-xs text-destructive">Last error: {operation.error_message}</p>
        ) : null}
      </div>
    )
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const normalizedProjectAssets: ProjectAssetsState = {
        ...(projectAssets.cover?.url ? { cover: projectAssets.cover } : {}),
        ...(bannerEnabled && projectAssets.banner?.url ? { banner: projectAssets.banner } : {}),
        ...(posterEnabled
          ? {
              splash_poster: {
                ...(projectAssets.splash_poster || {}),
                ...(projectAssets.splash_poster?.url ? { duration_seconds: Math.max(1, Number(posterDurationSeconds) || 3) } : {}),
              },
            }
          : {}),
        ...(gifEnabled && projectAssets.loading_gif?.url ? { loading_gif: projectAssets.loading_gif } : {}),
        ...(watermarkSectionEnabled && projectAssets.watermark_logo?.url ? { watermark_logo: projectAssets.watermark_logo } : {}),
      }

      const nextCoverUrl = normalizedProjectAssets.cover?.url || ''
      const nextVisualSettings = {
        watermark: {
          enabled: watermarkSectionEnabled ? watermarkEnabled : false,
          position: watermarkPosition,
          offset_x: Number(watermarkOffsetX) || 0,
          offset_y: Number(watermarkOffsetY) || 0,
          scale: clampWatermarkScale(Number(watermarkScale) || 1),
          opacity: clampWatermarkOpacity(Number(watermarkOpacity)),
        },
        share_access: {
          enabled: sharePasswordEnabled,
          ...(sharePasswordValue.trim() ? { password: sharePasswordValue.trim() } : {}),
        },
      }

      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          client_name: clientName,
          description,
          type,
          status,
          cover_url: nextCoverUrl,
          ftp_ingest: {
            enabled: ftpEnabled,
            buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
            project_code: ftpProjectCode.trim(),
            auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
          },
          project_assets: normalizedProjectAssets,
          visual_settings: nextVisualSettings,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Save failed");
        return;
      }
      onSaved({
        ...project,
        name,
        clientName,
        description,
        type,
        status,
        cover_url: nextCoverUrl,
        ftp_ingest: {
          enabled: ftpEnabled,
          buffer_api_base_url: ftpBufferApiBaseUrl.trim(),
          project_code: ftpProjectCode.trim(),
          auto_sync_interval_seconds: Math.max(1, Number(ftpAutoSyncIntervalSeconds) || 15),
        },
        project_assets: normalizedProjectAssets,
        visual_settings: {
          ...project.visual_settings,
          ...nextVisualSettings,
          share_access: {
            enabled: sharePasswordEnabled,
            has_password: sharePasswordEnabled ? true : false,
          },
        },
      });
      onClose();
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const getAssetPreviewUrl = (assetKey: ProjectAssetKey, asset?: AssetValue) => {
    if (!asset?.url) return undefined
    return buildProjectAssetApiUrl(project.id, assetKey, asset.version_token || asset.file_name || asset.file_size_bytes || '1')
  }

  const watermarkPreviewConfig = useMemo(() => ({
    ...getClientWatermarkConfig({
      ...project,
      project_assets: {
        ...(project.project_assets || {}),
        ...projectAssets,
      },
      visual_settings: {
        watermark: {
          enabled: watermarkSectionEnabled ? watermarkEnabled : false,
          position: watermarkPosition,
          offset_x: Number(watermarkOffsetX) || 0,
          offset_y: Number(watermarkOffsetY) || 0,
          scale: clampWatermarkScale(Number(watermarkScale) || 1),
          opacity: clampWatermarkOpacity(Number(watermarkOpacity)),
        },
      },
    }),
  }), [project, projectAssets, watermarkEnabled, watermarkOffsetX, watermarkOffsetY, watermarkOpacity, watermarkPosition, watermarkScale, watermarkSectionEnabled])

  const watermarkPreviewStyle = useMemo(() => getWatermarkStyle({
    config: watermarkPreviewConfig,
    baseWidth: 1200,
    baseHeight: 800,
    logoAspectRatio: watermarkLogoAspectRatio,
    mode: 'settings',
  }), [watermarkLogoAspectRatio, watermarkPreviewConfig])

  const watermarkPreviewBackground = useAlbumPhotoPreview && previewPhotoUrl ? previewPhotoUrl : null

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
      <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:max-h-[calc(100vh-2rem)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-foreground">Edit Project</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Basic Information</h3>
              <p className="text-xs text-muted-foreground">Core project details used across the dashboard.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-name">Project Name</label>
              <input
                id="edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-client">Client Name</label>
              <input
                id="edit-client"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="edit-description">Description</label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="edit-type">Type</label>
                <select
                  id="edit-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as ProjectType)}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="edit-status">Status</label>
                <select
                  id="edit-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {assignmentPermissions?.canManageAssignments ? (
              <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                <div>
                  <h4 className="text-sm font-medium text-foreground">Assign users</h4>
                  <p className="text-xs text-muted-foreground">Add a backend user by short ID so they can manage this project.</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={assignmentInput}
                    onChange={(e) => setAssignmentInput(e.target.value)}
                    placeholder="Paste backend user short ID"
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    disabled={assignmentsSaving}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleAddAssignment()} disabled={assignmentsSaving || !assignmentInput.trim()}>
                    Add
                  </Button>
                </div>

                {assignmentError ? <p className="text-sm text-destructive">{assignmentError}</p> : null}
                {assignmentNotice ? <p className="text-sm text-foreground">{assignmentNotice}</p> : null}
                {assignmentsLoading ? <p className="text-sm text-muted-foreground">Loading assigned users…</p> : null}

                <div className="space-y-2">
                  {assignments.map((assignment) => (
                    <div key={assignment.adminUserId} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{assignment.username}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{assignment.isOwner ? 'Creator' : assignment.role === 'super_admin' ? 'Super admin' : 'Assigned'}</span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{assignment.shortId}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRemoveAssignment(assignment.adminUserId)}
                        disabled={assignmentsSaving || assignment.isOwner}
                      >
                        {assignment.isOwner ? 'Locked' : 'Remove'}
                      </Button>
                    </div>
                  ))}
                  {!assignmentsLoading && assignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assigned users yet.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Project Settings</h3>
              <p className="text-xs text-muted-foreground">Control the client-facing entrance for this share page.</p>
            </div>

            <div className="rounded-lg border border-border bg-background p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input type="checkbox" checked={sharePasswordEnabled} onChange={(e) => setSharePasswordEnabled(e.target.checked)} />
                Enable project password
              </label>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Project share password</label>
                <input
                  type="password"
                  value={sharePasswordValue}
                  onChange={(e) => setSharePasswordValue(e.target.value)}
                  placeholder={project.visual_settings?.share_access?.has_password ? 'Leave blank to keep current password' : 'Enter a project password'}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-muted-foreground">
                  When enabled, clients must enter this password once per device/session before viewing the share project.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Project Assets</h3>
              <p className="text-xs text-muted-foreground">Manage cover, banner, poster, loading, and watermark assets without sending them into the gallery photo pipeline.</p>
            </div>

            <AssetSection
              title="Cover"
              assetKey="cover"
              asset={projectAssets.cover}
              enabled={true}
              expanded={true}
              setExpanded={() => {}}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'cover'}
              alwaysVisible
              previewUrl={getAssetPreviewUrl('cover', projectAssets.cover)}
            />

            <AssetSection
              title="Banner"
              assetKey="banner"
              asset={projectAssets.banner}
              enabled={bannerEnabled}
              setEnabled={setBannerEnabled}
              expanded={bannerExpanded}
              setExpanded={setBannerExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'banner'}
              previewUrl={getAssetPreviewUrl('banner', projectAssets.banner)}
            />

            <AssetSection
              title="Splash Poster"
              assetKey="splash_poster"
              asset={projectAssets.splash_poster}
              enabled={posterEnabled}
              setEnabled={setPosterEnabled}
              expanded={posterExpanded}
              setExpanded={setPosterExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'splash_poster'}
              previewUrl={getAssetPreviewUrl('splash_poster', projectAssets.splash_poster)}
            >
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Display Duration (seconds)</label>
                <input
                  type="number"
                  min="1"
                  value={posterDurationSeconds}
                  onChange={(e) => setPosterDurationSeconds(e.target.value)}
                  className="flex h-9 w-32 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                />
              </div>
            </AssetSection>

            <AssetSection
              title="Loading GIF"
              assetKey="loading_gif"
              asset={projectAssets.loading_gif}
              enabled={gifEnabled}
              setEnabled={setGifEnabled}
              expanded={gifExpanded}
              setExpanded={setGifExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'loading_gif'}
              previewUrl={getAssetPreviewUrl('loading_gif', projectAssets.loading_gif)}
            />

            <AssetSection
              title="Watermark"
              assetKey="watermark_logo"
              asset={projectAssets.watermark_logo}
              enabled={watermarkSectionEnabled}
              setEnabled={setWatermarkSectionEnabled}
              expanded={watermarkExpanded}
              setExpanded={setWatermarkExpanded}
              onUpload={handleAssetUpload}
              onDelete={handleDeleteAsset}
              uploading={assetUploading === 'watermark_logo'}
              previewUrl={getAssetPreviewUrl('watermark_logo', projectAssets.watermark_logo)}
            >
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={watermarkEnabled} onChange={(e) => setWatermarkEnabled(e.target.checked)} />
                  Enable Watermark
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Position</label>
                    <select value={watermarkPosition} onChange={(e) => setWatermarkPosition(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground">
                      <option value="top-left">Top Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Scale</label>
                    <input type="number" step="0.1" value={watermarkScale} onChange={(e) => setWatermarkScale(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Offset X</label>
                    <input type="number" value={watermarkOffsetX} onChange={(e) => setWatermarkOffsetX(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Offset Y</label>
                    <input type="number" value={watermarkOffsetY} onChange={(e) => setWatermarkOffsetY(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">Opacity</label>
                    <input type="number" step="0.1" min="0" max="1" value={watermarkOpacity} onChange={(e) => setWatermarkOpacity(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-foreground">Watermark Preview</p>
                      <p className="text-[11px] text-muted-foreground">3:2 preview with the same relative watermark layout used by client preview.</p>
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={useAlbumPhotoPreview && Boolean(previewPhotoUrl)}
                        disabled={!previewPhotoUrl}
                        onChange={(e) => setUseAlbumPhotoPreview(e.target.checked)}
                      />
                      Use first album photo
                    </label>
                  </div>
                  <div className="relative aspect-[3/2] overflow-hidden rounded-md border border-border bg-zinc-200">
                    {watermarkPreviewBackground ? (
                      <img
                        src={watermarkPreviewBackground}
                        alt="Album preview"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.9),rgba(255,255,255,0.2)_35%,transparent_55%),linear-gradient(135deg,#d6d3d1,#e7e5e4_38%,#cbd5e1_100%)]" />
                        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.15)_50%,rgba(255,255,255,0.15)_75%,transparent_75%,transparent)] bg-[length:24px_24px] opacity-40" />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/30 via-black/5 to-transparent px-4 py-3 text-[11px] text-white/90">
                          Default 3:2 preview canvas
                        </div>
                      </>
                    )}
                    {projectAssets.watermark_logo?.url ? (
                      <img
                        src={getAssetPreviewUrl('watermark_logo', projectAssets.watermark_logo) || projectAssets.watermark_logo.url}
                        alt="Watermark preview"
                        className="absolute max-w-none object-contain"
                        style={watermarkPreviewStyle}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                        No watermark logo
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{watermarkPreviewBackground ? 'Using first album photo' : 'Using built-in preview canvas'}</span>
                    <span>Offset is treated as % of image width/height</span>
                  </div>
                </div>
              </div>
            </AssetSection>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">FTP Ingest</h3>
              <p className="text-xs text-muted-foreground">Enable manual ingest from an FTP buffer API for this project.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={ftpEnabled} onChange={(e) => setFtpEnabled(e.target.checked)} />
              Enable FTP Ingest
            </label>
            {ftpEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Buffer API Base URL</label>
                  <input type="text" value={ftpBufferApiBaseUrl} onChange={(e) => setFtpBufferApiBaseUrl(e.target.value)} placeholder="http://1.2.3.4:9090" className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Project Code</label>
                  <code className="flex min-h-9 w-full items-center break-all rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground">{ftpProjectCode}</code>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Auto Sync Interval (seconds)</label>
                  <input type="number" min="1" value={ftpAutoSyncIntervalSeconds} onChange={(e) => setFtpAutoSyncIntervalSeconds(e.target.value)} placeholder="15" className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground" />
                </div>
                {ftpProjectCode.trim() && (
                  <div className="rounded-md border border-dashed border-border bg-background p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">FTP Setup Guide</p>
                    <p className="mt-1">This project expects incoming files under:</p>
                    <code className="mt-1 block rounded bg-muted px-2 py-1 text-foreground">/{ftpProjectCode.trim()}/</code>
                    <p className="mt-2">Create any FTP account manually on the buffer server.</p>
                    <p>As long as files are uploaded into this project directory, the main gallery can ingest them.</p>
                    <p>The main site does not manage FTP usernames or passwords.</p>
                  </div>
                )}
                <div className="space-y-2 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">FTP Ingest Status</p>
                  {ftpStatusSummary && <p>{ftpStatusSummary}</p>}
                  {ftpStatusError && <p className="text-destructive">{ftpStatusError}</p>}
                  {ingestResult && <p>{ingestResult}</p>}
                  {ftpErrorDetails.length > 0 && (
                    <div className="space-y-1 text-destructive">
                      <p className="font-medium">Error details</p>
                      <ul className="space-y-1">
                        {ftpErrorDetails.map((detail, index) => (
                          <li key={`${detail}-${index}`} className="break-words">{detail}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleLoadFtpStatus}>Refresh status</Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleRunFtpIngest} disabled={ingesting}>
                      {ingesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                      Run sync now
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Storage Maintenance</h3>
              <p className="text-xs text-muted-foreground">Scan this project for orphaned storage objects before cleanup.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleScanOrphans} disabled={scanningOrphans}>
                {scanningOrphans ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                Scan orphan files
              </Button>
              {orphanScanSummary && <p className="text-xs text-muted-foreground">{orphanScanSummary}</p>}
            </div>
            {orphanScanResult && (
              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={() => setCleanupConfirmOpen(true)} disabled={cleaningOrphans}>
                    {cleaningOrphans ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                    Clean scanned orphans
                  </Button>
                  {orphanCleanupSummary && <p>{orphanCleanupSummary}</p>}
                </div>
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="font-medium text-foreground">Scan Summary</p>
                  <ul className="mt-2 space-y-1">
                    <li>R2 orphan count: {orphanScanResult.r2_orphans.count} / {formatBytesToMb(orphanScanResult.r2_orphans.totalBytes)}</li>
                    <li>Local orphan count: {orphanScanResult.local_orphans.count} / {formatBytesToMb(orphanScanResult.local_orphans.totalBytes)}</li>
                    <li>DB orphan count: {orphanScanResult.db_orphans.count}</li>
                  </ul>
                </div>
                {([
                  ['R2 Orphans', orphanScanResult.r2_orphans.items],
                  ['Local Orphans', orphanScanResult.local_orphans.items],
                  ['DB Orphans', orphanScanResult.db_orphans.items],
                ] as const).map(([title, items]) => (
                  <details key={title} className="rounded-md border border-border bg-background p-3">
                    <summary className="cursor-pointer font-medium text-foreground">{title} ({items.length})</summary>
                    <div className="mt-2 space-y-2">
                      {items.length === 0 ? <p>No items</p> : items.map((item) => (
                        <div key={`${title}-${item.path}`} className="rounded border border-border/60 p-2">
                          <p className="break-all text-foreground">{item.path}</p>
                          <p>{item.reason}</p>
                          <p>{formatBytesToMb(item.size)}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        {cleanupConfirmOpen && orphanScanResult && (
          <div className="border-t border-border bg-muted/30 px-6 py-4">
            <p className="text-sm font-semibold text-foreground">Confirm orphan cleanup</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This will delete {orphanScanResult.r2_orphans.count + orphanScanResult.local_orphans.count} storage files and clean {orphanScanResult.db_orphans.count} orphan database records.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Estimated space to free: {formatBytesToMb(orphanScanResult.r2_orphans.totalBytes + orphanScanResult.local_orphans.totalBytes)}.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCleanupConfirmOpen(false)} disabled={cleaningOrphans}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={async () => {
                await handleCleanupOrphans(['r2', 'local', 'db']);
                setCleanupConfirmOpen(false);
              }} disabled={cleaningOrphans}>
                {cleaningOrphans ? 'Cleaning…' : 'Confirm cleanup'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
