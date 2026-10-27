import { failed, noStore, requireSession } from "@/lib/server/auth";

export async function GET() {
  try { await requireSession(); return noStore({ authenticated: true }); }
  catch (error) { return failed(error); }
}
