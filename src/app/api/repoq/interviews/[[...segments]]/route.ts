import type { NextRequest } from "next/server";
import { boundedJson, failed, guard, noStore } from "@/lib/server/auth";
import { jwt } from "@/lib/server/github";
import { acceptedOf, actions, cursorPattern, detailOf, enabled, historyOf, inputId, inputMode, inputTopic, interviewRequest, invalid, lifecycleOf, unavailable } from "@/lib/server/interview";

type Context = { params: Promise<{ segments?: string[] }> };

async function handle(request: NextRequest, context: Context) {
  try {
    const method = request.method;
    if (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE")
      return noStore({ code: "method_not_allowed" }, 405);
    const flags = enabled();
    const [rawId, action, ...rest] = (await context.params).segments ?? [];
    if (rest.length) return invalid();
    const id = rawId === undefined ? undefined : inputId(rawId);
    const search = new URL(request.url).searchParams;
    const allowed = (...keys: string[]) => {
      for (const key of search.keys()) if (!keys.includes(key) || search.getAll(key).length !== 1) invalid();
    };

    if (method === "GET") {
      if (action) return invalid();
      if (id) {
        allowed();
        const result = detailOf(await interviewRequest("/" + id, "GET", 200, (await jwt()).token), id);
        enabled(result.mode);
        return noStore(result);
      }
      allowed("projectId", "limit", "cursor");
      const projectId = inputId(search.get("projectId"));
      const limit = search.get("limit") ?? "20";
      const cursor = search.get("cursor");
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit) || cursor !== null && !cursorPattern.test(cursor)) return invalid();
      const query = new URLSearchParams({ projectId, limit });
      if (cursor !== null) query.set("cursor", cursor);
      return noStore(historyOf(await interviewRequest("?" + query, "GET", 200, (await jwt()).token), flags, Number(limit)));
    }

    await guard(request);
    if (method === "POST" && !id) {
      allowed();
      const body = await boundedJson(request);
      const projectId = inputId(body.projectId);
      const mode = inputMode(body.mode);
      enabled(mode);
      if (mode === "MOCK" && body.topicKey !== undefined) return invalid();
      const input = mode === "FREE" ? { projectId, mode, topicKey: inputTopic(body.topicKey) } : { projectId, mode };
      const result = detailOf(await interviewRequest("", "POST", 201, (await jwt()).token, input));
      if (result.mode !== mode) return unavailable();
      return noStore(result, 201);
    }

    if (!id || (method === "POST" ? action !== "answers" && action !== "bundles" : action !== undefined)) return invalid();
    const path = "/" + id;
    if (method === "DELETE") allowed("confirmAbandon");
    else allowed();
    const confirm = search.get("confirmAbandon");
    if (confirm !== null && confirm !== "true") return invalid();

    let input: object | undefined;
    if (method === "POST") {
      const body = await boundedJson(request, 32768);
      if (action === "answers") {
        const { answer, submissionId } = body;
        if (typeof answer !== "string" || !answer.trim() || answer.length > 4000 || answer.includes("\0")
          || typeof submissionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(submissionId)) return invalid();
        input = { questionId: inputId(body.questionId), answer, submissionId };
      } else {
        enabled("FREE");
        input = { previousBundleId: inputId(body.previousBundleId), topicKey: inputTopic(body.topicKey) };
      }
    } else if (method === "PATCH") {
      const body = await boundedJson(request);
      if (!actions.some(value => value === body.action)) return invalid();
      input = { action: body.action };
    }

    const { token } = await jwt();
    // The ID alone does not identify the mode. Check before forwarding a mutation.
    const session = detailOf(await interviewRequest(path, "GET", 200, token), id);
    enabled(session.mode);
    if (session.mode === "MOCK" && (action === "bundles" || method === "PATCH" && input && "action" in input && input.action === "END"))
      return noStore({ code: "interview_mode_not_supported" }, 400);
    if (confirm !== null && (session.mode !== "MOCK" || session.status === "COMPLETED")) return invalid();
    if (method === "POST") return noStore(acceptedOf(
      await interviewRequest(path + "/" + action, "POST", 202, token, input), action === "bundles"), 202);
    if (method === "PATCH") return noStore(lifecycleOf(await interviewRequest(path, "PATCH", 200, token, input)));
    await interviewRequest(path + (confirm ? "?confirmAbandon=true" : ""), "DELETE", 204, token);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return failed(error); }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
