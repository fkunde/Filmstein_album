"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Loader2,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
  RefreshCw,
  Columns2,
  Rows3,
} from "lucide-react";
import type { Photo, Project } from "@/data/mockData";
import PhotoGrid, { type ViewMode } from "@/components/PhotoGrid";
import AlbumTree from "@/components/AlbumTree";
import ColorFilterBar from "@/components/ColorFilterBar";
import StatusBadge from "@/components/StatusBadge";
import type { ColorLabel } from "@/data/mockData";
import { buildAlbumsFromPhotos } from "@/lib/albumsFromPhotos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FolderMeta } from "@/lib/albumsFromPhotos";
import { getClientHeroImage } from "@/lib/clientWatermark";
import PublicShareButton from "@/components/PublicShareButton";

const VIEWER_SESSION_STORAGE_KEY = 'filmstein-viewer-session-id'

function getOrCreateViewerSessionId() {
  if (typeof window === 'undefined') return ''
  const existing = window.localStorage.getItem(VIEWER_SESSION_STORAGE_KEY)
  if (existing) return existing
  const created = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(VIEWER_SESSION_STORAGE_KEY, created)
  return created
}

const EmptyState = ({ message }: { message?: string }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <p className="text-sm text-muted-foreground">{message ?? "No photos yet."}</p>
  </div>
);

const AccessGate = ({
  title,
  description,
  password,
  placeholder,
  error,
  busy,
  submitLabel,
  backLabel,
  onPasswordChange,
  onSubmit,
  onBack,
}: {
  title: string
  description: string
  password: string
  placeholder: string
  error: string | null
  busy: boolean
  submitLabel: string
  backLabel: string
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}) => (
  <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center px-4 py-8 sm:min-h-[calc(100vh-11rem)]">
    <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-7">
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="space-y-3">
          <Input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) onSubmit()
            }}
          />
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <Button type="button" className="w-full" onClick={onSubmit} disabled={busy || !password.trim()}>
            {busy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Unlocking…</> : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  </section>
)

type ClientGalleryMode = 'grid' | 'masonry' | 'timeline'

type TimelineGroup = {
  key: string
  label: string
  photos: Photo[]
}

function getHourBucket(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || 'Unknown time'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:00`
}

function formatTimelineLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || 'Unknown time'
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function groupPhotosForTimeline(photos: Photo[], sortDir: 'asc' | 'desc') {
  const groups = new Map<string, Photo[]>()
  for (const photo of photos) {
    const key = getHourBucket(photo.uploadedAt || '')
    const list = groups.get(key) ?? []
    list.push(photo)
    groups.set(key, list)
  }

  const entries = Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: formatTimelineLabel(key),
    photos: [...items].sort((a, b) => {
      const ta = new Date(a.uploadedAt || 0).getTime()
      const tb = new Date(b.uploadedAt || 0).getTime()
      return sortDir === 'asc' ? ta - tb : tb - ta
    }),
  }))

  return entries.sort((a, b) => {
    const ta = new Date(a.key || 0).getTime()
    const tb = new Date(b.key || 0).getTime()
    return sortDir === 'asc' ? ta - tb : tb - ta
  })
}

const ClientGallery = ({
  photos: externalPhotos,
  presentation = "default",
}: {
  photos?: Photo[];
  presentation?: "default" | "preview";
}) => {
  const params = useParams();
  const id = params?.id as string | undefined;

  const [photos, setPhotos] = useState<Photo[]>(externalPhotos ?? []);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderMeta[]>([]);
  const [activeAlbum, setActiveAlbum] = useState("all");
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<ColorLabel | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<"date" | "name">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [galleryMode, setGalleryMode] = useState<ClientGalleryMode>('grid')
  const [splashVisible, setSplashVisible] = useState(false)
  const [splashCountdown, setSplashCountdown] = useState(0)
  const [viewerSessionId, setViewerSessionId] = useState('')
  const [requiresProjectPassword, setRequiresProjectPassword] = useState(false)
  const [projectUnlocked, setProjectUnlocked] = useState(true)
  const [projectPassword, setProjectPassword] = useState('')
  const [unlockingProject, setUnlockingProject] = useState(false)
  const [albumPassword, setAlbumPassword] = useState('')
  const [lockedAlbumId, setLockedAlbumId] = useState<string | null>(null)
  const [unlockingAlbum, setUnlockingAlbum] = useState(false)

  useEffect(() => {
    setViewerSessionId(getOrCreateViewerSessionId())
  }, [])

  useEffect(() => {
    if (!splashVisible) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [splashVisible])

  useEffect(() => {
    if (!id || !viewerSessionId) return;

    let cancelled = false;

    const loadProject = async () => {
      setLoading(true);
      setError(null);
      try {
        const projRes = await fetch(`/api/projects/${id}?publishedOnly=true&viewerSessionId=${encodeURIComponent(viewerSessionId)}`)
        const projBody = await projRes.json()

        if (!projRes.ok || projBody.success !== true) {
          if (!cancelled) setError('Could not load photos.')
          return
        }

        if (cancelled) return

        const fetched = (projBody.data?.photos ?? []) as Photo[]
        const nextProject = (projBody.data?.project as Project) ?? null
        const nextAccess = projBody.data?.access as { requiresProjectPassword?: boolean; projectUnlocked?: boolean } | undefined
        setPhotos(fetched)
        setProject(nextProject)
        setRequiresProjectPassword(nextAccess?.requiresProjectPassword === true)
        const nextProjectUnlocked = nextAccess?.projectUnlocked !== false
        setProjectUnlocked(nextProjectUnlocked)

        if (nextProjectUnlocked) {
          const foldersRes = await fetch(`/api/projects/${id}/folders?publishedOnly=true`)
          const foldersBody = await foldersRes.json().catch(() => ({}))
          if (!cancelled && foldersRes.ok && foldersBody.success === true) {
            setFolders(Array.isArray(foldersBody.data) ? foldersBody.data as FolderMeta[] : [])
          }
        } else {
          setFolders([])
        }

        const splashUrl = nextProject?.project_assets?.splash_poster?.url
        if (splashUrl) {
          const durationSeconds = Math.max(1, Number(nextProject.project_assets?.splash_poster?.duration_seconds ?? 3))
          setSplashCountdown(durationSeconds)
          setSplashVisible(true)
          const timeoutId = window.setTimeout(() => {
            setSplashVisible(false)
          }, durationSeconds * 1000)
          const intervalId = window.setInterval(() => {
            setSplashCountdown((prev) => Math.max(0, prev - 1))
          }, 1000)
          window.setTimeout(() => window.clearInterval(intervalId), durationSeconds * 1000)
          void timeoutId
        }
      } catch {
        if (!cancelled) setError('Could not load photos.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProject()

    return () => {
      cancelled = true;
    };
  }, [id, viewerSessionId]);

  const projectName = project?.name ?? (id ? `Project ${id}` : "Project");
  const projectDescription = project?.description?.trim() || "";
  const heroImage = getClientHeroImage(project);
  const loadingGif = project?.project_assets?.loading_gif?.url

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

  const [selections, setSelections] = useState<Set<string>>(
    new Set(photos.filter((p) => p.selected).map((p) => p.id)),
  );

  useEffect(() => {
    setSelections(new Set(photos.filter((p) => p.selected).map((p) => p.id)));
  }, [photos]);

  const activeAlbumMeta = useMemo(() => folders.find((folder) => folder.id === activeAlbum) || null, [folders, activeAlbum])

  const folderFiltered = useMemo(() => {
    if (activeAlbum === "all") return photos;
    return photos.filter((p) => (p.folderId ?? p.albumId) === activeAlbum);
  }, [photos, activeAlbum]);

  const filtered = useMemo(() => {
    const byColor =
      activeTag === "all"
        ? folderFiltered
        : folderFiltered.filter((p) => p.colorLabel === activeTag);
    const q = searchQuery.trim().toLowerCase();
    const searched = q
      ? byColor.filter((p) => p.fileName.toLowerCase().includes(q))
      : byColor;
    const mul = sortDir === "asc" ? 1 : -1;
    return [...searched].sort((a, b) => {
      if (sortKey === "name") return mul * a.fileName.localeCompare(b.fileName);
      const ta = new Date(a.uploadedAt || 0).getTime();
      const tb = new Date(b.uploadedAt || 0).getTime();
      return mul * (ta - tb);
    });
  }, [folderFiltered, activeTag, searchQuery, sortKey, sortDir]);

  const timelineGroups = useMemo<TimelineGroup[]>(() => groupPhotosForTimeline(filtered, sortDir), [filtered, sortDir])

  const downloadSelected = async () => {
    if (selections.size === 0) return;
    setDownloading(true);
    try {
      const photoIds = Array.from(selections);
      const res = await fetch("/api/photos/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds, clientSafe: true }),
      });
      if (!res.ok) {
        const errBody = await res.json();
        throw new Error(errBody.error || "Download failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "photos.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      alert(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const handleRefresh = async () => {
    if (!id || !viewerSessionId) return;
    try {
      const res = await fetch(`/api/projects/${id}?publishedOnly=true&viewerSessionId=${encodeURIComponent(viewerSessionId)}`);
      const body = await res.json();
      if (res.ok && body.success) {
        const nextProjectUnlocked = body.data?.access?.projectUnlocked !== false
        setPhotos(Array.isArray(body.data?.photos) ? body.data.photos as Photo[] : []);
        setProject((body.data?.project as Project) ?? null);
        setRequiresProjectPassword(body.data?.access?.requiresProjectPassword === true);
        setProjectUnlocked(nextProjectUnlocked);
        if (nextProjectUnlocked) {
          const fr = await fetch(`/api/projects/${id}/folders?publishedOnly=true`);
          const fb = await fr.json().catch(() => ({}));
          if (fr.ok && fb.success) setFolders(Array.isArray(fb.data) ? fb.data as FolderMeta[] : []);
        } else {
          setFolders([])
        }
      }
    } catch {
      // ignore
    }
  };

  const handleToggleClientMark = async (photo: Photo) => {
    if (!id || !viewerSessionId) return

    const res = await fetch(`/api/photos/${photo.id}/client-mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, viewerSessionId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success !== true) {
      alert(body.error || 'Mark update failed')
      return
    }

    const marked = body.data?.marked === true
    const clientMarkCount = Number(body.data?.clientMarkCount) || 0
    setPhotos((prev) => prev.map((item) => item.id === photo.id
      ? {
          ...item,
          clientMarked: marked,
          clientMarkCount,
          hasClientMarks: clientMarkCount > 0,
        }
      : item))
  }

  const handleAlbumSelect = (albumId: string) => {
    if (albumId === 'all') {
      setActiveAlbum('all')
      setLockedAlbumId(null)
      setAlbumPassword('')
      return
    }

    const album = folders.find((folder) => folder.id === albumId)
    if (album?.access_mode === 'password_protected' && album.unlocked !== true) {
      setLockedAlbumId(albumId)
      setActiveAlbum(albumId)
      return
    }

    setLockedAlbumId(null)
    setAlbumPassword('')
    setActiveAlbum(albumId)
  }

  const handleProjectUnlock = async () => {
    if (!id) return
    setUnlockingProject(true)
    setError(null)
    try {
      const res = await fetch(`/api/share/${id}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: projectPassword }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        setError(body?.error || 'Incorrect password')
        return
      }
      setProjectPassword('')
      setProjectUnlocked(true)
      await handleRefresh()
    } catch {
      setError('Incorrect password')
    } finally {
      setUnlockingProject(false)
    }
  }

  const handleAlbumUnlock = async () => {
    if (!id || !lockedAlbumId) return
    setUnlockingAlbum(true)
    setError(null)
    try {
      const res = await fetch(`/api/share/${id}/albums/${lockedAlbumId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: albumPassword }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.success !== true) {
        setError(body?.error || 'Incorrect album password')
        return
      }
      setAlbumPassword('')
      setLockedAlbumId(null)
      await handleRefresh()
    } catch {
      setError('Incorrect album password')
    } finally {
      setUnlockingAlbum(false)
    }
  }

  const cycleSort = () => {
    setSortDir((d) => (d === "desc" ? "asc" : "desc"));
  };

  const handleProjectGateBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    window.location.href = '/'
  }

  const handleAlbumGateBack = () => {
    setLockedAlbumId(null)
    setAlbumPassword('')
    setError(null)
    setActiveAlbum('all')
  }

  const cleanPreview = presentation === "preview";
  const showProjectPasswordGate = requiresProjectPassword && !projectUnlocked && !loading && !splashVisible
  const showAlbumPasswordGate = !showProjectPasswordGate && !!lockedAlbumId && activeAlbumMeta?.access_mode === 'password_protected' && activeAlbumMeta?.unlocked !== true
  const showSidebar = !cleanPreview && viewMode !== "list";

  if (cleanPreview) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-surface to-background">
        {splashVisible && project?.project_assets?.splash_poster?.url ? (
          <div className="fixed inset-0 z-50 overflow-hidden bg-black">
            <img
              src={project.project_assets.splash_poster.url}
              alt={projectName}
              className="absolute inset-0 h-[100dvh] w-full object-cover object-center md:object-contain"
            />
            <button
              type="button"
              onClick={() => setSplashVisible(false)}
              className="absolute left-1/2 top-[70%] inline-flex -translate-x-1/2 items-center rounded-full bg-black/55 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/65 md:top-[70%]"
            >
              {splashCountdown}s Skip
            </button>
          </div>
        ) : null}

        {loading && loadingGif ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm">
            <img src={loadingGif} alt="Loading" className="h-28 w-28 object-contain sm:h-36 sm:w-36" />
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-7xl bg-surface px-0 pt-0 pb-2 sm:px-3 sm:py-4 lg:px-8 lg:py-10">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p>
          ) : showProjectPasswordGate ? (
            <AccessGate
              title="Enter album password"
              description="This album is protected. Enter the password to continue."
              password={projectPassword}
              placeholder="Album password"
              error={error}
              busy={unlockingProject}
              submitLabel="Unlock Album"
              backLabel="Go back"
              onPasswordChange={setProjectPassword}
              onSubmit={() => void handleProjectUnlock()}
              onBack={handleProjectGateBack}
            />
          ) : showAlbumPasswordGate ? (
            <AccessGate
              title="Enter album password"
              description="This album is locked. Enter the password to view the photos inside."
              password={albumPassword}
              placeholder="Album password"
              error={error}
              busy={unlockingAlbum}
              submitLabel="Unlock Album"
              backLabel="Back to albums"
              onPasswordChange={setAlbumPassword}
              onSubmit={() => void handleAlbumUnlock()}
              onBack={handleAlbumGateBack}
            />
          ) : error ? (
            <p className="py-12 text-center text-sm text-destructive" role="alert">{error}</p>
          ) : (
            <div className="space-y-4 sm:space-y-5">
              <section>
                <div className="overflow-hidden bg-muted shadow-sm sm:rounded-2xl">
                  <div className="aspect-[1500/844] sm:aspect-[1500/844] lg:aspect-[1500/844]">
                    <img src={heroImage} alt={projectName} className="h-full w-full object-cover" />
                  </div>
                </div>
              </section>

              <section>
                <div className="border-y border-border bg-card p-4 shadow-sm sm:rounded-2xl sm:border sm:p-5 lg:p-6">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-3">
                        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{projectName}</h1>
                        {projectDescription ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{projectDescription}</p> : null}
                      </div>
                      {id ? <PublicShareButton projectId={id} projectName={projectName} /> : null}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-2.5 shadow-sm sm:p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => handleAlbumSelect('all')}
                        className={`shrink-0 rounded-full px-3 py-2 text-sm transition-colors ${activeAlbum === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'}`}
                      >
                        All Photos
                      </button>
                      {albumsForUi.filter((album) => album.id !== 'all').map((album) => (
                        <button
                          key={album.id}
                          type="button"
                          onClick={() => handleAlbumSelect(album.id)}
                          className={`shrink-0 rounded-full px-3 py-2 text-sm transition-colors ${activeAlbum === album.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'}`}
                        >
                          {album.name}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
                      <button type="button" onClick={() => setGalleryMode('grid')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${galleryMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'}`}>
                        <LayoutGrid className="h-4 w-4" /> Grid
                      </button>
                      <button type="button" onClick={() => setGalleryMode('masonry')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${galleryMode === 'masonry' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'}`}>
                        <Columns2 className="h-4 w-4" /> Masonry
                      </button>
                      <button type="button" onClick={() => setGalleryMode('timeline')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${galleryMode === 'timeline' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'}`}>
                        <Rows3 className="h-4 w-4" /> Timeline
                      </button>
                      <Button type="button" variant="outline" size="sm" onClick={cycleSort}>
                        <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
                        {sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
                      </Button>
                    </div>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
                    <p className="text-sm font-medium text-foreground">No published photos yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">This gallery is ready, but no published photos are available yet.</p>
                  </div>
                ) : galleryMode === 'timeline' ? (
                  <div className="space-y-8">
                    {timelineGroups.map((group) => (
                      <section key={group.key} className="space-y-3">
                        <div className="sticky top-2 z-10 inline-flex rounded-full bg-card px-3 py-1 text-sm font-medium text-foreground shadow-sm ring-1 ring-border">
                          {group.label}
                        </div>
                        <div className="border-l border-border/70 pl-4">
                          <PhotoGrid
                            photos={group.photos}
                            viewMode="grid"
                            selectedIds={[]}
                            cardVariant="overlay"
                            hideStatusBadge
                            hideMetaOverlay
                            hideDownloadButton
                            clientDownloadMode
                            forceSquareCards
                            project={project}
                            onToggleClientMark={handleToggleClientMark}
                            gridClassName="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 lg:gap-2.5 xl:grid-cols-5"
                          />
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <PhotoGrid
                    photos={filtered}
                    viewMode="grid"
                    selectedIds={[]}
                    cardVariant="overlay"
                    hideStatusBadge
                    hideMetaOverlay
                    hideDownloadButton
                    clientDownloadMode
                    forceSquareCards={galleryMode === 'grid'}
                    project={project}
                    onToggleClientMark={handleToggleClientMark}
                    gridClassName={galleryMode === 'masonry'
                      ? 'mx-auto max-w-7xl columns-2 gap-1.5 space-y-1.5 sm:columns-3 sm:gap-2 sm:space-y-2 lg:columns-4 lg:gap-2.5 lg:space-y-2.5 xl:columns-5'
                      : 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 lg:gap-2.5 xl:grid-cols-5 2xl:grid-cols-6'}
                  />
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={cleanPreview ? "min-h-screen bg-gradient-to-b from-background via-surface to-background" : "min-h-screen bg-surface"}>
      {!cleanPreview && <header className="border-b border-border bg-card">
        <div className="container flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <Link href="/" className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">Projects</Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium text-foreground">{projectName}</span>
            {project?.status && <StatusBadge status={project.status} />}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" title="Refresh" onClick={handleRefresh}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" variant="outline" onClick={downloadSelected} disabled={downloading || selections.size === 0}>
              {downloading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Downloading…</> : <><Download className="mr-1.5 h-3.5 w-3.5" />Download</>}
            </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              if (filtered.length === 0) return;
              setDownloadingAll(true);
              try {
                const photoIds = filtered.map((p) => p.id);
                const res = await fetch("/api/photos/download-zip", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ photoIds, clientSafe: true }),
                });
                if (!res.ok) {
                  const errBody = await res.json().catch(() => ({}));
                  throw new Error(errBody.error || "Download failed");
                }
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "photos.zip";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
              } catch (err) {
                console.error("Download all error:", err);
                alert(err instanceof Error ? err.message : "Download failed");
              } finally {
                setDownloadingAll(false);
              }
            }} disabled={downloadingAll}>
              {downloadingAll ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />…</> : <><Download className="mr-1.5 h-3.5 w-3.5" />Download All</>}
            </Button>
          </div>
        </div>
      </header>}

      <main className="container py-6">
        {loading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading photos…</p> : error ? <p className="py-12 text-center text-sm text-destructive" role="alert">{error}</p> : photos.length === 0 ? <EmptyState /> : (
          <div className="flex flex-col gap-6 lg:flex-row">
            {showSidebar && (
              <aside className="w-full shrink-0 space-y-4 lg:w-56">
                <div className="rounded-xl border border-border bg-card p-3">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Albums</h2>
                  <AlbumTree albums={albumsForUi} activeAlbumId={activeAlbum} onSelect={handleAlbumSelect} expandedIds={expandedAlbums} onToggle={(albumId) => {
                    setExpandedAlbums((prev) => {
                      const next = new Set(prev);
                      if (next.has(albumId)) next.delete(albumId); else next.add(albumId);
                      return next;
                    });
                  }} />
                </div>
              </aside>
            )}

            <div className="min-w-0 flex-1 space-y-4">
              {!cleanPreview && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
                      <button type="button" title="Grid" onClick={() => setViewMode("grid")} className={`rounded p-1.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><LayoutGrid className="h-4 w-4" /></button>
                      <button type="button" title="List" onClick={() => setViewMode("list")} className={`rounded p-1.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><List className="h-4 w-4" /></button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold">{filtered.length} photos</span>
                      <div className="relative min-w-[160px] max-w-xs flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="Search…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 pl-8" />
                      </div>
                      <ColorFilterBar active={activeTag} onChange={setActiveTag} />
                    </div>
                  </div>
                </>
              )}

              <PhotoGrid photos={filtered} viewMode={viewMode} selectedIds={Array.from(selections)} cardVariant="gallery" clientDownloadMode project={project} onToggleClientMark={handleToggleClientMark} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClientGallery;
