import { cookies } from "next/headers";
import { failed, noStore, requireSession } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireSession();
    const jar = await cookies();
    const proof = jar.get("DF_ACCOUNT_REAUTH")?.value;
    const flow = new URL(request.url).searchParams.get("flowId");
    return noStore({ reauthenticated: /^[A-Za-z0-9_-]{43}$/.test(proof ?? "") &&
      (flow === null || (/^[A-Za-z0-9_-]{43}$/.test(flow) && flow === jar.get("DF_ACCOUNT_REAUTH_FLOW")?.value)) });
  } catch (error) { return failed(error); }
}
