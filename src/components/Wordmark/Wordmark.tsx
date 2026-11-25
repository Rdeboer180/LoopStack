import styles from './Wordmark.module.css';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  withMark?: boolean;
};

export function Wordmark({ size = 'md', withMark = false }: Props) {
  return (
    <span
      className={`${styles.wordmark} ${styles[size]}`}
      role="img"
      aria-label="LoopStack"
    >
      {withMark && <LogoMark className={styles.mark} />}
      <span className={styles.loop}>Loop</span>
      <span className={styles.stack}>Stack</span>
    </span>
  );
}

// The brand emblem — Concept 07c, the chosen icon: the ring with a speech tail and
// a staggered thread, the care team's reply in ink. Served as a static asset
// (public/loopstack-mark.svg); the same geometry is the iOS and desktop app icon.
// This is the complement to the wordmark: the type treatment above never changes.
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      className={className}
      src="/loopstack-mark.svg"
      alt=""
      aria-hidden
      draggable={false}
    />
  );
}
