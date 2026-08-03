import { notFound } from "next/navigation";

import PrintClient from "./PrintClient";
import { requireAdminPageAuth } from "@/lib/auth/session";
import { getProjectPermissionContext } from "@/lib/auth/projectPermissions";
import { loadPrintPhotoById } from "@/lib/printFlow";

type PageProps = {
  params: Promise<{ id: string; photoId: string }>;
};

export default async function ProjectPrintPage({ params }: PageProps) {
  const { id: projectId, photoId } = await params;
  const adminUser = await requireAdminPageAuth(`/projects/${projectId}/print/${photoId}`);
  const permission = await getProjectPermissionContext(adminUser, projectId);

  if (!permission.exists || !permission.canAccessProject) {
    notFound();
  }

  const printPhoto = await loadPrintPhotoById(photoId);
  if (!printPhoto || printPhoto.row.project_id !== projectId || printPhoto.folder?.folderKind !== "print") {
    notFound();
  }

  return (
    <PrintClient
      photoId={photoId}
      projectId={projectId}
      photoName={printPhoto.photo.fileName}
      printCode={printPhoto.photo.printCode}
      initialPrintCount={printPhoto.photo.printCount ?? 0}
      initialLastPrintedAt={printPhoto.photo.lastPrintedAt}
    />
  );
}
