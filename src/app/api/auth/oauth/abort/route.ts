import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { boundedJson, BffError, failed, guard, noStore, stringField } from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    await guard(request);
    const flowId = stringField(await boundedJson(request), "flowId", 43);
    if (!/^[A-Za-z0-9_-]{43}$/.test(flowId)) throw new BffError(400, "invalid_flow");
    const jar = await cookies();
    jar.delete(`DF_OAUTH_${flowId}`);
    jar.delete(`DF_ACCOUNT_OAUTH_${flowId}`);
    return noStore({ cleared: true });
  } catch (error) { return failed(error); }
}
