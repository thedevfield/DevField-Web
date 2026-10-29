import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const password = stringField(await boundedJson(request), "password", 256);
    if (password.length < 12) throw new BffError(400, "invalid_password");
    const result = await authPost("/api/account/email-login/password", { password }, await requireSession());
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    return noStore({ passwordSet: true });
  } catch (error) { return failed(error); }
}
