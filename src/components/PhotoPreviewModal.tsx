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

type PreviewPhoto = Photo & {
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
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [settleDirection, setSettleDirection] = useState<"prev" | "next" | null>(null);
  const [isResettingCarousel, setIsResettingCarousel] = useState(false);
  const previewOpenedAtRef = useRef<number | null>(null)
  const imageRequestStartedAtRef = useRef<number | null>(null)
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const prev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : photos.length - 1))
  }, [photos.length]);
  const next = useCallback(() => {
    setIndex((i) => (i < photos.length - 1 ? i + 1 : 0))
  }, [photos.length]);

  useEffect(() => {
    return () => {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current)
    }
  }, [])

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

  const photo = photos[index] as PreviewPhoto;

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
    setDragOffsetX(0)
    setIsDraggingPhoto(false)
    setSettleDirection(null)
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
  const previousPhotoIndex = index > 0 ? index - 1 : photos.length - 1
  const nextPhotoIndex = index < photos.length - 1 ? index + 1 : 0
  const previousPhoto = photos[previousPhotoIndex] as PreviewPhoto | undefined
  const nextPhoto = photos[nextPhotoIndex] as PreviewPhoto | undefined
  const getLowResPreviewSrc = (candidate: PreviewPhoto | undefined, candidateIndex: number) => {
    if (!candidate) return ''
    if (clientDownloadMode) {
      const canUseDirectPreview = Boolean(
        candidate.clientPreviewUrl
        && (!watermarkConfig.enabled || candidate.clientPreviewWatermarkSignature === watermarkVersionSignature)
      )
      return canUseDirectPreview
        ? candidate.clientPreviewUrl!
        : `/api/photos/${candidate.id}/client-render?mode=preview&disposition=inline&ts=${candidate.id}-${candidateIndex}-adjacent&wv=${encodeURIComponent(watermarkVersionSignature)}${debugPreview ? '&debug=1' : ''}`
    }
    return candidate.thumbUrl || candidate.url || candidate.displayUrl || candidate.file_url || ''
  }
  const currentPreviewPlaceholderSrc = getLowResPreviewSrc(photo, index)
  const previousPreviewSrc = photos.length > 1 ? getLowResPreviewSrc(previousPhoto, previousPhotoIndex) : ''
  const nextPreviewSrc = photos.length > 1 ? getLowResPreviewSrc(nextPhoto, nextPhotoIndex) : ''
  const showCurrentPreviewPlaceholder = Boolean(
    imageLoading
    && !printPreviewEnabled
    && currentPreviewPlaceholderSrc
  )
  const carouselTranslate = settleDirection === 'prev'
    ? 'translate3d(0, 0, 0)'
    : settleDirection === 'next'
      ? 'translate3d(-200%, 0, 0)'
      : `translate3d(calc(-100% + ${dragOffsetX}px), 0, 0)`
  const carouselCanTransition = !isDraggingPhoto && !isResettingCarousel
  const showSwipeCarousel = isDraggingPhoto || settleDirection !== null
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

  useEffect(() => {
    if (!open) return
    const sources = [currentPreviewPlaceholderSrc, previousPreviewSrc, nextPreviewSrc].filter(Boolean)
    const preloads = sources.map((src) => {
      const image = new Image()
      image.src = src
      return image
    })
    return () => {
      preloads.forEach((image) => {
        image.onload = null
        image.onerror = null
      })
    }
  }, [open, currentPreviewPlaceholderSrc, previousPreviewSrc, nextPreviewSrc])

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

  const handleSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (settleDirection || photos.length <= 1) return
    if (event.touches.length !== 1) {
      swipeStartRef.current = null
      setDragOffsetX(0)
      setIsDraggingPhoto(false)
      return
    }
    const touch = event.touches[0]
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    setDragOffsetX(0)
    setIsDraggingPhoto(true)
  }

  const handleSwipeMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (settleDirection || photos.length <= 1) return
    const start = swipeStartRef.current
    if (!start || event.touches.length !== 1) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const horizontalDistance = Math.abs(deltaX)

    if (horizontalDistance < 8 || horizontalDistance < Math.abs(deltaY)) {
      setDragOffsetX(0)
      return
    }

    event.preventDefault()
    setDragOffsetX(deltaX * 0.9)
  }

  const completeSwipe = (direction: "prev" | "next") => {
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current)
    setSettleDirection(direction)
    setDragOffsetX(0)
    const targetIndex = direction === 'next'
      ? (index < photos.length - 1 ? index + 1 : 0)
      : (index > 0 ? index - 1 : photos.length - 1)

    settleTimeoutRef.current = setTimeout(() => {
      setIsResettingCarousel(true)
      setIndex(targetIndex)
      setSettleDirection(null)
      setDragOffsetX(0)
      requestAnimationFrame(() => {
        setIsResettingCarousel(false)
      })
    }, 190)
  }

  const handleSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    setIsDraggingPhoto(false)
    if (!start || event.changedTouches.length === 0) {
      setDragOffsetX(0)
      return
    }

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    const horizontalDistance = Math.abs(deltaX)

    setDragOffsetX(0)

    if (horizontalDistance < 48 || horizontalDistance < Math.abs(deltaY) * 1.25 || elapsed > 800) return

    if (deltaX < 0) {
      completeSwipe('next')
    } else {
      completeSwipe('prev')
    }
  }

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

      <div
        className="max-h-[calc(100dvh-7rem)] w-[min(92vw,1200px)] touch-pan-y transform-gpu"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleSwipeStart}
        onTouchMove={handleSwipeMove}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={() => {
          swipeStartRef.current = null
          setDragOffsetX(0)
          setIsDraggingPhoto(false)
        }}
      >
        {showSwipeCarousel ? (
          <div
            className={`relative flex max-h-[calc(100dvh-7rem)] overflow-hidden bg-transparent ${carouselCanTransition ? 'transition-transform duration-200 ease-out' : ''}`}
            style={{
              transform: carouselTranslate,
            }}
          >
            <div className="flex w-full shrink-0 items-center justify-center">
              {previousPreviewSrc && previousPhoto && (
                <img
                  src={previousPreviewSrc}
                  alt={previousPhoto.fileName}
                  className="max-h-[calc(100dvh-7rem)] max-w-full scale-[1.02] object-contain opacity-70 blur-sm"
                  draggable={false}
                />
              )}
            </div>
            <div className="relative flex min-h-[60dvh] w-full shrink-0 items-center justify-center overflow-hidden bg-black/45">
              {showCurrentPreviewPlaceholder && (
                <img
                  src={currentPreviewPlaceholderSrc}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
                  draggable={false}
                  aria-hidden="true"
                />
              )}
              {imageLoading && (
                <div className={`absolute inset-0 z-20 flex items-center justify-center ${showCurrentPreviewPlaceholder ? 'bg-transparent' : 'bg-black/35 backdrop-blur-sm'}`}>
                  <div className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm text-white">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {highResRequested && !highResLoaded ? 'Loading high resolution…' : 'Loading image…'}
                  </div>
                </div>
              )}
              {showCurrentPreviewPlaceholder && (
                <img
                  src={currentPreviewPlaceholderSrc}
                  alt={photo.fileName}
                  className="pointer-events-none relative z-[1] max-h-[calc(100dvh-7rem)] max-w-full scale-[1.01] object-contain opacity-95 blur-sm"
                  draggable={false}
                  aria-hidden="true"
                />
              )}
              <img
                src={activeSrc}
                alt={photo.fileName}
                className={`${showCurrentPreviewPlaceholder ? 'absolute left-1/2 top-1/2 z-10 max-h-[calc(100dvh-7rem)] max-w-full -translate-x-1/2 -translate-y-1/2' : 'max-h-[calc(100dvh-7rem)] max-w-full'} object-contain`}
                draggable={false}
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
            <div className="flex w-full shrink-0 items-center justify-center">
              {nextPreviewSrc && nextPhoto && (
                <img
                  src={nextPreviewSrc}
                  alt={nextPhoto.fileName}
                  className="max-h-[calc(100dvh-7rem)] max-w-full scale-[1.02] object-contain opacity-70 blur-sm"
                  draggable={false}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-[60dvh] w-full max-h-[calc(100dvh-7rem)] items-center justify-center overflow-hidden bg-black/45">
            {showCurrentPreviewPlaceholder && (
              <img
                src={currentPreviewPlaceholderSrc}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-45 blur-2xl"
                draggable={false}
                aria-hidden="true"
              />
            )}
            {imageLoading && (
              <div className={`absolute inset-0 z-20 flex items-center justify-center ${showCurrentPreviewPlaceholder ? 'bg-transparent' : 'bg-black/35 backdrop-blur-sm'}`}>
                <div className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {highResRequested && !highResLoaded ? 'Loading high resolution…' : 'Loading image…'}
                </div>
              </div>
            )}
            {showCurrentPreviewPlaceholder && (
              <img
                src={currentPreviewPlaceholderSrc}
                alt={photo.fileName}
                className="pointer-events-none relative z-[1] max-h-[calc(100dvh-7rem)] max-w-full scale-[1.01] object-contain opacity-95 blur-sm"
                draggable={false}
                aria-hidden="true"
              />
            )}
              <img
                src={activeSrc}
                alt={photo.fileName}
                className={`${showCurrentPreviewPlaceholder ? 'absolute left-1/2 top-1/2 z-10 max-h-[calc(100dvh-7rem)] max-w-full -translate-x-1/2 -translate-y-1/2' : 'max-h-[calc(100dvh-7rem)] max-w-full'} object-contain`}
                draggable={false}
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
        )}
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
