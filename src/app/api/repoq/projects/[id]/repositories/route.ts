import type { NextRequest } from "next/server";
import { boundedJson, failed, guard, noStore } from "@/lib/server/auth";
import { addInput, additionOf, projectId, projectRequest, requestKey } from "@/lib/server/repoq";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await guard(request);
    const id = projectId((await params).id);
    const input = addInput(await boundedJson(request, 8192));
    const key = requestKey(request.headers.get("idempotency-key"));
    return noStore(additionOf(await projectRequest(`/api/projects/${id}/repositories`, "POST", 201, input, key)), 201);
  } catch (error) { return failed(error); }
}
