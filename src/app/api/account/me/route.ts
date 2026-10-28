import { accountMe, failed, noStore } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (new URL(request.url).search || request.headers.has("content-length") || request.headers.has("transfer-encoding"))
    return noStore({ code: "invalid_request" }, 400);
  try { return noStore(await accountMe()); }
  catch (error) { return failed(error); }
}
