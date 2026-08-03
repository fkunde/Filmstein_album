"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, ShieldCheck, Ticket, UserCog, Users } from "lucide-react";

import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";

type AdminRole = "super_admin" | "admin";

type AdminUser = {
  id: string;
  short_id: string;
  username: string;
  is_active: boolean;
  role: AdminRole;
};

type InviteCode = {
  id: string;
  code: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  used_by_admin_user_id: string | null;
  used_by_username: string | null;
  used_at: string | null;
};

type AdminUsersResponse = {
  success?: boolean;
  data?: {
    users?: AdminUser[];
    inviteCodes?: InviteCode[];
  };
  error?: string;
  warning?: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Unused";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [inviteRole, setInviteRole] = useState<AdminRole>("admin");
  const [loading, setLoading] = useState(true);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const activeUsers = users.filter((user) => user.is_active).length;
    const openInvites = inviteCodes.filter((invite) => invite.is_active && !invite.used_by_admin_user_id).length;
    const usedInvites = inviteCodes.filter((invite) => Boolean(invite.used_by_admin_user_id)).length;
    return { activeUsers, openInvites, usedInvites };
  }, [inviteCodes, users]);

  const loadData = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/users");
    const body = (await res.json().catch(() => ({}))) as AdminUsersResponse;
    if (!res.ok || body.success !== true) {
      setError(body.error ?? "Failed to load user management data");
      return;
    }
    setUsers(body.data?.users ?? []);
    setInviteCodes(body.data?.inviteCodes ?? []);
    setError(body.warning ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      await loadData();
      if (!cancelled) setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const createInvite = async () => {
    setCreatingInvite(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: inviteRole }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: InviteCode; error?: string };
      if (!res.ok || body.success !== true || !body.data) {
        setError(body.error ?? "Failed to create invite code");
        return;
      }
      setInviteCodes((current) => [body.data!, ...current]);
    } finally {
      setCreatingInvite(false);
    }
  };

  const updateUser = async (userId: string, payload: { role?: AdminRole; isActive?: boolean }) => {
    setUpdatingUserId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: AdminUser; error?: string };
      if (!res.ok || body.success !== true || !body.data) {
        setError(body.error ?? "Failed to update user");
        return;
      }
      setUsers((current) => current.map((user) => (user.id === userId ? body.data! : user)));
    } finally {
      setUpdatingUserId(null);
    }
  };

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(null), 1600);
    } catch {
      setError("Failed to copy invite code");
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <Navbar
        breadcrumb={
          <div>
            <p className="text-sm font-semibold text-foreground">User management</p>
            <p className="text-xs text-muted-foreground">Super admin</p>
          </div>
        }
      />
      <main className="container space-y-6 py-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5">
            <Users className="h-5 w-5 text-primary" />
            <p className="mt-4 text-2xl font-semibold text-foreground">{users.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">{stats.activeUsers} active users</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <Ticket className="h-5 w-5 text-primary" />
            <p className="mt-4 text-2xl font-semibold text-foreground">{stats.openInvites}</p>
            <p className="mt-1 text-sm text-muted-foreground">open invite codes</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-5">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <p className="mt-4 text-2xl font-semibold text-foreground">{stats.usedInvites}</p>
            <p className="mt-1 text-sm text-muted-foreground">used invite codes</p>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Invite codes</h1>
              <p className="mt-1 text-sm text-muted-foreground">Generate single-use admin registration codes.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value === "super_admin" ? "super_admin" : "admin")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                aria-label="Invite role"
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Super admin</option>
              </select>
              <Button type="button" onClick={() => void createInvite()} disabled={creatingInvite}>
                {creatingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                Generate invite
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Code</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Used by</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td className="px-5 py-6 text-muted-foreground" colSpan={6}>Loading...</td>
                  </tr>
                ) : inviteCodes.length === 0 ? (
                  <tr>
                    <td className="px-5 py-6 text-muted-foreground" colSpan={6}>No invite codes yet.</td>
                  </tr>
                ) : (
                  inviteCodes.map((invite) => (
                    <tr key={invite.id}>
                      <td className="px-5 py-4 font-mono text-sm text-foreground">{invite.code}</td>
                      <td className="px-5 py-4 text-muted-foreground">{invite.role === "super_admin" ? "Super admin" : "Admin"}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                          {invite.used_by_admin_user_id ? "Used" : invite.is_active ? "Open" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">{invite.used_by_username ?? formatDate(invite.used_at)}</td>
                      <td className="px-5 py-4 text-muted-foreground">{formatDate(invite.created_at)}</td>
                      <td className="px-5 py-4">
                        <Button type="button" variant="outline" size="sm" onClick={() => void copyInviteCode(invite.code)}>
                          {copiedCode === invite.code ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {copiedCode === invite.code ? "Copied" : "Copy"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">Users</h2>
            <p className="mt-1 text-sm text-muted-foreground">Manage account access and roles.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">User</th>
                  <th className="px-5 py-3 font-medium">Short ID</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td className="px-5 py-6 text-muted-foreground" colSpan={5}>Loading...</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                            {user.username.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="font-medium text-foreground">{user.username}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{user.short_id}</td>
                      <td className="px-5 py-4">
                        <select
                          value={user.role}
                          disabled={updatingUserId === user.id}
                          onChange={(event) => void updateUser(user.id, { role: event.target.value === "super_admin" ? "super_admin" : "admin" })}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
                          aria-label={`Role for ${user.username}`}
                        >
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super admin</option>
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={updatingUserId === user.id}
                          onClick={() => void updateUser(user.id, { isActive: !user.is_active })}
                        >
                          {updatingUserId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
                          {user.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
