"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

type PrintClientProps = {
  photoId: string;
  projectId: string;
  photoName: string;
  printCode?: string;
  initialPrintCount: number;
  initialLastPrintedAt?: string;
};

function formatLastPrinted(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export default function PrintClient({
  photoId,
  projectId,
  photoName,
  printCode,
  initialPrintCount,
  initialLastPrintedAt,
}: PrintClientProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [didAutoPrint, setDidAutoPrint] = useState(false);
  const [markingPrinted, setMarkingPrinted] = useState(false);
  const [printCount, setPrintCount] = useState(initialPrintCount);
  const [lastPrintedAt, setLastPrintedAt] = useState(initialLastPrintedAt);

  const printRenderSrc = useMemo(
    () => `/api/photos/${encodeURIComponent(photoId)}/print-render?projectId=${encodeURIComponent(projectId)}&ts=${encodeURIComponent(String(Date.now()))}`,
    [photoId, projectId],
  );

  useEffect(() => {
    if (!imageLoaded || didAutoPrint) return;
    const timer = window.setTimeout(() => {
      window.print();
      setDidAutoPrint(true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [didAutoPrint, imageLoaded]);

  const handlePrintAgain = () => {
    window.print();
  };

  const handleMarkPrinted = async () => {
    setMarkingPrinted(true);
    try {
      const res = await fetch(`/api/photos/${encodeURIComponent(photoId)}/mark-printed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true) {
        alert(body.error || "Could not update print status");
        return;
      }

      setPrintCount(Number(body.data?.printCount) || 0);
      setLastPrintedAt(typeof body.data?.lastPrintedAt === "string" ? body.data.lastPrintedAt : undefined);
    } finally {
      setMarkingPrinted(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <style>{`@media print { .screen-only { display: none !important; } body { background: white !important; } }`}</style>
      <div className="screen-only mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{photoName}</p>
          <p className="mt-1 text-xs text-white/60">
            {printCode ? `Print code: ${printCode}` : "Print preview"}
            {printCount > 0 ? ` · Printed ${printCount} time${printCount === 1 ? "" : "s"}` : " · Not printed yet"}
            {lastPrintedAt ? ` · Last printed: ${formatLastPrinted(lastPrintedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handlePrintAgain}>
            Print again
          </Button>
          <Button type="button" onClick={() => void handleMarkPrinted()} disabled={markingPrinted}>
            {markingPrinted ? "Saving…" : "Mark as printed"}
          </Button>
          <Button type="button" variant="ghost" asChild>
            <Link href={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link>
          </Button>
        </div>
      </div>
      <div className="flex min-h-screen items-center justify-center px-6 py-6 print:min-h-0 print:p-0">
        <img
          src={printRenderSrc}
          alt={photoName}
          className="max-h-[calc(100vh-5rem)] max-w-full object-contain print:max-h-none print:max-w-none"
          onLoad={() => setImageLoaded(true)}
        />
      </div>
    </div>
  );
}
