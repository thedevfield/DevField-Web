import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const currentPassword = stringField(body, "currentPassword", 256);
    const newPassword = stringField(body, "newPassword", 256);
    if (!currentPassword || newPassword.length < 12) throw new BffError(400, "invalid_password");
    const result = await authPost("/api/account/password/change", { currentPassword, newPassword }, await requireSession());
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    return noStore({ passwordChanged: true });
  } catch (error) { return failed(error); }
}
