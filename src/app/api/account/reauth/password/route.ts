import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { authPost, boundedJson, BffError, failed, guard, noStore, requireSession, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const body = await boundedJson(request);
    const password = stringField(body, "password", 256);
    const handle = await requireSession();
    const result = await authPost("/api/account/reauth/password", { password }, handle);
    const proof = result.data.reauthProof;
    if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new BffError(503, "auth_unavailable");
    (await cookies()).set("DF_ACCOUNT_REAUTH", proof, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/account", maxAge: 300 });
    return noStore({ reauthenticated: true });
  } catch (error) { return failed(error); }
}
