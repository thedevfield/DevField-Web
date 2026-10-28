import type { ReactNode } from "react";
import { authStudioStyles as styles } from "./AuthSplitShell";

export function FormField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return <div className={styles.field}>
    <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
    {children}
    {error && <p className={styles.error} id={`${id}-error`} role="alert">{error}</p>}
  </div>;
}
