"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LogOut, Users } from "lucide-react";
import type { ReactNode } from "react";

import SnapflareLogo from "@/components/SnapflareLogo";
import { Button } from "@/components/ui/button";

type CurrentAdminUser = {
  id: string;
  shortId: string;
  username: string;
  role: "super_admin" | "admin";
};

const Navbar = ({ breadcrumb, actions }: { breadcrumb?: ReactNode; actions?: ReactNode }) => {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentAdminUser | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let cancelled = false;

    const loadCurrentUser = async () => {
      try {
        const res = await fetch("/api/admin/me");
        const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: CurrentAdminUser };
        if (!cancelled && res.ok && body.success && body.data) {
          setCurrentUser(body.data);
        }
      } catch {
        // ignore
      }
    };

    void loadCurrentUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const initials = useMemo(() => {
    const source = currentUser?.username?.trim() || "AD";
    return source.slice(0, 2).toUpperCase();
  }, [currentUser?.username]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const handleCopyUuid = async () => {
    if (!currentUser?.id) return;

    try {
      await navigator.clipboard.writeText(currentUser.shortId);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1600);
    }
  };

  return (
    <header className="border-b border-border bg-card">
      <div className="container grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-4 py-3 sm:flex sm:h-16 sm:items-center sm:justify-between sm:py-0">
        <div className="min-w-0 flex items-center gap-3 sm:gap-4 sm:flex-1">
          <Link href="/" className="flex shrink-0 items-center">
            <SnapflareLogo compact markClassName="w-[8.75rem]" />
          </Link>
          {breadcrumb && <div className="min-w-0 flex-1">{breadcrumb}</div>}
        </div>
        <div className="relative shrink-0 sm:order-3" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-left text-xs font-medium text-primary-foreground transition hover:opacity-90"
            aria-label="Open account menu"
          >
            {initials}
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl">
              <div className="space-y-1 border-b border-border pb-3">
                <p className="text-sm font-medium text-foreground">{currentUser?.username || "Admin"}</p>
                <p className="text-xs text-muted-foreground">{currentUser?.role === "super_admin" ? "Super admin" : "Admin"}</p>
              </div>

              <div className="space-y-2 py-3">
                {currentUser?.role === "super_admin" ? (
                  <Button asChild variant="ghost" size="sm" className="w-full justify-start">
                    <Link href="/admin/users" onClick={() => setMenuOpen(false)}>
                      <Users className="h-4 w-4" />
                      User management
                    </Link>
                  </Button>
                ) : null}

                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">Your short ID</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{currentUser?.shortId || "Loading…"}</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyUuid()} disabled={!currentUser?.id}>
                      {copyState === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry" : "Copy"}
                    </Button>
                  </div>
                </div>
              </div>

              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          ) : null}
        </div>
        {actions ? <div className="col-span-2 sm:order-2 sm:col-span-1 sm:ml-auto">{actions}</div> : null}
      </div>
    </header>
  );
};

export default Navbar;
