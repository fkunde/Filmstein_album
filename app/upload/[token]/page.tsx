"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

type UploadConfig = {
  projectId: string;
  folderId: string;
  folderName: string;
  folderKind: "standard" | "print";
  albumUrl: string;
  allowCustomerUpload: boolean;
  defaultPublic: boolean;
  requirePublicChoice: boolean;
  forcedPrivate: boolean;
};

type UploadSessionStatus = "initiated" | "uploaded" | "processing" | "completed" | "failed";

type UploadItemState = {
  id: string;
  fileName: string;
  sessionId?: string;
  status: UploadSessionStatus | "pending" | "uploading";
  message: string;
  progressPct?: number;
};

const sha256Hex = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
};

const putFileToSignedUrl = (url: string, file: File, contentType: string, onProgress?: (loaded: number, total: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("R2 upload failed"));
    xhr.send(file);
  });

const buildFileId = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

const formatSpeed = (bytesPerSecond: number) => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "—";
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
};

const formatEta = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "Calculating…";
  if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.ceil(seconds % 60);
  return `~${minutes}m ${remSeconds}s remaining`;
};

export default function PublicUploadPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = typeof params?.token === "string" ? params.token : "";
  const [config, setConfig] = useState<UploadConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [customerPublicConsent, setCustomerPublicConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [uploadItems, setUploadItems] = useState<UploadItemState[]>([]);
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [bytesUploaded, setBytesUploaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [currentFileName, setCurrentFileName] = useState("");
  const [completionNotice, setCompletionNotice] = useState("");
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/public-upload/${token}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success !== true) {
          throw new Error(body.error || "Upload link unavailable");
        }
        if (cancelled) return;
        setConfig(body.data as UploadConfig);
        setCustomerPublicConsent(body.data?.defaultPublic !== false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Upload link unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setUploadItems(files.map((file) => ({
      id: buildFileId(file),
      fileName: file.name,
      status: "pending",
      message: "Waiting to upload",
      progressPct: 0,
    })));
  }, [files]);

  useEffect(() => {
    if (!completionNotice || !config?.albumUrl) return;
    setRedirectCountdown(3);
    const tick = window.setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev === null) return prev;
        if (prev <= 1) {
          window.clearInterval(tick);
          router.push(config.albumUrl);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [completionNotice, config?.albumUrl, router]);

  useEffect(() => {
    if (!token) return;
    const pendingSessions = uploadItems.filter((item) => item.sessionId && (item.status === "uploaded" || item.status === "processing"));
    if (pendingSessions.length === 0) return;

    const timer = window.setInterval(() => {
      void Promise.all(pendingSessions.map(async (item) => {
        const res = await fetch(`/api/public-upload/${token}/sessions/${item.sessionId}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success !== true || !body.data) return;

        const status = body.data.status as UploadSessionStatus;
        const message = status === "completed"
          ? "Upload complete."
          : status === "processing"
            ? "Upload received. Processing…"
            : status === "uploaded"
              ? "Upload successful."
              : status === "failed"
                ? (body.data.processing_error || "Upload failed")
                : "Preparing upload…";

        setUploadItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status, message } : entry));
      }));
    }, 1500);

    return () => window.clearInterval(timer);
  }, [token, uploadItems]);

  const summary = useMemo(() => {
    if (!config) return "";
    if (config.forcedPrivate) return "This album is hidden for public viewing. Uploaded photos stay private in the admin backend.";
    return config.requirePublicChoice
      ? "You can choose whether uploaded photos are publicly visible."
      : "Uploaded photos follow the album default visibility.";
  }, [config]);

  const statusSummary = useMemo(() => {
    const completed = uploadItems.filter((item) => item.status === "completed").length;
    const processing = uploadItems.filter((item) => item.status === "uploaded" || item.status === "processing").length;
    const failed = uploadItems.filter((item) => item.status === "failed").length;
    if (processing > 0) return `${processing} file(s) uploading or processing.`;
    if (completed > 0 && failed === 0) return `${completed} file(s) completed.`;
    if (failed > 0) return `${failed} file(s) failed.`;
    return doneCount > 0 ? `${doneCount} file(s) uploaded.` : "";
  }, [doneCount, uploadItems]);

  const overallProgressPct = useMemo(() => {
    if (!busy || totalBytes <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((bytesUploaded / totalBytes) * 100)));
  }, [busy, bytesUploaded, totalBytes]);

  const uploadSpeedBps = useMemo(() => {
    if (!busy || !uploadStartedAt) return 0;
    const elapsedSeconds = (Date.now() - uploadStartedAt) / 1000;
    if (elapsedSeconds <= 0) return 0;
    return bytesUploaded / elapsedSeconds;
  }, [busy, bytesUploaded, uploadStartedAt]);

  const etaSeconds = useMemo(() => {
    if (!busy || totalBytes <= 0 || uploadSpeedBps <= 0) return null;
    return Math.max(0, (totalBytes - bytesUploaded) / uploadSpeedBps);
  }, [busy, totalBytes, bytesUploaded, uploadSpeedBps]);

  const handleBackToAlbum = () => {
    if (!config?.albumUrl) return;
    router.push(config.albumUrl);
  };

  const handleSubmit = async () => {
    if (!config || files.length === 0) return;
    setBusy(true);
    setError(null);
    setCompletionNotice("");
    setRedirectCountdown(null);
    const plannedTotalBytes = files.reduce((sum, file) => sum + file.size, 0);
    setTotalBytes(plannedTotalBytes);
    setBytesUploaded(0);
    setUploadStartedAt(Date.now());
    let completed = 0;
    let uploadedSoFar = 0;
    try {
      for (const file of files) {
        const fileId = buildFileId(file);
        setCurrentFileName(file.name);
        setUploadItems((prev) => prev.map((entry) => entry.id === fileId ? { ...entry, status: "uploading", message: "Uploading file…" } : entry));
        const checksumSha256 = await sha256Hex(file);
        const initRes = await fetch(`/api/public-upload/${token}/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            fileSizeBytes: file.size,
            checksumSha256,
            displayPreset: "4000",
            customerPublicConsent,
          }),
        });
        const initBody = await initRes.json().catch(() => ({}));
        if (!initRes.ok || initBody.success !== true) {
          throw new Error(initBody.error || "Could not initialize upload");
        }

        setUploadItems((prev) => prev.map((entry) => entry.id === fileId ? {
          ...entry,
          sessionId: initBody.data.sessionId,
          status: "uploading",
          message: "Uploading file…",
        } : entry));

        await putFileToSignedUrl(initBody.data.uploadUrl, file, file.type || "application/octet-stream", (loaded, total) => {
          setBytesUploaded(uploadedSoFar + loaded);
          const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setUploadItems((prev) => prev.map((entry) => entry.id === fileId ? {
            ...entry,
            status: "uploading",
            message: "Uploading file…",
            progressPct: pct,
          } : entry));
        });
        uploadedSoFar += file.size;
        setBytesUploaded(uploadedSoFar);
        const completeRes = await fetch(`/api/public-upload/${token}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: initBody.data.sessionId }),
        });
        const completeBody = await completeRes.json().catch(() => ({}));
        if (!completeRes.ok || completeBody.success !== true) {
          throw new Error(completeBody.error || "Could not finalize upload");
        }

        setUploadItems((prev) => prev.map((entry) => entry.id === fileId ? {
          ...entry,
          sessionId: initBody.data.sessionId,
          status: "uploaded",
          message: "Upload successful.",
          progressPct: 100,
        } : entry));

        completed += 1;
        setDoneCount(completed);
      }
      const isPublicFlow = !config.forcedPrivate && customerPublicConsent === true;
      setCompletionNotice(isPublicFlow
        ? "Upload complete. Your photos have entered the print queue. Image processing may take a few minutes. They will appear in the album shortly."
        : "Upload complete. Your photos have entered the print queue. Please wait a moment.");
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setCurrentFileName("");
    }
  };

  if (loading) {
    return <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6 text-sm text-muted-foreground">Loading upload link…</main>;
  }

  if (error && !config) {
    return <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6 text-sm text-destructive">{error}</main>;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Photo Upload</h1>
        <p className="text-sm text-muted-foreground">{config?.folderName}</p>
        <p className="text-sm text-muted-foreground">{summary}</p>
        <button
          type="button"
          onClick={handleBackToAlbum}
          className="inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to album
        </button>
      </div>

      {config?.requirePublicChoice ? (
        <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={customerPublicConsent}
            onChange={(e) => setCustomerPublicConsent(e.target.checked)}
          />
          I agree that these photos can appear in the public gallery
        </label>
      ) : null}

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy || files.length === 0}
          className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Uploading…" : "Start upload"}
        </button>
        <p className="text-xs text-muted-foreground">{files.length > 0 ? `${files.length} file(s) selected` : "Choose one or more images to upload."}</p>
        {busy && totalBytes > 0 ? (
          <div className="space-y-2 pt-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${overallProgressPct}%` }} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{currentFileName ? `Uploading ${currentFileName}` : "Uploading…"}</span>
              <span>{overallProgressPct}%</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{formatSpeed(uploadSpeedBps)}</span>
              <span>{formatEta(etaSeconds)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {statusSummary ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            {uploadItems.some((item) => item.status === "failed") ? (
              <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            ) : uploadItems.some((item) => item.status === "uploaded" || item.status === "processing" || item.status === "uploading") ? (
              <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            )}
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{statusSummary}</p>
            </div>
          </div>
          {uploadItems.length > 0 ? (
            <div className="mt-4 space-y-2">
              {uploadItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">{item.message}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-background px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {completionNotice ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">{completionNotice}</p>
          {redirectCountdown !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Returning to the album in {redirectCountdown}s.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </main>
  );
}
