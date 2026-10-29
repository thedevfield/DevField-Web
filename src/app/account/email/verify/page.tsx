"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postAuth } from "@/components/auth/AuthForm";
import styles from "../../page.module.css";

export default function VerifyAccountEmailPage() {
  const started = useRef(false);
  const [state, setState] = useState<"working" | "verified" | "expired" | "session" | "error">("working");
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!match) { setState("expired"); return; }
    void postAuth("/api/account/email-login/verify", { token: match[1] }).then(response =>
      setState(response.ok ? "verified" : response.status === 401 ? "session" : response.status === 410 ? "expired" : "error")
    ).catch(() => setState("error"));
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 12 || password !== confirm) { setMessage("12자 이상의 일치하는 비밀번호를 입력하세요."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await postAuth("/api/account/email-login/password", { password });
      setPassword(""); setConfirm("");
      if (response.ok) { window.location.replace("/account"); return; }
      setMessage(response.status === 401 ? "세션이 만료됐습니다. 다시 로그인하세요." : "비밀번호를 설정하지 못했습니다. 계정 페이지에서 다시 시도하세요.");
    } catch { setMessage("연결에 실패했습니다. 계정 페이지에서 다시 시도하세요."); }
    finally { setBusy(false); }
  }
  return <div className={styles.page}><main className={styles.main}>
    <Link className={styles.backLink} href="/account">계정으로 돌아가기</Link>
    <section className={styles.card} aria-labelledby="email-verify-title">
      <p className={styles.cardEyebrow}>EMAIL / VERIFY</p><h1 id="email-verify-title">이메일 로그인 인증</h1>
      <p role="status" aria-live="polite">{state === "working" ? "이메일을 확인하는 중입니다…" : state === "verified" ? "이메일 소유권을 확인했습니다. 비밀번호를 설정하세요." : state === "session" ? "인증 요청을 시작한 계정으로 다시 로그인해야 합니다." : state === "expired" ? "링크가 만료됐거나 이미 사용됐습니다. 계정 페이지에서 다시 요청하세요." : "인증 서비스에 연결하지 못했습니다. 계정 페이지에서 상태를 확인하세요."}</p>
      {state === "verified" && <form className={styles.emailForm} onSubmit={submit}>
        <label>새 비밀번호<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label>비밀번호 확인<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? "설정 중…" : "비밀번호 설정"}</button>
        <p role="status" aria-live="polite">{message}</p>
      </form>}
      {state === "session" && <Link href="/login">로그인으로 이동</Link>}
    </section>
  </main></div>;
}
