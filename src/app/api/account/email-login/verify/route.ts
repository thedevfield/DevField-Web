import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const token = stringField(await boundedJson(request), "token", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BffError(400, "invalid_token");
    const result = await authPost("/api/account/email-login/verify", { token }, await requireSession());
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    return noStore({ verified: true });
  } catch (error) { return failed(error); }
}
