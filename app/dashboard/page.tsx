import ProjectsHomePage from "@/components/ProjectsHomePage";
import { requireAdminPageAuth } from "@/lib/auth/session";

export default async function DashboardPage() {
  await requireAdminPageAuth("/dashboard");
  return <ProjectsHomePage />;
}
