"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postAuth } from "./AuthForm";
import { StatusView } from "./StatusView";
export function OAuthCallback() {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState("인증 결과를 확인하고 있습니다.");
  const [outcome, setOutcome] = useState<"SIGNUP_REQUIRED" | "EXISTING_ACCOUNT" | null>(null);
  const [returnHref, setReturnHref] = useState("/login");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const flowId = fragment.get("flowId") ?? "", handoff = fragment.get("handoff") ?? "";
    const purpose = fragment.get("purpose");
    const account = purpose === "LINK" || purpose === "REAUTH";
    if (account) setReturnHref("/account");
    const error = fragment.get("error");
    if (error) {
      const descriptions: Record<string, string> = {
        oauth_cancelled: "인증이 취소되었거나 접근이 거부되었습니다.",
        oauth_provider_rejected: "인증 제공자가 요청을 거부했습니다. 잠시 후 다시 시도해 주세요.",
        google_reauth_unavailable: "Google에서 필요한 인증 시각을 제공하지 않아 본인 확인을 완료할 수 없습니다.",
        google_reauth_stale: "Google 계정의 최근 인증 시각을 확인할 수 없어 본인 확인을 완료할 수 없습니다.",
        oauth_state_invalid: "인증 요청이 만료되었거나 유효하지 않습니다. 처음부터 다시 시도해 주세요.",
        oauth_identity_failed: "인증 계정을 확인하지 못했습니다. 다시 시도해 주세요.",
        oauth_callback_failed: "인증 결과를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      };
      const ref = fragment.get("ref") ?? "";
      setStatus((descriptions[error] ?? "인증을 완료하지 못했습니다. 다시 시도해 주세요.") +
        (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ref) ? ` 참조 코드: ${ref}` : ""));
      if (/^[A-Za-z0-9_-]{43}$/.test(flowId)) void postAuth("/api/auth/oauth/abort", { flowId }).catch(() => {});
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(flowId) || !/^[A-Za-z0-9_-]{43}$/.test(handoff) || !["LOGIN", "SIGNUP", "LINK", "REAUTH"].includes(purpose ?? "")) {
      setStatus("유효하지 않은 인증 결과입니다."); return;
    }
    void (async () => {
      try {
        const response = await postAuth(account ? "/api/account/oauth/complete" : "/api/auth/oauth/complete", { flowId, handoff });
        if (!response.ok) {
          setStatus(response.status === 409 ? "이 로그인 수단은 다른 회원에게 연결되어 있습니다. 계정은 변경되지 않았습니다." :
            response.status === 403 ? "본인 확인 또는 현재 계정 상태를 확인할 수 없습니다." :
            response.status === 410 ? "인증 요청이 만료됐습니다. 처음부터 다시 시도해 주세요." :
            response.status === 503 ? "인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요." :
            "인증을 완료하지 못했습니다. 다시 시도해 주세요."); return;
        }
        const body = await response.json();
        if (!account && body.authenticated === false && (body.outcome === "SIGNUP_REQUIRED" || body.outcome === "EXISTING_ACCOUNT")) {
          setOutcome(body.outcome);
          setReturnHref(body.outcome === "SIGNUP_REQUIRED" ? "/signup" : "/login");
          setStatus(body.outcome === "SIGNUP_REQUIRED" ? "아직 가입되지 않은 소셜 계정입니다. 회원가입을 진행해주세요." : "이미 가입된 소셜 계정입니다. 로그인 화면에서 계속해주세요.");
          return;
        }
        if (body.authenticated !== true && !account) throw new Error("invalid_oauth_outcome");
        router.replace(account ? body.next : "/app"); router.refresh();
      } catch { setStatus("인증 서비스에 연결할 수 없습니다. 다시 시도해 주세요."); }
    })();
  }, [router]);
  const working = status === "인증 결과를 확인하고 있습니다.";
  return <StatusView eyebrow="SOCIAL AUTH / CALLBACK" title={working ? "인증 처리 중" : outcome === "SIGNUP_REQUIRED" ? "회원가입이 필요합니다" : outcome === "EXISTING_ACCOUNT" ? "이미 가입된 계정입니다" : "인증 결과"}
    description={status} tone={working ? "working" : outcome ? "warning" : "error"}
    primary={{ href: returnHref, label: returnHref === "/account" ? "계정으로 돌아가기" : returnHref === "/signup" ? "회원가입으로 이동" : "로그인으로 이동" }} />;
}
