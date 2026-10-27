import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const token = stringField(await boundedJson(request), "token", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BffError(400, "invalid_token");
    const result = await authPost("/api/auth/verify-email", { token });
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return failed(error); }
}
