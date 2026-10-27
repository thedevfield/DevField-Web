import { csrfIssue, failed, noStore } from "@/lib/server/auth";

export async function GET() {
  try { return noStore({ token: await csrfIssue() }); }
  catch (error) { return failed(error); }
}
