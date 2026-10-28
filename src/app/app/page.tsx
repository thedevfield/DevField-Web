import { redirect } from "next/navigation";
import { BffError, requireSession } from "@/lib/server/auth";
import { WorkspaceHome, WorkspaceStatus } from "@/components/workspace/WorkspaceHome";

export const dynamic = "force-dynamic";
export default async function AppPage() {
  let status: "active" | "forbidden" | "unavailable" = "active";
  try { await requireSession(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    status = error instanceof BffError && error.status === 403 ? "forbidden" : "unavailable";
  }
  return status === "active" ? <WorkspaceHome /> : <WorkspaceStatus status={status} />;
}
