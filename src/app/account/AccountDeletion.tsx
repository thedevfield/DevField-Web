"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { postAuth } from "@/components/auth/AuthForm";
import type { AccountProfile } from "@/lib/server/auth";
import styles from "./page.module.css";

type Provider = "google" | "github" | "kakao";
type Phase = "idle" | "verify" | "confirm" | "deleting" | "unknown" | "completed" | "expired" | "changed";
const pendingKey = "DF_ACCOUNT_DELETION_REAUTH";
const names = { google: "Google", github: "GitHub", kakao: "Kakao" };

export function AccountDeletion({ profile, enabled, deletionContext, children }: {
  profile: AccountProfile; enabled: Provider[]; deletionContext: string; children: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const serverDeleting = profile.deletionStatus === "DELETING";
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [verifiedFlow, setVerifiedFlow] = useState<string>();
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const providers = enabled.filter(provider => profile.socialProviders.some(linked => linked.toLowerCase() === provider));
  const terminal = phase === "completed" || phase === "expired" || phase === "changed";
  const deleting = !terminal && (serverDeleting || phase === "deleting");

  useEffect(() => {
    const pending = sessionStorage.getItem(pendingKey);
    if (!pending) return;
    const flow = params.get("reauthFlow");
    if (phase !== "idle" || serverDeleting || params.get("status") !== "reauthenticated" || !flow ||
        !/^[A-Za-z0-9_-]{43}$/.test(flow) || pending !== deletionContext + ":" + flow) {
      sessionStorage.removeItem(pendingKey);
      return;
    }
    let cancelled = false;
    void fetch("/api/account/reauth/status?flowId=" + flow, { cache: "no-store" })
      .then(async response => {
        const body = response.ok ? await response.json() : {};
        if (cancelled || sessionStorage.getItem(pendingKey) !== pending) return;
        sessionStorage.removeItem(pendingKey);
        if (body.reauthenticated === true) setVerifiedFlow(flow);
        setPhase(current => current === "idle" ? (body.reauthenticated === true ? "confirm" : "verify") : current);
        if (body.reauthenticated !== true) setMessage("본인 확인을 다시 진행해 주세요.");
      }).catch(() => {
        if (!cancelled) setMessage("본인 확인 상태를 확인하지 못했습니다.");
      });
    return () => { cancelled = true; };
  }, [params, serverDeleting, deletionContext, phase]);

  async function run(task: () => Promise<void>, failure: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try { await task(); }
    catch { setMessage(failure); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function verifyPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = password;
    setPassword("");
    void run(async () => {
      const response = await postAuth("/api/account/reauth/password", { password: value });
      if (!response.ok || (await response.json()).reauthenticated !== true) {
        setMessage(response.status === 401 ? "현재 비밀번호를 확인해 주세요." : "본인 확인에 실패했습니다.");
        return;
      }
      setVerifiedFlow(undefined);
      setPhase("confirm");
    }, "본인 확인에 실패했습니다.");
  }

  function verifySocial(provider: Provider) {
    void run(async () => {
      const response = await postAuth(`/api/account/reauth/social/${provider}`, {});
      if (!response.ok) throw new Error();
      const { authorizationUrl, flowId } = await response.json();
      if (typeof authorizationUrl !== "string" || typeof flowId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(flowId)) throw new Error();
      sessionStorage.setItem(pendingKey, deletionContext + ":" + flowId);
      window.location.assign(authorizationUrl);
    }, "소셜 계정 확인을 시작하지 못했습니다.");
  }

  function markDeleting() {
    setPhase("deleting");
    if (!serverDeleting) router.refresh();
  }

  async function checkStatus() {
    const response = await fetch("/api/account/me", { cache: "no-store" });
    if (response.status === 401) { setPhase("expired"); return; }
    if (response.ok && (await response.json()).deletionStatus === "DELETING") { markDeleting(); return; }
    setMessage("탈퇴 진행 여부를 확인하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.");
  }

  function requestDeletion() {
    void run(async () => {
      let response: Response;
      try {
        response = await postAuth("/api/account/me", undefined, "DELETE",
          deleting ? { "X-DevField-Deletion-Retry": "1" } : {
            "X-DevField-Deletion-Context": deletionContext,
            ...(verifiedFlow ? { "X-DevField-Deletion-Reauth-Flow": verifiedFlow } : {}),
          });
      }
      catch { setPhase("unknown"); await checkStatus(); return; }
      if (response.status === 204) { setPhase("completed"); return; }
      if (response.status === 401) { setPhase("expired"); return; }
      if (response.status === 202) { markDeleting(); return; }
      if (response.status === 503) { setPhase("unknown"); await checkStatus(); return; }
      const { code } = await response.json().catch(() => ({}));
      if (code === "account_session_changed") {
        setPhase("changed");
        return;
      }
      if (code === "reauth_required" || code === "deletion_reauth_flow_changed") {
        setVerifiedFlow(undefined);
        setPhase("verify");
        setMessage("본인 확인을 다시 진행해 주세요.");
      } else setMessage("탈퇴 요청을 처리하지 못했습니다.");
    }, "탈퇴 진행 여부를 확인하지 못했습니다. 잠시 후 상태를 다시 확인해 주세요.");
  }

  function cancel() {
    sessionStorage.removeItem(pendingKey);
    setPassword("");
    setVerifiedFlow(undefined);
    setMessage("");
    setPhase("idle");
  }

  return <>
    {!terminal && (serverDeleting || (!deleting && phase !== "unknown")) && children}
    <section className={styles.card} aria-labelledby="account-deletion-title" style={{ gridColumn: "1 / -1" }}>
      <h2 id="account-deletion-title">회원 탈퇴</h2>
      {terminal ? <>
        <p role="status">{phase === "completed" ? "회원 탈퇴가 완료됐습니다." :
          phase === "changed" ? "이 탭을 연 뒤 로그인 세션이 바뀌었습니다. 현재 계정 화면을 다시 열어 주세요." :
            "세션이 종료됐습니다. 현재 세션으로는 탈퇴 완료 여부를 확인할 수 없습니다."}</p>
        {phase === "changed" ? <a href="/account">현재 계정 다시 열기</a> : <Link href="/login">로그인 화면으로 이동</Link>}
      </> : <>
        {deleting ? <p role="status">탈퇴 처리 중입니다. 이 화면을 닫아도 처리는 계속됩니다.</p> :
          <p>탈퇴하면 계정과 연결된 프로젝트 및 면접 데이터가 삭제됩니다. 삭제된 데이터는 복구할 수 없습니다.</p>}
        {!deleting && phase === "verify" && (profile.emailLoginEnabled ?
          <form onSubmit={verifyPassword} className={styles.reauthForm}>
            <label htmlFor="deletion-password">현재 비밀번호</label>
            <input id="deletion-password" type="password" autoComplete="current-password" value={password}
              onChange={event => setPassword(event.target.value)} required maxLength={256} disabled={busy} />
            <button type="submit" disabled={busy}>본인 확인</button>
          </form> : <div className={styles.reauthActions}>
            {providers.map(provider => <button key={provider} type="button" disabled={busy}
              onClick={() => verifySocial(provider)}>{names[provider]}로 본인 확인</button>)}
            {providers.length === 0 && <p>현재 사용할 수 있는 본인 확인 수단이 없습니다.</p>}
            {providers.includes("github") && <small>GitHub 재승인은 비밀번호 재입력을 보장하지 않습니다.</small>}
          </div>)}
        <div className={styles.changeActions} aria-busy={busy}>
          {deleting || phase === "unknown" ?
            <button className={styles.changePrimary} type="button" disabled={busy}
              onClick={() => void run(checkStatus, "계정 상태를 확인하지 못했습니다.")}>상태 다시 확인</button> :
            phase === "idle" ? <button className={styles.changeDanger} type="button" disabled={busy}
              onClick={() => setPhase("verify")}>회원 탈퇴 신청</button> :
            phase === "confirm" ? <button className={styles.changeDanger} type="button" disabled={busy}
              onClick={requestDeletion}>{busy ? "처리 중…" : "회원 탈퇴 최종 확인"}</button> : null}
          {deleting && <button type="button" disabled={busy} onClick={requestDeletion}>탈퇴 처리 재확인</button>}
          {!deleting && phase !== "idle" && <button className={styles.changeCancel} type="button" disabled={busy}
            onClick={cancel}>{phase === "unknown" ? "확인 화면 닫기" : "취소"}</button>}
        </div>
      </>}
      <p className={styles.methodMessage} role="status">{message}</p>
    </section>
  </>;
}
