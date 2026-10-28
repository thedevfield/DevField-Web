import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, boundedJson, BffError, digest, failed, guard, noStore, nonce, providerEnabled, requireSession } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const provider = body.provider;
    const intent = body.intent;
    if (intent !== "LOGIN" && intent !== "SIGNUP") throw new BffError(400, "invalid_oauth_intent");
    const selectAccount = body.selectAccount === true;
    if (body.selectAccount !== undefined && typeof body.selectAccount !== "boolean") throw new BffError(400, "invalid_request");
    if (typeof provider !== "string" || !providerEnabled(provider)) throw new BffError(503, "provider_unavailable");
    try { await requireSession(); throw new BffError(409, "logout_required"); }
    catch (error) { if (!(error instanceof BffError && error.status === 401)) throw error; }
    const flowId = nonce();
    const binding = nonce();
    const result = await authPost("/internal/auth/oauth-intents", { provider, browserBindingHash: digest(binding), returnRoute: `${intent}_COMPLETE`, flowId, selectAccount });
    const raw = result.data.authorizationUrl;
    if (result.status !== 201 || typeof raw !== "string") throw new BffError(503, "auth_unavailable");
    let url: URL;
    try { url = new URL(raw); }
    catch { throw new BffError(503, "auth_unavailable"); }
    const configured = new URL(process.env.AUTH_BROWSER_ORIGIN ?? "http://127.0.0.1:18080");
    if (url.origin !== configured.origin || url.pathname !== `/oauth2/authorization/${provider}` ||
        !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("intent") ?? "") || [...url.searchParams.keys()].some(x => x !== "intent") || url.hash)
      throw new BffError(503, "auth_unavailable");
    (await cookies()).set(`DF_OAUTH_${flowId}`, `${binding}.${intent}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 });
    return noStore({ authorizationUrl: raw });
  } catch (error) { return failed(error); }
}
