import { notFound, redirect } from "next/navigation";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import { BffError, requireSession } from "@/lib/server/auth";
import { interviewFlags } from "@/lib/server/interview";
import { InterviewSessionView } from "../../InterviewSessionView";
import styles from "../../workspace.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "면접 | RepoQ", robots: { index: false, follow: false } };

export default async function InterviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const { id } = await params;
  const flags = interviewFlags();
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if ((!flags.FREE && !flags.MOCK) || !uuid.test(id)) notFound();
  const { projectId } = await searchParams;
  try { await requireSession(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    return <div className={styles.page}><WorkspaceHeader /><main className={styles.main}><h1>계정을 확인할 수 없습니다</h1><p>잠시 후 다시 시도해 주세요.</p></main></div>;
  }
  return <div className={styles.page}><WorkspaceHeader /><InterviewSessionView id={id} projectId={typeof projectId === "string" && uuid.test(projectId) ? projectId : undefined} /></div>;
}
