import type { ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { AuthEntrance } from "./AuthEntrance";
import styles from "./AuthStudio.module.css";

export function BrandPanel() {
  return <aside className={styles.brandPanel} aria-label="DevField 소개">
    <Link href="/" className={styles.brand} aria-label="DevField Welcome으로">
      <BrandLogo className={styles.brandLogo} /><span>DevField</span>
    </Link>
    <div className={styles.brandMessage}>
      <span className={styles.brandEyebrow}>DEVELOPER GROWTH PLATFORM</span>
      <p className={styles.brandHeadline}>연습하고, 도전하고,<br /><em>성장하는 공간.</em></p>
      <p>기술면접부터 코딩 테스트, 인프라 문제 해결까지.<br />DevField에서 나만의 속도로 실력을 쌓아가세요.</p>
    </div>
    <div className={styles.brandFoot}><span>Practice. Solve. Grow.</span><span>DEVFIELD STUDIO</span></div>
  </aside>;
}

export function AuthSplitShell({ children, backHref, backLabel = "방법 선택으로", section = "ACCOUNT", wide = false }: {
  children: ReactNode; backHref?: string; backLabel?: string; section?: string; wide?: boolean;
}) {
  return <main className={styles.shell}>
    <BrandPanel />
    <section className={styles.authPanel}>
      <div className={styles.authTop}>
        {backHref ? <Link href={backHref} className={styles.back}>← {backLabel}</Link> : <span>{section}</span>}
        <span>DEVFIELD / ACCOUNT</span>
      </div>
      <AuthEntrance className={`${styles.authContent} ${wide ? styles.authContentWide : ""}`}>{children}</AuthEntrance>
    </section>
  </main>;
}

export { styles as authStudioStyles };
