# Customer & Household owner

این سرویس منبع حقیقت household، اعضا و دسترسی خانوادگی مشتری است. شناسه‌های household/member در سرویس‌های دیگر opaque هستند؛ Wallet هیچ جدول Customer & Household را نمی‌خواند و پیش از تخصیص یا انتقال کارت، عضویت/وضعیت household را از API داخلی این owner اعتبارسنجی می‌کند.

## قرارداد و امنیت

- قرارداد داخلی: `contracts/openapi/customer-household.yaml`.
- Gateway تنها ورودی عمومیِ customer است؛ API داخلی این سرویس نباید public ingress داشته باشد.
- Callerهای Gateway و Wallet tokenهای جدا و مستقل دارند (`CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN` و `CUSTOMER_HOUSEHOLD_WALLET_TOKEN`). در production URL خصوصی باید HTTPS باشد و token واقعی فقط در Secret زمان اجرا قرار گیرد.
- هویت مشتری از نشست احراز‌شده‌ی Gateway می‌آید. داده‌ی کودک حداقلی است و scope دسترسی household در هر خواندن/تغییر سمت سرور بررسی می‌شود.
- رویدادهای نسخه‌دار در Outbox پایدار ذخیره می‌شوند؛ مصرف‌کنندگان باید idempotent باشند. پیام‌ها شامل داده‌ی حداقلی و بدون شناسه‌ی حساس غیرضروری هستند.

## اجرا و migration

پورت پیش‌فرض `4080` است. `CUSTOMER_HOUSEHOLD_DATABASE_URL` برای runtime و `CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL` برای DDL startup لازم‌اند؛ هر دو باید به یک database و schema `customer_household` اشاره کنند. Docker پیش از اجرای سرویس schema را با `CREATE SCHEMA IF NOT EXISTS` آماده و migrationهای pending را با `prisma migrate deploy` اعمال می‌کند. هر خطا fail-closed است و مانع start می‌شود؛ log خطا را بدون ارسال secret بفرستید.

نمونه‌ی متغیرهای بدون مقدار محرمانه در `.env.example` همین سرویس است. Secret واقعی، backup، migration، backfill و داده‌ی مشتری در source، تست، image یا log قرار نمی‌گیرند.

## آزمون و محدودیت انتشار

از monorepo، `pnpm --filter @funtino/customer-household typecheck`، `test`، `lint` و `build` را اجرا کنید. تست PostgreSQL واقعی، backfill/reconciliation، restore و staging چند tenant جداگانه لازم‌اند. Repository مستقل `funtino-customer-household-worker` provision شده؛ اتصال به item و Auto Pull و rollout production از این محیط قابل راستی‌آزمایی نیست.
