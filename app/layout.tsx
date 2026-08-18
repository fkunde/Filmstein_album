import type { Metadata } from "next";
import "./globals.css";

const SNAPFLARE_VERSION = "v1.0.5";
const DEPLOY_COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "dev";
const GIT_SHORT_HASH = DEPLOY_COMMIT_SHA.slice(0, 7);

export const metadata: Metadata = {
  title: "Snapflare",
  description: "Photo project dashboard",
  icons: {
    icon: [{ url: `/icon?v=${GIT_SHORT_HASH}`, type: "image/svg+xml", sizes: "any" }],
    shortcut: [`/icon?v=${GIT_SHORT_HASH}`],
    apple: [{ url: `/apple-icon?v=${GIT_SHORT_HASH}`, sizes: "180x180", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border bg-background/90 px-4 py-3 text-center text-xs text-muted-foreground backdrop-blur">
          Snapflare by filmstein.com · © 2026 · {SNAPFLARE_VERSION} · #{GIT_SHORT_HASH}
        </footer>
      </body>
    </html>
  );
}
