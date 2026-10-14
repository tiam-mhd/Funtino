# ADR-0021: مدیر سراسری مقید به هویت مالک تنظیم‌شده در Runflare

- تاریخ: 2026-10-05
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول
- دامنه: API Gateway، Identity & Access، bootstrap تولید، runtime بک‌اند و authorization سراسری
- جایگزین: انتخاب permission مدیر در ADR-0019 و ADR-0020؛ عمر نشست و write gate در ADR-0020 حفظ می‌شوند. الزام MFA در هر ورود ADR-0020 با ADR-0025 supersede شده است؛ TOTP/recovery تازه و یک‌باره‌ی `finalize` این ADR همچنان لازم است.

## مسئله و زمینه

مدیر اصلی باید همه‌ی اختیارهای مدیریتی تعریف‌شده در کاتالوگ را داشته باشد، اما bootstrap قبلی UUID دلخواه می‌پذیرفت و دو permission ویژه را حذف می‌کرد. شماره‌ی حساب در مالک هویت فعلی API Gateway ذخیره می‌شود؛ IAM فقط شناسه‌ی opaque را نگه می‌دارد و مجاز نیست مستقیماً جدول حساب Gateway را بخواند. در production نیز writeهای مدیریتی با feature gate مستقل و پیش‌فرض بسته کنترل می‌شوند.

## گزینه‌های بررسی‌شده

1. پذیرش UUID آزاد از terminal و اتکا به دقت اپراتور؛ رد، چون مقصد bootstrap قابل اشتباه یا تغییر است.
2. اتصال مستقیم IAM به جدول حساب Gateway برای جست‌وجوی شماره؛ رد، چون مرز مالکیت داده را نقض می‌کند.
3. resolve شماره‌ی allow-listed در API Gateway و ارائه‌ی شناسه‌ی opaque به CLI محلی IAM؛ پذیرفته.
4. بازکردن دائمی writeهای production در کد؛ رد، چون kill switch و rollback عملیاتی را حذف می‌کند.

## تصمیم

- شماره‌ی تنها مالک از `SYSTEM_ADMIN_OWNER_PHONE_E164` در runtime همان API Gateway خوانده می‌شود. مقدار باید canonical E.164 باشد. شماره در کد، DB مربوط به IAM، log، audit، event و repository ذخیره یا چاپ نمی‌شود.
- Gateway فقط در endpoint داخلی `GET /internal/v1/system/bootstrap-owner`، شماره‌ی پیکربندی‌شده را با حساب موجود خود resolve و `userId` opaque را برمی‌گرداند. endpoint هم‌زمان به loopback، service id برابر `identity-access` و secret مجزای `SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_TOKEN` نیاز دارد. secret فقط به API Gateway و Identity & Access process در backend item داده می‌شود.
- bootstrap CLI دیگر `user-uuid` نمی‌پذیرد؛ در هر invocation شناسه را از endpoint محلی Gateway می‌گیرد. اگر حسابی برای شماره موجود نباشد، fail-closed می‌شود و حساب خود مالک باید ابتدا یک‌بار با OTP ساخته شود.
- `prepare` برای همان حساب نقش موقت ۲۴ساعته و فاقد مجوز مدیریتی عادی می‌سازد. `finalize` تنها پس از TOTP یا recovery code تازه و یک‌بارمصرف، membership را در تراکنش قفل‌شده‌ی policy به نقش سراسری system-managed تبدیل می‌کند. audit قبل/بعد و Outbox اتمیک می‌مانند.
- `system_admin` تمام کلیدهای `permissionCatalog` جاری را می‌گیرد؛ `delegable` بودن مانع تخصیص کلید به نقش محافظت‌شده‌ی system-managed نیست. این شامل `organization.create`، `system.session_policy.manage`، `system.access.bootstrap` و `system.access.impersonate` است. هر کلید همچنان باید endpoint و authorization سمت سرور متناسب داشته باشد؛ تعریف کلید به‌تنهایی route تازه ایجاد نمی‌کند.
- هنگام finalize برای مالک پیکربندی‌شده، membershipهای global با role نام `system_admin` و وضعیت غیر از revoked که به حساب دیگری تعلق دارند در همان تراکنش revoke و audit می‌شوند. نقش با permissionهای شناخته‌شده‌ی ناقص قابل reconcile است؛ وجود permission خارج از کاتالوگ، role غیرسیستمی/ناسازگار یا state آسیب‌دیده fail-closed می‌ماند.
- قاعده‌ی «MFA در هر ورود مدیر سراسری» با ADR-0025 supersede شده است. عمر session مدیریتی ۱ تا ۱۲ ساعت با پیش‌فرض ۱۲ و write gate production همچنان طبق ADR-0020 می‌ماند؛ `finalize` یک‌باره‌ی همین ADR هنوز TOTP/recovery تازه می‌خواهد.
- API Gateway مالک resolve رابطه‌ی شماره به حساب در کد فعلی است؛ IAM هیچ دسترسی مستقیمی به جدول `users` Gateway نمی‌گیرد. endpoint داخلی فقط برای CLI bootstrap است، cache نمی‌شود، و شماره یا token را در response/log قرار نمی‌دهد.

## پیامدها و trade-offها

- Backend runtime به route داخلی Gateway، guard، دو متغیر runtime مالک/lookup و یک متغیر secret مشترک بین دو process نیاز دارد. migration دیتابیس اضافه نمی‌شود.
- فقط backend bundle اثرپذیر است؛ frontend، قراردادهای UI و نشست‌های مشتری تغییر نمی‌کنند.
- بستن write gate به `false` rollback سریع عملیات عادی مدیریتی است. دسترسی نقش bootstrap‌شده در DB باقی می‌ماند و حذف آن نیازمند تصمیم ممیزی‌شده‌ی جداست.
- مالک باید قبل از bootstrap در Runflare شماره را تنظیم کند. تغییر آن متغیر، مقصد bootstrap بعدی را عوض می‌کند؛ تغییر Runtime config به‌تنهایی membership موجود را منتقل نمی‌کند، اما finalize بعدی owner جدید را bind و مدیرهای دیگر را revoke می‌کند.

## قرارداد، rollout و rollback

- قرارداد: `contracts/openapi/api-gateway-internal.yaml`.
- پیاده‌سازی: `apps/api-gateway/src/interfaces/http/`، `services/identity-access/src/bootstrap/` و allow-list در `scripts/runtime-bundle/backend.processes.json`.
- در Runflare backend، `SYSTEM_ADMIN_OWNER_PHONE_E164` فقط برای API Gateway، `SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_TOKEN` برای دو process و `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` برای IAM در پنجره‌ی rollout تنظیم می‌شوند. bootstrap flag فقط به invocation تعاملی CLI داده و فوراً حذف می‌شود.
- migration لازم نیست. هر تغییر نقش و لغو مدیر قبلی با audit/outbox در تراکنش ثبت می‌شود. rollback کد، داده‌های role را خودکار downgrade نمی‌کند؛ دسترسی‌ها با SQL دستی دست‌کاری نمی‌شوند.

## اسناد مرتبط

- [قواعد لازم‌الاجرای پیاده‌سازی](../ImplementationRules.md)
- [مدیریت staff و access](../OperationsStaffAccess.md)
- [Runbook دو runtime](../runbooks/GroupedRunflareRuntime.md)
- [راهنمای Identity & Access](../../services/identity-access/README.md)
