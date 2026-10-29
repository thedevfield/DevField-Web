import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const email = stringField(body, "email", 320).trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]+$/.test(email)) throw new BffError(400, "invalid_email");
    const handle = await requireSession();
    const jar = await cookies();
    const reauthProof = jar.get("DF_ACCOUNT_REAUTH")?.value;
    if (!reauthProof) throw new BffError(403, "reauth_required");
    const result = await authPost("/api/account/email-login/requests", { email, reauthProof }, handle);
    if (result.status !== 202 || result.data.status !== "verification_required") throw new BffError(503, "auth_unavailable");
    jar.delete("DF_ACCOUNT_REAUTH");
    return noStore({ status: "verification_required" }, 202);
  } catch (error) { return failed(error); }
}
