"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Download, Heart, Loader2 } from "lucide-react";
import type { Photo } from "@/data/mockData";
import { colorLabelMap } from "@/data/mockData";
import { cn } from "@/lib/utils";

interface PhotoCardProps {
  photo: Photo;
  onClick?: () => void;
  onDoubleClick?: () => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  selectionMode?: boolean;
  variant?: "gallery" | "overlay";
  hideStatusBadge?: boolean;
  hideMetaOverlay?: boolean;
  hideDownloadButton?: boolean;
  clientDownloadMode?: boolean;
  forceSquare?: boolean;
  onToggleAdminColorTag?: (photoId: string, color: Exclude<keyof typeof colorLabelMap, 'none'>) => void;
  onPrint?: () => void;
}

const PhotoCard = ({
  photo,
  onClick,
  selected,
  onSelect,
  selectionMode = false,
  variant = "gallery",
  hideStatusBadge = false,
  hideMetaOverlay = false,
  hideDownloadButton = false,
  clientDownloadMode = false,
  forceSquare = false,
  onToggleAdminColorTag,
  onPrint,
}: PhotoCardProps) => {
  const adminColorTags = photo.adminColorTags ?? []
  const isEdited = (photo.versionCount || 1) > 1;
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showDownloadMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDownloadMenu]);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(!selected);
  };

  const openDownload = async (variant: "current" | "retouched-original" | "original" | "client-display" | "client-original") => {
    const url = clientDownloadMode
      ? `/api/photos/${photo.id}/client-render?mode=download`
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

  const imageSrc = ((photo as Photo & { thumbUrl?: string; displayUrl?: string }).thumbUrl || photo.url || "").trim();
  const uploadedAt = photo.uploadedAt ? new Date(photo.uploadedAt).toLocaleString() : "Unknown time";
  const printStatusLabel = photo.printCode || photo.printCount || photo.lastPrintedAt
    ? (photo.printCount && photo.printCount > 0
      ? `Printed ${photo.printCount} time${photo.printCount === 1 ? "" : "s"}`
      : "Not printed yet")
    : "";
  const isImageUnavailable = !imageSrc || failedImageSrc === imageSrc;
  const isStillProcessing = Boolean(photo.processingState) && photo.processingState !== "failed";
  const isProcessingPlaceholder = isStillProcessing || (photo.processingState === "failed" && (isImageUnavailable || photo.isPlaceholder));
  const isPendingVisual = isProcessingPlaceholder || isImageUnavailable;
  const processingLabel = photo.processingMessage || (photo.processingState === "failed"
    ? "Processing failed"
    : photo.processingState === "uploaded"
      ? "Upload completed"
      : photo.processingState === "processing"
        ? "Generating previews..."
        : "Uploading...");
  const unavailableLabel = photo.processingMessage || (photo.processingState === "failed"
    ? "Processing failed"
    : photo.processingState
      ? processingLabel
      : "Preview not ready yet");

  if (variant === "overlay") {
    return (
      <div
        className={cn(
          "group relative overflow-hidden bg-muted/70 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md",
          forceSquare ? "aspect-square rounded-none" : "rounded-none",
          onClick && !isPendingVisual ? "cursor-pointer" : "cursor-default"
        )}
        onClick={isPendingVisual ? undefined : onClick}
      >
        <div className={cn("overflow-hidden", forceSquare ? "aspect-square" : "") }>
          {isPendingVisual ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/80 px-4 text-center">
              {photo.processingState === "failed" ? (
                <AlertCircle className="h-7 w-7 text-destructive" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
              )}
              <p className="text-xs text-muted-foreground">{unavailableLabel}</p>
            </div>
          ) : (
            <img
              src={imageSrc}
              alt={photo.fileName}
              className={cn(
                "h-full w-full transition-transform duration-500 group-hover:scale-[1.03]",
                forceSquare ? 'object-cover' : 'object-contain bg-muted'
              )}
              loading="lazy"
              onError={() => setFailedImageSrc(imageSrc)}
            />
          )}
        </div>

        {selected && <div className="absolute inset-0 z-10 bg-black/25" />}

        {photo.clientMarked && (
          <div className="absolute right-2 top-2 z-20 rounded-full bg-black/45 p-1 text-white">
            <Heart className="h-3.5 w-3.5 fill-current text-rose-400" />
          </div>
        )}

        {onSelect !== undefined && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "absolute bottom-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all",
              selected
                ? "border-primary bg-primary opacity-100"
                : selectionMode
                  ? "border-white/80 bg-black/40 opacity-100"
                  : "border-white/60 bg-black/40 opacity-0 group-hover:opacity-100",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-visible border border-border bg-card shadow-sm transition-all",
        forceSquare ? "rounded-none" : "rounded-xl",
        selected ? "ring-2 ring-sky-500/70 shadow-md" : "hover:shadow-md",
      )}
    >
      <div
        className={cn("group relative overflow-hidden bg-muted", forceSquare ? "aspect-square rounded-none" : "aspect-[4/3] rounded-t-xl", onClick && !isPendingVisual ? "cursor-pointer" : "cursor-default")}
        onClick={isPendingVisual ? undefined : onClick}
      >
        {isPendingVisual ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/80 px-4 text-center">
            {photo.processingState === "failed" ? (
              <AlertCircle className="h-8 w-8 text-destructive" />
            ) : (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            )}
            <div className="space-y-1">
              <p className="line-clamp-2 text-sm font-medium text-foreground">{photo.fileName}</p>
              <p className="text-xs text-muted-foreground">{unavailableLabel}</p>
            </div>
          </div>
        ) : (
          <img
            src={imageSrc}
            alt={photo.fileName}
            className={cn(
              "h-full w-full object-cover transition-all duration-300",
              photo.isPublished === false ? "brightness-50" : "",
              selected ? "scale-[0.97]" : "group-hover:scale-[1.02]",
            )}
            loading="lazy"
            onError={() => setFailedImageSrc(imageSrc)}
          />
        )}

        {selected && <div className="absolute inset-0 z-10 bg-black/20 pointer-events-none" />}

        {photo.isPublished === false && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <span className="rounded-md bg-black/30 px-3 py-1 text-base font-semibold text-white/95 drop-shadow sm:text-lg">
              Unpublished
            </span>
          </div>
        )}

        {photo.uploadSource === 'customer_qr' && photo.customerPublicConsent === false ? (
          <div className="absolute left-2 bottom-2 z-20 rounded-md bg-black/65 px-2 py-1 text-[10px] font-medium text-white">
            Customer private
          </div>
        ) : null}

        {photo.clientMarked && (
          <div className="absolute left-2 top-2 z-20 rounded-full bg-black/45 p-1 text-white">
            <Heart className="h-3.5 w-3.5 fill-current text-rose-400" />
          </div>
        )}
        {(adminColorTags.length > 0 || onToggleAdminColorTag) && (
          <>
            {adminColorTags.length > 0 && (
              <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center justify-end gap-1 transition-opacity group-hover:opacity-0">
                {adminColorTags.map((tag) => (
                  <span key={tag} className={`h-2.5 w-2.5 rounded-full ${colorLabelMap[tag].bg}`} />
                ))}
              </div>
            )}
            {onToggleAdminColorTag && (
              <div className="pointer-events-none absolute right-2 top-2 z-30 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                {(["red", "green", "blue", "yellow", "purple"] as const).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleAdminColorTag(photo.id, tag);
                    }}
                    className={`h-3 w-3 rounded-full ${colorLabelMap[tag].bg} ring-2 ${adminColorTags.includes(tag) ? 'ring-white ring-offset-1 ring-offset-black/30' : 'ring-transparent'} transition-transform hover:scale-110`}
                    aria-label={`Toggle ${tag} tag`}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {onSelect !== undefined && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className={cn(
              "absolute bottom-2 right-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all",
              selected
                ? "border-sky-600 bg-sky-600 text-white opacity-100"
                : "border-white/80 bg-black/40 text-white opacity-0 group-hover:opacity-100",
            )}
            aria-label={selected ? "Deselect" : "Select"}
          >
            {selected && <Check className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className={cn("flex items-start justify-between gap-2 border-t border-border/60 px-3 py-2.5", forceSquare ? "rounded-none" : "") }>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <p
              className={cn(
                "w-full truncate text-sm font-medium transition-colors",
                selected ? "text-muted-foreground" : "text-foreground",
              )}
              title={photo.fileName}
            >
              {photo.fileName}
            </p>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isPendingVisual
                  ? photo.processingState === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-amber-50 text-amber-700"
                  : isEdited
                    ? "bg-sky-50 text-sky-700"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {isPendingVisual ? (photo.processingState === "failed" ? "Failed" : "Processing") : (isEdited ? "Retouched" : "Original")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{uploadedAt}</p>
          {printStatusLabel ? (
            <p className="mt-1 text-xs text-muted-foreground">{printStatusLabel}</p>
          ) : null}
        </div>
        {(!hideDownloadButton || onPrint) && !isPendingVisual && (
          <div className="relative z-30 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onPrint ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrint();
                }}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Print"
                aria-label="Print"
              >
                Print
              </button>
            ) : null}
            {!hideDownloadButton ? (
            <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowDownloadMenu((v) => !v);
              }}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Download"
              aria-label="Download"
            >
              <Download className="h-4 w-4" />
            </button>
            {showDownloadMenu && (
              <div className="absolute right-0 top-8 z-50 min-w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
                {clientDownloadMode ? (
                  <>
                    <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-display");
                    }}>
                      Download Preview
                    </button>
                    <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("client-original");
                    }}>
                      Download Original
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("current");
                    }}>
                      Download Current Version
                    </button>
                    {(photo.versionCount || 1) > 1 && (
                      <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={(e) => {
                        e.stopPropagation();
                        void openDownload("retouched-original");
                      }}>
                        Download Retouched Original
                      </button>
                    )}
                    <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={(e) => {
                      e.stopPropagation();
                      void openDownload("original");
                    }}>
                      Download Initial Original
                    </button>
                  </>
                )}
              </div>
            )}
            </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoCard;
