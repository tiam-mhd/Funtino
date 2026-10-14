import { Badge, FuntinoMark, IconBadge, Surface } from '@funtino/design-system';

const identityControls = [
  {
    label: 'ارسال OTP',
    value: 'ParsGreen adapter',
    detail: 'توکن در Secret محیط اجرا',
    tone: 'info' as const,
  },
  {
    label: 'تکمیل پروفایل',
    value: 'اجباری',
    detail: 'نام، شهر، تولد، جنسیت و avatar',
    tone: 'info' as const,
  },
  {
    label: 'اتصال شعبه',
    value: 'فقط از کارت',
    detail: 'ثبت‌نام تخصیص شعبه ندارد',
    tone: 'info' as const,
  },
];

export default function SystemHome() {
  return (
    <main className="system-app">
      <header className="system-topbar">
        <FuntinoMark />
        <div className="system-topbar__user">
          <span>
            <strong>مدیریت سامانه</strong>
            <small>نمای عمومی؛ ورود مدیر لازم است</small>
          </span>
        </div>
      </header>

      <div className="system-layout">
        <aside className="system-sidebar">
          <span className="system-sidebar__label">کنترل سامانه</span>
          <a className="is-active" href="#overview">
            <span aria-hidden="true">⌂</span> نمای کلی
          </a>
          <a href="/fa/organizations">
            <span aria-hidden="true">▦</span> سازمان‌ها و شعب
          </a>
          <a href="/fa/customer-family">
            <span aria-hidden="true">♧</span> مشاهده‌ی خانواده‌ی مشتری
          </a>
          <a href="/fa/access">
            <span aria-hidden="true">♙</span> کاربران و دسترسی
          </a>
          <a href="/fa/security/mfa">
            <span aria-hidden="true">♙</span> تأیید دومرحله‌ای
          </a>
          <a href="/fa/security/session-policy">
            <span aria-hidden="true">◷</span> مدت نشست کارکنان
          </a>
          <a href="#integrations">
            <span aria-hidden="true">⌘</span> اتصال‌ها
          </a>
          <a href="#audit">
            <span aria-hidden="true">◷</span> ممیزی
          </a>
        </aside>

        <section className="system-content" id="overview">
          <div className="system-heading">
            <div>
              <span className="system-heading__eyebrow">کنترل مرکزی</span>
              <h1>نمای کلی سامانه</h1>
              <p>
                پایش زنده فقط در صفحه‌ی مجاز مدیریت سامانه و با دسترسی سراسری نمایش داده می‌شود.
              </p>
            </div>
            <Badge tone="info">ورود مدیر لازم است</Badge>
          </div>

          <div className="system-demo-note" role="status">
            <span aria-hidden="true">⚙</span>
            <p>
              این نمای عمومی داده‌ی سلامت یا آمار ممیزی ارائه نمی‌کند. مشاهده‌ی پایش زنده از API
              نشست‌محور می‌آید و مجوز <bdi>system.health.read</bdi> روی سرور بررسی می‌شود.
            </p>
          </div>

          <section className="system-overview-grid">
            <a className="system-quick-card system-quick-card--link" href="/fa/system-health">
              <IconBadge icon="◷" label="پایش عملیاتی" tone="teal" />
              <strong>وضعیت زنده‌ی سرویس‌ها و هشدارها</strong>
              <span>دسترسی با نشست معتبر و مجوز سراسری انجام می‌شود.</span>
            </a>

            <Surface className="system-summary-card">
              <span className="system-summary-card__eyebrow">ممیزی امروز</span>
              <strong>نامشخص</strong>
              <span>آمار ممیزی به سرویس گزارش متصل نیست</span>
              <small>از این نما برای تأیید رخدادهای امنیتی استفاده نکن.</small>
            </Surface>
          </section>

          <section className="system-quick-grid" id="organizations">
            <a
              className="system-quick-card system-quick-card--link"
              href="/fa/security/session-policy"
            >
              <IconBadge icon="◷" label="امنیت" tone="purple" />
              <strong>مدت نشست کارکنان</strong>
              <span>تنظیم انقضای مطلق نشست پنل از ۱ تا ۱۲ ساعت</span>
            </a>
            <a className="system-quick-card system-quick-card--link" href="/fa/customer-family">
              <IconBadge icon="♧" label="پشتیبانی خانواده" tone="teal" />
              <strong>مشاهده‌ی خانواده‌ی مشتری</strong>
              <span>جست‌وجوی دقیق و فقط‌خواندنی با انتخاب شعبه و شماره‌ی کامل</span>
            </a>
            <a className="system-quick-card system-quick-card--link" href="/fa/organizations">
              <IconBadge icon="▦" label="سازمان‌ها" tone="purple" />
              <strong>مدیریت مجموعه‌ها و شعب</strong>
              <span>مشاهده‌ی وضعیت واقعی و مدیریت ساختار</span>
            </a>
            <Surface className="system-quick-card">
              <IconBadge icon="♙" label="کاربران" tone="teal" />
              <strong>ورود لازم است</strong>
              <span>فهرست کارکنان فقط از API مجاز و scope‌شده خوانده می‌شود.</span>
            </Surface>
            <Surface className="system-quick-card" id="audit">
              <IconBadge icon="◷" label="ممیزی" tone="orange" />
              <strong>داده موجود نیست</strong>
              <span>وضعیت رخدادها تا اتصال منبع ممیزی قابل تأیید نیست.</span>
            </Surface>
          </section>

          <section className="system-customer-control" id="access">
            <div className="system-customer-control__heading">
              <div>
                <span className="system-heading__eyebrow">قواعد محصول</span>
                <h2>قواعد تعریف‌شده در source</h2>
                <p>
                  این موارد قرارداد محصول هستند؛ اجرای آن‌ها در هر محیط deployment باید جداگانه
                  راستی‌آزمایی شود.
                </p>
              </div>
              <Badge tone="warning">وضعیت runtime را نشان نمی‌دهد</Badge>
            </div>
            <div className="system-identity-control-list">
              {identityControls.map((control) => (
                <div className="system-identity-control" key={control.label}>
                  <span className="system-identity-control__icon" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <strong>{control.label}</strong>
                    <small>{control.detail}</small>
                  </span>
                  <Badge tone={control.tone}>{control.value}</Badge>
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
