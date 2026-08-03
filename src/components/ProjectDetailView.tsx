"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import Navbar from "@/components/Navbar";
import {
  ArrowLeft,
  Upload,
  Share2,
  Eye,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Pencil,
  Folder,
  Plus,
  X,
  Move,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  Paintbrush,
  Settings,
  Download,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import PhotoGrid, { type ViewMode } from "@/components/PhotoGrid";
import StatusBadge from "@/components/StatusBadge";
import AlbumTree from "@/components/AlbumTree";
import ColorFilterBar from "@/components/ColorFilterBar";
import UploadPanel from "@/components/UploadPanel";
import ProjectEditDialog from "@/components/ProjectEditDialog";
import ShareModal from "@/components/ShareModal";
import PrintQueuePanel from "@/components/PrintQueuePanel";
import type { ColorLabel, Album, Project, Photo } from "@/data/mockData";
import { buildAlbumsFromPhotos } from "@/lib/albumsFromPhotos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const tabs = ["Photos", "Selections"] as const;

interface FolderItem {
  id: string;
  name: string;
  parent_id?: string | null;
  folder_kind?: 'standard' | 'print';
  access_mode?: 'public' | 'hidden' | 'password_protected';
  has_password?: boolean;
  customer_upload_enabled?: boolean;
  customer_upload_default_public?: boolean;
  customer_upload_require_public_choice?: boolean;
  customer_upload_token?: string | null;
  routing_prefix_rules?: Array<{ prefix: string; enabled?: boolean; sources?: Array<'admin' | 'ftp' | 'customer_qr'> }>;
  print_mode?: 'manual' | 'semi_auto' | 'auto';
  print_runner_status?: 'running' | 'paused';
  print_client_token?: string | null;
  print_template_asset?: {
    url?: string;
    file_name?: string;
    mime_type?: string;
    file_size_bytes?: number;
    version_token?: string;
    bucket_name?: string;
    object_key?: string;
  } | null;
  print_qr_enabled?: boolean;
  print_qr_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  print_qr_size_ratio?: number;
  print_qr_offset_x?: number;
  print_qr_offset_y?: number;
  hidden_print_upload_forces_private?: boolean;
  customer_upload_public_choice_visible?: boolean;
  unlocked?: boolean;
  photo_count?: number;
}

type FolderConfigDraft = {
  accessMode: 'public' | 'hidden' | 'password_protected';
  password: string;
  folderKind: 'standard' | 'print';
  customerUploadEnabled: boolean;
  customerUploadDefaultPublic: boolean;
  customerUploadRequirePublicChoice: boolean;
  prefixRulesText: string;
  printMode: 'manual' | 'semi_auto' | 'auto';
  printQrEnabled: boolean;
  printQrPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  printQrSizeRatio: string;
  printQrOffsetX: string;
  printQrOffsetY: string;
}

const getAllAlbumIds = (albums: Album[]): string[] =>
  albums.flatMap((a) => [a.id, ...(a.children ? getAllAlbumIds(a.children) : [])]);

const getDescendantIds = (albums: Album[], parentId: string): string[] => {
  for (const a of albums) {
    if (a.id === parentId) return [a.id, ...(a.children ? getAllAlbumIds(a.children) : [])];
    if (a.children) {
      const found = getDescendantIds(a.children, parentId);
      if (found.length) return found;
    }
  }
  return [];
};

const findAlbum = (albums: Album[], id: string): Album | null => {
  for (const a of albums) {
    if (a.id === id) return a;
    if (a.children) {
      const found = findAlbum(a.children, id);
      if (found) return found;
    }
  }
  return null;
};

const getChildAlbums = (albums: Album[], parentId: string): Album[] => {
  if (parentId === "all") return albums;
  const parent = findAlbum(albums, parentId);
  return parent?.children ?? [];
};

export default function ProjectDetailView({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("Photos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState("all");
  const [colorFilter, setColorFilter] = useState<ColorLabel[]>([]);
  const [clientMarkedFilter, setClientMarkedFilter] = useState(false);
  const [publishFilter, setPublishFilter] = useState<"all" | "published" | "unpublished">("all");
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);
  const [managedFolderIds, setManagedFolderIds] = useState<Set<string>>(new Set());
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const [folderConfigDrafts, setFolderConfigDrafts] = useState<Record<string, FolderConfigDraft>>({});
  const [savingFolderAccessId, setSavingFolderAccessId] = useState<string | null>(null);
  const [uploadingPrintTemplateId, setUploadingPrintTemplateId] = useState<string | null>(null);
  const [removingPrintTemplateId, setRemovingPrintTemplateId] = useState<string | null>(null);
  const [copiedUploadFolderId, setCopiedUploadFolderId] = useState<string | null>(null);
  const [copiedPrintClientFolderId, setCopiedPrintClientFolderId] = useState<string | null>(null);
  const [uploadQrCodeByFolderId, setUploadQrCodeByFolderId] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "name">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [downloadingBatch, setDownloadingBatch] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [downloadChoiceOpen, setDownloadChoiceOpen] = useState(false);

  const fallbackShareCoverUrl = useMemo(() => {
    const preferred = [
      project?.project_assets?.cover?.url,
      project?.cover_url && project.cover_url !== "/default-cover.svg" ? project.cover_url : "",
      ...photos.flatMap((photo) => [photo.displayUrl, photo.thumbUrl, photo.originalUrl, photo.url]),
    ].find((value) => typeof value === "string" && value.trim());

    return preferred?.trim() || "";
  }, [photos, project]);

  const refreshFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data)) {
        setFolders(body.data);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      setProject(null);
      setPhotos([]);

      try {
        const [projectRes, foldersRes] = await Promise.all([
          fetch(`/api/projects/${projectId}`),
          fetch(`/api/projects/${projectId}/folders`),
        ]);

        if (cancelled) return;

        if (projectRes.status === 404) {
          setNotFound(true);
          return;
        }

        const projectJson: unknown = await projectRes.json().catch(() => ({}));
        const foldersJson: unknown = await foldersRes.json().catch(() => ({}));

        const projectBody = projectJson as {
          success?: boolean;
          error?: string;
          data?: { project?: Project; photos?: unknown };
        };
        const foldersBody = foldersJson as {
          success?: boolean;
          data?: FolderItem[];
        };

        if (projectRes.status >= 400 || projectBody.success === false) {
          setError(projectBody.error ?? `Request failed (${projectRes.status})`);
          return;
        }

        if (projectBody.data?.project && Array.isArray(projectBody.data.photos)) {
          setProject(projectBody.data.project);
          setPhotos(projectBody.data.photos as Photo[]);
          if (foldersBody.success && Array.isArray(foldersBody.data)) {
            setFolders(foldersBody.data);
          }
        } else {
          setError("Invalid response from server");
        }
      } catch {
        if (!cancelled) setError("Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const albumsForUi = useMemo(
    () => buildAlbumsFromPhotos(photos, folders),
    [photos, folders],
  );

  useEffect(() => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev);
      for (const a of albumsForUi) {
        if (a.children?.length) next.add(a.id);
      }
      return next;
    });
  }, [albumsForUi]);

  useEffect(() => {
    setFolderConfigDrafts((prev) => {
      const next = { ...prev }
      for (const folder of folders) {
        if (!next[folder.id]) {
          next[folder.id] = {
            accessMode: folder.access_mode || 'public',
            password: '',
            folderKind: folder.folder_kind || 'standard',
            customerUploadEnabled: folder.customer_upload_enabled === true,
            customerUploadDefaultPublic: folder.customer_upload_default_public !== false,
            customerUploadRequirePublicChoice: folder.customer_upload_require_public_choice !== false,
            prefixRulesText: (folder.routing_prefix_rules || []).map((rule) => rule.prefix).filter(Boolean).join(', '),
            printMode: folder.print_mode || 'manual',
            printQrEnabled: folder.print_qr_enabled !== false,
            printQrPosition: folder.print_qr_position || 'bottom-right',
            printQrSizeRatio: String(folder.print_qr_size_ratio ?? 0.18),
            printQrOffsetX: String(folder.print_qr_offset_x ?? 0),
            printQrOffsetY: String(folder.print_qr_offset_y ?? 0),
          }
        }
      }
      return next
    })
  }, [folders]);

  useEffect(() => {
    const uploadableFolders = folders.filter((folder) => folder.customer_upload_enabled && folder.customer_upload_token && origin);
    if (uploadableFolders.length === 0) {
      setUploadQrCodeByFolderId({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const nextEntries = await Promise.all(uploadableFolders.map(async (folder) => {
        const uploadUrl = `${origin}/upload/${folder.customer_upload_token}`;
        try {
          const dataUrl = await QRCode.toDataURL(uploadUrl, {
            errorCorrectionLevel: "H",
            margin: 2,
            width: 480,
            color: {
              dark: "#111111",
              light: "#ffffff",
            },
          });
          return [folder.id, dataUrl] as const;
        } catch {
          return [folder.id, ""] as const;
        }
      }));

      if (!cancelled) {
        setUploadQrCodeByFolderId(Object.fromEntries(nextEntries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [folders, origin]);

  const toggleExpand = (albumId: string) => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  };

  const filteredPhotos = useMemo(() => {
    let list = photos;

    if (activeAlbum !== "all") {
      const ids = getDescendantIds(albumsForUi, activeAlbum);
      list = list.filter((p) => {
        const aid = p.albumId ?? p.folderId;
        return aid && ids.includes(aid);
      });
    }

    if (activeTab === "Selections") {
      list = list.filter((p) => p.selected);
    }

    if (colorFilter.length > 0) {
      list = list.filter((p) => (p.adminColorTags ?? []).some((tag) => colorFilter.includes(tag)));
    }

    if (clientMarkedFilter) {
      list = list.filter((p) => p.hasClientMarks === true);
    }

    if (publishFilter === "published") {
      list = list.filter((p) => p.isPublished === true);
    } else if (publishFilter === "unpublished") {
      list = list.filter((p) => p.isPublished !== true);
    }

    return list;
  }, [activeAlbum, activeTab, clientMarkedFilter, colorFilter, publishFilter, photos, albumsForUi]);

  const displayPhotos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q ? filteredPhotos.filter((p) => p.fileName.toLowerCase().includes(q)) : filteredPhotos;
    const mul = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === "name") return mul * a.fileName.localeCompare(b.fileName);
      const ta = new Date(a.uploadedAt || 0).getTime();
      const tb = new Date(b.uploadedAt || 0).getTime();
      return mul * (ta - tb);
    });
    return list;
  }, [filteredPhotos, searchQuery, sortKey, sortDir]);

  const childAlbums = useMemo(
    () => getChildAlbums(albumsForUi, activeAlbum),
    [activeAlbum, albumsForUi],
  );
  const activePrintFolder = useMemo(
    () => folders.find((folder) => folder.id === activeAlbum && folder.folder_kind === "print") || null,
    [activeAlbum, folders],
  );

  const handleAlbumClick = (albumId: string) => {
    setActiveAlbum(albumId);
    setExpandedAlbums((prev) => new Set([...prev, albumId]));
  };

  const albumBreadcrumb = useMemo(() => {
    if (activeAlbum === "all") return [];
    const trail: { id: string; name: string }[] = [];
    const walk = (albums: Album[], target: string): boolean => {
      for (const a of albums) {
        if (a.id === target) {
          trail.push({ id: a.id, name: a.name });
          return true;
        }
        if (a.children && walk(a.children, target)) {
          trail.unshift({ id: a.id, name: a.name });
          return true;
        }
      }
      return false;
    };
    walk(albumsForUi, activeAlbum);
    return trail;
  }, [activeAlbum, albumsForUi]);

  const showSidebar = viewMode !== "list";
  const [albumsOpen, setAlbumsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setAlbumsOpen(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const refreshPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body.success && Array.isArray(body.data?.photos)) {
        setPhotos(body.data.photos as Photo[]);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    const hasProcessingPhotos = photos.some((photo) => Boolean(photo.processingState) && photo.processingState !== "failed");
    if (!hasProcessingPhotos) return;

    const timer = window.setInterval(() => {
      void refreshPhotos();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [photos, refreshPhotos]);

  const toggleColorFilter = useCallback((color: ColorLabel) => {
    setColorFilter((prev) => prev.includes(color) ? prev.filter((value) => value !== color) : [...prev, color]);
  }, []);

  const handleToggleAdminColorTag = useCallback(async (photoId: string, color: Exclude<ColorLabel, 'none'>) => {
    const res = await fetch(`/api/photos/${photoId}/admin-color-tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, color }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success !== true) {
      console.error('Color tag toggle failed:', body.error)
      return
    }

    const nextTags = Array.isArray(body.data?.adminColorTags) ? body.data.adminColorTags as ColorLabel[] : []
    setPhotos((prev) => prev.map((photo) => photo.id === photoId ? { ...photo, adminColorTags: nextTags } : photo))
  }, [projectId])

  const handleRemoveClientMark = useCallback(async (photo: Photo, viewerSessionId: string) => {
    const res = await fetch(`/api/photos/${photo.id}/client-mark`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, viewerSessionId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success !== true) {
      console.error('Client mark removal failed:', body.error)
      return
    }

    const clientMarkDetails = Array.isArray(body.data?.clientMarkDetails) ? body.data.clientMarkDetails : []
    const clientMarkCount = Number(body.data?.clientMarkCount) || 0
    setPhotos((prev) => prev.map((item) => item.id === photo.id ? {
      ...item,
      clientMarkDetails,
      clientMarkCount,
      hasClientMarks: body.data?.hasClientMarks === true,
      clientMarked: item.clientMarked && item.clientMarkDetails?.some((mark) => mark.viewerSessionId === viewerSessionId)
        ? false
        : item.clientMarked,
    } : item))
  }, [projectId])

  const handleRefresh = async () => {
    await Promise.all([refreshPhotos(), refreshFolders()]);
  };

  const getFolderConfigDraft = (folder: FolderItem): FolderConfigDraft => folderConfigDrafts[folder.id] || {
    accessMode: folder.access_mode || 'public',
    password: '',
    folderKind: folder.folder_kind || 'standard',
    customerUploadEnabled: folder.customer_upload_enabled === true,
    customerUploadDefaultPublic: folder.customer_upload_default_public !== false,
    customerUploadRequirePublicChoice: folder.customer_upload_public_choice_visible !== false,
    prefixRulesText: (folder.routing_prefix_rules || []).map((rule) => rule.prefix).filter(Boolean).join(', '),
    printMode: folder.print_mode || 'manual',
    printQrEnabled: folder.print_qr_enabled !== false,
    printQrPosition: folder.print_qr_position || 'bottom-right',
    printQrSizeRatio: String(folder.print_qr_size_ratio ?? 0.18),
    printQrOffsetX: String(folder.print_qr_offset_x ?? 0),
    printQrOffsetY: String(folder.print_qr_offset_y ?? 0),
  }

  const handleCreateFolder = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          parentId: activeAlbum !== 'all' ? activeAlbum : null,
        }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshFolders();
      }
    } catch {
      // ignore
    }
  };

  const togglePhotoSelection = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPhotoIds(new Set());
    setMoveTargetFolderId("");
  }, []);

  const selectedManagedFolders = folders.filter((folder) => managedFolderIds.has(folder.id));

  useEffect(() => {
    setSelectedPhotoIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(photos.map((photo) => photo.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [photos]);

  const allVisibleSelected =
    displayPhotos.length > 0 && displayPhotos.every((p) => selectedPhotoIds.has(p.id));
  const someVisibleSelected = displayPhotos.some((p) => selectedPhotoIds.has(p.id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev);
        for (const p of displayPhotos) next.delete(p.id);
        return next;
      });
    } else {
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev);
        for (const p of displayPhotos) next.add(p.id);
        return next;
      });
    }
  };

  const handleBatchMove = async () => {
    if (selectedPhotoIds.size === 0) return;

    setMoving(true);
    try {
      const folderId = moveTargetFolderId === "" ? null : moveTargetFolderId;
      const res = await fetch("/api/photos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoIds: Array.from(selectedPhotoIds),
          folderId,
        }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshPhotos();
        clearSelection();
      } else {
        console.error("Move failed:", body.error);
      }
    } catch (err) {
      console.error("Move error:", err);
    } finally {
      setMoving(false);
    }
  };

  const handleDeleteCurrentVersion = async (photo: Photo) => {
    const versionNo = photo.latestVersionNo;
    if (!versionNo) return;

    const res = await fetch(`/api/photos/${photo.id}?mode=current-version&versionNo=${encodeURIComponent(String(versionNo))}`, {
      method: 'DELETE',
    });
    const body = await res.json();
    if (body.success) {
      await refreshPhotos();
    } else {
      console.error('Delete failed:', body.error);
    }
  };

  const handleDeleteAllVersions = async (photo: Photo) => {
    const res = await fetch(`/api/photos/${photo.id}?mode=all-versions`, {
      method: 'DELETE',
    });
    const body = await res.json();
    if (body.success) {
      await refreshPhotos();
    } else {
      console.error('Delete failed:', body.error);
    }
  };

  const handleBatchDelete = async (mode: 'current-version' | 'all-versions') => {
    if (selectedPhotoIds.size === 0) return;

    const selectedPhotos = displayPhotos.filter((p) => selectedPhotoIds.has(p.id));
    const photoIds = selectedPhotos.map((photo) => photo.id);

    if (photoIds.length === 0) return;

    setDeleting(true);
    try {
      const versionNoByPhotoId = Object.fromEntries(
        selectedPhotos
          .filter((photo) => typeof photo.latestVersionNo === 'number')
          .map((photo) => [photo.id, photo.latestVersionNo as number])
      );

      const res = await fetch('/api/photos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds,
          mode,
          versionNoByPhotoId: mode === 'current-version' ? versionNoByPhotoId : undefined,
        }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshPhotos();
        clearSelection();
      } else {
        console.error('Batch delete failed:', body.error);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleTogglePublish = async (photo: Photo, isPublished: boolean) => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/photos/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshPhotos();
      } else {
        console.error('Publish toggle failed:', body.error);
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleOpenPrint = useCallback((photo: Photo) => {
    if (typeof window === 'undefined') return
    window.open(`/projects/${encodeURIComponent(projectId)}/print/${encodeURIComponent(photo.id)}`, '_blank', 'noopener,noreferrer')
  }, [projectId])

  const handleMarkPrinted = useCallback(async (photo: Photo) => {
    const res = await fetch(`/api/photos/${photo.id}/mark-printed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success !== true) {
      alert(body.error || 'Could not update print status')
      return
    }

    const nextPrintCount = Number(body.data?.printCount) || 0
    const nextLastPrintedAt = typeof body.data?.lastPrintedAt === 'string' ? body.data.lastPrintedAt : undefined

    setPhotos((prev) => prev.map((item) => item.id === photo.id ? {
      ...item,
      printCount: nextPrintCount,
      lastPrintedAt: nextLastPrintedAt,
    } : item))
  }, [projectId])

  const handleQueuePhotoPrinted = useCallback((photoId: string, printCount: number, lastPrintedAt?: string | null) => {
    setPhotos((prev) => prev.map((item) => item.id === photoId ? {
      ...item,
      printCount,
      lastPrintedAt: lastPrintedAt || undefined,
    } : item))
  }, [])

  const handleBatchPublish = async (isPublished: boolean) => {
    if (selectedPhotoIds.size === 0) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/photos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: Array.from(selectedPhotoIds),
          isPublished,
        }),
      });
      const body = await res.json();
      if (body.success) {
        await refreshPhotos();
        clearSelection();
      } else {
        console.error('Batch publish failed:', body.error);
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleBatchDownload = async (variant: 'preview' | 'original') => {
    if (selectedPhotoIds.size === 0) return;
    setDownloadingBatch(true);
    try {
      const res = await fetch('/api/photos/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: Array.from(selectedPhotoIds),
          variant,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || 'Download failed');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = variant === 'original' ? 'photos-original.zip' : 'photos-preview.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      const skippedCount = Number(res.headers.get('X-Zip-Skipped-Count') || '0');
      if (skippedCount > 0) {
        alert(`${skippedCount} selected file(s) were skipped because they could not be downloaded.`);
      }

      setDownloadChoiceOpen(false);
    } catch (err) {
      console.error('Batch download failed:', err);
      alert('Download failed');
    } finally {
      setDownloadingBatch(false);
    }
  };

  const toggleManagedFolder = (folderId: string, checked: boolean) => {
    setManagedFolderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(folderId);
      else next.delete(folderId);
      return next;
    });
  };

  const handleRenameManagedFolder = async () => {
    if (selectedManagedFolders.length !== 1) return;
    const target = selectedManagedFolders[0];
    const name = renamingFolderName.trim();
    if (!name) return;

    const res = await fetch(`/api/projects/${projectId}/folders`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: target.id, name }),
    });
    const body = await res.json();
    if (body.success) {
      await refreshFolders();
      setRenamingFolderName(name);
    } else {
      console.error('Rename folder failed:', body.error);
    }
  };

  const handleSaveFolderAccess = async (folder: FolderItem) => {
    const draft = getFolderConfigDraft(folder)
    const prefixRules = draft.prefixRulesText
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .map((prefix) => ({ prefix, enabled: true, sources: ['admin', 'ftp'] }))
    setSavingFolderAccessId(folder.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: folder.id,
          accessMode: draft.accessMode,
          password: draft.accessMode === 'password_protected' ? draft.password : undefined,
          folderKind: draft.folderKind,
          settings: {
            customer_upload: {
              enabled: draft.customerUploadEnabled,
              default_public: draft.customerUploadDefaultPublic,
              require_public_choice: draft.customerUploadRequirePublicChoice,
            },
            routing: {
              prefix_rules: prefixRules,
            },
            print: {
              mode: draft.printMode,
              qr: {
                enabled: draft.printQrEnabled,
                position: draft.printQrPosition,
                size_ratio: Number(draft.printQrSizeRatio) || 0.18,
                offset_x: Number(draft.printQrOffsetX) || 0,
                offset_y: Number(draft.printQrOffsetY) || 0,
              },
            },
          },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        alert(body.error || 'Could not save album access')
        return
      }
      setFolderConfigDrafts((prev) => ({ ...prev, [folder.id]: { ...draft, password: '' } }))
      await refreshFolders()
      await refreshPhotos()
    } catch {
      alert('Could not save album access')
    } finally {
      setSavingFolderAccessId(null)
    }
  }

  const handleUploadPrintTemplate = async (folder: FolderItem, file: File | null) => {
    if (!file) return
    setUploadingPrintTemplateId(folder.id)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/folders/${folder.id}/print-template`, {
        method: 'POST',
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        alert(body.error || 'Could not upload print template')
        return
      }
      await refreshFolders()
    } catch {
      alert('Could not upload print template')
    } finally {
      setUploadingPrintTemplateId(null)
    }
  }

  const handleRemovePrintTemplate = async (folder: FolderItem) => {
    setRemovingPrintTemplateId(folder.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/folders/${folder.id}/print-template`, {
        method: 'DELETE',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        alert(body.error || 'Could not remove print template')
        return
      }
      await refreshFolders()
    } catch {
      alert('Could not remove print template')
    } finally {
      setRemovingPrintTemplateId(null)
    }
  }

  const printPreviewPhotoIds = useMemo(() => {
    const printFolderIds = new Set(folders.filter((folder) => folder.folder_kind === 'print').map((folder) => folder.id))
    return displayPhotos.filter((photo) => photo.folderId && printFolderIds.has(photo.folderId)).map((photo) => photo.id)
  }, [displayPhotos, folders])

  const handleRotateCustomerUploadToken = async (folder: FolderItem) => {
    setSavingFolderAccessId(folder.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: folder.id,
          rotateCustomerUploadToken: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        alert(body.error || 'Could not generate upload token')
        return
      }
      await refreshFolders()
    } catch {
      alert('Could not generate upload token')
    } finally {
      setSavingFolderAccessId(null)
    }
  }

  const handleCopyUploadLink = async (folder: FolderItem) => {
    if (!folder.customer_upload_token || !origin) return;
    const uploadUrl = `${origin}/upload/${folder.customer_upload_token}`;
    try {
      await navigator.clipboard.writeText(uploadUrl);
    } catch {
      const el = document.createElement("textarea");
      el.value = uploadUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedUploadFolderId(folder.id);
    window.setTimeout(() => setCopiedUploadFolderId((current) => current === folder.id ? null : current), 2000);
  }

  const handleRotatePrintClientToken = async (folder: FolderItem) => {
    setSavingFolderAccessId(folder.id)
    try {
      const res = await fetch(`/api/projects/${projectId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: folder.id,
          rotatePrintClientToken: true,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        alert(body.error || 'Could not generate print client token')
        return
      }
      await refreshFolders()
    } catch {
      alert('Could not generate print client token')
    } finally {
      setSavingFolderAccessId(null)
    }
  }

  const handleCopyPrintClientToken = async (folder: FolderItem) => {
    if (!folder.print_client_token) return
    try {
      await navigator.clipboard.writeText(folder.print_client_token)
    } catch {
      const el = document.createElement("textarea");
      el.value = folder.print_client_token;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopiedPrintClientFolderId(folder.id);
    window.setTimeout(() => setCopiedPrintClientFolderId((current) => current === folder.id ? null : current), 2000);
  }

  const handleDeleteManagedFolders = async () => {
    if (selectedManagedFolders.length === 0) return;
    const ok = window.confirm(`Delete ${selectedManagedFolders.length} sub-albums? Photos inside them will be moved back to All Photos.`);
    if (!ok) return;

    const res = await fetch(`/api/projects/${projectId}/folders`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderIds: selectedManagedFolders.map((folder) => folder.id) }),
    });
    const body = await res.json();
    if (body.success) {
      await Promise.all([refreshFolders(), refreshPhotos()]);
      setManagedFolderIds(new Set());
      setRenamingFolderName('');
    } else {
      console.error('Delete folders failed:', body.error);
    }
  };

  const cycleSort = () => {
    if (sortKey === "date") {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  };

  const heading = loading
    ? "Loading…"
    : error
      ? "Could not load project"
      : notFound
        ? "Project not found"
        : (project?.name?.trim() || "Untitled project");
  const showMeta = Boolean(project) && !notFound && !error && !loading;

  return (
    <div className="min-h-screen bg-surface">
      <Navbar
        breadcrumb={
          <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
            <Link
              href="/"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              Projects
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium text-foreground">{heading}</span>
            {showMeta && project && <StatusBadge status={project.status} />}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-3 hidden lg:inline-flex"
              onClick={() => setEditOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Project Settings
            </Button>
          </div>
        }
        actions={
          <div className="flex w-full items-center gap-2 lg:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 lg:hidden"
              onClick={() => setEditOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Settings className="mr-1.5 h-3.5 w-3.5" />
              Project Settings
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex h-9 w-9"
              title="Refresh"
              onClick={handleRefresh}
              disabled={loading || Boolean(error) || notFound}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="hidden lg:inline-flex" asChild>
              <Link
                href={`/projects/${projectId}/preview`}
                className={loading || error || notFound ? "pointer-events-none opacity-50" : undefined}
                onClick={(e) => {
                  if (loading || error || notFound) e.preventDefault();
                }}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Preview
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 lg:flex-none"
              onClick={() => setShareOpen(true)}
              disabled={loading || Boolean(error) || notFound}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              Share
            </Button>
          </div>
        }
      />

      <main className="container py-2 sm:py-6">
        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
          {showSidebar && (
            <aside className="w-full shrink-0 space-y-4 lg:w-56">
              <div className="w-full overflow-hidden rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setAlbumsOpen((prev) => !prev)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    {albumsOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Albums
                      </h2>
                      {activeAlbum !== 'all' && albumsOpen && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          New album will be created under the current album.
                        </p>
                      )}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setManageFoldersOpen(true)}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Manage albums"
                    >
                      <Settings className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAlbumsOpen(true);
                        setShowNewFolder(true);
                      }}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="New album"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {albumsOpen && (
                  <div className="mt-3">
                    <AlbumTree
                      albums={albumsForUi}
                      activeAlbumId={activeAlbum}
                      onSelect={setActiveAlbum}
                      expandedIds={expandedAlbums}
                      onToggle={toggleExpand}
                    />
                  </div>
                )}
              </div>
              <div className="hidden rounded-xl border border-border bg-card p-3 lg:block">
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setUploadOpen(true)}
                    disabled={loading || Boolean(error) || notFound}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Upload
                  </Button>
                  <div className="relative w-full min-w-0">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 pl-8"
                    />
                  </div>
                </div>
              </div>
            </aside>
          )}

          <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
            {/* DAM toolbar */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:hidden">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setUploadOpen(true)}
                    disabled={loading || Boolean(error) || notFound}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Upload
                  </Button>
                  <div className="relative w-full min-w-0 sm:flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 pl-8"
                    />
                  </div>
                </div>
                <div className="min-w-0 overflow-hidden lg:flex-none lg:max-w-[720px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <ColorFilterBar active="all" onChange={() => undefined} selectedColors={colorFilter} onToggleColor={toggleColorFilter} />
                    <button
                      type="button"
                      onClick={() => setClientMarkedFilter((prev) => !prev)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${clientMarkedFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                    >
                      Client Tagged
                    </button>
                    <select
                      value={publishFilter}
                      onChange={(e) => setPublishFilter(e.target.value as "all" | "published" | "unpublished")}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    >
                      <option value="all">All status</option>
                      <option value="published">Published</option>
                      <option value="unpublished">Unpublished</option>
                    </select>
                  </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto lg:justify-end">
                  <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                    <button
                      type="button"
                      title="Grid"
                      onClick={() => setViewMode("grid")}
                      className={`rounded p-1.5 transition-colors ${
                        viewMode === "grid" || viewMode === "browse"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="List"
                      onClick={() => setViewMode("list")}
                      className={`rounded p-1.5 transition-colors ${
                        viewMode === "list"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={cycleSort}
                    title={`Sort by ${sortKey} (${sortDir})`}
                  >
                    <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                    Sort
                  </Button>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as "date" | "name")}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="date">Date</option>
                    <option value="name">Name</option>
                  </select>
                </div>
              </div>

              {!showSidebar && (
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => setActiveAlbum("all")}
                    className={`hover:text-foreground ${activeAlbum === "all" ? "font-medium text-foreground" : ""}`}
                  >
                    All Photos
                  </button>
                  {albumBreadcrumb.map((crumb) => (
                    <span key={crumb.id} className="flex items-center gap-1.5">
                      <span>/</span>
                      <button
                        type="button"
                        onClick={() => setActiveAlbum(crumb.id)}
                        className="hover:text-foreground"
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {showNewFolder && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/50 p-3 sm:flex-row sm:items-center">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Album name"
                  className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      await handleCreateFolder(newFolderName);
                      setNewFolderName("");
                      setShowNewFolder(false);
                    }
                    if (e.key === "Escape") {
                      setShowNewFolder(false);
                      setNewFolderName("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  type="button"
                  onClick={async () => {
                    await handleCreateFolder(newFolderName);
                    setNewFolderName("");
                    setShowNewFolder(false);
                  }}
                >
                  Create
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewFolder(false);
                    setNewFolderName("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {selectedPhotoIds.size > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:flex-wrap sm:items-center">
                <span className="text-sm font-medium">{selectedPhotoIds.size} selected</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <select
                    value={moveTargetFolderId}
                    onChange={(e) => setMoveTargetFolderId(e.target.value)}
                    className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">All Photos</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button size="sm" onClick={handleBatchMove} disabled={moving || deleting || publishing}>
                  <Move className="mr-1 h-4 w-4" />
                  {moving ? "Moving…" : "Move"}
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => void handleBatchPublish(true)} disabled={deleting || moving || publishing || downloadingBatch}>
                  {publishing ? "Publishing…" : "Publish"}
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => void handleBatchPublish(false)} disabled={deleting || moving || publishing || downloadingBatch}>
                  {publishing ? "Publishing…" : "Unpublish"}
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => setDownloadChoiceOpen(true)} disabled={deleting || moving || publishing || downloadingBatch}>
                  {downloadingBatch ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                  {downloadingBatch ? 'Downloading…' : 'Download'}
                </Button>
                <Button size="sm" variant="destructive" type="button" onClick={() => setDeleteConfirmOpen(true)} disabled={deleting || moving || publishing || downloadingBatch}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            )}

            {activePrintFolder ? (
              <PrintQueuePanel
                projectId={projectId}
                folder={activePrintFolder}
                photos={displayPhotos}
                onFolderChanged={refreshFolders}
                onPhotoPrinted={handleQueuePhotoPrinted}
              />
            ) : null}

            {/* All files row */}
            {displayPhotos.length > 0 && selectedPhotoIds.size === 0 && (
              <div className="flex items-center gap-3 text-sm text-foreground">
                <span className="font-semibold text-foreground">{displayPhotos.length} photos</span>
                <label className="flex cursor-pointer items-center gap-2 hover:text-sky-600 transition-colors">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                  />
                  All files
                </label>
              </div>
            )}

            {loading && !error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
            ) : notFound ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                This project could not be found.
              </p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Photos could not be loaded.
              </p>
            ) : displayPhotos.length > 0 || childAlbums.length > 0 ? (
              <PhotoGrid
                photos={displayPhotos}
                viewMode={viewMode === "browse" ? "grid" : viewMode}
                albums={viewMode !== "browse" ? childAlbums : []}
                onAlbumClick={handleAlbumClick}
                onToggleSelect={togglePhotoSelection}
                selectedIds={Array.from(selectedPhotoIds)}
                cardVariant="gallery"
                onDeletePhoto={handleDeleteCurrentVersion}
                onDeleteAllVersions={handleDeleteAllVersions}
                onTogglePublish={handleTogglePublish}
                onToggleAdminColorTag={handleToggleAdminColorTag}
                onRemoveClientMark={handleRemoveClientMark}
                projectId={projectId}
                printPreviewPhotoIds={printPreviewPhotoIds}
                onOpenPrint={handleOpenPrint}
                onMarkPrinted={handleMarkPrinted}
              />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No photos match the current filters.
              </p>
            )}

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Link>
          </div>
        </div>
      </main>

      <UploadPanel
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
        initialFolderId={activeAlbum !== 'all' ? activeAlbum : undefined}
        folders={folders}
        onFolderCreated={refreshFolders}
        onUploadDone={refreshPhotos}
      />

      {project && (
        <ProjectEditDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          project={project}
          onSaved={(updated) => setProject(updated)}
        />
      )}

      {manageFoldersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Manage Albums</h2>
                <p className="text-sm text-muted-foreground">Single-select to rename, multi-select to delete.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setManageFoldersOpen(false)}>Close</Button>
            </div>
            <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto p-4 sm:p-6">
              <div className="space-y-2">
                {folders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No albums yet.</p>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {folders.map((folder) => {
                      const configDraft = getFolderConfigDraft(folder)
                      return (
                        <div key={folder.id} className="rounded-lg border border-border px-3 py-3 text-sm space-y-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={managedFolderIds.has(folder.id)}
                              onChange={(e) => {
                                toggleManagedFolder(folder.id, e.target.checked);
                                if (e.target.checked && managedFolderIds.size === 0) {
                                  setRenamingFolderName(folder.name);
                                }
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">{folder.name}</p>
                              <p className="text-xs text-muted-foreground">{folder.parent_id ? 'Sub-album' : 'Top-level album'} · {folder.access_mode || 'public'} · {folder.folder_kind || 'standard'}</p>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-3">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Access mode</label>
                              <select
                                value={configDraft.accessMode}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    accessMode: e.target.value as 'public' | 'hidden' | 'password_protected',
                                  },
                                }))}
                                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                              >
                                <option value="public">public</option>
                                <option value="hidden">hidden</option>
                                <option value="password_protected">password_protected</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Album password</label>
                              <Input
                                type="password"
                                value={configDraft.password}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    password: e.target.value,
                                  },
                                }))}
                                placeholder={folder.has_password ? 'Leave blank to keep current password' : 'Enter album password'}
                                disabled={configDraft.accessMode !== 'password_protected'}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Album kind</label>
                              <select
                                value={configDraft.folderKind}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    folderKind: e.target.value as 'standard' | 'print',
                                  },
                                }))}
                                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                              >
                                <option value="standard">standard</option>
                                <option value="print">print</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input
                                type="checkbox"
                                checked={configDraft.customerUploadEnabled}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    customerUploadEnabled: e.target.checked,
                                  },
                                }))}
                              />
                              Allow customer upload
                            </label>
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input
                                type="checkbox"
                                checked={configDraft.customerUploadDefaultPublic}
                                disabled={!configDraft.customerUploadEnabled || folder.hidden_print_upload_forces_private === true}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    customerUploadDefaultPublic: e.target.checked,
                                  },
                                }))}
                              />
                              Default public
                            </label>
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <input
                                type="checkbox"
                                checked={configDraft.customerUploadRequirePublicChoice}
                                disabled={!configDraft.customerUploadEnabled || folder.hidden_print_upload_forces_private === true}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    customerUploadRequirePublicChoice: e.target.checked,
                                  },
                                }))}
                              />
                              Show public consent checkbox
                            </label>
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-foreground">Print mode</label>
                              <select
                                value={configDraft.printMode}
                                disabled={configDraft.folderKind !== 'print'}
                                onChange={(e) => setFolderConfigDrafts((prev) => ({
                                  ...prev,
                                  [folder.id]: {
                                    ...getFolderConfigDraft(folder),
                                    ...prev[folder.id],
                                    printMode: e.target.value as 'manual' | 'semi_auto' | 'auto',
                                  },
                                }))}
                                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                              >
                                <option value="manual">manual</option>
                                <option value="semi_auto">semi_auto</option>
                                <option value="auto">auto</option>
                              </select>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-foreground">Auto-route filename prefixes</label>
                            <Input
                              value={configDraft.prefixRulesText}
                              onChange={(e) => setFolderConfigDrafts((prev) => ({
                                ...prev,
                                [folder.id]: {
                                  ...getFolderConfigDraft(folder),
                                  ...prev[folder.id],
                                  prefixRulesText: e.target.value,
                                },
                              }))}
                              placeholder="PNT, PRINT"
                            />
                            <p className="text-xs text-muted-foreground">Used only when upload has no explicit album. Applies to admin direct upload and FTP import.</p>
                          </div>

                          {configDraft.folderKind === 'print' ? (
                            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                              <div className="space-y-2">
                                <div>
                                  <p className="text-xs font-medium text-foreground">Print template</p>
                                  <p className="text-xs text-muted-foreground">Album-level border/template used only for print preview and print output.</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground hover:bg-muted">
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0] || null
                                        void handleUploadPrintTemplate(folder, file)
                                        e.currentTarget.value = ''
                                      }}
                                    />
                                    {uploadingPrintTemplateId === folder.id ? 'Uploading…' : 'Upload template'}
                                  </label>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleRemovePrintTemplate(folder)}
                                    disabled={!folder.print_template_asset || removingPrintTemplateId === folder.id}
                                  >
                                    {removingPrintTemplateId === folder.id ? 'Removing…' : 'Remove template'}
                                  </Button>
                                </div>
                                {folder.print_template_asset ? (
                                  <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">{folder.print_template_asset.file_name || 'Template configured'}</p>
                                    <img
                                      src={`/api/projects/${projectId}/folders/${folder.id}/print-template?v=${encodeURIComponent(folder.print_template_asset.version_token || '1')}`}
                                      alt={folder.print_template_asset.file_name || 'Print template'}
                                      className="max-h-48 rounded-md border border-border bg-background object-contain"
                                    />
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No template uploaded yet.</p>
                                )}
                              </div>

                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="flex items-center gap-2 text-xs text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={configDraft.printQrEnabled}
                                    onChange={(e) => setFolderConfigDrafts((prev) => ({
                                      ...prev,
                                      [folder.id]: {
                                        ...getFolderConfigDraft(folder),
                                        ...prev[folder.id],
                                        printQrEnabled: e.target.checked,
                                      },
                                    }))}
                                  />
                                  Enable print QR
                                </label>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-foreground">QR position</label>
                                  <select
                                    value={configDraft.printQrPosition}
                                    onChange={(e) => setFolderConfigDrafts((prev) => ({
                                      ...prev,
                                      [folder.id]: {
                                        ...getFolderConfigDraft(folder),
                                        ...prev[folder.id],
                                        printQrPosition: e.target.value as 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center',
                                      },
                                    }))}
                                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
                                  >
                                    <option value="top-left">top-left</option>
                                    <option value="top-right">top-right</option>
                                    <option value="bottom-left">bottom-left</option>
                                    <option value="bottom-right">bottom-right</option>
                                    <option value="center">center</option>
                                  </select>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-foreground">QR size ratio</label>
                                  <Input
                                    value={configDraft.printQrSizeRatio}
                                    onChange={(e) => setFolderConfigDrafts((prev) => ({
                                      ...prev,
                                      [folder.id]: {
                                        ...getFolderConfigDraft(folder),
                                        ...prev[folder.id],
                                        printQrSizeRatio: e.target.value,
                                      },
                                    }))}
                                    placeholder="0.18"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-foreground">QR offset X</label>
                                    <Input
                                      value={configDraft.printQrOffsetX}
                                      onChange={(e) => setFolderConfigDrafts((prev) => ({
                                        ...prev,
                                        [folder.id]: {
                                          ...getFolderConfigDraft(folder),
                                          ...prev[folder.id],
                                          printQrOffsetX: e.target.value,
                                        },
                                      }))}
                                      placeholder="0"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-foreground">QR offset Y</label>
                                    <Input
                                      value={configDraft.printQrOffsetY}
                                      onChange={(e) => setFolderConfigDrafts((prev) => ({
                                        ...prev,
                                        [folder.id]: {
                                          ...getFolderConfigDraft(folder),
                                          ...prev[folder.id],
                                          printQrOffsetY: e.target.value,
                                        },
                                      }))}
                                      placeholder="0"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {folder.hidden_print_upload_forces_private ? (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                              This hidden print album forces customer uploads to stay private. The upload page will skip the public consent checkbox.
                            </div>
                          ) : null}

                          {configDraft.folderKind === 'print' ? (
                            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="text-xs font-medium text-foreground">Desktop print client token</p>
                                  <p className="break-all text-xs text-muted-foreground">
                                    {folder.print_client_token || 'No token yet'}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void handleCopyPrintClientToken(folder)}
                                    disabled={!folder.print_client_token}
                                  >
                                    {copiedPrintClientFolderId === folder.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                                    {copiedPrintClientFolderId === folder.id ? 'Copied!' : 'Copy token'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void handleRotatePrintClientToken(folder)}
                                    disabled={savingFolderAccessId === folder.id}
                                  >
                                    {folder.print_client_token ? 'Rotate token' : 'Generate token'}
                                  </Button>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Use this token in the desktop client to bind directly to this print album without an admin login.
                              </p>
                            </div>
                          ) : null}

                          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-xs font-medium text-foreground">Customer upload link</p>
                                <p className="break-all text-xs text-muted-foreground">
                                  {folder.customer_upload_token && origin ? `${origin}/upload/${folder.customer_upload_token}` : folder.customer_upload_token ? `/upload/${folder.customer_upload_token}` : 'No token yet'}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => void handleCopyUploadLink(folder)}
                                  disabled={!folder.customer_upload_token || !origin}
                                >
                                  {copiedUploadFolderId === folder.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                                  {copiedUploadFolderId === folder.id ? 'Copied!' : 'Copy upload link'}
                                </Button>
                                <Button type="button" variant="outline" onClick={() => void handleRotateCustomerUploadToken(folder)} disabled={savingFolderAccessId === folder.id || !configDraft.customerUploadEnabled}>
                                  {folder.customer_upload_token ? 'Rotate token' : 'Generate token'}
                                </Button>
                              </div>
                            </div>
                            {folder.customer_upload_token ? (
                              <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
                                <div className="flex h-[120px] w-[120px] items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2">
                                  {uploadQrCodeByFolderId[folder.id] ? (
                                    <img
                                      src={uploadQrCodeByFolderId[folder.id]}
                                      alt={`Upload QR for ${folder.name}`}
                                      className="h-full w-full object-contain"
                                    />
                                  ) : (
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <p className="text-xs font-medium text-foreground">Upload QR code</p>
                                  <p className="text-xs text-muted-foreground">
                                    Scan to open the customer upload page directly.
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => void handleSaveFolderAccess(folder)}
                              disabled={savingFolderAccessId === folder.id || (configDraft.accessMode === 'password_protected' && !folder.has_password && !configDraft.password.trim())}
                            >
                              {savingFolderAccessId === folder.id ? 'Saving…' : 'Save album settings'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Rename selected album</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={renamingFolderName}
                    onChange={(e) => setRenamingFolderName(e.target.value)}
                    placeholder={selectedManagedFolders.length === 1 ? 'Album name' : 'Select one album to rename'}
                    disabled={selectedManagedFolders.length !== 1}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleRenameManagedFolder()} disabled={selectedManagedFolders.length !== 1 || !renamingFolderName.trim()}>
                    Rename
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Deleting albums moves their photos back to All Photos.</p>
                <Button type="button" variant="destructive" className="w-full sm:w-auto" onClick={() => void handleDeleteManagedFolders()} disabled={selectedManagedFolders.length === 0}>
                  Delete selected
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {downloadChoiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Batch Download</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose which version to download as a zip package.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDownloadChoiceOpen(false)} disabled={downloadingBatch}>
                Cancel
              </Button>
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => void handleBatchDownload('preview')} disabled={downloadingBatch}>
                Download Preview
              </Button>
              <Button type="button" className="w-full sm:w-auto" onClick={() => void handleBatchDownload('original')} disabled={downloadingBatch}>
                Download Original
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">Confirm Delete</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              You can delete the current version of the selected photos, or delete the photos and all their versions. This action cannot be undone.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={async () => {
                  await handleBatchDelete('current-version');
                  setDeleteConfirmOpen(false);
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete Current Version'}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={async () => {
                  await handleBatchDelete('all-versions');
                  setDeleteConfirmOpen(false);
                }}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete Photos'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {project && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={project.id}
          projectName={project.name}
          projectDescription={project.description}
          projectCoverUrl={fallbackShareCoverUrl}
          shareCardTitle={project.visual_settings?.share_card?.title}
          shareCardSubtitle={project.visual_settings?.share_card?.subtitle}
          onSaved={(nextShareCard) => {
            setProject((prev) => (
              prev
                ? {
                    ...prev,
                    visual_settings: {
                      ...prev.visual_settings,
                      share_card: nextShareCard,
                    },
                  }
                : prev
            ));
          }}
        />
      )}
    </div>
  );
}
