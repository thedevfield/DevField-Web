import type { NextRequest } from "next/server";
import { boundedJson, failed, guard, noStore } from "@/lib/server/auth";
import { createInput, listOf, projectRequest, registrationOf, requestKey } from "@/lib/server/repoq";

export async function GET(request: NextRequest) {
  try {
    if (new URL(request.url).search) return noStore({ code: "invalid_request" }, 400);
    return noStore(listOf(await projectRequest("/api/projects", "GET", 200)));
  } catch (error) { return failed(error); }
}
export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const input = createInput(await boundedJson(request, 8192));
    const key = requestKey(request.headers.get("idempotency-key"));
    return noStore(registrationOf(await projectRequest("/api/projects", "POST", 201, input, key)), 201);
  } catch (error) { return failed(error); }
}
