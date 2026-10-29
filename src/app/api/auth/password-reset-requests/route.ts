import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const email = stringField(await boundedJson(request), "email", 320).trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]+$/.test(email)) throw new BffError(400, "invalid_email");
    const result = await authPost("/api/auth/password-reset-requests", { email });
    if (result.status !== 202 || result.data.status !== "accepted") throw new BffError(503, "auth_unavailable");
    return noStore({ status: "accepted" }, 202);
  } catch (error) { return failed(error); }
}
