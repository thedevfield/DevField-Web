import type { NextRequest } from "next/server";
import { BffError, failed, guard } from "@/lib/server/auth";
import { projectId, projectRequest } from "@/lib/server/repoq";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    await guard(request);
    if (new URL(request.url).search || (request.headers.has("content-length") && request.headers.get("content-length") !== "0"))
      throw new BffError(400, "invalid_request");
    const { id, memberId } = await params;
    await projectRequest(`/api/projects/${projectId(id)}/repositories/${projectId(memberId)}`, "DELETE", 204);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return failed(error); }
}
