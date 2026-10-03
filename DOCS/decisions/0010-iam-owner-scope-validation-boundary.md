# ADR-0010: مرز اعتبارسنجی scope مالک در mutationهای IAM

- تاریخ: 2026-10-01
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول (تأیید گزینه‌ی ۱)
- دامنه: Identity & Access، Organization & Branch، API Gateway و Operations Web

## مسئله و تعارض اسناد

اکنون API داخلی Organization & Branch برای تأیید وجود سازمان، active بودن، وجود شعبه و رابطه‌ی parent/child پیاده شده است. IAM هنوز writeهای tenant را در `production` با fail-closed می‌بندد.

دو تصمیم پذیرفته‌شده مرز مجوز را متفاوت بیان می‌کردند:

- ADR-0008 اتصال را به اعتبارسنجی وجود/وضعیت/parent و «اجازه‌ی actor در همان owner» مشروط می‌کند.
- ADR-0009 می‌گوید IAM منبع مجوز actor است و Organization & Branch فقط وجود، وضعیت و نسبت منابع را تأیید می‌کند؛ owner نباید role یا membership را کپی کند.

مالک محصول در 2026-10-01 گزینه‌ی ۱ را انتخاب کرد. این ADR تعارض را برای اتصال IAM به owner حل می‌کند و عبارت مبهم ADR-0008 را supersede می‌کند؛ ADR-0009 درباره‌ی مالکیت داده و permission همچنان برقرار است.

## گزینه‌ها

1. **پیروی از مرز ADR-0009:** IAM پس از احراز مجوز actor، اعتبارسنجی owner را با API داخلی نسخه‌دار و credential مجزای `identity-access` انجام دهد. Owner فقط وجود، وضعیت فعال و رابطه‌ی parent/child را گزارش کند؛ IAM مالک permission باقی بماند.
2. **پیروی از عبارت ADR-0008:** owner علاوه بر اعتبار منبع، اجازه‌ی actor را هم تصمیم بگیرد. برای این گزینه باید قرارداد و مالکیت permission در owner، ورودی اعتمادشده‌ی هویت actor، نحوه‌ی هماهنگی با IAM و پیامد کپی/وابستگی مجوزها جداگانه تعریف و پذیرفته شود. تا آن زمان writeهای tenant بسته می‌مانند.
3. **نگه‌داشتن gate:** writeهای tenant در production همچنان fail-closed بمانند و رابط فقط در محیط‌های مجاز غیرproduction قابل استفاده باشد.

## تصمیم

**گزینه‌ی ۱ پذیرفته شد.** IAM تنها مرجع تصمیم مجوز actor است. Organization & Branch تنها مرجع وجود، وضعیت و رابطه‌ی parent/child منبع است و هیچ role، membership، permission یا تصمیم مجوز actor را در خود نگه‌داری یا محاسبه نمی‌کند.

- در هر mutation دارای scope سازمان/شعبه در `NODE_ENV=production`، IAM ابتدا مجوز actor را با membership، policy، delegation و MFA خودش بررسی می‌کند؛ فقط پس از مجازشدن actor، همان scope را با credential مستقل از `POST /internal/v1/scopes/validate` در owner اعتبارسنجی می‌کند.
- scope معتبر باید متعلق به همان organization و در وضعیت فعال باشد؛ برای scope شعبه، خود branch نیز باید فعال و متعلق به همان organization باشد. پاسخ معتبر باید شناسه‌های درخواستی و versionهای مثبت owner را داشته باشد.
- پاسخ `valid:false` به‌عنوان رد مجوز عمومی ثبت‌شده در audit بازگردانده می‌شود. timeout، قطع سرویس، credential نامعتبر، پاسخ malformed یا شناسه/version ناسازگار به `503` و عدم تغییر داده منجر می‌شود. هیچ خطای owner باعث fallback به UUID opaque در production نمی‌شود.
- اعتبارسنجی از داخل مرز تراکنش IAM و بعد از احراز permission/delegation اجرا می‌شود؛ timeout شبکه ۲ ثانیه است و در هر شکست، transaction و idempotency mutation commit نمی‌شوند. داده‌ی owner در IAM کپی نمی‌شود.
- token با هویت `identity-access` فقط مجاز به `POST /internal/v1/scopes/validate` است؛ دسترسی آن به routeهای دیگر owner رد می‌شود. token آن با Gateway و Device Integration مجزا می‌ماند. URL مالک در production باید HTTPS باشد و درخواست tokenدار redirect را دنبال نمی‌کند.
- رفتار nonproduction مطابق ADR-0008 حفظ می‌شود: scopeهای opaque برای توسعه/آزمون پذیرفته می‌شوند و اثبات وجود resource نیستند. در production، tenant write فقط در صورت پیکربندی معتبر HTTPS برای `ORGANIZATION_BRANCH_URL` و `ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN` فعال است؛ خود هر درخواست همچنان owner را زنده صدا می‌زند.
- این ADR فقط مرز mutationهای IAM را تعیین می‌کند. Gateway و سرویس مالک همچنان باید برای هر عملیات عمومی، permission و وضعیت زنده‌ی resource را در محدوده‌ی خود بررسی کنند؛ پاسخ IAM جایگزین کنترل domain در owner نیست.

## پیامدها و rollback

- readiness مقدار configured بودن validator را جدا از دسترس‌پذیری لحظه‌ای owner گزارش می‌کند؛ اگر owner هنگام mutation در دسترس نباشد، آن mutation fail-closed می‌شود.
- بازگشت امن، بستن tenant writes با حذف/نامعتبرکردن credential یا بازگرداندن guard fail-closed است؛ هیچ داده‌ی owner در schema IAM کپی نمی‌شود.
- اجرای migration لازم نیست؛ schema تغییر نکرده است. این تصمیم مجوز ساخت secret واقعی، استقرار، backfill یا بازکردن عملیاتی production نیست.
- scope غیرفعال، از جمله برای revoke/suspend tenant، در این مسیر رد می‌شود؛ مسیر break-glass سراسری خارج از این ADR باقی می‌ماند و باید مطابق ADR-0005/MFA/audit استفاده شود.

## اسناد و قراردادهای اثرپذیرفته

- [ADR-0008](0008-iam-management-write-gates.md)
- [ADR-0009](0009-organization-branch-owner-and-legacy-cutover.md)
- `contracts/openapi/organization-branch.yaml`
- `contracts/openapi/identity-access.yaml`
- `contracts/openapi/gateway.yaml`
- `services/identity-access/src/application/ports/organization-scope-owner.port.ts`
- `services/identity-access/src/infrastructure/organization-branch/organization-scope-owner.client.ts`
- [مدیریت کارکنان و دسترسی Operations](../OperationsStaffAccess.md)
