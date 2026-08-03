export type ProjectStatus = "Draft" | "Reviewing" | "Delivered";
export type ProjectType = "Wedding" | "Event" | "Campaign";
export type PhotoStatus = "original" | "edited";
export type UserRole = "photographer" | "editor" | "client";
export type ColorLabel = "red" | "green" | "blue" | "yellow" | "purple" | "none";

export interface Project {
  id: string;
  name: string;
  createdByAdminUserId?: string;
  permissions?: {
    canDelete?: boolean;
    canManageAssignments?: boolean;
  };
  storage_state?: {
    location_mode?: 'r2' | 'node_local';
    holder_node_id?: string | null;
    holder_node_name?: string | null;
    holder_node_key?: string | null;
  };
  type: ProjectType;
  date: string;
  created_at?: string;
  cover_url: string;
  photoCount: number;
  storage_used_bytes?: number;
  status: ProjectStatus;
  clientName: string;
  description: string;
  ftp_ingest?: {
    enabled?: boolean;
    buffer_api_base_url?: string;
    project_code?: string;
    auto_sync_interval_seconds?: number;
    last_sync_at?: string | null;
  };
  project_assets?: {
    cover?: { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; version_token?: string };
    banner?: { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; version_token?: string };
    splash_poster?: { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; duration_seconds?: number; version_token?: string };
    loading_gif?: { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; version_token?: string };
    watermark_logo?: { url?: string; file_name?: string; mime_type?: string; file_size_bytes?: number; version_token?: string };
  };
  visual_settings?: {
    watermark?: {
      enabled?: boolean;
      position?: string;
      offset_x?: number;
      offset_y?: number;
      scale?: number;
      opacity?: number;
    };
    share_card?: {
      title?: string;
      subtitle?: string;
    };
    share_access?: {
      enabled?: boolean;
      has_password?: boolean;
    };
  };
}

export interface Album {
  id: string;
  name: string;
  photoCount: number;
  parentId?: string;
  kind?: 'standard' | 'print';
  accessMode?: 'public' | 'hidden' | 'password_protected';
  customerUploadEnabled?: boolean;
  customerUploadToken?: string;
  customerUploadDefaultPublic?: boolean;
  customerUploadRequirePublicChoice?: boolean;
  routingPrefixRules?: Array<{ prefix: string; enabled?: boolean; sources?: Array<'admin' | 'ftp' | 'customer_qr'> }>;
  printMode?: 'manual' | 'semi_auto' | 'auto';
  printRunnerStatus?: 'running' | 'paused';
  unlocked?: boolean;
  children?: Album[];
}

export interface PhotoClientMarkDetail {
  viewerSessionId: string;
  createdAt?: string;
  label: string;
}

export interface AdminUserIdentity {
  id: string;
  shortId?: string;
  username: string;
  role: "super_admin" | "admin";
}

export interface Photo {
  id: string;
  url: string;
  file_url: string;
  fileName: string;
  tag: string;
  selected: boolean;
  photoStatus: PhotoStatus;
  colorLabel: ColorLabel;
  uploadedAt: string;
  albumId?: string;
  folder?: string;
  folderId?: string;
  originalFileId?: string;
  retouchedFileId?: string;
  clientPreviewFileId?: string;
  thumbUrl?: string;
  displayUrl?: string;
  downloadUrl?: string;
  clientPreviewUrl?: string;
  clientPreviewWatermarkSignature?: string;
  projectWatermarkSignature?: string;
  retouchedOriginalUrl?: string;
  originalUrl?: string;
  versionCount?: number;
  latestVersionNo?: number;
  firstVersionNo?: number;
  isPublished?: boolean;
  uploadSource?: 'admin' | 'ftp' | 'customer_qr';
  customerPublicConsent?: boolean | null;
  printCode?: string;
  printCount?: number;
  lastPrintedAt?: string;
  clientMarked?: boolean;
  clientMarkCount?: number;
  hasClientMarks?: boolean;
  clientMarkDetails?: PhotoClientMarkDetail[];
  adminColorTags?: ColorLabel[];
  isPlaceholder?: boolean;
  processingState?: "uploading" | "uploaded" | "processing" | "failed";
  processingMessage?: string;
  uploadSessionId?: string;
}

export interface UploadFile {
  id: string;
  fileName: string;
  size: string;
  status: "Pending" | "Uploading" | "Completed" | "Failed";
  progress: number;
}

export const colorLabelMap: Record<ColorLabel, { bg: string; ring: string; label: string }> = {
  red:    { bg: "bg-red-500",    ring: "ring-red-500/30",    label: "Red" },
  green:  { bg: "bg-green-500",  ring: "ring-green-500/30",  label: "Green" },
  blue:   { bg: "bg-blue-500",   ring: "ring-blue-500/30",   label: "Blue" },
  yellow: { bg: "bg-yellow-400", ring: "ring-yellow-400/30", label: "Yellow" },
  purple: { bg: "bg-purple-500", ring: "ring-purple-500/30", label: "Purple" },
  none:   { bg: "",              ring: "",                    label: "None" },
};

export const mockAlbums: Album[] = [
  {
    id: "all",
    name: "All Photos",
    photoCount: 12,
  },
  {
    id: "ceremony",
    name: "Ceremony",
    photoCount: 4,
    children: [
      { id: "ceremony-prep", name: "Preparation", photoCount: 2 },
      { id: "ceremony-main", name: "Main Ceremony", photoCount: 2 },
    ],
  },
  {
    id: "portraits",
    name: "Portraits",
    photoCount: 3,
  },
  {
    id: "details",
    name: "Details & Products",
    photoCount: 3,
  },
  {
    id: "bts",
    name: "Behind the Scenes",
    photoCount: 2,
  },
];

export const mockProjects: Project[] = [
  {
    id: "1",
    name: "Summer Brand Campaign",
    type: "Campaign",
    date: "2026-03-15",
    cover_url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&h=400&fit=crop",
    photoCount: 248,
    status: "Reviewing",
    clientName: "Acme Co.",
    description: "Summer product launch campaign shoot across three locations.",
  },
  {
    id: "2",
    name: "Chen & Wang Wedding",
    type: "Wedding",
    date: "2026-02-20",
    cover_url: "https://images.unsplash.com/photo-1519741497674-611481863552?w=600&h=400&fit=crop",
    photoCount: 1024,
    status: "Delivered",
    clientName: "Chen Family",
    description: "Full-day wedding coverage including ceremony, reception, and portraits.",
  },
  {
    id: "3",
    name: "Tech Conference 2026",
    type: "Event",
    date: "2026-03-01",
    cover_url: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&h=400&fit=crop",
    photoCount: 512,
    status: "Reviewing",
    clientName: "TechCorp",
    description: "Annual tech conference event coverage.",
  },
  {
    id: "4",
    name: "Autumn Lookbook",
    type: "Campaign",
    date: "2026-01-10",
    cover_url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&h=400&fit=crop",
    photoCount: 86,
    status: "Draft",
    clientName: "Vogue Studio",
    description: "Fashion lookbook shoot for the autumn collection.",
  },
  {
    id: "5",
    name: "Product Flat Lays",
    type: "Campaign",
    date: "2026-03-28",
    cover_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&h=400&fit=crop",
    photoCount: 34,
    status: "Draft",
    clientName: "StartupXYZ",
    description: "Minimalist product photography for e-commerce catalog.",
  },
  {
    id: "6",
    name: "Corporate Gala Night",
    type: "Event",
    date: "2026-02-14",
    cover_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&h=400&fit=crop",
    photoCount: 320,
    status: "Delivered",
    clientName: "Global Finance Inc.",
    description: "Annual corporate gala event with awards ceremony.",
  },
];

export const projectPhotos: Photo[] = [
  { id: "1", url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb", fileName: "IMG_1001.jpg", tag: "Landscape", selected: true, photoStatus: "edited", colorLabel: "green", albumId: "ceremony", uploadedAt: "2026-03-15" },
  { id: "2", url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e", fileName: "IMG_1002.jpg", tag: "Landscape", selected: true, photoStatus: "edited", colorLabel: "green", albumId: "ceremony", uploadedAt: "2026-03-15" },
  { id: "3", url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e", fileName: "IMG_1003.jpg", tag: "Detail", selected: false, photoStatus: "original", colorLabel: "red", albumId: "details", uploadedAt: "2026-03-15" },
  { id: "4", url: "https://images.unsplash.com/photo-1519741497674-611481863552?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1519741497674-611481863552", fileName: "IMG_1004.jpg", tag: "Portrait", selected: true, photoStatus: "edited", colorLabel: "blue", albumId: "portraits", uploadedAt: "2026-03-15" },
  { id: "5", url: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1540575467063-178a50c2df87", fileName: "IMG_1005.jpg", tag: "Event", selected: false, photoStatus: "original", colorLabel: "none", albumId: "ceremony-prep", uploadedAt: "2026-03-14" },
  { id: "6", url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30", fileName: "IMG_1006.jpg", tag: "Event", selected: false, photoStatus: "original", colorLabel: "yellow", albumId: "ceremony-prep", uploadedAt: "2026-03-14" },
  { id: "7", url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470", fileName: "IMG_1007.jpg", tag: "Landscape", selected: false, photoStatus: "edited", colorLabel: "none", albumId: "portraits", uploadedAt: "2026-03-14" },
  { id: "8", url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05", fileName: "IMG_1008.jpg", tag: "Landscape", selected: false, photoStatus: "original", colorLabel: "purple", albumId: "portraits", uploadedAt: "2026-03-14" },
  { id: "9", url: "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d", fileName: "IMG_1009.jpg", tag: "Portrait", selected: false, photoStatus: "original", colorLabel: "none", albumId: "details", uploadedAt: "2026-03-13" },
  { id: "10", url: "https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1433086966358-54859d0ed716", fileName: "IMG_1010.jpg", tag: "Detail", selected: false, photoStatus: "edited", colorLabel: "green", albumId: "details", uploadedAt: "2026-03-13" },
  { id: "11", url: "https://images.unsplash.com/photo-1482938289607-e9573fc25ebb?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1482938289607-e9573fc25ebb", fileName: "IMG_1011.jpg", tag: "Landscape", selected: false, photoStatus: "original", colorLabel: "none", albumId: "bts", uploadedAt: "2026-03-13" },
  { id: "12", url: "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=400&h=300&fit=crop", file_url: "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07", fileName: "IMG_1012.jpg", tag: "Detail", selected: false, photoStatus: "original", colorLabel: "none", albumId: "bts", uploadedAt: "2026-03-13" },
];

export const mockUploadFiles: UploadFile[] = [
  { id: "1", fileName: "DSC_0421.jpg", size: "4.2 MB", status: "Completed", progress: 100 },
  { id: "2", fileName: "DSC_0422.jpg", size: "3.8 MB", status: "Completed", progress: 100 },
  { id: "3", fileName: "DSC_0423.jpg", size: "5.1 MB", status: "Uploading", progress: 67 },
  { id: "4", fileName: "DSC_0424.jpg", size: "4.5 MB", status: "Uploading", progress: 34 },
  { id: "5", fileName: "DSC_0425.jpg", size: "3.2 MB", status: "Failed", progress: 0 },
];
