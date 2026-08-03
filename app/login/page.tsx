import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getAuthenticatedAdminUser } from "@/lib/auth/session";

type PageProps = {
  searchParams: Promise<{ mode?: string; next?: string }>;
};

function normalizeNextPath(nextPath: string | undefined) {
  if (!nextPath) return "/dashboard";
  if (!nextPath.startsWith("/")) return "/dashboard";
  if (nextPath.startsWith("//")) return "/dashboard";
  if (nextPath === "/login") return "/dashboard";
  return nextPath;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const adminUser = await getAuthenticatedAdminUser();
  const { mode, next } = await searchParams;
  const nextPath = normalizeNextPath(next);
  const initialMode = mode === "register" ? "register" : "login";

  if (adminUser) {
    redirect(nextPath);
  }

  return <LoginForm initialMode={initialMode} nextPath={nextPath} />;
}
