import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, sessionHandle, setSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    if (await sessionHandle()) {
      try { await requireSession(); throw new BffError(409, "logout_required"); }
      catch (error) { if (!(error instanceof BffError && error.status === 401)) throw error; }
    }
    const body = await boundedJson(request);
    const email = stringField(body, "email", 320).trim().toLowerCase();
    const password = stringField(body, "password", 256);
    if (!/^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]+$/.test(email) || !password) throw new BffError(400, "invalid_request");
    const result = await authPost("/api/auth/login", { email, password });
    const handle = result.data.sessionHandle;
    if (result.status !== 200 || typeof handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(handle)) throw new BffError(503, "auth_unavailable");
    await setSession(handle);
    return noStore({ authenticated: true });
  } catch (error) { return failed(error); }
}
