import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, BffError, digest, failed, guard, noStore, nonce, providerEnabled, requireSession } from "@/lib/server/auth";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    await guard(request);
    const { provider } = await context.params;
    if (!providerEnabled(provider)) throw new BffError(503, "provider_unavailable");
    const handle = await requireSession();
    const flowId = nonce(), binding = nonce();
    const result = await authPost(`/api/account/reauth/social/${provider}`, { browserBindingHash: digest(binding), flowId }, handle);
    const url = result.data.authorizationUrl;
    if (result.status !== 201 || typeof url !== "string") throw new BffError(503, "auth_unavailable");
    const parsed = new URL(url), configured = new URL(process.env.AUTH_BROWSER_ORIGIN ?? "http://127.0.0.1:18080");
    if (parsed.origin !== configured.origin || parsed.pathname !== `/oauth2/authorization/${provider}` ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.searchParams.get("intent") ?? "") || [...parsed.searchParams.keys()].some(x => x !== "intent") || parsed.hash)
      throw new BffError(503, "auth_unavailable");
    (await cookies()).set(`DF_ACCOUNT_OAUTH_${flowId}`, binding, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 300 });
    return noStore({ authorizationUrl: url });
  } catch (error) { return failed(error); }
}
