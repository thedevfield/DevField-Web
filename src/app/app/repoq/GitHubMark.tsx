import Image from "next/image";
import styles from "./workspace.module.css";

export function GitHubMark({ size = 22 }: { size?: number }) {
  return <span className={styles.githubMark}><Image src="/brands/github-invertocat-white.svg" width={size} height={size} alt="" /></span>;
}
