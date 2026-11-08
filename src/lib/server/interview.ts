import "server-only";
import { BffError } from "./auth";
import type { InterviewAnswer, InterviewBundle, InterviewDetail, InterviewEvaluation, InterviewHistory, InterviewItem, InterviewMode, InterviewSummary } from "../interview";

export function interviewFlags() {
  return { FREE: process.env.WEB_FREE_INTERVIEW_ENABLED === "true", MOCK: process.env.WEB_MOCK_INTERVIEW_ENABLED === "true" };
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const topic = /^[A-Z][A-Z0-9_]{0,63}$/;
export const cursorPattern = /^[A-Za-z0-9_-]{1,256}$/;
const statuses = ["PREPARING", "ACTIVE", "GENERATION_FAILED", "PAUSED", "ENDED", "EVALUATING", "COMPLETED"] as const;
const progress = ["AWAITING_ANSWER", "FOLLOW_UP_PENDING", "QUESTIONS_COMPLETE", "FOLLOW_UP_FAILED", "FOLLOW_UP_CANCELLED"] as const;
const evaluationStates = ["PENDING", "READY", "FAILED", "CANCELLED"] as const;
export const actions = ["PAUSE", "RESUME", "END"] as const;
const errorStatus: Record<string, number> = {
  invalid_request: 400, invalid_topic: 400, invalid_limit: 400, invalid_cursor: 400, interview_mode_not_supported: 400,
  invalid_session: 401, invalid_token: 401, account_unavailable: 403, project_access_unavailable: 403,
  project_not_found: 404, interview_not_found: 404, snapshot_unavailable: 409, answer_conflict: 409,
  bundle_conflict: 409, interview_state_conflict: 409, auth_unavailable: 503, project_unavailable: 503,
};
export const invalid = (): never => { throw new BffError(400, "invalid_request"); };
export const unavailable = (): never => { throw new BffError(503, "interview_unavailable"); };
export function enabled(mode?: InterviewMode) {
  const flags = interviewFlags();
  if (mode ? !flags[mode] : !flags.FREE && !flags.MOCK) throw new BffError(403, "interview_disabled");
  return flags;
}

export function inputId(value: unknown) {
  return typeof value === "string" && uuid.test(value) ? value.toLowerCase() : invalid();
}
export function inputTopic(value: unknown) {
  return typeof value === "string" && topic.test(value) ? value : invalid();
}
export function inputMode(value: unknown): InterviewMode {
  return value === "FREE" || value === "MOCK" ? value : invalid();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : unavailable();
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === "string" && allowed.some(item => item === value) ? value as T : unavailable();
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && (!pattern || pattern.test(value)) ? value : unavailable();
}
function count(value: unknown, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : unavailable();
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) && value.length <= max ? value.map(parse) : unavailable();
}
const id = (value: unknown) => text(value, 36, uuid).toLowerCase();
function answerOf(value: unknown): InterviewAnswer {
  const r = record(value);
  return { questionId: id(r.questionId), question: text(r.question, 500), answer: text(r.answer, 4000) };
}
function evaluationOf(value: unknown): InterviewEvaluation {
  const r = record(value);
  return { evidenceId: id(r.evidenceId), strengths: text(r.strengths, 400), gaps: text(r.gaps, 400),
    improvements: text(r.improvements, 400), exampleAnswer: text(r.exampleAnswer, 400),
    keyPoints: text(r.keyPoints, 400), limitations: text(r.limitations, 400) };
}
function summaryOf(value: unknown): InterviewSummary {
  const r = record(value);
  return { strengths: text(r.strengths, 500), gaps: text(r.gaps, 500), consistency: text(r.consistency, 500),
    studyAreas: text(r.studyAreas, 500), limitations: text(r.limitations, 500) };
}
function bundleOf(value: unknown): InterviewBundle {
  const r = record(value);
  const sequence = count(r.sequence, 2147483647);
  if (!sequence) unavailable();
  return { bundleId: id(r.bundleId), sequence, topicKey: text(r.topicKey, 64, topic),
    answers: list(r.answers, 4, answerOf), evaluation: evaluationOf(r.evaluation) };
}
function core(r: Record<string, unknown>) {
  const mode = choice(r.mode, ["FREE", "MOCK"] as const);
  const status = choice(r.status, statuses);
  if (mode === "FREE" && (status === "EVALUATING" || status === "COMPLETED") || mode === "MOCK" && status === "ENDED") unavailable();
  const completedBundles = count(r.completedBundles, mode === "MOCK" ? 5 : 2147483647);
  return { interviewId: id(r.interviewId), mode, status, completedBundles };
}

export function historyOf(value: unknown, flags: ReturnType<typeof interviewFlags>, limit: number): InterviewHistory {
  const r = record(value);
  const items = list(r.items, limit, (item): InterviewItem => {
    const row = record(item);
    const createdAt = text(row.createdAt, 64);
    if (!Number.isFinite(Date.parse(createdAt))) unavailable();
    return { ...core(row), createdAt };
  }).filter(item => flags[item.mode]);
  return { items, nextCursor: r.nextCursor === null ? null : text(r.nextCursor, 256, cursorPattern) };
}

export function detailOf(value: unknown, expectedId?: string): InterviewDetail {
  const r = record(value);
  const result: InterviewDetail = { ...core(r), snapshotId: id(r.snapshotId),
    topicKey: r.topicKey === null ? null : text(r.topicKey, 64, topic) };
  if (expectedId && result.interviewId !== expectedId) unavailable();
  if (r.currentQuestion !== undefined) {
    const q = record(r.currentQuestion);
    result.currentQuestion = { id: id(q.id), text: text(q.text, 500), topicKey: text(q.topicKey, 64, topic) };
  }
  if (r.answers !== undefined) result.answers = list(r.answers, 4, answerOf);
  if (r.currentBundleId !== undefined) result.currentBundleId = id(r.currentBundleId);
  if (r.answerProgress !== undefined) result.answerProgress = choice(r.answerProgress, progress);
  if (r.evaluationStatus !== undefined) result.evaluationStatus = choice(r.evaluationStatus, evaluationStates);
  if (result.mode === "MOCK") {
    if (r.evaluation !== undefined) unavailable();
    if (result.status === "COMPLETED") {
      if (result.evaluationStatus !== "READY" || result.completedBundles !== 5) unavailable();
      const bundles = list(r.completedBundleHistory, 5, bundleOf);
      if (bundles.length !== 5 || bundles.some((bundle, index) => bundle.sequence !== index + 1 || !bundle.answers.length)
          || new Set(bundles.map(bundle => bundle.bundleId)).size !== 5) unavailable();
      result.completedBundleHistory = bundles;
      result.sessionEvaluation = summaryOf(r.sessionEvaluation);
    } else if (r.completedBundleHistory !== undefined || r.sessionEvaluation !== undefined || result.evaluationStatus === "READY") unavailable();
  } else {
    if (r.sessionEvaluation !== undefined) unavailable();
    if (r.evaluation !== undefined) {
      if (result.evaluationStatus !== "READY") unavailable();
      result.evaluation = evaluationOf(r.evaluation);
    }
    if (r.completedBundleHistory !== undefined) result.completedBundleHistory = list(r.completedBundleHistory, 10000, bundleOf);
  }
  return result;
}

export function acceptedOf(value: unknown, bundle = false) {
  const r = record(value);
  const status = choice(r.status, ["ACCEPTED"] as const);
  return bundle ? { status, bundleId: id(r.bundleId) } : { status };
}
export function lifecycleOf(value: unknown) {
  return { status: choice(record(value).status, statuses) };
}

export async function interviewRequest(path: string, method: "GET" | "POST" | "PATCH" | "DELETE",
  expected: 200 | 201 | 202 | 204, token: string, body?: object): Promise<unknown> {
  let target: URL;
  try {
    const base = new URL(process.env.INTERVIEW_INTERNAL_URL ?? "");
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
      throw new Error();
    target = new URL("/api/interviews" + path, base);
    if (target.origin !== base.origin) throw new Error();
  } catch { throw new BffError(503, "web_configuration_error"); }
  let response: Response;
  let data: unknown;
  try {
    response = await fetch(target, { method, cache: "no-store", redirect: "manual",
      signal: AbortSignal.timeout(expected === 201 ? 45000 : 8000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return unavailable(); }
    if (response.status === 204 && expected === 204) return null;
    const reader = response.body?.getReader();
    if (!reader) return unavailable();
    const maxBytes = expected === 200 && path.startsWith("/") ? 4 * 1024 * 1024 : 128 * 1024;
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) { await reader.cancel(); return unavailable(); }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) { await reader.cancel(); return unavailable(); }
      chunks.push(part.value);
    }
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return unavailable(); }
  if (response.status === expected) return data;
  const code = record(data).code;
  if (typeof code === "string" && (errorStatus[code] === response.status
      || code === "interview_unavailable" && [403, 409, 503].includes(response.status))) throw new BffError(response.status, code);
  return unavailable();
}
