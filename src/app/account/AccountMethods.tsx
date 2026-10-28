"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import type { AccountProfile } from "@/lib/server/auth";
import { postAuth } from "@/components/auth/AuthForm";
import styles from "./page.module.css";
type Provider = "google" | "github" | "kakao";
type Action = { provider: Provider; kind: "link" | "unlink" };
const providers: Provider[] = ["google", "github", "kakao"];
const names = { google: "Google", github: "GitHub", kakao: "Kakao" };
const icons = { google: "/brands/google-g.png", github: "/brands/github-invertocat-white.svg", kakao: "/brands/kakao-login-symbol.svg" };
const iconClasses = { google: "", github: styles.accountIconGithub, kakao: styles.accountIconKakao };
function ProviderIcon({ provider }: { provider: Provider }) {
  return <span className={`${styles.accountProviderIcon} ${iconClasses[provider]}`}>
    <Image src={icons[provider]} width={22} height={22} alt="" />
  </span>;
}
async function unlink(provider: Provider) {
  const response = await fetch("/api/auth/csrf", { cache: "no-store" });
  if (!response.ok) throw new Error();
  const { token } = await response.json();
  return fetch(`/api/account/social-links/${provider}`, { method: "DELETE", cache: "no-store", headers: { "X-DevField-CSRF": token } });
}
export function AccountMethods({ profile, enabled }: { profile: AccountProfile; enabled: Provider[] }) {
  const router = useRouter(), params = useSearchParams();
  const [action, setAction] = useState<Action | null>(null);
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthProvider, setReauthProvider] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState(params.get("status") === "linked" ? "로그인 수단이 연결되었습니다." :
    "");
  useEffect(() => {
    if (params.get("status") !== "reauthenticated") {
      window.sessionStorage.removeItem("DF_ACCOUNT_PENDING_ACTION");
      return;
    }
    const pending = window.sessionStorage.getItem("DF_ACCOUNT_PENDING_ACTION");
    window.sessionStorage.removeItem("DF_ACCOUNT_PENDING_ACTION");
    if (!pending) return;
    try {
      const candidate: Action = JSON.parse(pending);
      if (providers.includes(candidate.provider) && (candidate.kind === "link" || candidate.kind === "unlink")) {
        void fetch("/api/account/reauth/status", { cache: "no-store" }).then(async response => {
          const body = response.ok ? await response.json() : {};
          if (body.reauthenticated === true) {
            setAction(candidate); setVerified(true); setMessage("계정 확인이 완료됐습니다.");
          } else setMessage("본인 확인을 완료하지 못했습니다. 다시 시도해 주세요.");
        }).catch(() => setMessage("본인 확인 상태를 확인하지 못했습니다. 다시 시도해 주세요."));
      }
    } catch { /* A stale display hint never grants authorization. */ }
  }, [params]);
  const linked = profile.socialProviders.map(x => x.toLowerCase());
  const linkedProviders = providers.filter(x => linked.includes(x));
  const selectedReauthProvider = reauthProvider && linkedProviders.includes(reauthProvider) ? reauthProvider : linkedProviders[0];
  const count = linked.length + (profile.emailLoginEnabled ? 1 : 0);
  async function showError(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 403 || response.status === 410 || body.code === "reauth_required") setVerified(false);
    if (body.code === "reauth_required") setMessage("먼저 본인 확인을 완료해 주세요.");
    else if (body.code === "last_login_method") setMessage("마지막 로그인 수단은 해제할 수 없습니다.");
    else if (body.code === "social_link_conflict") setMessage("이미 연결됐거나 다른 회원이 사용하는 수단입니다.");
    else if (response.status === 401) setMessage("세션이 만료됐습니다. 다시 로그인해 주세요.");
    else if (response.status === 403) setMessage("본인 확인이 필요하거나 현재 계정을 변경할 수 없습니다.");
    else if (response.status === 410) setMessage("인증 시간이 만료됐습니다. 다시 본인 확인을 진행해 주세요.");
    else if (response.status === 429) setMessage("요청이 일시 제한됐습니다. 잠시 후 다시 시도해 주세요.");
    else if (response.status === 503) setMessage("인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    else setMessage("요청을 처리하지 못했습니다. 다시 시도해 주세요.");
  }
  async function perform(target: Action) {
    if (inFlight.current || !verified) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    let navigating = false;
    try {
      const response = target.kind === "unlink" ? await unlink(target.provider) : await postAuth(`/api/account/social-links/${target.provider}`, {});
      if (!response.ok) { await showError(response); return; }
      if (target.kind === "link") {
        const body = await response.json();
        if (typeof body.authorizationUrl !== "string") throw new Error();
        window.location.assign(body.authorizationUrl);
        navigating = true;
      } else { setAction(null); setVerified(false); setMessage("연결을 해제했습니다. 다른 기존 세션은 종료됩니다."); router.refresh(); }
    } catch { setMessage("요청을 처리하지 못했습니다. 다시 시도해 주세요."); }
    finally { if (!navigating) { inFlight.current = false; setBusy(false); } }
  }
  async function confirmPassword(event: React.FormEvent) {
    event.preventDefault(); if (!action || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await postAuth("/api/account/reauth/password", { password });
      setPassword("");
      if (!response.ok) { setMessage(response.status === 401 ? "현재 비밀번호를 확인해 주세요." : "본인 확인에 실패했습니다."); return; }
      const body = await response.json();
      if (body.reauthenticated !== true) throw new Error();
      setVerified(true); setMessage("본인 확인이 완료됐습니다.");
    } catch { setMessage("본인 확인에 실패했습니다."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function confirmSocial(provider: Provider) {
    if (inFlight.current || !linked.includes(provider)) return;
    inFlight.current = true;
    setBusy(true);
    let navigating = false;
    try {
      const response = await postAuth(`/api/account/reauth/social/${provider}`, {});
      if (!response.ok) { await showError(response); return; }
      const body = await response.json();
      if (typeof body.authorizationUrl !== "string") throw new Error();
      if (action) window.sessionStorage.setItem("DF_ACCOUNT_PENDING_ACTION", JSON.stringify(action));
      window.location.assign(body.authorizationUrl);
      navigating = true;
    } catch { setMessage("본인 확인을 시작하지 못했습니다."); }
    finally { if (!navigating) { inFlight.current = false; setBusy(false); } }
  }
  function choose(target: Action) {
    if (target.kind === "unlink" && count <= 1) { setMessage("마지막 로그인 수단은 해제할 수 없습니다."); return; }
    setAction(target); setVerified(false); setReauthProvider(linkedProviders[0] ?? null); setMessage("");
  }
  return <div className={styles.methods}>
    <ul className={styles.methodList}>{providers.map(provider => {
      const connected = linked.includes(provider);
      return <li key={provider} className={styles.methodRow}>
        <div className={styles.methodIdentity}><ProviderIcon provider={provider} /><span><strong>{names[provider]}</strong><small>{connected ? "연결됨" : "미연결"}</small></span></div>
        {(enabled.includes(provider) || connected) && profile.deletionStatus !== "DELETING" && <div className={styles.methodAction}>
          <button type="button" disabled={busy || (connected && count <= 1)}
            className={connected ? count <= 1 ? styles.lastMethodButton : styles.unlinkButton : styles.linkButton}
            aria-describedby={connected && count <= 1 ? `last-method-${provider}` : undefined}
            onClick={() => choose({ provider, kind: connected ? "unlink" : "link" })}>{connected ? "연결 해제" : "연결하기"}</button>
          {connected && count <= 1 && <small id={`last-method-${provider}`} className={styles.lastMethodHint}>마지막 로그인 수단은 해제할 수 없습니다. 다른 수단을 연결하세요.</small>}
        </div>}
      </li>;
    })}</ul>
    {action && <div className={styles.changePanel}>
      <h3 className={styles.changeTitle}><ProviderIcon provider={action.provider} />{names[action.provider]} {action.kind === "link" ? "연결" : "연결 해제"}</h3>
      <p>{verified ? action.kind === "link" ? `계정 확인이 완료됐습니다. 이제 ${names[action.provider]} 계정을 연결할 수 있습니다.` : `계정 확인이 완료됐습니다. ${names[action.provider]} 연결을 해제할 수 있습니다.` : !profile.emailLoginEnabled && selectedReauthProvider === "google" ? "현재 계정에 연결된 Google 계정인지 확인합니다. Google 비밀번호 재입력이나 추가 인증을 보장하지 않습니다." : "계정 보호를 위해 현재 로그인 수단으로 본인 확인을 진행합니다."}</p>
      {!verified && profile.emailLoginEnabled ? <form id="account-reauth-form" onSubmit={confirmPassword} className={styles.reauthForm}>
        <label htmlFor="account-password">현재 비밀번호로 본인 확인</label>
        <input id="account-password" type="password" autoComplete="current-password" value={password}
          onChange={e => setPassword(e.target.value)} required maxLength={256} />
      </form> : !verified ? <div className={styles.reauthActions}>
        {linkedProviders.length > 1 && <label htmlFor="reauth-provider">본인 확인 수단
          <select id="reauth-provider" value={selectedReauthProvider} disabled={busy} onChange={event => setReauthProvider(event.target.value as Provider)}>
            {linkedProviders.map(provider => <option key={provider} value={provider}>{names[provider]}</option>)}
          </select>
        </label>}
        {linked.includes("github") && <small>GitHub 재승인은 비밀번호 재입력을 보장하지 않습니다.</small>}
      </div> : null}
      <div className={styles.changeActions} aria-busy={busy}>
        {verified ? <button className={action.kind === "unlink" ? styles.changeDanger : styles.changePrimary} type="button" disabled={busy} aria-busy={busy} onClick={() => void perform(action)}>
          {busy ? "처리 중…" : action.kind === "link" ? <><ProviderIcon provider={action.provider} />{names[action.provider]} 연결하기</> : "연결 해제 확인"}
        </button> : profile.emailLoginEnabled ? <button className={styles.changePrimary} type="submit" form="account-reauth-form" disabled={busy} aria-busy={busy}>
          {busy ? "본인 확인 중…" : "본인 확인"}
        </button> : <button className={styles.changePrimary} type="button" disabled={busy || !selectedReauthProvider} aria-busy={busy} onClick={() => selectedReauthProvider && void confirmSocial(selectedReauthProvider)}>
          {selectedReauthProvider && !busy && <ProviderIcon provider={selectedReauthProvider} />}{busy ? "계정 확인 진행 중…" : selectedReauthProvider === "google" ? "Google 계정 확인" : selectedReauthProvider ? `${names[selectedReauthProvider]}로 본인 확인` : "본인 확인 수단 없음"}
        </button>}
        <button className={styles.changeCancel} type="button" disabled={busy} onClick={() => { setAction(null); setVerified(false); setPassword(""); window.sessionStorage.removeItem("DF_ACCOUNT_PENDING_ACTION"); }}>취소</button>
      </div>
    </div>}
    <p className={styles.methodMessage} role="status" aria-live="polite">{message}</p>
  </div>;
}
