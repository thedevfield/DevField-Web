import { WorkspaceHeader } from "@/components/workspace/WorkspaceHome";
import styles from "./page.module.css";

export default function AccountLoading() {
  return <div className={styles.page}>
    <a className={styles.skipLink} href="#account-main">본문으로 건너뛰기</a>
    <WorkspaceHeader withLogout={false} current="account" />
    <main id="account-main" className={styles.main} aria-busy="true">
      <div className={styles.intro}><div><p className={styles.eyebrow}>ACCOUNT / OVERVIEW</p><h1>내 계정</h1></div></div>
      <p className={styles.loadingLabel} role="status">계정 정보를 불러오는 중입니다.</p>
      <div className={styles.grid} aria-hidden="true">
        <section className={styles.card}><span className={styles.skeletonEyebrow} /><span className={styles.skeletonTitle} />
          <div className={styles.skeletonRows}>{Array.from({ length: 5 }, (_, index) => <div className={styles.skeletonRow} key={index}><span /><span /></div>)}</div>
        </section>
        <section className={styles.card}><span className={styles.skeletonEyebrow} /><span className={styles.skeletonTitle} />
          <div className={styles.skeletonRows}>{Array.from({ length: 2 }, (_, index) => <div className={styles.skeletonRow} key={index}><span /><span /></div>)}</div>
        </section>
      </div>
    </main>
  </div>;
}
