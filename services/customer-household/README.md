# Customer & Household owner

این سرویس منبع حقیقت household، اعضا و دسترسی خانوادگی مشتری است. شناسه‌های household/member در سرویس‌های دیگر opaque هستند؛ Wallet هیچ جدول Customer & Household را نمی‌خواند و پیش از تخصیص یا انتقال کارت، عضویت/وضعیت household را از API داخلی این owner اعتبارسنجی می‌کند.

## قرارداد و امنیت

- قرارداد داخلی: `contracts/openapi/customer-household.yaml`.
- Gateway تنها ورودی عمومیِ customer است؛ API داخلی این سرویس نباید public ingress داشته باشد.
- Callerهای Gateway و Wallet tokenهای جدا و مستقل دارند (`CUSTOMER_HOUSEHOLD_GATEWAY_TOKEN` و `CUSTOMER_HOUSEHOLD_WALLET_TOKEN`). در production URL خصوصی باید HTTPS باشد و token واقعی فقط در Secret زمان اجرا قرار گیرد.
- هویت مشتری از نشست احراز‌شده‌ی Gateway می‌آید. داده‌ی کودک حداقلی است و scope دسترسی household در هر خواندن/تغییر سمت سرور بررسی می‌شود.
- رویدادهای نسخه‌دار در Outbox پایدار ذخیره می‌شوند؛ مصرف‌کنندگان باید idempotent باشند. پیام‌ها شامل داده‌ی حداقلی و بدون شناسه‌ی حساس غیرضروری هستند.
- مدل گراف از `FamilyPerson`، عضویت household و edgeهای `parent_of`، `spouse_of`، `sibling_of` و `guardian_of` استفاده می‌کند. متن قدیمی relationship فقط برای بازبینی نگه داشته می‌شود و واقعیت گراف محسوب نمی‌شود.
- پذیرش دعوت حساب ثبت‌شده صریح است و expiry ندارد. لینک دعوت شماره‌ی ثبت‌نشده ۳۲ بایت تصادفی دارد؛ فقط SHA-256 آن ذخیره و raw token فقط یک‌بار از پاسخ ساخت برگردانده می‌شود. دعوت pending تکراری به همان عضو موجود اشاره می‌کند.
- مالک یا سرپرست می‌تواند اطلاعات وابسته را مدیریت کند؛ عضو متصل فقط اطلاعات نمایشی خودش را تغییر می‌دهد. تغییر نسبت با حساب بزرگسال دیگر بدون رضایت او رد می‌شود. تغییرات با expected version، idempotency، audit و Outbox ثبت می‌شوند.
- آرشیو نرم عضویت، دعوت‌های باز و دسترسی مرتبط را لغو می‌کند، اما audit و ارجاع household در Wallet را نگه می‌دارد. مالک برای خروج باید ابتدا مالکیت household را منتقل کند.
- endpoint `family-audit` فقط برای Gateway داخلی است و حداکثر ۲۵ action و زمان را برمی‌گرداند؛ payload audit، actor UUID، شماره و تاریخ تولد در خروجی نیستند. Gateway پیش از خواندن تاریخچه، household را با assignment فعال Wallet در branch انتخاب‌شده محدود می‌کند.

## اجرا و migration

پورت پیش‌فرض `4080` است. `CUSTOMER_HOUSEHOLD_DATABASE_URL` برای runtime و `CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL` برای DDL startup لازم‌اند؛ هر دو باید به یک database و schema `customer_household` اشاره کنند. Docker پیش از اجرای سرویس schema را با `CREATE SCHEMA IF NOT EXISTS` آماده و migrationهای pending را با `prisma migrate deploy` اعمال می‌کند. هر خطا fail-closed است و مانع start می‌شود؛ log خطا را بدون ارسال secret بفرستید.

نمونه‌ی متغیرهای بدون مقدار محرمانه در `.env.example` همین سرویس است. Secret واقعی، backup، migration، backfill و داده‌ی مشتری در source، تست، image یا log قرار نمی‌گیرند.

## تنظیم دعوت

- `CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS` در Worker مقدار پیش‌فرض `7` دارد و فقط ۱ تا ۳۰ روز می‌پذیرد. این مدت اعتبار لینک دعوت شماره‌ی ثبت‌نشده است؛ دعوت حساب ثبت‌شده منقضی نمی‌شود.
- توکن لینک با CSPRNG ساخته می‌شود و secret جداگانه‌ای برای ساخت token لازم نیست. `CUSTOMER_FAMILY_PHONE_HASH_SECRET` فقط در API Gateway برای HMAC شماره‌ی normalize‌شده استفاده می‌شود و حداقل ۳۲ کاراکتر باید داشته باشد.

## آزمون و محدودیت انتشار

از monorepo، `pnpm --filter @funtino/customer-household typecheck`، `test`، `lint` و `build` را اجرا کنید. تست PostgreSQL واقعی، backfill/reconciliation، restore و staging چند tenant جداگانه لازم‌اند. Migration `0002_family_graph_and_invitations` افزایشی است و startup Runner فقط طبق ADR-0015 آن را fail-closed اعمال می‌کند؛ این کار دستی روی دیتابیس production اجرا نمی‌شود. Repository مستقل `funtino-customer-household-worker` provision شده؛ اتصال به item و Auto Pull و rollout production از این محیط قابل راستی‌آزمایی نیست.
