import Link from "next/link";
import { Code2, LockKeyhole, MessagesSquare, RefreshCw, ServerCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LogoutButton } from "@/components/auth/LogoutButton";
import styles from "./WorkspaceHome.module.css";

type Service = {
  name: string;
  description: string;
  detail: string;
  status: "개발 중" | "준비 중";
  icon: LucideIcon;
  number: string;
};

const services: Service[] = [
  { name: "RepoQ", description: "당신의 코드가, 다음 질문이 됩니다.", detail: "GitHub 프로젝트 기반 AI 기술면접. 프로젝트 분석, 자유연습, 모의면접을 준비하고 있습니다.", status: "개발 중", icon: MessagesSquare, number: "01" },
  { name: "AlgoField", description: "문제를 풀며 사고의 깊이를 넓히세요.", detail: "알고리즘과 코딩 테스트를 단계적으로 훈련하는 공간을 준비하고 있습니다.", status: "준비 중", icon: Code2, number: "02" },
  { name: "InfraField", description: "장애 상황에서 실무 대응 능력을 훈련하세요.", detail: "인프라 장애 대응과 문제 해결을 연습하는 공간을 준비하고 있습니다.", status: "준비 중", icon: ServerCog, number: "03" },
];

export function WorkspaceHeader({ withLogout = true, current = "workspace" }: { withLogout?: boolean; current?: "workspace" | "account" }) {
  return <header className={styles.header}><div className={styles.headerInner}>
    <Link className={styles.brand} href="/app" aria-label="DevField Workspace 홈">
      <BrandLogo className={styles.brandLogo} />
      <span className={styles.brandText}><strong>DevField</strong><small>Practice. Solve. Grow.</small></span>
    </Link>
    <nav className={styles.headerActions} aria-label="사용자 메뉴">
      <Link className={styles.headerLink} href="/app" aria-current={current === "workspace" ? "page" : undefined}>Workspace</Link>
      <Link className={styles.headerLink} href="/account" aria-current={current === "account" ? "page" : undefined}>내 계정</Link>
      {withLogout && <div className={styles.logout}><LogoutButton /></div>}
    </nav>
  </div></header>;
}

function ServiceCard({ service }: { service: Service }) {
  const Icon = service.icon;
  return <article className={styles.serviceCard}>
    <div className={styles.cardTop}>
      <span className={styles.serviceIcon}><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className={styles.serviceNumber}>{service.number} / SERVICE</span>
    </div>
    <div className={styles.cardBody}>
      <h3>{service.name}</h3>
      <p className={styles.cardLead}>{service.description}</p>
      <p className={styles.cardDetail}>{service.detail}</p>
    </div>
    <div className={styles.cardBottom}>
      <span className={styles.statusBadge}><span className={styles.statusDot} />{service.name === "RepoQ" ? "GitHub 연결" : service.status}</span>
      {service.name === "RepoQ" ? <Link className={styles.headerLink} href="/app/repoq">GitHub App 연결 →</Link> : <span className={styles.unavailableLabel}>이용 준비 중</span>}
    </div>
  </article>;
}

export function WorkspaceHome() {
  return <div className={styles.page}>
    <WorkspaceHeader />
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="workspace-title">
        <p className={styles.eyebrow}><span className={styles.eyebrowLine} /> YOUR WORKSPACE / DEVFIELD</p>
        <h1 id="workspace-title">오늘은 어떤 역량을<br className={styles.desktopBreak} /> 키워볼까요?</h1>
        <p className={styles.heroDescription}>DevField에서 훈련할 서비스를 선택하고<br className={styles.desktopBreak} /> 개발자로서의 다음 성장을 시작하세요.</p>
      </section>
      <section className={styles.services} aria-labelledby="services-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.sectionEyebrow}>EXPLORE SERVICES</p><h2 id="services-title">성장을 위한 세 가지 필드</h2></div>
          <p>각 서비스는 준비되는 대로 이용할 수 있습니다.</p>
        </div>
        <div className={styles.serviceGrid}>{services.map((service) => <ServiceCard key={service.name} service={service} />)}</div>
      </section>
    </main>
    <footer className={styles.footer}><span>DevField</span><span>Practice. Solve. Grow.</span></footer>
  </div>;
}

export function WorkspaceStatus({ status }: { status: "forbidden" | "unavailable" }) {
  const forbidden = status === "forbidden";
  return <div className={styles.page}>
    <WorkspaceHeader withLogout={false} />
    <main className={styles.statusMain}>
      <section className={styles.statusCard} aria-labelledby="workspace-status-title">
        <span className={styles.statusIcon}>{forbidden ? <LockKeyhole size={26} aria-hidden="true" /> : <RefreshCw size={26} aria-hidden="true" />}</span>
        <p className={styles.sectionEyebrow}>{forbidden ? "ACCOUNT ACCESS" : "SERVICE UNAVAILABLE"}</p>
        <h1 id="workspace-status-title">{forbidden ? "계정을 이용할 수 없습니다" : "인증 서비스를 확인할 수 없습니다"}</h1>
        <p>{forbidden ? "계정 상태를 확인하거나 다시 로그인해주세요." : "일시적인 문제일 수 있습니다. 잠시 후 다시 시도해주세요."}</p>
        <div className={styles.statusActions}>
          {forbidden ? <div className={styles.logout}><LogoutButton /></div> : <a className={styles.retryLink} href="/app">다시 시도 <RefreshCw size={17} aria-hidden="true" /></a>}
        </div>
      </section>
    </main>
  </div>;
}
