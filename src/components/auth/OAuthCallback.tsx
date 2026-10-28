"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postAuth } from "./AuthForm";
import { StatusView } from "./StatusView";

export function OAuthCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState("로그인 처리 중입니다.");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const flowId = fragment.get("flowId") ?? "";
    const handoff = fragment.get("handoff") ?? "";
    const failure = fragment.get("error");
    if (failure) {
      setStatus(failure === "oauth_cancelled" ? "인증이 취소되었거나 동의가 완료되지 않았습니다." : "제공자 인증을 완료하지 못했습니다.");
      if (/^[A-Za-z0-9_-]{43}$/.test(flowId)) void postAuth("/api/auth/oauth/abort", { flowId }).catch(() => {});
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(flowId) || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) { setStatus("유효하지 않은 로그인 링크입니다."); return; }
    void (async () => {
      try {
        const response = await postAuth("/api/auth/oauth/complete", { flowId, handoff });
        if (!response.ok) { setStatus(response.status === 410 ? "로그인 요청이 만료되었거나 이미 사용되었습니다." : "로그인을 완료하지 못했습니다. 다시 시작해주세요."); return; }
        router.replace("/app"); router.refresh();
      } catch { setStatus("인증 서비스에 연결할 수 없습니다. 다시 시도해주세요."); }
    })();
  }, [router]);
  const working = status === "로그인 처리 중입니다.";
  const cancelled = status.startsWith("인증이 취소");
  return <StatusView eyebrow="SOCIAL AUTH / CALLBACK" title={working ? "로그인 처리 중" : cancelled ? "인증이 취소되었습니다" : "로그인을 완료하지 못했습니다"}
    description={status} tone={working ? "working" : cancelled ? "warning" : "error"}
    primary={{ href: "/login", label: "로그인 방법으로" }} />;
}
