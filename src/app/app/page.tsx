import Link from "next/link";
import { redirect } from "next/navigation";
import { BffError, requireSession } from "@/lib/server/auth";
import { LogoutButton } from "@/components/auth/LogoutButton";
import styles from "@/components/auth/AuthFlow.module.css";

export const dynamic = "force-dynamic";
export default async function AppPage() {
  let status: "active" | "forbidden" | "unavailable" = "active";
  try { await requireSession(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    status = error instanceof BffError && error.status === 403 ? "forbidden" : "unavailable";
  }
  return <main className={styles.scene}><section className={styles.card}>
    <Link className={styles.brand} href="/">DevField · Practice. Solve. Grow.</Link>
    <h1 className={styles.title}>{status === "active" ? "DevField에 오신 것을 환영합니다" : status === "forbidden" ? "계정을 이용할 수 없습니다" : "인증 서비스를 확인할 수 없습니다"}</h1>
    <p className={styles.help}>{status === "active" ? "로그인 세션이 활성 상태입니다." : status === "forbidden" ? "계정 상태를 확인하거나 다시 로그인해주세요." : "잠시 후 새로고침하여 다시 시도해주세요."}</p>
    {status === "active" || status === "forbidden" ? <LogoutButton /> : <nav className={styles.links}><Link href="/login">로그인으로</Link></nav>}
  </section></main>;
}
