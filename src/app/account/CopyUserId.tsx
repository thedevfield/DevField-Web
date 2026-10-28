"use client";

import { useState } from "react";
import styles from "./page.module.css";

export function CopyUserId({ userId }: { userId: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(userId);
      setMessage("User ID를 복사했습니다.");
    } catch {
      setMessage("복사하지 못했습니다. 다시 시도해주세요.");
    }
  }
  return <span className={styles.copyControl}>
    <button type="button" onClick={copy} aria-label="DevField User ID 복사">ID 복사</button>
    <span className={styles.copyMessage} aria-live="polite" role="status">{message}</span>
  </span>;
}
