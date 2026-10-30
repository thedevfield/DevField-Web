import { redirect } from "next/navigation";
import { BffError, requireSession } from "@/lib/server/auth";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import { ProjectHome } from "./ProjectHome";
import styles from "./workspace.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "내 프로젝트 | RepoQ", robots: { index: false, follow: false } };

export default async function RepoQPage() {
  let unavailable = false;
  try { await requireSession(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    unavailable = true;
  }
  return <div className={styles.page}><WorkspaceHeader />{unavailable ?
    <main className={styles.main}><h1>RepoQ에 연결할 수 없습니다</h1><p>계정 상태를 확인하거나 잠시 후 다시 시도해 주세요.</p></main> : <ProjectHome />}</div>;
}
