import { redirect } from "next/navigation";
import { BffError, requireSession } from "@/lib/server/auth";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import { RepoQConnection } from "./RepoQConnection";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "RepoQ GitHub 연결 | DevField", robots: { index: false, follow: false } };

export default async function RepoQPage() {
  try { await requireSession(); }
  catch (error) { if (error instanceof BffError && error.status === 401) redirect("/login"); }
  return <div className={styles.page}><WorkspaceHeader /><RepoQConnection /></div>;
}
