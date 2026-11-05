import type { NextRequest } from "next/server";
import { BffError, failed, guard, noStore } from "@/lib/server/auth";
import { disconnectionOf, jwt, project, safeConnectionId } from "@/lib/server/github";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  try {
    await guard(request);
    if (new URL(request.url).search || request.headers.has("transfer-encoding") ||
        request.headers.has("content-length") && request.headers.get("content-length") !== "0") throw new BffError(400, "invalid_request");
    if (request.body) {
      const reader = request.body.getReader();
      const first = await reader.read();
      if (!first.done && first.value.byteLength) { await reader.cancel(); throw new BffError(400, "invalid_request"); }
    }
    const id = safeConnectionId((await params).connectionId);
    const { token } = await jwt();
    return noStore(disconnectionOf(await project(`/api/github/connections/${id}`, token, "DELETE", undefined, 202), id), 202);
  } catch (error) { return failed(error); }
}
