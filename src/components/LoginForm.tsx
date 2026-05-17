"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import SnapflareLogo from "@/components/SnapflareLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AuthMode = "login" | "register";

export default function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isDisabled = useMemo(
    () => submitting || username.trim().length === 0 || password.length === 0 || (mode === "register" && inviteCode.trim().length === 0),
    [inviteCode, mode, password.length, submitting, username],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, inviteCode, next: nextPath }),
      });

      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; next?: string };
      if (!res.ok || body.success !== true) {
        setError(body.error ?? (mode === "login" ? "Login failed" : "Registration failed"));
        return;
      }

      if (mode === "register") {
        setNotice("Registration successful");
      }
      router.replace(body.next || nextPath || "/");
      router.refresh();
    } catch {
      setError(mode === "login" ? "Login failed" : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex justify-center">
            <SnapflareLogo markClassName="!h-32 !w-auto sm:!h-36" />
          </div>
          <div className="text-center">
            <CardDescription>{mode === "login" ? "Log in to access the dashboard." : "Create an admin account with an invite code."}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium text-foreground">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Enter your username"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  className="pr-11"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {mode === "register" ? (
              <div className="space-y-2">
                <label htmlFor="inviteCode" className="text-sm font-medium text-foreground">
                  Invite Code
                </label>
                <Input
                  id="inviteCode"
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  placeholder="Enter your invite code"
                />
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="text-sm text-foreground" role="status">
                {notice}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={isDisabled}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? (mode === "login" ? "Signing in…" : "Registering…") : mode === "login" ? "Sign in" : "Register"}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-center">
            {mode === "login" ? (
              <button
                type="button"
                onClick={() => switchMode("register")}
                className="text-sm text-muted-foreground transition hover:text-foreground"
              >
                Register
              </button>
            ) : (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-sm text-muted-foreground transition hover:text-foreground"
              >
                Back to Sign in
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
