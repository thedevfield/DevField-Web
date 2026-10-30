import styles from "./workspace.module.css";

export function RepositoryFields({ rows, onChange, disabled }: { rows: string[]; onChange: (rows: string[]) => void; disabled: boolean }) {
  return <fieldset className={styles.fields} disabled={disabled}>
    <legend>Public Repository URL</legend>
    <p className={styles.help}>GitHub App 연결 없이도 공개 Repository를 등록할 수 있습니다. Private Repository는 후속 기능입니다.</p>
    {rows.map((row, index) => <div className={styles.fieldRow} key={index}>
      <label className={styles.srOnly} htmlFor={`repository-${index}`}>Repository URL {index + 1}</label>
      <input id={`repository-${index}`} type="url" inputMode="url" value={row} required placeholder="https://github.com/owner/repository"
        onChange={event => onChange(rows.map((value, i) => i === index ? event.target.value : value))} />
      <button type="button" className={styles.secondary} aria-label={`Repository URL ${index + 1} 입력 제거`} disabled={rows.length === 1}
        onClick={() => onChange(rows.filter((_, i) => i !== index))}>제거</button>
    </div>)}
    <button type="button" className={styles.secondary} disabled={rows.length >= 20} onClick={() => onChange([...rows, ""])}>+ Repository 추가</button>
    <p className={styles.help}>{rows.length}/20개 입력</p>
  </fieldset>;
}
