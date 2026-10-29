"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postAuth } from "@/components/auth/AuthForm";
import styles from "../../account/page.module.css";

export default function ResetCompletePage() {
  const started = useRef(false);
  const token = useRef("");
  const [ready, setReady] = useState(false), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    token.current = match?.[1] ?? "";
    setReady(true);
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if (password.length < 12 || password !== confirm) { setMessage("12자 이상의 일치하는 비밀번호를 입력하세요."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await postAuth("/api/auth/password-reset", { token: token.current, password });
      setPassword(""); setConfirm("");
      if (response.ok) { token.current = ""; setMessage("비밀번호를 재설정했습니다. 모든 기존 세션이 종료됐습니다. 다시 로그인하세요."); return; }
      setMessage(response.status === 410 ? "링크가 만료됐거나 이미 사용됐습니다. 다시 요청하세요." : "재설정에 실패했습니다. 다시 요청하세요.");
    } catch { setMessage("연결에 실패했습니다. 다시 시도하세요."); }
    finally { setBusy(false); }
  }
  return <div className={styles.page}><main className={styles.main}>
    <Link className={styles.backLink} href="/login/email">이메일 로그인으로 돌아가기</Link>
    <section className={styles.card}><p className={styles.cardEyebrow}>EMAIL / RECOVERY</p><h1>새 비밀번호 설정</h1>
      {!ready ? <p role="status">링크를 확인하는 중입니다…</p> : !token.current ? <p role="status">링크가 없거나 이미 사용됐습니다. 재설정을 다시 요청하세요.</p> :
        <form className={styles.emailForm} onSubmit={submit}>
          <label>새 비밀번호<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label>비밀번호 확인<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
          <button type="submit" disabled={busy} aria-busy={busy}>{busy ? "변경 중…" : "비밀번호 재설정"}</button>
        </form>}
      <p role="status" aria-live="polite">{message}</p>
      <Link href="/reset-password">재설정 링크 다시 요청</Link>
    </section></main></div>;
}
