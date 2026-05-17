"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, Loader2, MessageCircle, QrCode, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicShareDialogProps {
  open: boolean;
  onClose: () => void;
  shareUrl: string;
  title: string;
}

export default function PublicShareDialog({
  open,
  onClose,
  shareUrl,
  title,
}: PublicShareDialogProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharingWechat, setSharingWechat] = useState(false);

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
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveQrCode = () => {
    if (!qrCodeUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeUrl;
    link.download = `${title || "snapflare-share"}-qr-code.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleWechatShare = async () => {
    if (!shareUrl) return;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        setSharingWechat(true);
        await navigator.share({
          title,
          text: title,
          url: shareUrl,
        });
        return;
      } catch (error) {
        const shareError = error as { name?: string };
        if (shareError?.name === "AbortError") return;
      } finally {
        setSharingWechat(false);
      }
    }

    await handleCopy();
    alert("Link copied. Open WeChat and paste it to forward the share card.");
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">Share</h2>
            <p className="max-w-[240px] truncate text-xs text-muted-foreground">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close share dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Share2 className="h-3.5 w-3.5" />
              Share Link
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2">
              <div className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-sm text-foreground">
                <span className="block truncate">{shareUrl}</span>
              </div>
              <Button type="button" size="sm" onClick={() => void handleCopy()} className="shrink-0">
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" />
              QR Code
            </div>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/40 p-4">
              <div className="flex h-52 w-52 items-center justify-center rounded-xl bg-white p-3 shadow-sm">
                {qrCodeUrl ? (
                  <img src={qrCodeUrl} alt={`QR code for ${title}`} className="h-full w-full object-contain" />
                ) : qrLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <span className="px-4 text-center text-sm text-muted-foreground">QR code unavailable</span>
                )}
              </div>
              <p className="text-center text-xs leading-5 text-muted-foreground">
                Scan to open this gallery directly, or save the PNG and forward it in WeChat.
              </p>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" type="button" onClick={() => void handleWechatShare()} disabled={sharingWechat}>
            {sharingWechat ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="mr-1.5 h-3.5 w-3.5" />}
            Share to WeChat
          </Button>
          <Button variant="outline" type="button" onClick={handleSaveQrCode} disabled={!qrCodeUrl}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Save QR Code
          </Button>
        </div>
      </div>
    </div>
  );
}
