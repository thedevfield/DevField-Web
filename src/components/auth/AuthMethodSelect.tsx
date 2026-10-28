"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Mail } from "lucide-react";
import { AuthSplitShell, authStudioStyles as styles } from "./AuthSplitShell";
import { postAuth } from "./AuthForm";

type Mode = "login" | "signup";
type Provider = "email" | "google" | "kakao" | "github";
const providers: Provider[] = ["email", "google", "kakao", "github"];
const providerNames: Record<Exclude<Provider, "email">, string> = { google: "Google", kakao: "Kakao", github: "GitHub" };

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "email") return <Mail aria-hidden="true" />;
  if (provider === "google") return <span className={`${styles.providerIcon} ${styles.providerBrandSurface}`}><Image src="/brands/google-g.png" width={22} height={22} alt="" /></span>;
  if (provider === "kakao") return <span className={`${styles.providerIcon} ${styles.providerKakao}`}><Image src="/brands/kakao-login-symbol.svg" width={22} height={22} alt="" /></span>;
  return <span className={`${styles.providerIcon} ${styles.providerGithub}`}><Image src="/brands/github-invertocat-white.svg" width={22} height={22} alt="" /></span>;
}

export function AuthMethodSelect({ mode, enabledProviders = [] }: { mode: Mode; enabledProviders?: Provider[] }) {
  const router = useRouter();
  const busy = useRef(false);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [notice, setNotice] = useState("");
  const isLogin = mode === "login";
  const otherHref = isLogin ? "/signup" : "/login";

  async function choose(provider: Provider) {
    if (busy.current) return;
    if (provider === "email") { router.push(isLogin ? "/login/email" : "/signup/email"); return; }
    if (!enabledProviders.includes(provider)) { setNotice(`${providerNames[provider]} 인증은 설정과 실제 검증 후 제공됩니다.`); return; }
    busy.current = true;
    setPendingProvider(provider);
    try {
      setNotice(`${providerNames[provider]} 로그인 시작 중…`);
      const response = await postAuth("/api/auth/oauth/start", { provider });
      const body = await response.json();
      if (!response.ok || typeof body.authorizationUrl !== "string") throw new Error();
      window.location.assign(body.authorizationUrl);
    } catch {
      setNotice("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
      busy.current = false;
      setPendingProvider(null);
    }
  }

  return <AuthSplitShell section={`ACCOUNT / ${isLogin ? "SIGN IN" : "CREATE"}`}>
    <span className={styles.eyebrow}>ACCOUNT / {isLogin ? "SIGN IN" : "CREATE"}</span>
    <h1 className={styles.title}>{isLogin ? "다시 오신 것을 환영합니다." : "DevField에서 성장을 시작하세요."}</h1>
    <p className={styles.intro}>{isLogin ? "DevField에 로그인할 방법을 선택해주세요." : "DevField를 시작할 방법을 선택해주세요."}</p>
    <div className={styles.providers}>
      {providers.map((provider, index) => <div key={provider}>
        {index === 1 && <div className={styles.separator}>또는</div>}
        <button type="button" className={`${styles.provider} ${provider === "email" ? styles.providerPrimary : ""}`}
          disabled={pendingProvider !== null || (provider !== "email" && !enabledProviders.includes(provider))}
          onClick={() => void choose(provider)}>
          <span className={styles.providerIcon}><ProviderIcon provider={provider} /></span>
          <span>{provider === "email" ? `이메일로 ${isLogin ? "로그인" : "회원가입"}` : `${providerNames[provider]}로 계속하기`}</span>
          <span className={styles.providerAction}>{provider === "email" ? "↗" : pendingProvider === provider ? "연결 중…" : enabledProviders.includes(provider) ? "↗" : "준비 중"}</span>
        </button>
      </div>)}
    </div>
    <p className={styles.bottomLink}>{isLogin ? "계정이 없나요?" : "이미 계정이 있나요?"} <Link href={otherHref}>{isLogin ? "회원가입" : "로그인"}</Link></p>
    <p className={styles.note} role="status" aria-live="polite">{notice || "소셜 로그인은 설정과 검증이 완료된 제공자에서만 사용할 수 있습니다."}</p>
  </AuthSplitShell>;
}
