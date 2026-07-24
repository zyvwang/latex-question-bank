import styles from "./SetupScreen.module.css";

export function LoadingScreen() {
  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingMark}>
        <img src="/brand/icon-64.png" width="36" height="36" alt="" />
        <span>LaTeX 题库</span>
      </div>
    </main>
  );
}
