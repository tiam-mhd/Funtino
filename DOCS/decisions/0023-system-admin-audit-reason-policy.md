# ADR-0023: سیاست دلیل اختیاری برای ممیزی پنل System

- تاریخ: 2026-10-12
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول
- دامنه: System Web، API Gateway، Identity & Access، Organization & Branch، OpenAPI و دو runtime bundle
- superseded by ADR-0025: دسته‌بندی reason برای تغییر role/permission، override و membership؛ فهرست step-up و فرمان‌های پرریسک

## زمینه

پنل System برای ایجاد و ویرایش نقش، کارکنان، مجوزها، سیاست نشست، مجموعه و شعبه در بسیاری از mutationها دلیل اجباری می‌خواست. ثبت actor و وضعیت تغییر برای ممیزی لازم است؛ اما گرفتن متن دلیل برای هر تغییر عادی اصطکاک بی‌مورد ایجاد می‌کند. لغو دسترسی فعال اثر امنیتی جدی و فوری دارد و همچنان باید توضیح صریح داشته باشد.

## تصمیم

- فیلدهای دلیل در فرم‌های مدیریتی System باقی می‌مانند. دلیل برای دعوت و لغو دعوتِ در انتظار، تعلیق/فعال‌سازی مجدد، ویرایش نام نقش و تغییرهای عادی سازمان/شعبه اختیاری است؛ دلیل واردشده ثبت می‌شود.
- دلیل برای ایجاد نقش دارای permission، تغییر مؤثر permissionهای role، تغییر role عضویت فعال، ایجاد/revoke override فعال و revoke دائمی membership فعال اجباری است. ADR-0025 تعیین می‌کند کدام commandهای این فهرست نیز به MFA step-up نیاز دارند.
- در قابلیت فعلی System Web، حذف نقش، مجموعه یا شعبه ارائه نمی‌شود. غیرفعال‌کردن نقش و تعلیق مجموعه/شعبه گذارهای برگشت‌پذیرند و دلیل اجباری ندارند. آرشیو terminal در API مالک سازمان/شعبه، اگر از مسیر مجاز دیگری اجرا شود، همچنان دلیل می‌خواهد.
- هر mutation همچنان actor، scope، هدف، زمان، correlation id، نتیجه و snapshot قبل/بعد لازم را audit می‌کند. نسخه‌ی policy، رکورد audit و Outbox در IAM اتمیک می‌مانند؛ در Organization & Branch، audit و Outbox مالک نیز اتمیک می‌مانند.
- دلیل اختیاری در storage با مقدار `NULL` نمایش داده می‌شود؛ متن خالی ذخیره نمی‌شود. audit append-only و retention فعلی بدون تغییر می‌ماند.
- APIهای Operations و System برای دسترسی IAM مشترک‌اند؛ API اجازه‌ی دلیل خالی در mutationهای عادی را می‌دهد، اما UI عملیات فعلی دست‌نخورده می‌ماند. الزام دلیل در لغوهای بحرانی برای همه‌ی مصرف‌کنندگان API یکسان است.
- قواعد جاری MFA و step-up طبق ADR-0025 هستند؛ مجوز server-side، scope، last-admin protection، idempotency، optimistic concurrency، ساختار audit و قواعد مالکیت داده‌ی این ADR حفظ می‌شوند.

## گزینه‌های بررسی‌شده

- نگه‌داشتن دلیل اجباری برای تمام تغییرها: رد شد؛ با نیاز تجربه‌ی مدیریتی سازگار نیست.
- اختیاری‌کردن دلیل در همه‌ی عملیات از جمله لغو دسترسی فعال: رد شد؛ حذف دسترسی مهم باید علت ثبت‌شده داشته باشد.
- اختیاری‌کردن دلیل در تغییرهای عادی و الزام آن فقط در لغوهای بحرانی: پذیرفته شد.

## پیامدها و rollback

- OpenAPI عمومی Gateway و قراردادهای داخلی IAM و Organization & Branch دلیل عادی را اختیاری اعلام می‌کنند.
- migrationهای IAM و Organization & Branch ستون دلیل audit/override را nullable می‌کنند. migration داده‌ی موجود را حذف یا تغییر نمی‌دهد.
- rollback کد به‌تنهایی ممکن است رکوردهای جدید با دلیل `NULL` را در نسخه‌ی قدیمی ناسازگار کند؛ پیش از rollback باید دسترسی نسخه‌ی قدیمی به این داده‌ها ارزیابی شود. الزام مجدد با backfill ساختگی مجاز نیست.
- migration در انتشار Workerهای مجاز طبق ADR-0015 اجرا می‌شود؛ migration از فرایند معمول انتشار سایر appها جدا می‌ماند.

## قراردادها و استقرار

- `contracts/openapi/gateway.yaml`
- `contracts/openapi/identity-access.yaml`
- `contracts/openapi/organization-branch.yaml`
- frontend runtime: `apps/system-web`
- backend runtime: `apps/api-gateway`، `services/identity-access` و `services/organization-branch`
- به‌علت تغییر قرارداد و دو مالک داده، هر دو runtime bundle باید همگام و منتشر شوند.
