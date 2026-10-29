"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AccountProfile } from "@/lib/server/auth";
import { postAuth } from "@/components/auth/AuthForm";
import styles from "./page.module.css";

export function EmailMethods({ profile }: { profile: AccountProfile }) {
  const router = useRouter();
  const params = useSearchParams();
  const [reauthenticated, setReauthenticated] = useState(false);
  const [provider, setProvider] = useState(profile.socialProviders[0]?.toLowerCase() ?? "");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (params.get("status") !== "reauthenticated") return;
    void fetch("/api/account/reauth/status", { cache: "no-store" }).then(async response => {
      const body = response.ok ? await response.json() : {};
      if (body.reauthenticated === true) setReauthenticated(true);
    }).catch(() => setMessage("본인 확인 상태를 확인하지 못했습니다."));
  }, [params]);
  async function reauth() {
    if (busy || !provider) return;
    setBusy(true); setMessage("");
    try {
      const response = await postAuth(`/api/account/reauth/social/${provider}`, {});
      if (!response.ok) { setMessage(response.status === 409 ? "연결된 계정을 확인할 수 없습니다." : "본인 확인을 시작하지 못했습니다."); return; }
      const body = await response.json();
      if (typeof body.authorizationUrl !== "string") throw new Error();
      window.location.assign(body.authorizationUrl);
    } catch { setMessage("본인 확인을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (profile.deletionStatus !== "NONE") return;
    if (!profile.emailLoginEnabled && !profile.emailOwnershipVerified && !reauthenticated) { setMessage("먼저 연결된 소셜 계정으로 본인 확인을 완료하세요."); return; }
    if (profile.emailLoginEnabled && !currentPassword) { setMessage("현재 비밀번호를 입력하세요."); return; }
    if ((profile.emailLoginEnabled || profile.emailOwnershipVerified) && (password.length < 12 || password !== confirm)) {
      setMessage("새 비밀번호는 12자 이상이고 확인 입력과 일치해야 합니다."); return;
    }
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const path = profile.emailLoginEnabled ? "/api/account/password/change" : profile.emailOwnershipVerified ? "/api/account/email-login/password" : "/api/account/email-login/requests";
      const body = profile.emailLoginEnabled ? { currentPassword, newPassword: password } : profile.emailOwnershipVerified ? { password } : { email };
      const response = await postAuth(path, body);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(response.status === 401 ? "세션이 만료됐거나 현재 비밀번호가 맞지 않습니다." : response.status === 409 ? "이미 사용 중인 이메일이거나 계정 상태가 변경됐습니다." : response.status === 429 ? "요청이 일시 제한됐습니다. 잠시 후 다시 시도하세요." : response.status === 503 ? "인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도하세요." : result.code === "invalid_email" ? "이메일 주소를 확인하세요." : "요청을 완료하지 못했습니다. 다시 시도하세요.");
        return;
      }
      setCurrentPassword(""); setPassword(""); setConfirm("");
      if (!profile.emailLoginEnabled && !profile.emailOwnershipVerified) { setSent(true); setReauthenticated(false); setMessage("인증 메일을 보냈습니다. 메일의 링크를 열어주세요."); }
      else { setMessage(profile.emailLoginEnabled ? "비밀번호를 변경했습니다. 다른 세션은 종료됩니다." : "이메일 로그인을 사용할 수 있습니다. 다른 세션은 종료됩니다."); router.refresh(); }
    } catch { setMessage("연결에 실패했습니다. 잠시 후 다시 시도하세요."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (profile.deletionStatus !== "NONE") return null;
  return <form className={styles.emailForm} onSubmit={submit}>
    <h3>{profile.emailLoginEnabled ? "비밀번호 변경" : profile.emailOwnershipVerified ? "비밀번호 최초 설정" : "이메일 로그인 추가"}</h3>
    {profile.emailLoginPending && !profile.emailOwnershipVerified && <p>인증 대기 중입니다. 메일을 받지 못했다면 같은 주소로 다시 요청하세요.</p>}
    {!profile.emailLoginEnabled && !profile.emailOwnershipVerified && !reauthenticated && <div className={styles.emailReauth}>
      <p>이메일 로그인 추가 전에 현재 계정을 확인합니다. Provider 계정 선택만으로 비밀번호 재인증이 보장되지는 않습니다.</p>
      {profile.socialProviders.length > 1 && <label>확인할 소셜 계정<select value={provider} onChange={event => setProvider(event.target.value)}>{profile.socialProviders.map(value => <option key={value} value={value.toLowerCase()}>{value}</option>)}</select></label>}
      <button type="button" disabled={busy || !provider} onClick={() => void reauth()}>{busy ? "이동 중…" : `${provider.toUpperCase()} 계정 확인`}</button>
    </div>}
    {!profile.emailLoginEnabled && !profile.emailOwnershipVerified && <label>추가할 이메일<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>}
    {profile.emailLoginEnabled && <label>현재 비밀번호<input type="password" autoComplete="current-password" required maxLength={256} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>}
    {(profile.emailLoginEnabled || profile.emailOwnershipVerified) && <>
      <label>새 비밀번호<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>새 비밀번호 확인<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    </>}
    <button type="submit" disabled={busy || (!profile.emailLoginEnabled && !profile.emailOwnershipVerified && !reauthenticated)} aria-busy={busy}>{busy ? "처리 중…" : profile.emailLoginEnabled ? "비밀번호 변경" : profile.emailOwnershipVerified ? "비밀번호 설정" : sent ? "인증 메일 다시 보내기" : "인증 메일 보내기"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
