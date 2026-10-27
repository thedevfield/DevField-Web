import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import styles from "./AuthFlow.module.css";

export function AuthEntryStatus({ status, path }: { status: "forbidden" | "unavailable"; path: string }) {
  const forbidden = status === "forbidden";
  return <main className={styles.scene}><section className={styles.card} role="status">
    <Link className={styles.brand} href="/">DevField · Practice. Solve. Grow.</Link>
    <h1 className={styles.title}>{forbidden ? "계정을 이용할 수 없습니다" : "인증 상태를 확인할 수 없습니다"}</h1>
    <p className={styles.help}>{forbidden ? "계정 상태를 확인하거나 로그아웃한 뒤 다시 시도해주세요." : "인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. 현재 세션은 유지됩니다."}</p>
    {forbidden ? <LogoutButton /> : <nav className={styles.links}><a href={path}>다시 시도</a></nav>}
  </section></main>;
}
