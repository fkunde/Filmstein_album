"use client";

import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { X, Copy, ExternalLink, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  projectDescription?: string;
  projectCoverUrl?: string;
  shareCardTitle?: string;
  shareCardSubtitle?: string;
  onSaved?: (value: { title?: string; subtitle?: string }) => void;
}

const DEFAULT_SHARE_DESCRIPTION = "Open this shared photo album on Snapflare.";

function buildDefaultCardTitle(projectName: string) {
  return projectName.trim() || "Snapflare Share";
}

function buildDefaultCardSubtitle(projectName: string, projectDescription?: string) {
  const trimmed = projectDescription?.trim();
  if (trimmed) return trimmed;
  if (projectName.trim()) return `View ${projectName.trim()} on Snapflare.`;
  return DEFAULT_SHARE_DESCRIPTION;
}

export default function ShareModal({
  open,
  onClose,
  projectId,
  projectName,
  projectDescription,
  projectCoverUrl,
  shareCardTitle,
  shareCardSubtitle,
  onSaved,
}: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(`/share/${projectId}`);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [cardTitleInput, setCardTitleInput] = useState(shareCardTitle?.trim() || "");
  const [cardSubtitleInput, setCardSubtitleInput] = useState(shareCardSubtitle?.trim() || "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cardTitle = cardTitleInput.trim() || buildDefaultCardTitle(projectName);
  const cardDescription = cardSubtitleInput.trim() || buildDefaultCardSubtitle(projectName, projectDescription);
  const showCardCover = Boolean(projectCoverUrl?.trim());

  useEffect(() => {
    setShareUrl(`${window.location.origin}/share/${projectId}`);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setCardTitleInput(shareCardTitle?.trim() || "");
    setCardSubtitleInput(shareCardSubtitle?.trim() || "");
    setSaveError(null);
  }, [open, shareCardSubtitle, shareCardTitle]);

  useEffect(() => {
    if (!open) return;

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !shareUrl) return;

    let cancelled = false;

    const buildQrCode = async () => {
      setQrLoading(true);
      try {
        const dataUrl = await QRCode.toDataURL(shareUrl, {
          errorCorrectionLevel: "H",
          margin: 2,
          width: 960,
          color: {
            dark: "#111111",
            light: "#ffffff",
          },
        });

        if (!cancelled) {
          setQrCodeUrl(dataUrl);
        }
      } catch {
        if (!cancelled) {
          setQrCodeUrl("");
        }
      } finally {
        if (!cancelled) {
          setQrLoading(false);
        }
      }
    };

    void buildQrCode();

    return () => {
      cancelled = true;
    };
  }, [open, shareUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenAlbum = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const handleSaveQrCode = () => {
    if (!qrCodeUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeUrl;
    link.download = `${projectName || "share"}-qr-code.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveShareCard = async () => {
    setSaving(true);
    setSaveError(null);

    const nextShareCard = {
      title: cardTitleInput.trim() || undefined,
      subtitle: cardSubtitleInput.trim() || undefined,
    };

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visual_settings: {
            share_card: nextShareCard,
          },
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        setSaveError(body?.error || "Could not save share card settings");
        return;
      }

      onSaved?.(nextShareCard);
    } catch {
      setSaveError("Could not save share card settings");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Share Album</h2>
            <p className="mt-0.5 text-xs text-muted-foreground truncate max-w-[240px]">
              {projectName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-6">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Public Link
            </label>
            <div className="flex items-stretch gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-muted px-3 py-2">
                <span className="truncate text-sm text-foreground">{shareUrl}</span>
              </div>
              <Button type="button" onClick={handleCopy} className="shrink-0">
                {copied ? (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                )}
                {copied ? "Copied!" : "Copy Link"}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider" htmlFor="share-card-title">
                Card Title
              </label>
              <Input
                id="share-card-title"
                value={cardTitleInput}
                onChange={(event) => setCardTitleInput(event.target.value)}
                placeholder={buildDefaultCardTitle(projectName)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider" htmlFor="share-card-subtitle">
                Card Subtitle
              </label>
              <textarea
                id="share-card-subtitle"
                value={cardSubtitleInput}
                onChange={(event) => setCardSubtitleInput(event.target.value)}
                placeholder={buildDefaultCardSubtitle(projectName, projectDescription)}
                maxLength={220}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Leave either field empty to fall back to the project name, project description, or default Snapflare copy.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Share Card Preview
            </label>
            <div className="rounded-2xl border border-border bg-white p-3 shadow-sm">
              <div className="flex items-stretch gap-3">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                    {cardTitle}
                  </p>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                    {cardDescription}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                      Link Preview
                    </span>
                    <span>Snapflare</span>
                  </div>
                </div>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                  {showCardCover ? (
                    <img
                      src={projectCoverUrl}
                      alt={cardTitle}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 px-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                      Snapflare
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              This is an editor preview. Actual WeChat or social cards still depend on the share page metadata and the target app's renderer.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              QR Code
            </label>
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <div className="flex h-52 w-52 items-center justify-center rounded-lg bg-white p-3 shadow-sm">
                {qrCodeUrl ? (
                  <img
                    src={qrCodeUrl}
                    alt={`QR code for ${projectName}`}
                    className="h-full w-full object-contain"
                  />
                ) : qrLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <span className="px-4 text-center text-sm text-muted-foreground">
                    QR code unavailable
                  </span>
                )}
              </div>
              <p className="text-center text-xs leading-5 text-muted-foreground">
                Scan to open this share page directly, or save the PNG and forward it in WeChat.
              </p>
            </div>
          </div>

          {saveError ? (
            <p className="text-sm text-destructive" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card px-6 py-4">
          <Button type="button" onClick={() => void handleSaveShareCard()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? "Saving…" : "Save Card Content"}
          </Button>
          <Button variant="outline" type="button" onClick={handleSaveQrCode} disabled={!qrCodeUrl}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Save QR Code
          </Button>
          <Button variant="outline" type="button" onClick={handleOpenAlbum}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Open Album
          </Button>
        </div>
      </div>
    </div>
  );
}
