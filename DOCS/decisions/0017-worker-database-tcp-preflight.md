# ADR-0017: پیش‌بررسی TCP اتصال دیتابیس Worker

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-04
- دامنه: مرحله‌ی startup پنج Worker دارای migration در ADR-0015
- مجوز تصمیم: رفع ابهام timeout هنگام راه‌اندازی Backend و نبود نشست قابل مشاهده در PostgreSQL

## زمینه

Runner قبلی فقط DNS را بررسی می‌کرد. در رخداد گزارش‌شده hostname داخلی PostgreSQL به IP resolve می‌شد، اما فرمان Prisma تا timeout منتظر می‌ماند و از `pg_stat_activity` نیز نشست قابل انتسابی دیده نمی‌شد. نتیجه‌ی DNS به‌تنهایی نشان نمی‌دهد که پورت مقصد از container قابل دسترسی است.

## گزینه‌ها

1. حفظ رفتار فعلی و واگذاری همه‌ی تشخیص به timeout Prisma؛ علت network از کد مرحله‌ی startup جدا نمی‌شود.
2. یک اتصال TCP کوتاه به IP resolve‌شده و پورت URL پیش از Prisma؛ دسترسی لایه‌ی شبکه روشن می‌شود، اما auth و SQL بررسی نمی‌شوند.
3. انجام login یا query تشخیصی مستقل؛ credentialها و منطق پروتکل PostgreSQL را وارد probe می‌کند و عملاً اتصال موازی دیگری می‌سازد.

## تصمیم

پس از DNS، runner به‌صورت موازی IPهای همان hostname را با timeout پنج‌ثانیه‌ای TCP می‌سنجد. حداقل یک اتصال موفق اجازه می‌دهد مرحله‌ی Prisma ادامه یابد؛ اگر همه شکست بخورند، startup با `DATABASE_TCP_CONNECT_FAILED` fail-closed می‌شود و هیچ migration یا برنامه‌ی Worker اجرا نمی‌شود. برای هر آدرس فقط IP، خانواده‌ی آدرس و کد خطای سیستم ثبت می‌شود؛ URL و credential هرگز در event قرار نمی‌گیرند.

این probe login یا startup packet پروتکل PostgreSQL نمی‌فرستد و بلافاصله socket را می‌بندد. بنابراین:

- موفقیت آن فقط TCP reachability روی host/port را ثابت می‌کند؛ PostgreSQL بودن endpoint، وجود database/schema، اعتبار credential و مجوز DDL را ثابت نمی‌کند.
- این اتصال ephemeral و احرازنشده، session پایدار `pg_stat_activity` ایجاد نمی‌کند. خروجی migration Prisma همچنان مرجع تشخیص protocol/auth/DDL است.
- نام نمایشی port در پنل به‌تنهایی مسیر را عوض نمی‌کند؛ host، پورت عددی و targetPort تعیین‌کننده‌اند.

## پیامد و rollback

- برای network drop یا port اشتباه، log علت را پیش از timeout سی‌ثانیه‌ای Prisma با کدهایی مانند `ECONNREFUSED`، `ETIMEDOUT` یا `ENETUNREACH` مشخص می‌کند.
- اگر TCP باز باشد، startup بدون تغییر ادامه می‌یابد و خطای بعدی Prisma باید جداگانه بررسی شود.
- probe فقط در runner backend و حالت `--bootstrap-only` اجرا می‌شود؛ schema و داده‌ی PostgreSQL را تغییر نمی‌دهد.
- rollback با بازگرداندن همین runner به revision قبلی انجام می‌شود؛ migrationهای اجراشده reset یا معکوس نمی‌شوند.

## اثر و اعتبارسنجی

- source: `scripts/worker-startup.mjs` و `scripts/worker-startup.spec.mjs`.
- deployment اثرپذیرفته: فقط `funtino-backend-runtime`، چون runner و processهای پنج Worker در bundle Backend قرار دارند.
- اعتبارسنجی: تست TCP loopback برای مسیر موفق، تست خطای تزریق‌شده برای شکست، و بررسی build Docker snapshot.
- مراجع: [ADR-0015](0015-worker-startup-migrations.md)، [Runbook دو runtime](../runbooks/GroupedRunflareRuntime.md)، [workflow انتشار](../CommitPushAndDeploymentWorkflow.md).
