import { redirect } from "next/navigation";
import { BffError, requireSession } from "@/lib/server/auth";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import { RepoQConnection } from "../../RepoQConnection";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "GitHub App 연결 관리 | RepoQ", robots: { index: false, follow: false } };
export default async function GitHubSettingsPage() {
  try { await requireSession(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    return <div className={styles.page}><WorkspaceHeader /><main className={styles.main}><h1>계정을 확인할 수 없습니다</h1><p>잠시 후 다시 시도해 주세요.</p></main></div>;
  }
  return <div className={styles.page}><WorkspaceHeader /><RepoQConnection /></div>;
}
