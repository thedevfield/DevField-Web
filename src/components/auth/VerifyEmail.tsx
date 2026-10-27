"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { postAuth } from "./AuthForm";
import styles from "./AuthFlow.module.css";

export function VerifyEmail() {
  const started = useRef(false);
  const [state, setState] = useState<"working" | "success" | "invalid" | "expired" | "error">("working");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!match) { setState("invalid"); return; }
    const token = match[1];
    void (async () => {
      try { const response = await postAuth("/api/auth/verify-email", { token }); setState(response.status === 204 ? "success" : response.status === 410 ? "expired" : response.status === 400 || response.status === 409 ? "invalid" : "error"); }
      catch { setState("error"); }
    })();
  }, []);
  const content = { working: ["이메일 인증 중", "잠시만 기다려주세요."], success: ["이메일 인증 완료", "이제 이메일로 로그인할 수 있습니다."], invalid: ["잘못된 인증 링크", "링크를 다시 확인해주세요."], expired: ["사용할 수 없는 링크", "인증 링크가 만료되었거나 이미 사용되었습니다."], error: ["인증 서비스 오류", "잠시 후 메일의 원래 링크에서 다시 시도해주세요."] }[state];
  return <main className={styles.scene}><section className={styles.card} aria-live="polite"><Link className={styles.brand} href="/">DevField</Link><h1 className={styles.title}>{content[0]}</h1><p className={styles.help}>{content[1]}</p><nav className={styles.links}><Link href={state === "success" ? "/login/email" : "/signup/email"}>{state === "success" ? "이메일 로그인" : "가입 화면으로"}</Link></nav></section></main>;
}
