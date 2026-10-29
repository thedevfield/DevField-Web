"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthSplitShell, authStudioStyles as styles } from "./AuthSplitShell";
import { FormField } from "./FormField";

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

  return <AuthSplitShell backHref={signup ? "/signup" : "/login"} backLabel="뒤로" section={`EMAIL / ${signup ? "CREATE ACCOUNT" : "SIGN IN"}`}>
    <span className={styles.eyebrow}>EMAIL / {signup ? "CREATE ACCOUNT" : "SIGN IN"}</span>
    <h1 className={styles.title} id="auth-title">이메일로 {signup ? "회원가입" : "로그인"}</h1>
    <p className={styles.intro}>{signup ? "기본 정보를 입력하면 확인 메일을 안내합니다." : "가입한 이메일과 비밀번호를 입력해주세요."}</p>
    <form className={styles.form} onSubmit={submit} noValidate>
      {fields.map(field => <FormField key={field} id={field} label={labels[field]} error={errors[field]}>
        {field === "password" || field === "confirm" ? <span className={styles.password}>
          <Input id={field} name={field} className={styles.input} ref={node => { refs.current[field] = node; }} type={visible ? "text" : "password"} value={values[field]} onChange={e => setValues({ ...values, [field]: e.target.value })} autoComplete={field === "confirm" ? "new-password" : signup ? "new-password" : "current-password"} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined} maxLength={256} placeholder={field === "confirm" ? "한 번 더 입력하세요" : signup ? "12자 이상 입력하세요" : "비밀번호를 입력하세요"} />
          {field === "password" && <button className={styles.toggle} type="button" aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"} onClick={() => setVisible(!visible)}>{visible ? "숨김" : "표시"}</button>}
        </span> : <Input id={field} name={field} className={styles.input} ref={node => { refs.current[field] = node; }} type={field === "email" ? "email" : "text"} value={values[field]} onChange={e => setValues({ ...values, [field]: e.target.value })} autoComplete={field === "email" ? "email" : "nickname"} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? `${field}-error` : undefined} maxLength={field === "email" ? 320 : 100} placeholder={field === "email" ? "name@example.com" : "어떻게 불러드릴까요?"} />}
      </FormField>)}
      <Button className={styles.submit} disabled={pending} type="submit" aria-busy={pending}>{pending ? "처리 중…" : signup ? "회원가입" : "로그인"}</Button>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </form>
    {!signup && <p className={styles.bottomLink}><Link href="/reset-password">비밀번호를 잊으셨나요?</Link></p>}
    <nav className={styles.bottomLink} aria-label={signup ? "로그인 안내" : "회원가입 안내"}>{signup ? "이미 계정이 있나요?" : "계정이 없나요?"} <Link href={signup ? "/login" : "/signup"}>{signup ? "로그인" : "회원가입"}</Link></nav>
  </AuthSplitShell>;
}
