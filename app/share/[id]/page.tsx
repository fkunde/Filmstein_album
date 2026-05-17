import type { Metadata } from "next";
import { headers } from "next/headers";
import ClientGallery from "@/components/ClientGallery";
import { supabase } from "@/lib/supabase/server";
import { mapRowToProject } from "@/lib/mapProject";
import { mapRowToPhoto } from "@/lib/mapPhoto";
import {
  getFirstVersionFiles,
  getLatestVersionFiles,
  groupPhotoFilesByVersion,
  type PhotoFileRow,
} from "@/lib/photoVersions";

type PageProps = {
  params: Promise<{ id: string }>;
};

const DEFAULT_SHARE_ORIGIN = "https://snapflare.filmstein.com";
const DEFAULT_SHARE_DESCRIPTION = "Open this shared photo album on Snapflare.";
const DEFAULT_SHARE_IMAGE = "/default-cover.svg";

function readShareCardSettings(project: ReturnType<typeof mapRowToProject>) {
  const visualSettings = project.visual_settings && typeof project.visual_settings === "object"
    ? project.visual_settings as { share_card?: { title?: string; subtitle?: string } }
    : undefined;

  return {
    title: visualSettings?.share_card?.title?.trim() || "",
    subtitle: visualSettings?.share_card?.subtitle?.trim() || "",
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveOrigin(hostValue: string | null, protoValue: string | null) {
  if (hostValue) {
    return `${protoValue || "https"}://${hostValue}`;
  }

  const envOrigin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    DEFAULT_SHARE_ORIGIN;

  return trimTrailingSlash(envOrigin);
}

function toAbsoluteUrl(url: string, origin: string) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

function buildShareDescription(project: ReturnType<typeof mapRowToProject>) {
  const shareCard = readShareCardSettings(project);
  if (shareCard.subtitle) return shareCard.subtitle;

  const explicitDescription = project.description.trim();
  if (explicitDescription) return explicitDescription;
  if (project.clientName.trim()) {
    return `View ${project.name} shared for ${project.clientName.trim()} on Snapflare.`;
  }
  return DEFAULT_SHARE_DESCRIPTION;
}

function pickProjectCoverImage(project: ReturnType<typeof mapRowToProject>) {
  const assetCover = project.project_assets?.cover?.url?.trim();
  if (assetCover) return assetCover;

  const coverUrl = project.cover_url?.trim();
  if (coverUrl && coverUrl !== DEFAULT_SHARE_IMAGE) {
    return coverUrl;
  }

  return "";
}

async function fetchShareMeta(projectId: string, origin: string) {
  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !projectRow) {
    return null;
  }

  const project = mapRowToProject(projectRow as Record<string, unknown>);

  const { data: photoRow } = await supabase
    .from("photos")
    .select("global_photo_id, project_id, folder_id, original_file_id, retouched_file_id, color_label, status, metadata, updated_at, is_published")
    .eq("project_id", projectId)
    .eq("is_published", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let fallbackPhotoUrl = "";

  if (photoRow?.global_photo_id) {
    const { data: fileRows } = await supabase
      .from("photo_files")
      .select("id, photo_id, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at, branch_type, version_no")
      .eq("photo_id", photoRow.global_photo_id);

    const typedFileRows = (fileRows ?? []) as PhotoFileRow[];
    const latestVersion = getLatestVersionFiles(typedFileRows);
    const firstVersion = getFirstVersionFiles(typedFileRows);
    const versionCount = groupPhotoFilesByVersion(typedFileRows).length;

    const mappedPhoto = mapRowToPhoto({
      ...(photoRow as Record<string, unknown>),
      latest_original_file: latestVersion?.byBranch.original ?? null,
      latest_thumb_file: latestVersion?.byBranch.thumb ?? null,
      latest_display_file: latestVersion?.byBranch.display ?? null,
      latest_client_preview_file: latestVersion?.byBranch.client_preview ?? null,
      first_original_file: firstVersion?.byBranch.original ?? null,
      version_count: versionCount,
      latest_version_no: latestVersion?.versionNo ?? null,
      first_version_no: firstVersion?.versionNo ?? null,
    });

    fallbackPhotoUrl =
      mappedPhoto.displayUrl ||
      mappedPhoto.thumbUrl ||
      mappedPhoto.originalUrl ||
      mappedPhoto.url ||
      "";
  }

  const imageUrl = toAbsoluteUrl(
    pickProjectCoverImage(project) || fallbackPhotoUrl || DEFAULT_SHARE_IMAGE,
    origin,
  );

  const pageUrl = `${origin}/share/${projectId}`;
  const shareCard = readShareCardSettings(project);
  const title = shareCard.title || project.name.trim() || "Snapflare Share";
  const description = buildShareDescription(project);

  return {
    title,
    description,
    imageUrl,
    pageUrl,
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const headerStore = await headers();
  const origin = resolveOrigin(
    headerStore.get("x-forwarded-host") || headerStore.get("host"),
    headerStore.get("x-forwarded-proto"),
  );

  const shareMeta = await fetchShareMeta(id, origin);

  if (!shareMeta) {
    const fallbackUrl = `${origin}/share/${id}`;
    const fallbackImage = toAbsoluteUrl(DEFAULT_SHARE_IMAGE, origin);
    return {
      title: "Snapflare Share",
      description: DEFAULT_SHARE_DESCRIPTION,
      alternates: {
        canonical: fallbackUrl,
      },
      openGraph: {
        type: "website",
        title: "Snapflare Share",
        description: DEFAULT_SHARE_DESCRIPTION,
        url: fallbackUrl,
        siteName: "Snapflare",
        images: [
          {
            url: fallbackImage,
            width: 1200,
            height: 630,
            alt: "Snapflare share cover",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "Snapflare Share",
        description: DEFAULT_SHARE_DESCRIPTION,
        images: [fallbackImage],
      },
    };
  }

  return {
    title: shareMeta.title,
    description: shareMeta.description,
    alternates: {
      canonical: shareMeta.pageUrl,
    },
    openGraph: {
      type: "website",
      title: shareMeta.title,
      description: shareMeta.description,
      url: shareMeta.pageUrl,
      siteName: "Snapflare",
      images: [
        {
          url: shareMeta.imageUrl,
          width: 1200,
          height: 630,
          alt: shareMeta.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareMeta.title,
      description: shareMeta.description,
      images: [shareMeta.imageUrl],
    },
  };
}

/** Public share page at /share/[id].
 *  Renders ClientGallery which fetches its own data reactively from /api/projects/[id]. */
export default async function SharePage(_props: PageProps) {
  return <ClientGallery presentation="preview" />;
}
