"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./AuthFlow.module.css";

type Mode = "signup" | "login";

export async function postAuth(path: string, body: object) {
  const proof = await fetch("/api/auth/csrf", { cache: "no-store" });
  if (!proof.ok) throw new Error("csrf_unavailable");
  const { token } = await proof.json();
  return fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-DevField-CSRF": token }, body: JSON.stringify(body), cache: "no-store" });
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  const [values, setValues] = useState({ displayName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const signup = mode === "signup";
  const fields: (keyof typeof values)[] = signup ? ["displayName", "email", "password", "confirm"] : ["email", "password"];
  const labels: Record<string, string> = { displayName: "표시 이름", email: "이메일", password: "비밀번호", confirm: "비밀번호 확인" };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const found: Record<string, string> = {};
    if (signup && (!values.displayName.trim() || values.displayName.length > 100)) found.displayName = "표시 이름은 공백을 제외해 1~100자로 입력해주세요.";
    const email = values.email.trim().toLowerCase();
    if (email.length > 320 || !/^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]+$/.test(email)) found.email = "올바른 이메일 주소를 입력해주세요.";
    if (signup && (values.password.length < 12 || values.password.length > 256)) found.password = "비밀번호는 12~256자로 입력해주세요.";
    if (!signup && !values.password) found.password = "비밀번호를 입력해주세요.";
    if (signup && values.confirm !== values.password) found.confirm = "비밀번호가 일치하지 않습니다.";
    setErrors(found);
    if (Object.keys(found).length) { refs.current[fields.find(x => found[x])!]?.focus(); return; }
    busy.current = true; setPending(true); setStatus("");
    try {
      const response = await postAuth(signup ? "/api/auth/signup" : "/api/auth/login", signup ? { displayName: values.displayName, email, password: values.password } : { email, password: values.password });
      if (response.ok) { setValues({ displayName: "", email: "", password: "", confirm: "" }); router.replace(signup ? "/signup/check-email" : "/app"); router.refresh(); return; }
      const result = await response.json().catch(() => ({}));
      const code = result.code;
      if (code === "invalid_email") { setErrors({ email: "올바른 이메일 주소를 입력해주세요." }); refs.current.email?.focus(); }
      else if (code === "invalid_signup") { setErrors({ password: "입력값을 다시 확인해주세요." }); refs.current.password?.focus(); }
      else setStatus(code === "rate_limited" ? "요청이 일시 제한되었습니다. 잠시 후 다시 시도해주세요." : code === "logout_required" ? "현재 계정에서 로그아웃한 뒤 다시 로그인해주세요." : response.status === 401 ? "이메일 또는 비밀번호를 확인해주세요." : response.status === 403 ? "현재 이용할 수 없는 계정입니다." : "서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } catch { setStatus("연결에 실패했습니다. 잠시 후 다시 시도해주세요."); }
    finally { busy.current = false; setPending(false); }
  }

  return <main className={styles.scene}><section className={styles.card} aria-labelledby="auth-title">
    <Link className={styles.brand} href="/">DevField · Practice. Solve. Grow.</Link>
    <h1 className={styles.title} id="auth-title">이메일로 {signup ? "회원가입" : "로그인"}</h1>
    <p className={styles.help}>{signup ? "정보를 입력하면 인증 가능한 주소로 확인 메일을 안내합니다." : "이메일 인증을 완료한 계정으로 로그인하세요."}</p>
    <form className={styles.form} onSubmit={submit} noValidate>
      {fields.map(field => <label className={styles.field} key={field} htmlFor={field}>{labels[field]}
        {field === "password" || field === "confirm" ? <span className={styles.password}>
          <input id={field} className={styles.input} ref={node => { refs.current[field] = node; }} type={visible ? "text" : "password"} value={values[field]} onChange={e => setValues({ ...values, [field]: e.target.value })} autoComplete={field === "confirm" ? "new-password" : signup ? "new-password" : "current-password"} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined} maxLength={256} />
          {field === "password" && <button className={styles.toggle} type="button" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"} onClick={() => setVisible(!visible)}>{visible ? "숨김" : "표시"}</button>}
        </span> : <input id={field} className={styles.input} ref={node => { refs.current[field] = node; }} type={field === "email" ? "email" : "text"} value={values[field]} onChange={e => setValues({ ...values, [field]: e.target.value })} autoComplete={field === "email" ? "email" : "nickname"} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined} maxLength={field === "email" ? 320 : 100} />}
        {errors[field] && <p className={styles.error} id={`${field}-error`}>{errors[field]}</p>}
      </label>)}
      <button className={styles.button} disabled={pending} type="submit">{pending ? "처리 중…" : signup ? "회원가입" : "로그인"}</button>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </form>
    <nav className={styles.links}><Link href={signup ? "/signup" : "/login"}>방법 선택으로</Link><Link href={signup ? "/login" : "/signup"}>{signup ? "로그인" : "회원가입"}</Link></nav>
  </section></main>;
}
