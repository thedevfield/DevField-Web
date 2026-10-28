"use client";

import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { Welcome } from "./Welcome";
import styles from "./EntryExperience.module.css";

type Phase = "checking" | "playing" | "revealing" | "done";
const playedKey = "devfield-splash-v1.1-played";
const timing = {
  s2: 70, s2e: 480, s3: 95, s3e: 470,
  s4: 325, s4e: 830, s5: 770, s5e: 1065, s6: 1050, s6e: 1320,
  wordmark: 980, wordmarkEnd: 1280, reveal: 1370, welcome: 1850,
};
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => { const v = clamp(value); return v * v * (3 - 2 * v); };
const ease = (value: number) => { const v = clamp(value); return .1 * v + .9 * (1 - Math.cos(Math.PI * v)) / 2; };

export function EntryExperience() {
  const [phase, setPhase] = useState<Phase>("checking");
  const svgRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const startedRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const revealingRef = useRef(false);
  const lengthsRef = useRef<Record<number, number>>({});

  useEffect(() => {
    finishedRef.current = false;
    revealingRef.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || sessionStorage.getItem(playedKey) === "1") {
      rootRef.current?.style.setProperty("--reveal", "1");
      finishedRef.current = true;
      setPhase("done");
      return;
    }
    const svg = svgRef.current;
    if (!svg) return;
    const brushes = [2, 3, 4, 5, 6];
    for (const number of brushes) {
      const path = svg.querySelector<SVGPathElement>(`[data-brush="${number}"]`);
      if (!path) return;
      const length = path.getTotalLength();
      lengthsRef.current[number] = length;
      path.style.strokeDasharray = `${length} ${length}`;
      path.style.strokeDashoffset = String(length);
    }
    setPhase("playing");
    const setStroke = (number: number, progress: number) => {
      const path = svg.querySelector<SVGPathElement>(`[data-brush="${number}"]`);
      if (!path) return;
      path.style.opacity = progress <= 0 ? "0" : "1";
      path.style.strokeDashoffset = String(lengthsRef.current[number] * (1 - progress));
    };
    const setFill = (number: number, progress: number) => {
      const path = svg.querySelector<SVGPathElement>(`[data-fill="${number}"]`);
      if (path) path.style.opacity = String(progress);
    };
    const frame = (now: number) => {
      if (!startedRef.current) startedRef.current = now;
      const ms = Math.min(timing.welcome, now - startedRef.current);
      if (finishedRef.current) return;
      const p2 = ease((ms - timing.s2) / (timing.s2e - timing.s2));
      const p3 = ease((ms - timing.s3) / (timing.s3e - timing.s3));
      const p4 = ease((ms - timing.s4) / (timing.s4e - timing.s4));
      const p5 = ease((ms - timing.s5) / (timing.s5e - timing.s5));
      const p6 = ease((ms - timing.s6) / (timing.s6e - timing.s6));
      setStroke(2, p2); setFill(2, smooth((p2 - .58) / .18));
      setStroke(3, p3); setFill(3, smooth((p3 - .56) / .18));
      setStroke(4, p4); setFill(4, smooth((p4 - .60) / .18));
      setStroke(5, p5); setFill(5, smooth((p5 - .66) / .16));
      setStroke(6, p6); setFill(6, smooth((p6 - .62) / .16));
      const emeraldSeam = svg.querySelector<SVGPathElement>("[data-emerald-seam]");
      if (emeraldSeam) emeraldSeam.style.opacity = String(smooth((p2 - .35) / .25));
      const reveal = smooth((ms - timing.reveal) / (timing.welcome - timing.reveal));
      const wordmark = wordmarkRef.current;
      if (wordmark) {
        const progress = 1 - Math.pow(1 - clamp((ms - timing.wordmark) / (timing.wordmarkEnd - timing.wordmark)), 3);
        wordmark.style.opacity = String(progress * (1 - reveal));
        wordmark.style.transform = `translateY(${8 * (1 - progress)}px)`;
      }
      rootRef.current?.style.setProperty("--reveal", String(reveal));
      if (ms >= timing.reveal && !revealingRef.current) {
        revealingRef.current = true;
        setPhase("revealing");
      }
      if (ms < timing.welcome) frameRef.current = requestAnimationFrame(frame);
      else {
        finishedRef.current = true;
        sessionStorage.setItem(playedKey, "1");
        setPhase("done");
      }
    };
    startedRef.current = 0;
    frameRef.current = requestAnimationFrame(frame);
    return () => {
      finishedRef.current = true;
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const skip = () => {
    finishedRef.current = true;
    cancelAnimationFrame(frameRef.current);
    sessionStorage.setItem(playedKey, "1");
    rootRef.current?.style.setProperty("--reveal", "1");
    setPhase("done");
  };

  const isDone = phase === "done";
  return <main ref={rootRef} className={styles.stage}>
    <div className={styles.welcomeLayer} aria-hidden={phase === "checking" || phase === "playing"} inert={phase === "checking" || phase === "playing"}>
      <Welcome animate={phase === "revealing"} />
    </div>
    {!isDone && <div className={styles.splashLayer}>
      <div className={styles.splashContent}>
        <div ref={svgRef} className={styles.splashLogo}><BrandLogo animated signature /></div>
        <div ref={wordmarkRef} className={styles.wordmark}>
          <span className={styles.wordmarkName}>DevField</span>
          <span className={styles.wordmarkSlogan}>Practice. Solve. Grow.</span>
        </div>
      </div>
      {phase !== "checking" && <button className={styles.skip} type="button" onClick={skip}>건너뛰기</button>}
    </div>}
  </main>;
}
