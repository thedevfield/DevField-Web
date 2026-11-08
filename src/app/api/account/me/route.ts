import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { accountMe, authPost, BffError, clearAccountReauth, clearSession, failed, guard, matchesAccountDeletionContext, noStore, sessionHandle } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).search || request.headers.has("content-length") || request.headers.has("transfer-encoding"))
    return noStore({ code: "invalid_request" }, 400);
  try { return noStore(await accountMe()); }
  catch (error) {
    if (error instanceof BffError && error.status === 401 && await sessionHandle()) await clearSession();
    return failed(error);
  }
}

async function deletionPending() {
  await clearAccountReauth();
  return noStore({ deletionStatus: "DELETING" }, 202);
}

export async function DELETE(request: NextRequest) {
  try {
    await guard(request);
    const contentLength = request.headers.get("content-length");
    if (request.nextUrl.search || (contentLength !== null && contentLength !== "0") || request.headers.has("transfer-encoding"))
      throw new BffError(400, "invalid_request");
    const reader = request.body?.getReader();
    if (reader && !(await reader.read()).done) {
      await reader.cancel();
      throw new BffError(400, "invalid_request");
    }
    const handle = await sessionHandle();
    if (!handle) throw new BffError(401, "invalid_session");
    const retry = request.headers.get("x-devfield-deletion-retry") === "1";
    if (!retry && !matchesAccountDeletionContext(handle, request.headers.get("x-devfield-deletion-context")))
      throw new BffError(409, "account_session_changed");
    const jar = await cookies();
    const reauthFlow = request.headers.get("x-devfield-deletion-reauth-flow");
    if (!retry && reauthFlow !== null &&
        (!/^[A-Za-z0-9_-]{43}$/.test(reauthFlow) || jar.get("DF_ACCOUNT_REAUTH_FLOW")?.value !== reauthFlow))
      throw new BffError(403, "deletion_reauth_flow_changed");
    const proof = retry ? undefined : jar.get("DF_ACCOUNT_REAUTH")?.value;
    let result: Awaited<ReturnType<typeof authPost>>;
    try {
      result = await authPost("/api/account/me",
        proof && /^[A-Za-z0-9_-]{43}$/.test(proof) ? { reauthProof: proof } : undefined, handle, "DELETE");
    } catch (error) {
      if (error instanceof BffError && error.code === "auth_unavailable") {
        // Auth may have committed the request before the connection timed out.
        const profile = await accountMe().catch(statusError => {
          if (statusError instanceof BffError && statusError.status === 401) throw statusError;
          return null;
        });
        if (profile?.deletionStatus === "DELETING") return deletionPending();
      }
      throw error;
    }
    if (result.status === 202 && result.data.deletionStatus === "DELETING") return deletionPending();
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    await clearSession();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof BffError && error.status === 401) await clearSession();
    if (error instanceof BffError && error.code === "reauth_required") await clearAccountReauth();
    return failed(error);
  }
}
