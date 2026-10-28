import Link from "next/link";
import { redirect } from "next/navigation";
import { accountMe, BffError, type AccountProfile } from "@/lib/server/auth";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import { CopyUserId } from "./CopyUserId";
import styles from "./page.module.css";
import { AccountMethods } from "./AccountMethods";
import { providerEnabled } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "내 계정 | DevField", robots: { index: false, follow: false } };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className={styles.field}><dt>{label}</dt><dd>{children}</dd></div>;
}

function AccountDetails({ profile }: { profile: AccountProfile }) {
  const deleting = profile.deletionStatus === "DELETING";
  return <main id="account-main" className={styles.main}>
    <Link className={styles.backLink} href="/app"><span aria-hidden="true">←</span> Workspace로 돌아가기</Link>
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>ACCOUNT / OVERVIEW</p>
      <h1>내 계정</h1></div>
    </div>
    <p className={styles.description}>DevField에 저장된 계정 정보와 연결된 로그인 수단을 확인하세요.</p>
    {deleting && <section className={styles.notice} role="status" aria-label="계정 삭제 진행 상태">
      <strong>계정 삭제가 진행 중입니다.</strong><p>Workspace 이용이 제한됩니다. 계정 상태가 변경될 때까지 기다려주세요.</p>
    </section>}
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="account-info-title">
        <p className={styles.cardEyebrow}>01 / PROFILE</p><h2 id="account-info-title">계정 정보</h2>
        <dl>
          <Field label="표시 이름">{profile.displayName ?? <span className={styles.emptyValue}>등록된 표시 이름이 없습니다</span>}</Field>
          <Field label="확인된 이메일">{profile.email ?? <span className={styles.emptyValue}>등록된 이메일 로그인 정보가 없습니다</span>}</Field>
          <Field label="DevField User ID"><div className={styles.idRow}><span className={styles.identifier}>{profile.userId}</span><CopyUserId userId={profile.userId} /></div></Field>
          <Field label="가입일">{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(profile.createdAt))}</Field>
          <Field label="계정 상태"><span className={deleting ? styles.deletingState : styles.activeState}>{deleting ? "삭제 진행 중" : "정상"}</span></Field>
        </dl>
      </section>
      <section className={styles.card} aria-labelledby="login-methods-title">
        <p className={styles.cardEyebrow}>02 / ACCESS</p><h2 id="login-methods-title">로그인 수단</h2>
        <p className={styles.accessIntro}>DevField에 로그인할 수 있는 수단을 관리합니다.</p>
        <div className={styles.emailMethod}><strong>이메일 로그인</strong><span>{profile.emailLoginEnabled ? "사용 가능" : "사용 불가"}</span></div>
        <AccountMethods profile={profile} enabled={( ["google", "github", "kakao"] as const).filter(providerEnabled)} />
      </section>
    </div>
  </main>;
}

export default async function AccountPage() {
  let profile: AccountProfile | undefined;
  let status: "forbidden" | "unavailable" | undefined;
  try { profile = await accountMe(); }
  catch (error) {
    if (error instanceof BffError && error.status === 401) redirect("/login");
    status = error instanceof BffError && error.status === 403 ? "forbidden" : "unavailable";
  }
  return <div className={styles.page}>
    <a className={styles.skipLink} href="#account-main">본문으로 건너뛰기</a>
    <WorkspaceHeader withLogout={!!profile} current="account" />
    {profile ? <AccountDetails profile={profile} /> : <main id="account-main" className={styles.errorMain}>
      <section className={styles.errorCard} role="alert" aria-labelledby="account-error-title">
        <p className={styles.cardEyebrow}>{status === "forbidden" ? "ACCOUNT ACCESS" : "SERVICE UNAVAILABLE"}</p>
        <h1 id="account-error-title">{status === "forbidden" ? "계정을 이용할 수 없습니다" : "계정 정보를 불러올 수 없습니다"}</h1>
        <p>{status === "forbidden" ? "현재 계정 상태에서는 정보를 조회할 수 없습니다." : "일시적인 문제일 수 있습니다. 잠시 후 다시 시도해주세요."}</p>
        {status === "unavailable" && <a href="/account">다시 시도</a>}
      </section>
    </main>}
  </div>;
}
