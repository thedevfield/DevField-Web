import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, setSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const flowId = stringField(body, "flowId", 43);
    const handoff = stringField(body, "handoff", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(flowId) || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) throw new BffError(400, "invalid_handoff");
    const jar = await cookies();
    const binding = jar.get(`DF_OAUTH_${flowId}`)?.value;
    if (!binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new BffError(400, "invalid_browser_binding");
    try { await requireSession(); throw new BffError(409, "logout_required"); }
    catch (error) { if (!(error instanceof BffError && error.status === 401)) throw error; }
    const result = await authPost("/internal/auth/oauth-handoffs/exchange", { handoff, browserBinding: binding, flowId });
    const handle = result.data.sessionHandle;
    if (result.status !== 200 || result.data.returnRoute !== "LOGIN_COMPLETE" || typeof handle !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(handle))
      throw new BffError(503, "auth_unavailable");
    await setSession(handle);
    jar.delete(`DF_OAUTH_${flowId}`);
    return noStore({ authenticated: true, next: "/app" });
  } catch (error) { return failed(error); }
}
