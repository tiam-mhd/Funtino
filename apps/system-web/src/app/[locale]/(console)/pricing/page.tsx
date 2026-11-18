import { Badge, Surface } from '@funtino/design-system';
import styles from './PricingReadiness.module.css';

export default function PricingReadinessPage() {
  return (
    <main className={styles.page} dir="rtl" aria-labelledby="pricing-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>قواعد قیمت و کمپین</p>
          <h1 id="pricing-title">قیمت‌گذاری آفلاین</h1>
        </div>
        <Badge tone="warning">غیرفعال</Badge>
      </header>
      <Surface className={styles.panel}>
        <h2>فعال‌سازی تا تأیید رفتار ویندوز قفل است</h2>
        <p>
          فرمول قیمت یا تخفیف فرضی وارد نشده است. سناریوهای واقعی ورودی و خروجی باید از نرم‌افزار ویندوز استخراج و تأیید شوند؛ تا آن زمان snapshot قیمت هیچ قاعده‌ی قابل‌اجرایی ندارد.
        </p>
      </Surface>
      <Surface className={styles.panel} role="status">
        <h2>محدودیت تخفیف آفلاین</h2>
        <p>
          سقف کلی یا تخفیف یک‌بارمصرف بدون سهمیه‌ی آفلاین قابل تضمین نیست و نباید برای عملیات آفلاین فعال شود.
        </p>
      </Surface>
      <Surface className={styles.panel}>
        <h2>پیش‌نیاز انتشار نسخه‌ی قیمت</h2>
        <ol>
          <li>سناریوهای واقعی قیمت و تخفیف ویندوز ثبت و تأیید شوند.</li>
          <li>ترتیب، سقف، گردکردن و خروجی هر سناریو با تست مرجع تطبیق داده شود.</li>
          <li>نسخه‌ی قواعد با زمان اعتبار و audit منتشر شود؛ دستگاه ویندوز فقط snapshot همان نسخه را اجرا کند.</li>
        </ol>
      </Surface>
    </main>
  );
}
