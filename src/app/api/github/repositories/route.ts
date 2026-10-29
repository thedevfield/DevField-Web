import { BffError, failed, noStore } from "@/lib/server/auth";
import { jwt, listingOf, project } from "@/lib/server/github";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(k => k !== "page") || url.searchParams.getAll("page").length > 1) throw new BffError(400, "invalid_request");
    const raw = url.searchParams.get("page") ?? "1";
    if (!/^[1-9][0-9]{0,3}$/.test(raw) || Number(raw) > 10000) throw new BffError(400, "invalid_request");
    const { token } = await jwt();
    const page = Number(raw);
    const listing = listingOf(await project(`/api/github/repositories?page=${page}&perPage=30`, token, "GET"));
    if (listing.page !== page || listing.repositories.length > 30) throw new BffError(503, "project_unavailable");
    return noStore(listing);
  } catch (error) { return failed(error); }
}
