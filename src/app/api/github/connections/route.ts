import { failed, noStore } from "@/lib/server/auth";
import { jwt, project, statusOf } from "@/lib/server/github";

export async function GET(request: Request) {
  if (new URL(request.url).search) return noStore({ code: "invalid_request" }, 400);
  try { const { token } = await jwt(); return noStore(statusOf(await project("/api/github/connections", token, "GET"))); }
  catch (error) { return failed(error); }
}
