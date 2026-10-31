"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./WorkspaceHeroCarousel.module.css";

const DURATION = 8000;
const slides = [
  { name: "RepoQ", label: "01 / PROJECT INTERVIEW", title: <>당신의 프로젝트가,<br />다음 질문이 됩니다.</>, description: "GitHub 프로젝트를 바탕으로 기술면접을 연습하세요.", preview: RepoPreview },
  { name: "AlgoField", label: "02 / ALGORITHM PRACTICE", title: <>코드를 작성하고,<br />문제 해결력을 키우세요.</>, description: "문제를 풀고 실행 결과를 확인하는 훈련 공간을 준비하고 있습니다.", preview: AlgoPreview },
  { name: "InfraField", label: "03 / INCIDENT RESPONSE", title: <>장애 상황 속에서,<br />실무 대응력을 단련하세요.</>, description: "로그와 메트릭을 읽고 대응을 판단하는 훈련 공간을 준비하고 있습니다.", preview: InfraPreview },
] as const;

function PreviewWindow({ name, children }: { name: string; children: React.ReactNode }) {
  return <div className={styles.window}>
    <div className={styles.windowBar}><span>DEVFIELD / {name.toUpperCase()}</span><span className={styles.windowDots}>● ● ●</span></div>
    <div className={styles.windowBody}>{children}</div>
  </div>;
}

function RepoPreview() {
  return <PreviewWindow name="RepoQ">
    <div className={styles.previewHeading}>프로젝트 기반 기술면접 <span>MOCK PREVIEW</span></div>
    <div className={styles.repoGrid}>
      <div className={styles.repoList}><small>GITHUB REPOSITORY</small><div>⌁ devfield-web</div><div>⌁ project-api</div><div>⌁ auth-service</div></div>
      <div className={styles.repoFlow}>
        <div className={styles.codeBlock}><span>src / projects.ts</span><br /><span>const project = await loadRepo()</span><br /><span>return analyze(project)</span></div>
        <div className={styles.analysis}>✓ 코드 분석 완료 · 질문 생성 중</div>
        <div className={styles.question}>Q. 이 프로젝트의 인증 흐름을 어떻게 설계했나요?</div>
        <div className={styles.answer}><span>세션 검증을 서버에서 처리했습니다.</span></div>
        <div className={styles.follow}>↳ 세션 만료 상황은 어떻게 대응하나요?</div>
      </div>
    </div>
  </PreviewWindow>;
}

function AlgoPreview() {
  return <PreviewWindow name="AlgoField">
    <div className={styles.previewHeading}>알고리즘 문제 풀이 <span>MOCK PREVIEW</span></div>
    <div className={styles.problem}><strong>두 수의 합</strong><p>목표값을 만드는 두 숫자의 인덱스를 찾으세요.</p></div>
    <div className={styles.editor}><div>solution.ts</div><p>1&nbsp; <b>function</b> twoSum(nums, target) {'{'}</p><p>2&nbsp;&nbsp; <b>for</b> (let i = 0; i &lt; nums.length; i++) {'{'}</p><p>3&nbsp;&nbsp;&nbsp; <b>if</b> (nums[i] + nums[i + 1] === target)</p><p>4&nbsp;&nbsp;&nbsp;&nbsp; return [i, i + 1];</p><p>5&nbsp; {'}'}</p></div>
    <div className={styles.run}>▶ 코드 실행</div><div className={styles.passed}>✓ 테스트 통과 · 3 / 3</div>
  </PreviewWindow>;
}

function InfraPreview() {
  return <PreviewWindow name="InfraField">
    <div className={styles.previewHeading}>서비스 상태 모니터링 <span>MOCK PREVIEW</span></div>
    <div className={styles.metric}><strong>API 응답 시간</strong><span className={styles.metricValue}><span className={styles.normalValue}>42ms · 정상</span><span className={styles.incidentValue}>1,240ms · 지연</span></span></div>
    <svg className={styles.chart} viewBox="0 0 300 55" preserveAspectRatio="none" aria-hidden="true"><path d="M0 42 L40 39 L80 41 L120 38 L160 40 L190 36" /><path className={styles.spike} d="M190 36 L220 33 L240 9 L260 16 L280 7 L300 12" /></svg>
    <div className={styles.alert}>! 응답 지연 감지 · 오류율 상승</div>
    <div className={styles.logs}>[ERROR] upstream timeout<br />[WARN] connection pool exhausted</div>
    <div className={styles.cause}>원인 분석 · 연결 풀 포화 가능성</div>
    <div className={styles.choice}>대응 판단: 트래픽 분산 · 풀 설정 확인</div>
  </PreviewWindow>;
}

export function WorkspaceHeroCarousel() {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [cycle, setCycle] = useState(0);
  const remaining = useRef(DURATION);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = hovered || focused || hidden || reduced;

  const select = useCallback((next: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    remaining.current = DURATION;
    setIndex(next);
    setCycle((value) => value + 1);
  }, []);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReduced(motion.matches);
    const onVisibility = () => setHidden(document.visibilityState !== "visible");
    onMotion(); onVisibility();
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { motion.removeEventListener("change", onMotion); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    if (paused) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
      }
      return;
    }
    started.current = Date.now();
    timer.current = setTimeout(() => {
      timer.current = null;
      remaining.current = DURATION;
      setIndex((value) => (value + 1) % slides.length);
      setCycle((value) => value + 1);
    }, remaining.current);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
      }
    };
  }, [paused, cycle]);

  const slide = slides[index];
  const Preview = slide.preview;
  return <section className={`${styles.hero} ${paused ? styles.paused : ""}`} aria-roledescription="carousel" aria-label="서비스 미리보기"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className={styles.copy} key={`copy-${cycle}`}>
      <p className={styles.eyebrow}>{slide.label}</p>
      <h1 id="workspace-title">{slide.title}</h1>
      <p className={styles.description}>{slide.description}</p>
      {index === 0 ? <Link className={styles.cta} href="/app/repoq">RepoQ 시작하기 <span aria-hidden="true">→</span></Link> : <span className={styles.unavailable} aria-disabled="true">서비스 준비 중</span>}
    </div>
    <div className={styles.art} aria-hidden="true" key={`preview-${cycle}`}><div className={styles.preview}><Preview /></div></div>
    <div className={styles.indicators} role="group" aria-label="서비스 미리보기 선택">
      {slides.map((item, position) => <button key={item.name} type="button" className={`${styles.indicator} ${position === index ? styles.active : ""}`} aria-label={`${item.name} 미리보기`} aria-pressed={position === index} onClick={() => select(position)} />)}
    </div>
  </section>;
}
