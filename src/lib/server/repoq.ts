import "server-only";
import { BffError } from "./auth";
import { jwt } from "./github";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicUrl = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/;
const statuses = new Set(["QUEUED", "RUNNING", "FAILED", "INSUFFICIENT_EVIDENCE", "CANCELLED", "READY"]);
const errors = new Set(["invalid_request", "invalid_name", "invalid_repository_url", "invalid_repositories", "repository_unavailable", "repository_already_registered", "last_repository_required", "analysis_in_progress", "idempotency_key_conflict", "project_not_found", "repository_not_found", "invalid_session", "account_unavailable", "auth_unavailable", "github_unavailable", "github_rate_limited", "project_unavailable", "private_repository_not_supported", "invalid_token"]);

export function projectId(value: string) {
  if (!uuid.test(value)) throw new BffError(400, "invalid_request");
  return value.toLowerCase();
}
export function requestKey(value: string | null) {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) throw new BffError(400, "invalid_request");
  return value;
}
export function repositoriesInput(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new BffError(400, "invalid_repositories");
  const seen = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(k => k !== "repositoryUrl"))
      throw new BffError(400, "invalid_request");
    const raw = (item as Record<string, unknown>).repositoryUrl;
    if (typeof raw !== "string" || raw.length > 300) throw new BffError(400, "invalid_repository_url");
    const url = raw.trim();
    const match = publicUrl.exec(url);
    if (!match || match[2] === "." || match[2] === ".." || match[2].endsWith(".git")) throw new BffError(400, "invalid_repository_url");
    const canonical = `https://github.com/${match[1]}/${match[2]}`;
    const identity = canonical.toLowerCase();
    if (seen.has(identity)) throw new BffError(409, "repository_already_registered");
    seen.add(identity);
    return { repositoryUrl: canonical };
  });
}
export function createInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(k => !["name", "repositories"].includes(k))) throw new BffError(400, "invalid_request");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100) throw new BffError(400, "invalid_name");
  return { name: value.name.trim(), repositories: repositoriesInput(value.repositories) };
}
export function addInput(value: Record<string, unknown>) {
  if (Object.keys(value).some(k => k !== "repositories")) throw new BffError(400, "invalid_request");
  return { repositories: repositoriesInput(value.repositories) };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BffError(503, "project_unavailable");
  return value as Record<string, unknown>;
}
function validStatus(value: unknown) { return typeof value === "string" && statuses.has(value); }
function validName(value: unknown) { return typeof value === "string" && value.length > 0 && value.length <= 100; }
function members(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) throw new BffError(503, "project_unavailable");
  return value.map(raw => {
    const r = record(raw);
    if (typeof r.id !== "string" || !uuid.test(r.id) || typeof r.githubRepositoryId !== "string" || !/^\d+$/.test(r.githubRepositoryId) ||
      typeof r.fullName !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(r.fullName) || !["PUBLIC", "PRIVATE"].includes(String(r.visibility)) ||
      !["ACTIVE", "BLOCKED"].includes(String(r.accessStatus)) || !validStatus(r.analysisStatus) ||
      !(r.commitSha === null || typeof r.commitSha === "string")) throw new BffError(503, "project_unavailable");
    return { id: r.id, githubRepositoryId: r.githubRepositoryId, fullName: r.fullName, visibility: r.visibility,
      accessStatus: r.accessStatus, analysisStatus: r.analysisStatus, commitSha: r.commitSha };
  });
}
export function listOf(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) throw new BffError(503, "project_unavailable");
  return value.map(raw => {
    const r = record(raw);
    if (typeof r.id !== "string" || !uuid.test(r.id) || !validName(r.name) || !validStatus(r.analysisStatus) ||
      !Number.isSafeInteger(r.repositoryCount) || (r.repositoryCount as number) < 1 ||
      !Number.isSafeInteger(r.privateRepositoryCount) || (r.privateRepositoryCount as number) < 0 ||
      typeof r.canInterview !== "boolean") throw new BffError(503, "project_unavailable");
    return { id: r.id, name: r.name, analysisStatus: r.analysisStatus, repositoryCount: r.repositoryCount,
      privateRepositoryCount: r.privateRepositoryCount, canInterview: r.canInterview };
  });
}
export function detailOf(value: unknown) {
  const r = record(value);
  if (typeof r.id !== "string" || !uuid.test(r.id) || !validName(r.name) || !["ACTIVE", "DELETING"].includes(String(r.projectStatus)) ||
    !validStatus(r.analysisStatus) || typeof r.canInterview !== "boolean" || typeof r.canPrivateInterview !== "boolean" ||
    !Number.isSafeInteger(r.membershipVersion) || (r.membershipVersion as number) < 1 || r.latestReadySnapshot !== null)
    throw new BffError(503, "project_unavailable");
  return { id: r.id, name: r.name, projectStatus: r.projectStatus, analysisStatus: r.analysisStatus,
    canInterview: r.canInterview, canPrivateInterview: r.canPrivateInterview, latestReadySnapshot: null,
    membershipVersion: r.membershipVersion, repositories: members(r.repositories) };
}
export function registrationOf(value: unknown) {
  const r = record(value);
  if (typeof r.id !== "string" || !uuid.test(r.id) || r.analysisStatus !== "QUEUED") throw new BffError(503, "project_unavailable");
  return { id: r.id, analysisStatus: r.analysisStatus, repositories: members(r.repositories) };
}
export function additionOf(value: unknown) {
  const r = record(value);
  if (typeof r.projectId !== "string" || !uuid.test(r.projectId) || r.analysisStatus !== "QUEUED" ||
    !Number.isSafeInteger(r.membershipVersion) || (r.membershipVersion as number) < 2)
    throw new BffError(503, "project_unavailable");
  return { projectId: r.projectId, membershipVersion: r.membershipVersion, analysisStatus: r.analysisStatus,
    repositories: members(r.repositories) };
}

export async function projectRequest(path: string, method: "GET" | "POST" | "DELETE", expected: 200 | 201 | 204,
  body?: object, key?: string): Promise<unknown> {
  const configured = process.env.PROJECT_INTERNAL_URL;
  let target: URL;
  try {
    if (!configured || !/^\/api\/projects(?:\/[0-9a-f-]{36}(?:\/repositories(?:\/[0-9a-f-]{36})?)?)?$/i.test(path)) throw new Error();
    const base = new URL(configured);
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error();
    target = new URL(path, base);
    if (target.origin !== base.origin) throw new Error();
  } catch { throw new BffError(503, "web_configuration_error"); }
  const { token } = await jwt();
  let response: Response;
  try {
    response = await fetch(target, { method, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw new BffError(503, "project_unavailable"); }
  if (response.status >= 300 && response.status < 400) throw new BffError(503, "project_unavailable");
  if (response.status === 204 && expected === 204) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 131072) throw new BffError(503, "project_unavailable");
  let data: unknown;
  try {
    const reader = response.body?.getReader(); if (!reader) throw new Error();
    const parts: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 131072) { await reader.cancel(); throw new Error(); } parts.push(part.value); }
    data = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch { throw new BffError(503, "project_unavailable"); }
  if (response.status === expected) return data;
  const error = record(data).code;
  if (typeof error === "string" && errors.has(error) && [400, 401, 403, 404, 409, 503].includes(response.status))
    throw new BffError(response.status, error);
  throw new BffError(503, "project_unavailable");
}
