import AdminUsersPage from "@/components/AdminUsersPage";
import { requireSuperAdminPageAuth } from "@/lib/auth/session";

export default async function AdminUsersRoute() {
  await requireSuperAdminPageAuth("/admin/users");
  return <AdminUsersPage />;
}
