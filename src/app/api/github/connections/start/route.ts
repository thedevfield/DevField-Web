import type { NextRequest } from "next/server";
import { BffError, failed, guard, noStore } from "@/lib/server/auth";
import { jwt, project, saveAttempt, startOf } from "@/lib/server/github";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    if (request.headers.has("content-length") && request.headers.get("content-length") !== "0") throw new BffError(400, "invalid_request");
    const { handle, token } = await jwt();
    const attempt = startOf(await project("/api/github/connections/start", token, "POST"));
    await saveAttempt(attempt, handle);
    return noStore({ nextAction: attempt.kind, url: attempt.url, expiresAt: new Date(attempt.expiry).toISOString() });
  } catch (error) { return failed(error); }
}
