# ADR-0012: پایش عملیاتی خصوصی و خلاصه‌ی سلامت مجوزدار

- وضعیت: accepted
- تاریخ: 2026-10-01
- دامنه: telemetry backend، داشبورد System Web، پایش broker و هشدار عملیاتی

## مسئله و زمینه

هشت process backend در source، log ساخت‌یافته و endpoint metrics با token مستقل دارند؛ اما scrape، histogram تاخیر، داشبورد و alert delivery متصل نبود. System Web عمومی نیز نباید target داخلی یا آمار زیرساخت را بدون نشست و مجوز نشان دهد. مقادیر واقعی شبکه، secretهای metrics و مقصد هشدار در workspace وجود ندارند.

## گزینه‌ها

1. خواندن endpointهای هر سرویس مستقیماً از مرورگر یا System Web؛ رد می‌شود چون secret و topology را به کلاینت می‌رساند و کنترل scope ضعیف می‌شود.
2. scrape متمرکز و private با Prometheus، داشبورد Grafana و dispatch هشدار Alertmanager؛ انتخاب می‌شود.
3. ارسال مستقیم metric از processها به یک vendor/سرویس بیرونی؛ در این مرحله رد می‌شود تا vendor، هزینه و مقصد داده با تصمیم محصول/امنیت تعیین شود.

## تصمیم

- Prometheus از scrape خصوصی استفاده می‌کند؛ برای هر backend file-discovery target و token جدا دارد و خود Prometheus، Alertmanager و Grafana نیز برای دسترس‌پذیری scrape می‌شوند. secretها فقط فایل runtime هستند و targetهای production نیز خارج از repository provision می‌شوند.
- Grafana داشبورد نسخه‌دار برای availability سرویس‌ها و اجزای monitoring، request rate، 5xx، p95، RabbitMQ backlog و alertهای فعال دارد. Alertmanager فقط از URL فایل secret‌شده‌ی webhook استفاده می‌کند؛ provider مقصد در source انتخاب نشده است.
- HTTP request duration علاوه بر شمارنده و جمع قدیمی، histogram سازگار و additive بر حسب ثانیه صادر می‌کند.
- Gateway یک API خواندنی ثابت برای Prometheus می‌دهد؛ API پس از SessionGuard مجوز global `system.health.read` را از IAM می‌گیرد، PromQL ورودی نمی‌پذیرد، redirect را دنبال نمی‌کند و target address را برنمی‌گرداند.
- صفحه‌ی public در System Web داده‌ی زنده ندارد. داشبورد زنده فقط از مسیر System Web و API مجوزدار قابل مشاهده است.
- RabbitMQ metrics از plugin رسمی `/metrics/detailed` فقط در شبکه‌ی خصوصی scrape می‌شود؛ به‌علت نداشتن bearer auth، endpoint عمومی ممنوع است.
- آستانه‌های 5% خطای 5xx، یک ثانیه p95 و 1,000 پیام آماده‌ی صف، candidate اولیه‌اند و پیش از پایلوت باید با عملیات و SLO واقعی بازتنظیم شوند.

## پیامدها و محدودیت‌ها

- تغییر histogram backward-compatible است و متریک‌های موجود حذف نمی‌شوند.
- هیچ migration دیتابیس یا تغییر منبع حقیقت دامنه ندارد.
- Compose مانیتورینگ فقط برای local است و روی loopback bind می‌شود. Monitoring Deployment و private networking Runflare در source فعلی provision نشده‌اند.
- در broker topology فعلی DLQ/consumer retry اعلام‌شده وجود ندارد. freshness رویداد و telemetry پایگاه‌داده نیز هنوز exporter/metric مالکانه ندارند؛ این سیگنال‌ها نباید در داشبورد به‌عنوان سالم یا صفر نمایش داده شوند.
- بازگشت کد dashboard به نسخه‌ی قبلی بدون migration انجام می‌شود؛ scrape/rule/dashboard config با revert فایل‌های source به نسخه‌ی قبلی برمی‌گردد. rollback deployment production نیازمند image قبلی و schema backward-compatible است.

## سرویس‌ها و بسترهای اثرپذیرفته

`packages/backend-core` و همه‌ی هشت مصرف‌کننده‌اش (API Gateway، Realtime Gateway، Device Integration، Wallet، Notifications، Identity & Access، Organization & Branch و Analytics)، API Gateway، Identity & Access permission catalog، System Web و `infra/monitoring`.

## برنامه‌ی اجرا و بازگشت

1. ابتدا config، قرارداد و تست منبع را بررسی کن؛ سپس مقصدهای private و secretها را در staging provision کن.
2. همه‌ی backendهای وابسته به `backend-core` را با metrics tokenهای مجزای همان محیط منتشر کن.
3. scrape، query API، dashboard، تست webhook، alert delivery و thresholdها را در staging تمرین کن.
4. اگر telemetry روی درخواست عادی اثر گذاشت، route مجاز health را غیرفعال/rollback کن و نسخه‌ی backend قبلی را فقط پس از تأیید سازگاری schema مستقر کن. migration down وجود ندارد.

## اسناد مرتبط

- [گیت‌های کیفیت و پایلوت](../ReleaseQualityGatesAndPilot.md)
- [ساختار فولدر](../FolderAndFileStructure.md)
- [Runbook telemetry](../runbooks/operational-telemetry.md)
- [Runbook backup/restore و rollback](../runbooks/backup-restore-rollback.md)
- [راهبرد استقرار Runflare](../RunflareRepositoryAndDeployment.md)
