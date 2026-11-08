import type { NextRequest } from "next/server";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, setAccountReauth, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const password = stringField(body, "password", 256);
    const handle = await requireSession();
    const result = await authPost("/api/account/reauth/password", { password }, handle);
    const proof = result.data.reauthProof;
    if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new BffError(503, "auth_unavailable");
    await setAccountReauth(proof);
    return noStore({ reauthenticated: true });
  } catch (error) { return failed(error); }
}
