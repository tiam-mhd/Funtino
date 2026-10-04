# ADR-0019: مجوز ساخت مجموعه برای مدیر سراسری bootstrapشده

- تاریخ: 2026-10-04
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول/مدیر محصول
- دامنه: Identity & Access، API Gateway و provisioning اولیه‌ی System Web
- تصمیم مرتبط: تکمیل سیاست bootstrap در ADR-0011
- انتخاب permissionهای نقش سراسری در این ADR با ADR-0021 supersede شده است؛ هدف قدیمی یعنی افزودن امن `organization.create` حفظ می‌شود.

## مسئله و زمینه

کاتالوگ IAM، `organization.create` را فقط در scope سراسری تعریف می‌کند و آن را غیرقابل‌واگذاری نگه می‌دارد. مسیر bootstrap نقش دائمی `system_admin` را از permissionهای `delegable` می‌ساخت؛ بنابراین مدیر اولیه پس از bootstrap نمی‌توانست اولین مجموعه را بسازد، در حالی که endpoint ایجاد مجموعه همین permission سراسری را بررسی می‌کند.

## گزینه‌های بررسی‌شده

1. قابل‌واگذاری‌کردن `organization.create` و افزودن آن به همه‌ی roleها؛ این کار مرز delegation را بی‌دلیل گسترش می‌دهد.
2. دورزدن بررسی permission در API ایجاد مجموعه؛ این کار authorization سمت سرور و audit معمول را تضعیف می‌کند.
3. افزودن یک استثنای صریح و محدود به role سیستمی `system_admin`، در مسیر bootstrap آفلاین و ممیزی‌شده.

## تصمیم

گزینه‌ی ۳ انتخاب شد:

- role سراسری و system-managed `system_admin` همه‌ی permissionهای `delegable` کاتالوگ به‌علاوه‌ی `organization.create` را دارد. این مجوز فقط در scope سراسری قرار می‌گیرد.
- `organization.create` در کاتالوگ همچنان `delegable: false` است؛ نقش‌های tenant نمی‌توانند آن را دریافت کنند. مسیر عادی API و UI نیز نمی‌تواند role سیستمی را بسازد یا ویرایش کند.
- تصمیم قبلی برای کنارگذاشتن permissionهای `system.access.bootstrap` و `system.access.impersonate` از مدیر سراسری در ADR-0021 supersede شده است؛ کاتالوگ کامل از طریق همان bootstrap MFAدار اعمال می‌شود.
- finalize فقط پس از MFA تازه و داخل transaction قفل‌شده‌ی policy مجاز است. ایجاد نقش، افزودن permission جاافتاده، ارتقای membership، policy version، audit before/after و outbox اتمیک ثبت می‌شوند.
- اگر role قدیمی دقیقاً permissionهای delegable قبلی را داشته باشد، finalize تنها `organization.create` را اضافه می‌کند. هر مجموعه‌ی permission دیگری ناسازگار تلقی می‌شود و fail-closed باقی می‌ماند.
- این تغییر به migration schema نیاز ندارد؛ permission از قبل در کاتالوگ و جدول `role_permissions` موجود است. اصلاح دستی SQL مجاز نیست.

## پیامدها و ریسک‌ها

- مدیر اصلی می‌تواند اولین مجموعه و سپس منابع مجاز زیرمجموعه را از مسیرهای رسمی API ایجاد کند؛ authorization و step-up موجود API تغییر نمی‌کند.
- مجوز ساخت مجموعه همچنان از delegationهای سازمانی جداست و مجوز bootstrap یا impersonation به مدیر دائمی افزوده نمی‌شود.
- ارتقای role قدیمی فقط از مسیر finalize یک‌باره با MFA و دلیل ممیزی انجام می‌شود؛ roleهای دارای هر انحراف دیگر به اصلاح کنترل‌شده نیاز دارند.

## سرویس‌ها، قراردادها و استقرار اثرپذیرفته

- `services/identity-access`: grant نقش محافظت‌شده، سازگارسازی محدود role قدیمی و audit/outbox؛
- `apps/api-gateway`: بدون تغییر قرارداد؛ endpoint ایجاد مجموعه همچنان `organization.create` و step-up را ارزیابی می‌کند؛
- قرارداد رویداد: از رویداد موجود `role.created`/`role.updated` استفاده می‌شود و schema نسخه‌دار تغییر نمی‌کند؛
- فقط runtime bundle بک‌اند (`funtino-backend-runtime`) اثر می‌پذیرد؛ frontend و دیتابیس نیاز به deployment یا migration جدا ندارند.

## rollout و rollback

پس از انتشار bundle بک‌اند، اپراتور مجاز finalize را با TOTP یا recovery تازه و دلیل ممیزی اجرا می‌کند. اگر finalize به علت role ناسازگار متوقف شود، نباید SQL دستی برای افزودن permission اجرا کرد؛ وضعیت role باید با audit موجود بررسی و یک bootstrap کنترل‌شده انجام شود. rollback کد bundle را برمی‌گرداند؛ اگر permission قبلاً در پایگاه داده ثبت شده باشد، باید برای rollback سیاستی جداگانه و ممیزی‌شده تدوین شود و حذف مستقیم آن مجاز نیست.

## اسناد مرتبط

- [ADR-0008: gateهای نوشتن IAM](0008-iam-management-write-gates.md)
- [ADR-0011: bootstrap مدیر و gateهای production](0011-iam-bootstrap-and-production-write-release-gate.md)
- [قواعد پیاده‌سازی](../ImplementationRules.md)
- [مدیریت سازمان، شعبه و نقش‌ها](../OrganizationBranchDeviceCardManagement.md)
- [راهنمای Identity & Access](../../services/identity-access/README.md)
