import "server-only";
import { BffError } from "./auth";
import { jwt } from "./github";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicUrl = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/;
const repositoryId = /^[1-9][0-9]{0,18}$/;
export const privateEnabled = () => process.env.WEB_PRIVATE_REGISTRATION_ENABLED === "true";
const statuses = new Set(["QUEUED", "RUNNING", "FAILED", "INSUFFICIENT_EVIDENCE", "CANCELLED", "READY"]);
const errors: Record<string, number[]> = {
  invalid_request: [400], invalid_name: [400], invalid_repository_url: [400], invalid_repositories: [400], repository_unavailable: [400],
  repository_already_registered: [409], last_repository_required: [409], analysis_in_progress: [409], idempotency_key_conflict: [409],
  project_not_found: [404], repository_not_found: [404], invalid_session: [401], invalid_token: [401],
  account_unavailable: [403], auth_unavailable: [503], github_unavailable: [503], github_rate_limited: [503],
  project_unavailable: [503], private_repository_not_supported: [400], private_collection_consent_required: [403],
  private_access_unavailable: [403], github_access_denied: [403], github_pagination_limit: [503], github_reauthorization_required: [401],
};

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
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new BffError(400, "invalid_request");
    const entry = item as Record<string, unknown>;
    if (entry.githubRepositoryId !== undefined) {
      if (!privateEnabled()) throw new BffError(400, "private_repository_not_supported");
      if (Object.keys(entry).some(k => !["githubRepositoryId", "consents", "visibility"].includes(k)) ||
          typeof entry.githubRepositoryId !== "string" || !repositoryId.test(entry.githubRepositoryId) ||
          entry.visibility !== undefined && entry.visibility !== "PRIVATE" || !Array.isArray(entry.consents) || entry.consents.length !== 2)
        throw new BffError(400, "invalid_request");
      const purposes = new Set<string>();
      const consents = entry.consents.map(raw => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BffError(400, "invalid_request");
        const c = raw as Record<string, unknown>;
        if (Object.keys(c).some(k => !["purpose", "decision", "policyVersion"].includes(k)) ||
            !["PRIVATE_COLLECTION", "EXTERNAL_AI"].includes(String(c.purpose)) || purposes.has(String(c.purpose)) ||
            !["GRANTED", "DENIED"].includes(String(c.decision)) || typeof c.policyVersion !== "string" || !c.policyVersion || c.policyVersion.length > 100)
          throw new BffError(400, "invalid_request");
        purposes.add(c.purpose as string);
        return { purpose: c.purpose, decision: c.decision, policyVersion: c.policyVersion };
      });
      if (!purposes.has("PRIVATE_COLLECTION") || !purposes.has("EXTERNAL_AI")) throw new BffError(400, "invalid_request");
      if (!consents.some(c => c.purpose === "PRIVATE_COLLECTION" && c.decision === "GRANTED")) throw new BffError(403, "private_collection_consent_required");
      const identity = `id:${entry.githubRepositoryId}`;
      if (seen.has(identity)) throw new BffError(409, "repository_already_registered");
      seen.add(identity);
      return { githubRepositoryId: entry.githubRepositoryId, consents };
    }
    if (Object.keys(entry).some(k => k !== "repositoryUrl")) throw new BffError(400, "invalid_request");
    const raw = entry.repositoryUrl;
    if (typeof raw !== "string" || raw.length > 300) throw new BffError(400, "invalid_repository_url");
    const url = raw.trim();
    const match = publicUrl.exec(url);
    if (!match || match[2] === "." || match[2] === ".." || match[2].endsWith(".git")) throw new BffError(400, "invalid_repository_url");
    const canonical = `https://github.com/${match[1]}/${match[2]}`;
    const identity = `url:${canonical.toLowerCase()}`;
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
    const blocked = r.visibility === "PRIVATE" && r.accessStatus === "BLOCKED";
    if (typeof r.id !== "string" || !uuid.test(r.id) ||
      !(blocked && r.githubRepositoryId === null || typeof r.githubRepositoryId === "string" && repositoryId.test(r.githubRepositoryId)) ||
      !(blocked && r.fullName === null || typeof r.fullName === "string" && /^[^/\s]+\/[^/\s]+$/.test(r.fullName)) || !["PUBLIC", "PRIVATE"].includes(String(r.visibility)) ||
      !["ACTIVE", "BLOCKED"].includes(String(r.accessStatus)) || !validStatus(r.analysisStatus) ||
      !(r.commitSha === null || typeof r.commitSha === "string") || blocked && (r.githubRepositoryId !== null || r.fullName !== null || r.commitSha !== null)) throw new BffError(503, "project_unavailable");
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
  if (typeof r.id !== "string" || !uuid.test(r.id) || !validStatus(r.analysisStatus)) throw new BffError(503, "project_unavailable");
  return { id: r.id, analysisStatus: r.analysisStatus, repositories: members(r.repositories) };
}
export function additionOf(value: unknown) {
  const r = record(value);
  if (typeof r.projectId !== "string" || !uuid.test(r.projectId) || !validStatus(r.analysisStatus) ||
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
  if (typeof error === "string" && errors[error]?.includes(response.status))
    throw new BffError(response.status, error);
  throw new BffError(503, "project_unavailable");
}
