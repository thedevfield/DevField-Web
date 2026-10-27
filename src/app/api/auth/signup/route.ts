import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const email = stringField(body, "email", 320).trim().toLowerCase();
    const password = stringField(body, "password", 256);
    const displayName = stringField(body, "displayName", 100);
    if (!/^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]+$/.test(email)) throw new BffError(400, "invalid_email");
    if (password.length < 12 || displayName.trim().length === 0) throw new BffError(400, "invalid_signup");
    const result = await authPost("/api/auth/signup", { email, password, displayName });
    if (result.status !== 202 || result.data.status !== "verification_required") throw new BffError(503, "auth_unavailable");
    return noStore({ status: "verification_required" }, 202);
  } catch (error) { return failed(error); }
}
