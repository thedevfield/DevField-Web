import type { NextRequest } from "next/server";
import { authPost, BffError, clearSession, failed, guard, noStore, sessionHandle } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const handle = await sessionHandle();
    if (handle) {
      try { const result = await authPost("/api/auth/logout", undefined, handle); if (result.status !== 204) throw new BffError(503, "auth_unavailable"); }
      catch (error) { if (!(error instanceof BffError && error.status === 401)) throw error; }
    }
    await clearSession();
    return noStore({ authenticated: false });
  } catch (error) { return failed(error); }
}
