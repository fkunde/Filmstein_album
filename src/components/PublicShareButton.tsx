"use client";

import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PublicShareDialog from "@/components/PublicShareDialog";

interface PublicShareButtonProps {
  projectId: string;
  projectName: string;
}

export default function PublicShareButton({ projectId, projectName }: PublicShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState(`/share/${projectId}`);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShareUrl(`${window.location.origin}/share/${projectId}`);
  }, [projectId]);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Share2 className="mr-1.5 h-4 w-4" />
        Share
      </Button>
      <PublicShareDialog
        open={open}
        onClose={() => setOpen(false)}
        shareUrl={shareUrl}
        title={projectName}
      />
    </>
  );
}
