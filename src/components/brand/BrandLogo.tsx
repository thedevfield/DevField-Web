import { useId } from "react";
import { brushPaths, logoPaths } from "./logoPaths";

type BrandLogoProps = { animated?: boolean; className?: string };

const brushWidths = [154, 154, 132, 114, 108] as const;

export function BrandLogo({ animated = false, className }: BrandLogoProps) {
  const prefix = useId().replace(/:/g, "");
  const mint = `${prefix}-mint`;
  const white = `${prefix}-white`;
  const blue = `${prefix}-blue`;
  const whiteMask = `${prefix}-white-mask`;
  const clip = (number: number) => `${prefix}-clip-${number}`;

  const revealSegment = (number: 2 | 3 | 4 | 5 | 6) => {
    const index = number - 2;
    return <g key={number} clipPath={`url(#${clip(number)})`}>
      <path d={logoPaths[number - 1]} fill="white" opacity="0" data-fill={number} />
      <path d={brushPaths[index]} fill="none" stroke="white" strokeWidth={brushWidths[index]}
        strokeLinecap="round" strokeLinejoin="round" opacity="0" data-brush={number} />
    </g>;
  };

  return <svg className={className} viewBox="0 0 1024 1024" role="img"
    aria-label={animated ? "DevField DF 로고 애니메이션" : "DevField DF 로고"}>
    <defs>
      <linearGradient id={mint} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7CE9D7" />
        <stop offset="60%" stopColor="#35D9C0" />
        <stop offset="100%" stopColor="#00C8B8" />
      </linearGradient>
      <linearGradient id={white} gradientUnits="userSpaceOnUse" x1="188" y1="293" x2="871" y2="714">
        <stop offset="0%" stopColor="#F5F8FC" />
        <stop offset="55%" stopColor="#EEF3F9" />
        <stop offset="100%" stopColor="#DFE6F0" />
      </linearGradient>
      <linearGradient id={blue} x1="0%" y1="50%" x2="100%" y2="50%">
        <stop offset="0%" stopColor="#3D99F4" />
        <stop offset="100%" stopColor="#73D0EA" />
      </linearGradient>
      {animated && [1, 2, 3, 4, 5, 6].map((number) =>
        <clipPath id={clip(number)} key={number}><path d={logoPaths[number - 1]} /></clipPath>)}
      <mask id={whiteMask} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <path d={logoPaths[0]} fill="white" transform="translate(0 4)"
          opacity={animated ? 0 : 1} data-emerald-seam={animated ? "" : undefined} />
        {animated
          ? [3, 2, 4, 5].map((number) => revealSegment(number as 2 | 3 | 4 | 5))
          : logoPaths.slice(1, 5).map((path, index) => <path d={path} fill="white" key={index} />)}
      </mask>
    </defs>
    <rect x="0" y="0" width="1024" height="1024" fill={`url(#${white})`} mask={`url(#${whiteMask})`} />
    {animated
      ? <g clipPath={`url(#${clip(6)})`}>
          <path d={logoPaths[5]} fill={`url(#${blue})`} opacity="0" data-fill="6" />
          <path d={brushPaths[4]} fill="none" stroke={`url(#${blue})`} strokeWidth={brushWidths[4]}
            strokeLinecap="round" strokeLinejoin="round" opacity="0" data-brush="6" />
        </g>
      : <path d={logoPaths[5]} fill={`url(#${blue})`} />}
    <path d={logoPaths[0]} fill={`url(#${mint})`} />
  </svg>;
}
