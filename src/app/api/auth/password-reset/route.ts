import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const token = stringField(body, "token", 43), password = stringField(body, "password", 256);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12) throw new BffError(400, "invalid_request");
    const result = await authPost("/api/auth/password-reset", { token, password });
    if (result.status !== 204) throw new BffError(503, "auth_unavailable");
    return noStore({ passwordReset: true });
  } catch (error) { return failed(error); }
}
