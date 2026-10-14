import Link from 'next/link';
import { FuntinoMark } from '@funtino/design-system';
import styles from './HomePage.module.css';

export default function SystemHome() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <FuntinoMark compact />
        <span>مدیریت کل سامانه</span>
      </header>
      <section className={styles.content} aria-labelledby="system-entry-title">
        <span className={styles.eyebrow}>Funtino · System</span>
        <h1 id="system-entry-title">ورود به پنل مدیریت سامانه</h1>
        <p>
          صفحه‌های مدیریتی پس از تأیید نشست مستقل مدیریت و مجوزهای همان حساب در دسترس قرار می‌گیرند.
        </p>
        <Link className={styles.primaryAction} href="/fa/system-health">
          ورود به پنل
          <span aria-hidden="true">←</span>
        </Link>
      </section>
      <footer className={styles.footer}>دسترسی هر صفحه در API و روی سرور بررسی می‌شود.</footer>
    </main>
  );
}
