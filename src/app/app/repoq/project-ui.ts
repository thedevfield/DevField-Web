export type Member = { id: string; githubRepositoryId: string; fullName: string; visibility: "PUBLIC" | "PRIVATE";
  accessStatus: string; analysisStatus: string; commitSha: string | null };
export type ProjectItem = { id: string; name: string; analysisStatus: string; repositoryCount: number;
  privateRepositoryCount: number; canInterview: boolean };
export type ProjectDetail = { id: string; name: string; projectStatus: string; analysisStatus: string;
  canInterview: boolean; latestReadySnapshot: null; membershipVersion: number; repositories: Member[]; canPrivateInterview: boolean };

export const statusText: Record<string, string> = {
  QUEUED: "분석 대기 중", RUNNING: "분석 진행 중", FAILED: "분석 실패", INSUFFICIENT_EVIDENCE: "근거 부족",
  CANCELLED: "분석 취소됨", READY: "분석 상태 확인 필요",
};
export const errorText: Record<string, string> = {
  invalid_name: "프로젝트 이름은 1~100자로 입력해 주세요.", invalid_repository_url: "GitHub Public Repository URL을 확인해 주세요.",
  invalid_repositories: "Repository를 1~20개 입력해 주세요.", repository_unavailable: "공개 Repository를 확인할 수 없습니다. 주소와 공개 여부를 확인해 주세요.",
  repository_already_registered: "이미 등록된 Repository입니다.", last_repository_required: "마지막 Repository는 제거할 수 없습니다. 프로젝트 삭제 기능은 아직 준비 중입니다.",
  analysis_in_progress: "분석이 진행 중이라 Repository 구성을 바꿀 수 없습니다. 잠시 후 다시 시도해 주세요.",
  idempotency_key_conflict: "요청 내용이 변경됐습니다. 새로고침 후 다시 시도해 주세요.",
  project_not_found: "프로젝트를 찾을 수 없습니다.", repository_not_found: "Repository 연결을 찾을 수 없습니다.",
  invalid_session: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", invalid_token: "로그인 세션을 확인할 수 없습니다.",
  account_unavailable: "계정을 이용할 수 없습니다.", auth_unavailable: "인증 서비스에 연결할 수 없습니다. 다시 시도해 주세요.",
  project_unavailable: "RepoQ 서비스에 연결할 수 없습니다. 다시 시도해 주세요.", github_unavailable: "GitHub에 연결할 수 없습니다. 다시 시도해 주세요.",
  github_rate_limited: "GitHub 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
};
export function messageFor(code: string) { return errorText[code] ?? "요청을 완료하지 못했습니다. 다시 시도해 주세요."; }
export async function responseData(response: Response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messageFor(typeof data.code === "string" ? data.code : ""));
  return data;
}
export async function csrfToken() {
  const response = await fetch("/api/auth/csrf", { cache: "no-store" });
  const data = await responseData(response);
  if (!data || typeof data.token !== "string") throw new Error("요청을 시작할 수 없습니다. 다시 시도해 주세요.");
  return data.token as string;
}
export function publicUrl(value: string) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(value.trim());
  return match && match[2] !== "." && match[2] !== ".." && !match[2].endsWith(".git")
    ? `https://github.com/${match[1]}/${match[2]}` : null;
}
export function urlsOf(rows: string[]) {
  if (rows.length < 1 || rows.length > 20) throw new Error("Repository를 1~20개 입력해 주세요.");
  const urls = rows.map(publicUrl);
  if (urls.some(url => !url)) throw new Error("GitHub Public Repository URL을 확인해 주세요.");
  if (new Set(urls.map(url => url!.toLowerCase())).size !== urls.length) throw new Error("같은 Repository URL이 중복됐습니다.");
  return urls.map(url => ({ repositoryUrl: url! }));
}
