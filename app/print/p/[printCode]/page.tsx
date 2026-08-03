import Link from 'next/link'
import { notFound } from 'next/navigation'

import { loadPrintPhotoByCode } from '@/lib/printFlow'

type PageProps = {
  params: Promise<{ printCode: string }>
}

export default async function PrintPhotoPage({ params }: PageProps) {
  const { printCode } = await params
  const printPhoto = await loadPrintPhotoByCode(printCode)

  if (!printPhoto) {
    notFound()
  }

  const previewSrc = printPhoto.photo.displayUrl || printPhoto.photo.thumbUrl || printPhoto.photo.url
  const downloadHref = `/api/print/p/${printCode}/download`

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-10 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-white/55">Print Pickup</p>
          <h1 className="text-2xl font-semibold">{printPhoto.folder?.name || 'Print photo'}</h1>
          <p className="text-sm text-white/70">
            Print code: <span className="font-mono text-white">{printCode}</span>
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
            {previewSrc ? (
              <img src={previewSrc} alt={printPhoto.photo.fileName} className="h-full w-full object-contain" />
            ) : (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-white/60">Preview unavailable</div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-white/70">
              This QR code is bound to a controlled print entry, not a raw storage link. Use the button below to fetch the original file.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <a
                href={downloadHref}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90"
              >
                Download Original
              </a>
              {previewSrc ? (
                <Link
                  href={previewSrc}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/8"
                >
                  Open Preview
                </Link>
              ) : null}
            </div>
            <div className="mt-6 space-y-2 text-xs text-white/55">
              <p>Photo: {printPhoto.photo.fileName}</p>
              <p>Printed: {printPhoto.photo.printCount ?? 0} time(s)</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
