# ADR-0008: فرمان‌های IAM و gate مالکیت scope

- تاریخ: 2026-09-30
- وضعیت: پذیرفته‌شده
- تصمیم‌گیر: مالک محصول

## مسئله و زمینه

ADR-0005 قابلیت مدیریت نقش، عضویت، دعوت و override را تأیید کرده است. ADR-0006 به‌درستی writeهای scope‌دار را تا زمان تکمیل سرویس مالک سازمان/شعبه متوقف می‌کند. سرویس مالک هنوز در repository و deployment مستقل موجود نیست؛ Identity & Access نیز طبق مرز معماری حق خواندن مستقیم جداول آن را ندارد. در عین حال، زیرساخت journal/outbox، policy version، کاتالوگ permission و MFA برای تکمیل commandهای IAM آماده است.

## گزینه‌ها

1. حذف کامل commandها تا آماده‌شدن سرویس سازمان/شعبه؛ امن، ولی مانع توسعه و تست end-to-end IAM می‌شود.
2. فعال‌کردن writeهای scope‌دار در همه‌ی محیط‌ها با UUIDهای opaque؛ سریع، اما وجود و مالکیت شعبه را اثبات نمی‌کند و در production ممکن است scope نامعتبر بسازد.
3. تکمیل commandها و UI در source monorepo، فعال‌بودن scopeهای opaque فقط در محیط غیرproduction و مسدودکردن write سازمان/شعبه در production تا اتصال validator مالک.

## تصمیم

گزینه‌ی ۳ انتخاب شد. این ADR فقط بخش «اجازه‌ی شروع IAM قبل از سرویس سازمان/شعبه» از محدودیت پایانی ADR-0006 را supersede می‌کند؛ محدودیت production و مالکیت داده همچنان برقرار است.

- IAM در هر command، permission مؤثر actor، scope عضویت، سقف delegation، step-up سمت‌سرور، نسخه‌ی مورد انتظار، idempotency و audit را بررسی می‌کند.
- در `NODE_ENV=production` هر mutation با scope سازمان یا شعبه با خطای fail-closed رد می‌شود. scope سراسری فقط برای عملیات مجاز و bootstrap باقی می‌ماند.
- محیط غیرproduction امکان end-to-end را با UUIDهای opaque می‌دهد؛ این فقط ابزار توسعه/آزمون است و اثبات وجود سازمان/شعبه محسوب نمی‌شود.
- اتصال production فقط پس از قرارداد با سرویس مالک و اعتبارسنجی وجود، وضعیت فعال و parent organization قابل بازشدن است. اجازه‌ی actor فقط در IAM محاسبه می‌شود؛ این مرز مطابق ADR-0009 و ADR-0010 است. خواندن مستقیم DB سرویس مالک ممنوع است.
- نقش `system_admin` و `system_admin_bootstrap` از invite، تغییر عادی membership یا ویرایش UI قابل تخصیص/تغییر نیستند. تنها CLI آفلاین دو‌مرحله‌ای با MFA، audit و runbook مجاز است.
- تغییرات IAM در PostgreSQL یک تراکنش می‌مانند: policy lock، mutation، journal/outbox و پاسخ idempotency با هم commit/rollback می‌شوند. کلید idempotency برای ۲۴ ساعت قابل replay است.
- دعوت ۷ روز اعتبار دارد؛ شماره فقط HMAC نسخه‌دار و mask ذخیره می‌شود. OTP مالکیت شماره را ثابت می‌کند اما فعال‌سازی عضویت فقط با پذیرش صریح کاربر است.
- نشست Gateway با TTL فعلی ۳۰ روز باقی می‌ماند؛ عملیات حساس به step-up با عمر حداکثر ۳۰۰ ثانیه و نسخه‌ی فعال فعلی عامل MFA نیاز دارند.

## پیامدها و محدودیت‌ها

- توسعه‌ی nonproduction می‌تواند قراردادها و تجربه‌ی واقعی IAM را تست کند؛ داده‌ی ساخته‌شده در این حالت نباید production seed شود.
- سیستم تا تکمیل owner سازمان/شعبه قادر به اعتبارسنجی وجود scopeهای tenant نیست؛ feature production برای این writeها عمداً در دسترس نخواهد بود.
- آماده‌بودن schema یا build مجوز deploy نیست. migration production، Runflare و seed مدیر production در این کار اجرا نمی‌شوند.
- Bootstrap دو فاز است: CLI آفلاین role محدود و membership موقت را می‌سازد؛ کاربر پس از ورود با OTP، TOTP را ثبت می‌کند؛ سپس CLI کد TOTP/recovery را بدون echo مصرف و عضویت را به system admin ارتقا می‌دهد.
- هر تغییر command یا scope-owner integration باید ADR، OpenAPI، AsyncAPI/schema، تست و deployment gates اثرپذیرفته را همگام کند.

## سرویس‌ها، بسترها و اسناد اثرپذیرفته

- `services/identity-access`: command، migration، bootstrap و security policy.
- `apps/api-gateway`: BFF نشست‌محور، CSRF trusted-origin و forwarding شواهد MFA/idempotency.
- `apps/system-web`: ابزار مدیریت IAM و پذیرش صریح دعوت.
- قراردادها: `contracts/openapi/identity-access.yaml`، `contracts/openapi/gateway.yaml` و event schema تغییر policy.
- تکمیل owner سازمان/شعبه در [ADR-0005](0005-organization-branch-device-card-management.md) و [ADR-0006](0006-administrative-mfa-totp.md) همچنان gate production است.
