import { findFolderByCustomerUploadToken, shouldShowCustomerPublicChoice } from '@/lib/folderSettings'

export async function GET(_req: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params
    const folder = await findFolderByCustomerUploadToken(token)
    if (!folder) {
      return Response.json({ success: false, error: 'Upload link not found or disabled' }, { status: 404 })
    }

    const showPublicChoice = shouldShowCustomerPublicChoice({
      folderKind: folder.folder_kind,
      accessMode: folder.access_mode,
      settings: folder.settings,
    })
    const forcedPrivate = !showPublicChoice

    return Response.json({
      success: true,
      data: {
        projectId: folder.project_id,
        folderId: folder.id,
        folderName: folder.name,
        folderKind: folder.folder_kind,
        albumUrl: folder.access_mode === 'hidden'
          ? `/share/${folder.project_id}`
          : `/share/${folder.project_id}?album=${folder.id}`,
        allowCustomerUpload: true,
        defaultPublic: forcedPrivate ? false : folder.settings.customer_upload.default_public,
        requirePublicChoice: showPublicChoice,
        forcedPrivate,
      },
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
