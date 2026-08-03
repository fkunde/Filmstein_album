"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Download, Heart, Trash2, Info, Loader2 } from "lucide-react";
import type { Photo, PhotoClientMarkDetail } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import type { Project } from "@/data/mockData";
import { getClientWatermarkConfig, getWatermarkVersionSignature } from "@/lib/clientWatermark";

interface PhotoPreviewModalProps {
  photos: Photo[];
  projectId?: string;
  printPreviewPhotoIds?: string[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
  onDeleteCurrent?: (photo: Photo) => Promise<void> | void;
  onDeleteAllVersions?: (photo: Photo) => Promise<void> | void;
  onTogglePublish?: (photo: Photo, isPublished: boolean) => Promise<void> | void;
  onMarkPrinted?: (photo: Photo) => Promise<void> | void;
  clientDownloadMode?: boolean;
  project?: Project | null;
  onToggleClientMark?: (photo: Photo) => Promise<void> | void;
  onRemoveClientMark?: (photo: Photo, viewerSessionId: string) => Promise<void> | void;
}

const PhotoPreviewModal = ({ photos, projectId, printPreviewPhotoIds = [], initialIndex, open, onClose, onDeleteCurrent, onDeleteAllVersions, onTogglePublish, onMarkPrinted, clientDownloadMode = false, project = null, onToggleClientMark, onRemoveClientMark }: PhotoPreviewModalProps) => {
  const [index, setIndex] = useState(initialIndex);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [highResRequested, setHighResRequested] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);
  const [highResFailed, setHighResFailed] = useState(false);
  const [printPreviewEnabled, setPrintPreviewEnabled] = useState(false);
  const [previewSrcOverride, setPreviewSrcOverride] = useState<string | null>(null);
  const [markingPrinted, setMarkingPrinted] = useState(false);
  const previewOpenedAtRef = useRef<number | null>(null)
  const imageRequestStartedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [open])

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : photos.length - 1)), [photos.length]);
  const next = useCallback(() => setIndex((i) => (i < photos.length - 1 ? i + 1 : 0)), [photos.length]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, prev, next]);

  const [portalReady, setPortalReady] = useState(false)

  useEffect(() => {
    setPortalReady(true)
  }, [])

  const photo = photos[index] as Photo & {
    clientMarkDetails?: PhotoClientMarkDetail[];
    displayUrl?: string;
    clientPreviewUrl?: string;
    originalUrl?: string;
    retouchedOriginalUrl?: string;
    displayFileId?: string;
    clientPreviewFileId?: string;
    versionCount?: number;
    latestVersionNo?: number;
  };

  const watermarkConfig = getClientWatermarkConfig(project)
  const watermarkVersionSignature = getWatermarkVersionSignature(project)
  const debugPreview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'

  useEffect(() => {
    if (!open || photos.length === 0) return
    setImageLoading(true)
    setHighResRequested(false)
    setHighResLoaded(false)
    setHighResFailed(false)
    setPrintPreviewEnabled(false)
    setPreviewSrcOverride(null)
  }, [index, open, photos.length])

  const canPreviewPrint = Boolean(projectId && !clientDownloadMode && printPreviewPhotoIds.includes(photo.id))
  const lastPrintedLabel = photo.lastPrintedAt ? new Date(photo.lastPrintedAt).toLocaleString() : ''
  const printStatusLabel = (photo.printCount || 0) > 0
    ? `Printed ${photo.printCount} time${photo.printCount === 1 ? '' : 's'}`
    : 'Not printed yet'
  const printPreviewSrc = canPreviewPrint && projectId
    ? `/api/photos/${photo.id}/print-render?projectId=${encodeURIComponent(projectId)}&ts=${photo.id}-print-${index}`
    : ''
  const previewFallbackSrc = photo
    ? `/api/photos/${photo.id}/client-render?mode=preview&disposition=inline&ts=${photo.id}-${index}&wv=${encodeURIComponent(watermarkVersionSignature)}${debugPreview ? '&debug=1' : ''}`
    : ''

  const canUseDirectClientPreview = Boolean(
    clientDownloadMode
    && photo?.clientPreviewUrl
    && (!watermarkConfig.enabled || photo.clientPreviewWatermarkSignature === watermarkVersionSignature)
  )

  const previewSrc = printPreviewEnabled && printPreviewSrc
    ? printPreviewSrc
    : previewSrcOverride || (photo
    ? (clientDownloadMode
      ? (canUseDirectClientPreview ? photo.clientPreviewUrl! : previewFallbackSrc)
      : (photo.displayUrl || photo.file_url || photo.url))
    : '')

  const highResSrc = photo
    ? (clientDownloadMode
      ? `/api/photos/${photo.id}/client-render?mode=download&disposition=inline&ts=${photo.id}-${index}-hires&wv=${encodeURIComponent(watermarkVersionSignature)}${debugPreview ? '&debug=1' : ''}`
      : (photo.originalUrl || photo.retouchedOriginalUrl || photo.displayUrl || photo.file_url || photo.url))
    : ''

  const activeSrc = !printPreviewEnabled && highResRequested ? highResSrc : previewSrc
  const previewPath = useMemo(() => {
    if (printPreviewEnabled) return 'print-preview'
    if (!clientDownloadMode) return 'non-client-preview'
    if (highResRequested) return 'client-render-download'
    if (previewSrcOverride === previewFallbackSrc) return 'client-render-fallback'
    if (canUseDirectClientPreview && photo?.clientPreviewUrl && previewSrc === photo.clientPreviewUrl) return 'clientPreviewUrl-direct'
    return 'client-render-preview'
  }, [clientDownloadMode, highResRequested, previewFallbackSrc, previewSrcOverride, photo?.clientPreviewUrl, previewSrc, canUseDirectClientPreview, printPreviewEnabled])

  useEffect(() => {
    if (!open || !photo) return
    previewOpenedAtRef.current = performance.now()
    if (debugPreview) {
      console.debug('[preview-modal] open', {
        photoId: photo.id,
        fileName: photo.fileName,
        previewPath,
        previewSrc,
        previewFallbackSrc,
      })
    }
  }, [open, photo?.id, debugPreview, previewPath, previewSrc, previewFallbackSrc, photo?.fileName])

  useEffect(() => {
    if (!open || !activeSrc) return
    imageRequestStartedAtRef.current = performance.now()
    if (debugPreview) {
      console.debug('[preview-modal] image-request-start', {
        photoId: photo?.id,
        previewPath,
        src: activeSrc,
      })
    }
  }, [open, activeSrc, debugPreview, previewPath, photo?.id])

  if (!open || photos.length === 0 || !portalReady || !photo) return null;

  const handleOpenPrintPage = () => {
    if (!canPreviewPrint || !projectId || typeof window === 'undefined') return
    window.open(`/projects/${encodeURIComponent(projectId)}/print/${encodeURIComponent(photo.id)}`, '_blank', 'noopener,noreferrer')
  }

  const handleMarkPrinted = async () => {
    if (!onMarkPrinted) return
    setMarkingPrinted(true)
    try {
      await onMarkPrinted(photo)
    } finally {
      setMarkingPrinted(false)
    }
  }

  const openDownload = async (variant: "current" | "retouched-original" | "original" | "client-display" | "client-original") => {
    const url = clientDownloadMode
      ? `/api/photos/${photo.id}/client-render?mode=${variant === 'client-display' ? 'preview' : 'download'}&disposition=attachment&wv=${encodeURIComponent(watermarkVersionSignature)}`
      : `/api/photos/${photo.id}/download?variant=${variant}`;
    const check = await fetch(url, { method: "HEAD" });
    if (!check.ok) {
      const body = await check.json().catch(() => ({}));
      alert(body.error || "Download failed");
      setShowDownloadMenu(false);
      return;
    }

    const a = document.createElement("a");
    a.href = url;
    a.download = photo.fileName || "photo.jpg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setShowDownloadMenu(false);
  };

  const handleDelete = async (mode: 'current' | 'all') => {
    const action = mode === 'all' ? onDeleteAllVersions : onDeleteCurrent;
    if (!action) return;
    setDeleting(true);
    try {
      await action(photo);
      onClose();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-black/90 backdrop-blur-md"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      onClick={onClose}
    >
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        {photo.isPublished === false && (
          <span className="inline-flex items-center rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            Unpublished
          </span>
        )}
        {canPreviewPrint && (
          <span className="inline-flex items-center rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {printStatusLabel}
          </span>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {clientDownloadMode && onToggleClientMark ? (
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void onToggleClientMark(photo);
            }}
          >
            <Heart className={`h-5 w-5 ${photo.clientMarked ? 'fill-rose-500 text-rose-400' : ''}`} />
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); }}>
            <Heart className="h-5 w-5" />
          </Button>
        )}
        {onTogglePublish && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void onTogglePublish(photo, !photo.isPublished);
            }}
          >
            {photo.isPublished ? 'Unpublish' : 'Publish'}
          </Button>
        )}
        {canPreviewPrint && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenPrintPage();
            }}
          >
            Print
          </Button>
        )}
        {canPreviewPrint && onMarkPrinted && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            disabled={markingPrinted}
            onClick={(e) => {
              e.stopPropagation();
              void handleMarkPrinted();
            }}
          >
            {markingPrinted ? 'Saving…' : 'Mark as printed'}
          </Button>
        )}
        {canPreviewPrint && (
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              setPrintPreviewEnabled((prev) => !prev);
              setImageLoading(true);
              setHighResRequested(false);
              setHighResFailed(false);
            }}
          >
            {printPreviewEnabled ? 'View Photo' : 'Print Preview'}
          </Button>
        )}
        {onDeleteCurrent && (
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }} disabled={deleting}>
            <Trash2 className="h-5 w-5" />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}>
          <Info className="h-5 w-5" />
        </Button>
        <div className="relative">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={(e) => { e.stopPropagation(); setShowDownloadMenu((v) => !v); }}>
            <Download className="h-5 w-5" />
          </Button>
          {showDownloadMenu && (
            <div className="absolute right-0 top-10 z-30 min-w-40 rounded-lg border border-border bg-card p-1 text-foreground shadow-lg">
              {clientDownloadMode ? (
                <>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-display");
                    }}
                  >
                    Download Preview
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-original");
                    }}
                  >
                    Download Original
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("current");
                    }}
                  >
                    Download Current Version
                  </button>
                  {(photo.versionCount || 1) > 1 && (
                    <button
                      type="button"
                      className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        void openDownload("retouched-original");
                      }}
                    >
                      Download Retouched Original
                    </button>
                  )}
                  <button
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("original");
                    }}
                  >
                    Download Initial Original
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); prev(); }}
        className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      <div className="max-h-[calc(100dvh-7rem)] w-[min(92vw,1200px)] transform-gpu" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex max-h-[calc(100dvh-7rem)] items-center justify-center overflow-hidden bg-transparent">
          {imageLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35 backdrop-blur-sm">
              <div className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                {highResRequested && !highResLoaded ? 'Loading high resolution…' : 'Loading image…'}
              </div>
            </div>
          )}
          <img
            src={activeSrc}
            alt={photo.fileName}
            className="max-h-[calc(100dvh-7rem)] max-w-full object-contain"
            onLoad={(event) => {
              setImageLoading(false)
              if (highResRequested) setHighResLoaded(true)
              if (debugPreview) {
                const requestMs = imageRequestStartedAtRef.current == null ? null : Math.round(performance.now() - imageRequestStartedAtRef.current)
                const totalSinceOpenMs = previewOpenedAtRef.current == null ? null : Math.round(performance.now() - previewOpenedAtRef.current)
                const headers = event.currentTarget.currentSrc.includes('/api/photos/')
                  ? 'inspect network response headers for X-Debug-*'
                  : 'direct image request'
                console.debug('[preview-modal] image-loaded', {
                  photoId: photo.id,
                  previewPath,
                  src: event.currentTarget.currentSrc,
                  requestMs,
                  totalSinceOpenMs,
                  headers,
                })
              }
            }}
            onError={(event) => {
              if (debugPreview) {
                const requestMs = imageRequestStartedAtRef.current == null ? null : Math.round(performance.now() - imageRequestStartedAtRef.current)
                const totalSinceOpenMs = previewOpenedAtRef.current == null ? null : Math.round(performance.now() - previewOpenedAtRef.current)
                console.debug('[preview-modal] image-error', {
                  photoId: photo.id,
                  previewPath,
                  src: event.currentTarget.currentSrc || activeSrc,
                  requestMs,
                  totalSinceOpenMs,
                })
              }
              if (!highResRequested && clientDownloadMode && canUseDirectClientPreview && photo.clientPreviewUrl && previewSrc === photo.clientPreviewUrl) {
                setPreviewSrcOverride(previewFallbackSrc)
                setImageLoading(true)
                return
              }
              setImageLoading(false)
              if (highResRequested) {
                setHighResFailed(true)
                setHighResRequested(false)
              }
            }}
          />
          {clientDownloadMode && watermarkConfig.enabled && watermarkConfig.logoUrl && false && null}
          {photo.isPublished === false && (
            <div className="absolute inset-0 bg-black/20 pointer-events-none" />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); next(); }}
        className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-3 text-sm text-white/70">
        {!printPreviewEnabled && !highResLoaded && (
          <button
            type="button"
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/85 transition hover:bg-white/10 disabled:opacity-50"
            disabled={highResRequested && imageLoading}
            onClick={(e) => {
              e.stopPropagation()
              setHighResRequested(true)
              setImageLoading(true)
              setHighResFailed(false)
            }}
          >
            {highResRequested && imageLoading ? 'Loading original…' : 'View Original'}
          </button>
        )}
        {printPreviewEnabled && (
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/85">
            Print preview
          </span>
        )}
        <span>{index + 1} / {photos.length}</span>
      </div>

      {highResFailed && !printPreviewEnabled && (
        <div className="absolute bottom-[calc(max(1.5rem,env(safe-area-inset-bottom))+2.5rem)] left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3 py-1 text-xs text-white/85 backdrop-blur">
          Original image unavailable. Current image is the highest available quality.
        </div>
      )}

      {showInfo && (
        <div className="absolute bottom-14 left-1/2 z-20 w-[min(92vw,560px)] -translate-x-1/2 rounded-xl border border-white/10 bg-black/65 px-4 py-3 text-white backdrop-blur">
          <p className="text-sm font-medium">{photo.fileName}</p>
          <p className="mt-1 text-xs text-white/75">{photo.uploadedAt || 'Unknown time'}</p>
          {!clientDownloadMode && (
            <div className="mt-3 space-y-2">
              {canPreviewPrint && (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-white/75">Print status</p>
                    <span className="text-xs text-white/85">{printStatusLabel}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
                    {photo.printCode ? <span>Code: {photo.printCode}</span> : null}
                    <span>Count: {photo.printCount ?? 0}</span>
                    {lastPrintedLabel ? <span>Last printed: {lastPrintedLabel}</span> : null}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-white/75">Client Marks</p>
                <span className="text-xs text-white/60">{photo.clientMarkCount ?? photo.clientMarkDetails?.length ?? 0} marks</span>
              </div>
              {(photo.clientMarkDetails?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {photo.clientMarkDetails?.map((mark) => (
                    <button
                      key={mark.viewerSessionId}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onRemoveClientMark?.(photo, mark.viewerSessionId)
                      }}
                      className="group inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/85 transition hover:border-white/35 hover:bg-white/10"
                      title={`Remove ${mark.label}`}
                    >
                      <span>{mark.label}</span>
                      <span className="hidden text-white/60 group-hover:inline">×</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/60">No client marks yet</p>
              )}
            </div>
          )}
        </div>
      )}

      {showDeleteConfirm && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-foreground shadow-2xl">
            <h3 className="text-base font-semibold">Confirm Delete</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {onDeleteCurrent && onDeleteAllVersions
                ? 'You can delete the current version of this photo, or delete the photo and all its versions.'
                : 'This will delete all versions of this photo and remove the linked logical photo. This action cannot be undone.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </Button>
              {onDeleteCurrent && onDeleteAllVersions && (
                <Button type="button" variant="outline" onClick={() => void handleDelete('current')} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete Current Version'}
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={() => void handleDelete('all')} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Photo'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default PhotoPreviewModal;
