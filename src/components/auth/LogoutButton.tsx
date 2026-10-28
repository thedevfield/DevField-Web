"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postAuth } from "./AuthForm";
import styles from "./AuthFlow.module.css";
import studioStyles from "./AuthStudio.module.css";

export function LogoutButton({ studio = false }: { studio?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const result = await postAuth("/api/auth/logout", {});
      if (!result.ok) throw new Error();
      router.replace("/login"); router.refresh();
    } catch { setError("로그아웃을 완료하지 못했습니다. 다시 시도해주세요."); }
    finally { setPending(false); }
  }
  return <><button type="button" className={studio ? studioStyles.submit : styles.button} onClick={logout} disabled={pending}>{pending ? "처리 중…" : "로그아웃"}</button><p className={studio ? studioStyles.error : styles.error} role="alert">{error}</p></>;
}
