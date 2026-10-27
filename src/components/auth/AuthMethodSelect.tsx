"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { brandHeadline } from "@/components/brand/copy";
import styles from "./AuthMethodSelect.module.css";

type Mode = "login" | "signup";
type Provider = "email" | "google" | "kakao" | "github";
const providers: Provider[] = ["email", "google", "kakao", "github"];
const providerNames: Record<Exclude<Provider, "email">, string> = {
  google: "Google", kakao: "Kakao", github: "GitHub",
};

function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "email") return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8"/></svg>;
  if (provider === "google") return <span className={styles.googleSurface}><Image src="/brands/google-g.png" width={20} height={20} alt="" className={styles.brandIcon} /></span>;
  if (provider === "kakao") return <span className={styles.kakaoSurface}><Image src="/brands/kakao-login-symbol.svg" width={19} height={19} alt="" className={styles.brandIcon} /></span>;
  return <Image src="/brands/github-invertocat-white.svg" width={22} height={22} alt="" className={styles.brandIcon} />;
}

export function AuthMethodSelect({ mode }: { mode: Mode }) {
  const [notice, setNotice] = useState("");
  const isLogin = mode === "login";
  const title = isLogin ? "로그인" : "회원가입";
  const otherHref = isLogin ? "/signup" : "/login";
  return <main className={styles.scene}>
    <header className={styles.header}>
      <Link href="/" className={styles.brandLink} aria-label="DevField Welcome으로"><BrandLogo className={styles.smallLogo}/><span>DevField</span></Link>
      <span className={styles.headerSlogan}>Practice. Solve. Grow.</span>
    </header>
    <div className={styles.grid}>
      <section className={styles.editorial} aria-label="DevField 소개">
        <h1>{brandHeadline.lead}{brandHeadline.suffix}<br/><span>{brandHeadline.second}</span></h1>
        <p>연습하고, 문제를 해결하고, 성장하는 공간.<br/>DevField에서 다음 단계를 시작하세요.</p>
      </section>
      <section className={styles.panel} aria-labelledby="method-heading">
        <Link href="/" className={styles.back}>← Welcome</Link>
        <h2 id="method-heading">{title}</h2>
        <p className={styles.subtitle}>{isLogin ? "로그인할 방법을 선택하세요." : "시작할 방법을 선택하세요."}</p>
        <div className={styles.providers}>
          {providers.map((provider) => <button key={provider} type="button"
            className={`${styles.provider} ${provider === "email" ? styles.email : ""}`}
            onClick={() => setNotice(provider === "email" ? `이메일 ${title}은 다음 Slice에서 제공됩니다.` : `${providerNames[provider]} 인증은 향후 OAuth Slice에서 제공됩니다.`)}>
            <span className={styles.providerIcon}><ProviderIcon provider={provider}/></span>
            <span className={styles.providerLabel}>{provider === "email" ? `이메일로 ${title}` : `${providerNames[provider]}로 계속하기`}</span>
            <span className={styles.coming}>준비 중</span>
          </button>)}
        </div>
        <p className={styles.notice} role="status" aria-live="polite">{notice || "이메일과 소셜 인증은 아직 연결되지 않았습니다."}</p>
        <p className={styles.panelBottom}>{isLogin ? "계정이 없나요?" : "이미 계정이 있나요?"} <Link href={otherHref}>{isLogin ? "회원가입" : "로그인"}</Link></p>
      </section>
    </div>
  </main>;
}
