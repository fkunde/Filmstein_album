"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Pause, Play, Printer, RefreshCw, XCircle } from "lucide-react";

import type { Photo } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type QueueStatus = "queued" | "printing" | "completed" | "cancelled" | "failed";
type QueueSourceMode = "manual" | "semi_auto" | "auto";
type QueueSourceReason = "admin_click" | "new_upload" | "ftp_route" | "customer_upload";

type PrintQueueItem = {
  id: string;
  projectId: string;
  folderId: string;
  photoId: string;
  printCodeSnapshot: string | null;
  requestedCopies: number;
  completedCopies: number;
  status: QueueStatus;
  sourceMode: QueueSourceMode;
  sourceReason: QueueSourceReason;
  errorMessage: string | null;
  createdByAdminUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PrintClientNode = {
  id: string;
  nodeKey: string;
  clientName: string | null;
  appVersion: string | null;
  platform: string | null;
  printerStatus: string;
  nodeStatus: string;
  isOnline: boolean;
  printerName: string | null;
  lastCheckAt: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  acceptNewJobs: boolean;
  maintenancePaused: boolean;
};

type FolderInfo = {
  id: string;
  name: string;
  print_mode?: "manual" | "semi_auto" | "auto";
  print_runner_status?: "running" | "paused";
};

type PrintQueuePanelProps = {
  projectId: string;
  folder: FolderInfo;
  photos: Photo[];
  onFolderChanged?: () => Promise<void> | void;
  onPhotoPrinted?: (photoId: string, printCount: number, lastPrintedAt?: string | null) => void;
};

const SOURCE_REASON_LABEL: Record<QueueSourceReason, string> = {
  admin_click: "Admin click",
  new_upload: "New upload",
  ftp_route: "FTP route",
  customer_upload: "Customer upload",
};

const STATUS_CLASSNAME: Record<QueueStatus, string> = {
  queued: "bg-slate-100 text-slate-700",
  printing: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
  failed: "bg-rose-100 text-rose-800",
};

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleString();
}

function normalizeCopies(value: string | number | undefined) {
  return String(Math.max(1, Math.floor(Number(value) || 1)));
}

export default function PrintQueuePanel({ projectId, folder, photos, onFolderChanged, onPhotoPrinted }: PrintQueuePanelProps) {
  const [items, setItems] = useState<PrintQueueItem[]>([]);
  const [nodes, setNodes] = useState<PrintClientNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiesByPhotoId, setCopiesByPhotoId] = useState<Record<string, string>>({});
  const [copiesByItemId, setCopiesByItemId] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);

  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const queueablePhotos = useMemo(
    () => photos.filter((photo) => photo.folderId === folder.id),
    [folder.id, photos],
  );

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/print/queue?folderId=${encodeURIComponent(folder.id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true || !Array.isArray(body.data)) {
        setError(body.error || "Could not load print queue");
        return;
      }
      setItems(body.data as PrintQueueItem[]);
      setNodes(Array.isArray(body.nodes) ? body.nodes as PrintClientNode[] : []);
      setCopiesByItemId(Object.fromEntries((body.data as PrintQueueItem[]).map((item) => [item.id, normalizeCopies(item.requestedCopies)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load print queue");
    } finally {
      setLoading(false);
    }
  }, [folder.id, projectId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const queuedItems = useMemo(() => items.filter((item) => item.status === "queued"), [items]);
  const printingItems = useMemo(() => items.filter((item) => item.status === "printing"), [items]);
  const historyItems = useMemo(
    () => items.filter((item) => item.status === "completed" || item.status === "cancelled" || item.status === "failed"),
    [items],
  );

  const handleSaveFolderPrintSettings = useCallback(async (printPatch: Record<string, unknown>) => {
    setSavingMode(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/folders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folder.id,
          settings: {
            print: printPatch,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        alert(body.error || "Could not update print settings");
        return;
      }
      await onFolderChanged?.();
      await loadQueue();
    } finally {
      setSavingMode(false);
    }
  }, [folder.id, loadQueue, onFolderChanged, projectId]);

  const handleAddToQueue = useCallback(async (photoId: string) => {
    const requestedCopies = Math.max(1, Number(copiesByPhotoId[photoId]) || 1);
    setBusyKey(`add:${photoId}`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/print/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: folder.id,
          photoId,
          requestedCopies,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        alert(body.error || "Could not add queue item");
        return;
      }
      const item = body.data as PrintQueueItem;
      setItems((prev) => [item, ...prev]);
      setCopiesByItemId((prev) => ({ ...prev, [item.id]: normalizeCopies(item.requestedCopies) }));
    } finally {
      setBusyKey(null);
    }
  }, [copiesByPhotoId, folder.id, projectId]);

  const handlePatchQueueItem = useCallback(async (item: PrintQueueItem, patch: Record<string, unknown>) => {
    setBusyKey(`${item.id}:${String(patch.status || "update")}`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/print/queue/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        alert(body.error || "Could not update queue item");
        return;
      }
      const nextItem = body.data?.item as PrintQueueItem;
      setItems((prev) => prev.map((entry) => entry.id === nextItem.id ? nextItem : entry));
      setCopiesByItemId((prev) => ({ ...prev, [nextItem.id]: normalizeCopies(nextItem.requestedCopies) }));
      if (body.data?.photo?.photoId && typeof body.data.photo.printCount === "number") {
        onPhotoPrinted?.(
          String(body.data.photo.photoId),
          Number(body.data.photo.printCount) || 0,
          typeof body.data.photo.lastPrintedAt === "string" ? body.data.photo.lastPrintedAt : null,
        );
      }
    } finally {
      setBusyKey(null);
    }
  }, [onPhotoPrinted, projectId]);

  const renderQueueRow = (item: PrintQueueItem) => {
    const photo = photoById.get(item.photoId);
    const requestedDraft = copiesByItemId[item.id] ?? normalizeCopies(item.requestedCopies);
    return (
      <div key={item.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">{photo?.fileName || item.photoId}</p>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSNAME[item.status]}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Code {item.printCodeSnapshot || "N/A"} · {SOURCE_REASON_LABEL[item.sourceReason]} · mode {item.sourceMode}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Created {formatDateTime(item.createdAt)}
              {item.startedAt ? ` · Started ${formatDateTime(item.startedAt)}` : ""}
              {item.completedAt ? ` · Finished ${formatDateTime(item.completedAt)}` : ""}
            </p>
            {item.errorMessage ? <p className="mt-1 text-xs text-rose-600">{item.errorMessage}</p> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {item.completedCopies > 0 ? `${item.completedCopies}/${item.requestedCopies} copies` : `${item.requestedCopies} copies`}
          </div>
        </div>

        {item.status === "queued" ? (
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex items-center gap-2">
              <Input
                value={requestedDraft}
                onChange={(e) => setCopiesByItemId((prev) => ({ ...prev, [item.id]: e.target.value }))}
                className="h-9 w-20"
                inputMode="numeric"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handlePatchQueueItem(item, { requestedCopies: Math.max(1, Number(requestedDraft) || 1) })}
                disabled={busyKey === `${item.id}:update`}
              >
                Save copies
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => void handlePatchQueueItem(item, { status: "printing" })} disabled={busyKey === `${item.id}:printing`}>
                Start printing
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void handlePatchQueueItem(item, { status: "cancelled" })} disabled={busyKey === `${item.id}:cancelled`}>
                Cancel
              </Button>
              {busyKey?.startsWith(item.id) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
          </div>
        ) : null}

        {item.status === "printing" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void handlePatchQueueItem(item, { status: "completed", completedCopies: item.requestedCopies })}
              disabled={busyKey === `${item.id}:completed`}
            >
              Mark completed
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handlePatchQueueItem(item, { status: "failed", errorMessage: "Marked failed from web queue" })}
              disabled={busyKey === `${item.id}:failed`}
            >
              Mark failed
            </Button>
            {busyKey?.startsWith(item.id) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        ) : null}
      </div>
    );
  };

  const onlineNodes = nodes.filter((node) => node.isOnline);
  const latestNode = nodes[0] ?? null;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">Print Queue</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {folder.name} · mode {folder.print_mode || "manual"} · runner {folder.print_runner_status || "paused"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={folder.print_mode || "manual"}
            onChange={(e) => void handleSaveFolderPrintSettings({ mode: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            disabled={savingMode}
          >
            <option value="manual">manual</option>
            <option value="semi_auto">semi_auto</option>
            <option value="auto">auto</option>
          </select>
          <Button
            type="button"
            variant={folder.print_runner_status === "running" ? "outline" : "default"}
            size="sm"
            onClick={() => void handleSaveFolderPrintSettings({ runner_status: "running" })}
            disabled={savingMode || folder.print_runner_status === "running"}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Start
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSaveFolderPrintSettings({ runner_status: "paused" })}
            disabled={savingMode || folder.print_runner_status === "paused"}
          >
            <Pause className="mr-1.5 h-3.5 w-3.5" />
            Pause
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => void loadQueue()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        `auto` mode only auto-enqueues new photos while the runner is `running`. This phase stops at queue control and state changes; it does not dispatch jobs to a desktop printer yet.
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Desktop client connection</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {onlineNodes.length > 0
                ? `${onlineNodes.length} online · ${nodes.length} known node${nodes.length === 1 ? "" : "s"}`
                : nodes.length > 0
                  ? `No recent heartbeat · ${nodes.length} known node${nodes.length === 1 ? "" : "s"}`
                  : "No desktop client heartbeat yet"}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${onlineNodes.length > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
            {onlineNodes.length > 0 ? "online" : "offline"}
          </span>
        </div>
        {latestNode ? (
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            <span>Node {latestNode.clientName || latestNode.nodeKey}</span>
            <span>Platform {latestNode.platform || "unknown"}</span>
            <span>Printer {latestNode.printerStatus}</span>
            <span>Seen {formatDateTime(latestNode.lastSeenAt) || "never"}</span>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Add Photos To Queue</h3>
          <span className="text-xs text-muted-foreground">{queueablePhotos.length} photo(s) in this print album</span>
        </div>
        {queueablePhotos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No photos in this print album yet.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {queueablePhotos.map((photo) => (
              <div key={photo.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{photo.fileName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Code {photo.printCode || "N/A"}
                    {typeof photo.printCount === "number" ? ` · Printed ${photo.printCount} time${photo.printCount === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={copiesByPhotoId[photo.id] ?? "1"}
                    onChange={(e) => setCopiesByPhotoId((prev) => ({ ...prev, [photo.id]: e.target.value }))}
                    className="h-9 w-20"
                    inputMode="numeric"
                  />
                  <Button type="button" size="sm" onClick={() => void handleAddToQueue(photo.id)} disabled={busyKey === `add:${photo.id}`}>
                    {busyKey === `add:${photo.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Add to queue
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-foreground">Waiting</h3>
            <span className="text-xs text-muted-foreground">{queuedItems.length}</span>
          </div>
          {queuedItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No queued items.</p>
          ) : (
            <div className="space-y-2">{queuedItems.map(renderQueueRow)}</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-foreground">Printing</h3>
            <span className="text-xs text-muted-foreground">{printingItems.length}</span>
          </div>
          {printingItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No printing items.</p>
          ) : (
            <div className="space-y-2">{printingItems.map(renderQueueRow)}</div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">History</h3>
          <span className="text-xs text-muted-foreground">{historyItems.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading queue…
          </div>
        ) : error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-700">{error}</p>
        ) : historyItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No historical items yet.</p>
        ) : (
          <div className="space-y-2">
            {historyItems.map((item) => {
              const photo = photoById.get(item.photoId);
              return (
                <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{photo?.fileName || item.photoId}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASSNAME[item.status]}`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Code {item.printCodeSnapshot || "N/A"} · {item.completedCopies}/{item.requestedCopies} copies
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.completedAt ? `Finished ${formatDateTime(item.completedAt)}` : `Created ${formatDateTime(item.createdAt)}`}
                    </p>
                    {item.errorMessage ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
                        <XCircle className="h-3.5 w-3.5" />
                        {item.errorMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
