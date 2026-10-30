import type { NextRequest } from "next/server";
import { failed, noStore } from "@/lib/server/auth";
import { detailOf, projectId, projectRequest } from "@/lib/server/repoq";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (new URL(request.url).search) return noStore({ code: "invalid_request" }, 400);
    const id = projectId((await params).id);
    return noStore(detailOf(await projectRequest(`/api/projects/${id}`, "GET", 200)));
  } catch (error) { return failed(error); }
}
