import Link from "next/link";
import { BrandLogo } from "./BrandLogo";
import { brandHeadline } from "./copy";
import styles from "./Welcome.module.css";

export function Welcome({ animate }: { animate: boolean }) {
  return <div className={`${styles.hero} ${animate ? styles.arriving : ""}`}>
    <BrandLogo className={styles.logo} />
    <h1 className={styles.brand}>DevField</h1>
    <p className={styles.tagline}><span>{brandHeadline.lead}</span>{brandHeadline.suffix}<br />{brandHeadline.second}</p>
    <p className={styles.sub}>Practice. Solve. Grow.</p>
    <div className={styles.actions}>
      <Link className={`${styles.cta} ${styles.primary}`} href="/login">로그인</Link>
      <Link className={styles.cta} href="/signup">회원가입</Link>
    </div>
  </div>;
}
