import Link from "next/link";
import { AlertCircle, Check, Clock3, LoaderCircle, Mail, type LucideIcon } from "lucide-react";
import { AuthSplitShell, authStudioStyles as styles } from "./AuthSplitShell";

type Tone = "mail" | "success" | "working" | "warning" | "error";
const icons: Record<Tone, LucideIcon> = { mail: Mail, success: Check, working: LoaderCircle, warning: Clock3, error: AlertCircle };

export function StatusView({ eyebrow, title, description, tone, primary, secondary }: {
  eyebrow: string; title: string; description: string; tone: Tone;
  primary: { href: string; label: string }; secondary?: { href: string; label: string };
}) {
  const Icon = icons[tone];
  const toneClass = tone === "error" ? styles.statusError : tone === "warning" ? styles.statusWarning : tone === "working" ? styles.statusWorking : "";
  return <AuthSplitShell section="ACCOUNT / STATUS" wide>
    <div className={styles.statusCard} role="status" aria-live="polite">
      <div className={`${styles.statusIcon} ${toneClass}`} aria-hidden="true"><Icon className={tone === "working" ? "animate-spin" : undefined} /></div>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.intro}>{description}</p>
      <nav className={styles.statusActions} aria-label="다음 단계">
        <Link href={primary.href}>{primary.label}</Link>
        {secondary && <Link href={secondary.href}>{secondary.label}</Link>}
      </nav>
    </div>
  </AuthSplitShell>;
}
