import { cookies } from "next/headers";
import { failed, noStore, requireSession } from "@/lib/server/auth";

export async function GET() {
  try {
    await requireSession();
    const proof = (await cookies()).get("DF_ACCOUNT_REAUTH")?.value;
    return noStore({ reauthenticated: /^[A-Za-z0-9_-]{43}$/.test(proof ?? "") });
  } catch (error) { return failed(error); }
}
