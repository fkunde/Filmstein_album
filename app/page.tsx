import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  CloudUpload,
  FolderKanban,
  ImageUp,
  LockKeyhole,
  Mail,
  Printer,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import SnapflareLogo from "@/components/SnapflareLogo";
import { Button } from "@/components/ui/button";
import { getAuthenticatedAdminUser } from "@/lib/auth/session";

export default async function Home() {
  const adminUser = await getAuthenticatedAdminUser();

  const capabilities = [
    {
      title: "Branded gallery publishing",
      detail:
        "Turn a project folder into a clean client-facing album with cover settings, share copy, selected photos, and a public link that feels ready to send.",
      icon: Sparkles,
    },
    {
      title: "Upload intake for teams and clients",
      detail:
        "Keep photographer imports, customer uploads, and production files tied to the same project so nothing lives in a side channel.",
      icon: ImageUp,
    },
    {
      title: "Access, watermark, and delivery control",
      detail:
        "Protect previews, unlock approved downloads, audit storage state, and keep every handoff clear before final delivery.",
      icon: ShieldCheck,
    },
    {
      title: "On-site print workflow",
      detail:
        "Move selected frames into a print queue for events, schools, and pop-up production desks without leaving the album workspace.",
      icon: Printer,
    },
  ];

  const workflow = [
    "Create a project and organize folders",
    "Upload team or customer photos",
    "Publish a polished share album",
    "Approve downloads or send prints",
  ];

  const audiences = ["Event teams", "Portrait studios", "School photo days", "Brand activations"];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-white/95 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex shrink-0 items-center" aria-label="Snapflare home">
            <SnapflareLogo compact markClassName="w-[8.75rem]" />
          </Link>
          <nav className="flex items-center gap-2">
            {adminUser ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/login?mode=register">
                Request access
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative -mt-16 min-h-[82vh] overflow-hidden border-b border-border pt-16">
        <Image
          src="/landing/snapflare-hero-studio.png"
          alt="A professional event photography delivery desk with camera gear, prints, and a gallery preview"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,12,22,0.86),rgba(7,12,22,0.58)_42%,rgba(7,12,22,0.16)_76%)]" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent,hsl(var(--background)))]" />

        <div className="container relative flex min-h-[calc(82vh-4rem)] items-center py-16">
          <div className="max-w-3xl text-white">
            <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white/82 backdrop-blur">
              <Zap className="h-4 w-4 text-[#7dd3fc]" />
              Private beta for photo delivery teams
            </div>
            <h1 className="text-5xl font-semibold leading-tight tracking-normal sm:text-6xl lg:text-7xl">
              Snapflare
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-9 text-white/82">
              A focused workspace for publishing client albums, collecting uploads, protecting previews, and running print delivery without scattering the job across five tools.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-white text-slate-950 hover:bg-white/90">
                <Link href="/login?mode=register">
                  Register with invite
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/35 bg-white/10 text-white hover:bg-white/18 hover:text-white">
                <Link href="/login">Existing user login</Link>
              </Button>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-white/76">
              Need an invite code? Email{" "}
              <a href="mailto:info@filmstein.com" className="font-semibold text-white underline-offset-4 hover:underline">
                info@filmstein.com
              </a>{" "}
              with the workflow you want to run.
            </p>
            {adminUser ? (
              <p className="mt-4 text-sm text-white/72">
                Signed in as {adminUser.username}. <Link href="/dashboard" className="font-medium text-white hover:underline">Open your dashboard</Link>.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background py-16">
        <div className="container grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">What Snapflare handles</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
              From first upload to final handoff
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              The product is shaped around real production days: fast intake, presentable albums, clear access state, and a short path from selected image to delivered file or print.
            </p>
          </div>

          <div className="divide-y divide-border border-y border-border">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="grid gap-4 py-7 sm:grid-cols-[12rem_1fr]">
                  <div className="flex items-center gap-3 text-sm font-semibold text-foreground">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    {item.title}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-surface py-16">
        <div className="container">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="relative min-h-[28rem] overflow-hidden rounded-lg border border-border bg-background">
              <Image
                src="/landing/snapflare-hero-studio.png"
                alt="Camera gear and gallery preview for a photo delivery workflow"
                fill
                sizes="(min-width: 1024px) 52vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_20%,rgba(7,12,22,0.82))]" />
              <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                <p className="flex items-center gap-2 text-sm font-medium text-white/78">
                  <Camera className="h-4 w-4" />
                  Live production ready
                </p>
                <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-normal">
                  A public album that looks finished, backed by tools your team can actually operate.
                </h2>
              </div>
            </div>

            <div className="space-y-8">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-primary">Workflow</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground">
                  Keep the job moving in one line
                </h2>
              </div>
              <ol className="space-y-4">
                {workflow.map((step, index) => (
                  <li key={step} className="grid grid-cols-[2.5rem_1fr] items-start gap-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-foreground">
                      {index + 1}
                    </span>
                    <div className="border-b border-border pb-4">
                      <p className="font-medium text-foreground">{step}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-background py-16">
        <div className="container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">Private beta</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground">
              Built for teams who deliver images under time pressure
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Snapflare fits the moments where clients need a link now, selected photos need to be protected, and the production desk still has prints and uploads to finish.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <a href="mailto:info@filmstein.com">
                  Get an invite code
                  <Mail className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link href="/login">Log in</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {audiences.map((item) => (
              <div key={item} className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                {item}
              </div>
            ))}
            <div className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
              <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
              Project folders
            </div>
            <div className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
              <LockKeyhole className="h-4 w-4 shrink-0 text-primary" />
              Controlled access
            </div>
            <div className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
              <CloudUpload className="h-4 w-4 shrink-0 text-primary" />
              Customer upload links
            </div>
            <div className="flex min-h-16 items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm font-medium text-foreground">
              <Users className="h-4 w-4 shrink-0 text-primary" />
              Admin team workspace
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
