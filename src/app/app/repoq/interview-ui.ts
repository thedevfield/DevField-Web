import type { InterviewDetail } from "@/lib/interview";
import { csrfToken, responseData } from "./project-ui";

export const interviewPath = "/api/repoq/interviews";
export const interviewStatus: Record<InterviewDetail["status"], string> = {
  PREPARING: "질문 생성 중", ACTIVE: "진행 중", GENERATION_FAILED: "질문 생성 실패",
  PAUSED: "일시 중단", ENDED: "종료", EVALUATING: "평가 생성 중", COMPLETED: "완료",
};

export function shouldPoll(detail: InterviewDetail) {
  return detail.status === "PREPARING"
    || (detail.status === "ACTIVE" || detail.status === "EVALUATING")
      && (detail.answerProgress === "FOLLOW_UP_PENDING" || detail.evaluationStatus === "PENDING");
}

export function publishedMock(detail: InterviewDetail) {
  return detail.mode === "MOCK" && detail.status === "COMPLETED" && detail.evaluationStatus === "READY"
    && detail.completedBundleHistory?.length === 5 && detail.sessionEvaluation
    ? { bundles: detail.completedBundleHistory, summary: detail.sessionEvaluation } : null;
}

export class InterviewReadUnavailable extends Error {}

export async function interviewFetch<T>(path: string, method = "GET", body?: object, signal?: AbortSignal): Promise<T> {
  const headers = method === "GET" ? undefined : {
    "x-devfield-csrf": await csrfToken(), "Content-Type": "application/json",
  };
  const deadline = AbortSignal.timeout(method === "POST" && !path ? 55000 : method === "GET" ? 15000 : 25000);
  const isDetailRead = method === "GET" && path.startsWith("/");
  let response: Response;
  try {
    response = await fetch(interviewPath + path, { method, headers, cache: "no-store",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    signal?.throwIfAborted();
    if (isDetailRead && (error instanceof TypeError || deadline.aborted))
      throw new InterviewReadUnavailable("면접 상태를 확인하지 못했습니다.");
    throw error;
  }
  signal?.throwIfAborted();
  if (isDetailRead && [502, 503, 504].includes(response.status))
    throw new InterviewReadUnavailable("면접 상태를 확인하지 못했습니다.");
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인 세션이 만료되었습니다.");
  }
  if (response.status === 404) throw new Error("면접 또는 프로젝트를 찾을 수 없습니다.");
  if (response.status === 409) throw new Error("면접 상태가 바뀌었거나 시작 조건을 충족하지 않습니다. 현재 상태를 확인해 주세요.");
  return responseData(response);
}
