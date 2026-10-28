import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const flowId = stringField(body, "flowId", 43), handoff = stringField(body, "handoff", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(flowId) || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) throw new BffError(400, "invalid_handoff");
    const jar = await cookies(), binding = jar.get(`DF_ACCOUNT_OAUTH_${flowId}`)?.value;
    if (!binding) throw new BffError(400, "invalid_browser_binding");
    const handle = await requireSession();
    const result = await authPost("/internal/auth/oauth-handoffs/exchange", { flowId, handoff, browserBinding: binding, expectedPurpose: "ACCOUNT" }, handle);
    const route = result.data.returnRoute;
    if (route !== "LINK_COMPLETE" && route !== "REAUTH_COMPLETE") throw new BffError(503, "auth_unavailable");
    if (route === "REAUTH_COMPLETE") {
      const proof = result.data.reauthProof;
      if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new BffError(503, "auth_unavailable");
      jar.set("DF_ACCOUNT_REAUTH", proof, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/account", maxAge: 300 });
    }
    jar.delete(`DF_ACCOUNT_OAUTH_${flowId}`);
    return noStore({ next: route === "LINK_COMPLETE" ? "/account?status=linked" : "/account?status=reauthenticated" });
  } catch (error) { return failed(error); }
}
