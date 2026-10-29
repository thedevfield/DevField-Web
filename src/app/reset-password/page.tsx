"use client";
import Link from "next/link";
import { useState } from "react";
import { postAuth } from "@/components/auth/AuthForm";
import styles from "../account/page.module.css";

export default function ResetRequestPage() {
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await postAuth("/api/auth/password-reset-requests", { email });
      setMessage(response.ok ? "계정에 이메일 로그인이 설정돼 있다면 재설정 링크를 보냈습니다." : response.status === 429 ? "요청이 일시 제한됐습니다. 잠시 후 다시 시도하세요." : "요청을 처리하지 못했습니다. 다시 시도하세요.");
    } catch { setMessage("연결에 실패했습니다. 다시 시도하세요."); }
    finally { setBusy(false); }
  }
  return <div className={styles.page}><main className={styles.main}>
    <Link className={styles.backLink} href="/login/email">이메일 로그인으로 돌아가기</Link>
    <section className={styles.card}><p className={styles.cardEyebrow}>EMAIL / RECOVERY</p><h1>비밀번호 재설정</h1>
      <p>이메일 로그인 주소를 입력하세요. 해당 계정이 있으면 재설정 링크를 보냅니다.</p>
      <form className={styles.emailForm} onSubmit={submit}><label>이메일<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? "전송 중…" : "재설정 링크 보내기"}</button>
        <p role="status" aria-live="polite">{message}</p></form>
    </section></main></div>;
}
