# Analytics Read Model

مالک projectionهای گزارش عملیاتی فانتینو است. این سرویس فقط رویدادهای نسخه‌دار Organization & Branch و Device Integration را از RabbitMQ دریافت می‌کند؛ داده‌ی گزارش را از جدول سرویس‌های دیگر نمی‌خواند. API آن داخلی است و مصرف‌کننده‌ی مجازش API Gateway است.

## راه‌اندازی محلی

متغیرهای لازم در زمان اجرا:

- `ANALYTICS_DATABASE_URL`: اتصال runtime به PostgreSQL و schema `analytics_read_model`.
- `ANALYTICS_MIGRATION_DATABASE_URL`: اتصال migration با مجوز DDL.
- `ANALYTICS_API_GATEWAY_TOKEN`: راز تصادفی حداقل ۳۲ کاراکتری که فقط بین Gateway و این سرویس به اشتراک گذاشته می‌شود.
- `RABBITMQ_URL`: اتصال broker برای پوشش رویدادهای عملیاتی.
- `PORT` (پیش‌فرض `4060`).
- `DEVICE_HEALTH_STALE_AFTER_SECONDS` و `DEVICE_HEALTH_OFFLINE_AFTER_SECONDS`: همان policy سرویس Device Integration؛ مقدار دوم باید از اول بزرگ‌تر باشد.

سپس از ریشه‌ی monorepo:

```powershell
pnpm --filter @funtino/analytics-read-model prisma:generate
pnpm --filter @funtino/analytics-read-model prisma:migrate
pnpm --filter @funtino/analytics-read-model dev
```

در Runflare، `ANALYTICS_DATABASE_URL` برای runtime و `ANALYTICS_MIGRATION_DATABASE_URL` برای DDL در هر startup لازم‌اند و باید به یک database و schema `analytics_read_model` اشاره کنند؛ host می‌تواند به‌دلیل pooler/direct connection متفاوت باشد. پیش از شروع، Docker schema را idempotent آماده و migration نسخه‌دار `0001_analytics_read_model` و migrationهای بعدی را با `prisma migrate deploy` اعمال می‌کند؛ با failure برنامه بالا نمی‌آید. خطای Prisma/PostgreSQL در log می‌ماند ولی URL/token/password حذف می‌شود. در production نبودن RabbitMQ یا token معتبر همچنان باعث fail-closed/readiness ناموفق می‌شود. برای نقش runtime، دسترسی به schema و داده‌های همین سرویس محدود شود؛ مجوز DDL فقط به URL migration داده شود.

## API، تست و بازسازی

- قرارداد داخلی: `contracts/openapi/analytics-read-model.yaml`
- API عمومی پنل: `GET /api/v1/operations/reports` و `POST /api/v1/operations/reports/export` در Gateway.
- export فقط ردیف‌های روزانه‌ی تجمیعی را برمی‌گرداند؛ IAM با مجوز `report.export` و MFA step-up، scope و session را در Gateway بررسی می‌کند. Analytics ثبت append-only درخواست export را در همان تراکنش query ذخیره می‌کند.
- گزارش‌ها UTC، حداکثر ۳۶۶ روز، بدون PII یا شاخص مالی هستند. ردیف‌های branch تا ۵۰۰ مورد نمایش داده می‌شوند و تعداد کل دستگاه‌ها مستقل از این سقف محاسبه می‌شود.
- بازسازی از journal رویدادهای sanitized و append-only در generation جدید انجام می‌شود؛ cutover زیر advisory lock و پس از catch-up تا high-watermark رخ می‌دهد. دستور عملیاتی: `pnpm --filter @funtino/analytics-read-model analytics:rebuild`.

## پوشش و محدودیت فعلی

Projection وضعیت مجموعه، شعبه، چرخه‌عمر/سلامت دستگاه و شمار رویدادهای معتبر این producerها را دارد. `coverageStartedAt` آغاز مصرف‌کننده را نشان می‌دهد و بازه‌ی پیش از آن سابقه‌ی کامل تلقی نمی‌شود. این مرحله snapshot/backfill از داده‌های موجود پیش از فعال‌شدن consumer ندارد؛ بنابراین برای شروع گزارش تاریخی باید backfill نسخه‌دار از API مالک‌ها با cursor/high-watermark طراحی و اجرا شود.

Wallet/فروش، بازدید مشتری، رفتار خرید، کمپین و CRM هنوز منبع رویدادی معتبر و مالک فعال ندارند؛ هیچ‌کدام از این شاخص‌ها حدس یا از جدول Gateway استنتاج نمی‌شوند. Repository مستقل `funtino-analytics-worker` provision شده و snapshot مستقل دارد؛ اتصال به item/Auto Pull، secretهای زمان اجرا، migration جداگانه، پایش RabbitMQ/DLQ و آزمون بازیابی واقعی همچنان باید در Runflare/staging تأیید شوند.
