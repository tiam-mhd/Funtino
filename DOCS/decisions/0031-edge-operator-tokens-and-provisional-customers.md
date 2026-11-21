# ADR-0031: توکن اپراتور Edge و رکورد موقت مشتری

- تاریخ: 2026-11-21
- وضعیت: accepted
- تصمیم‌گیر: پاسخ صریح مالک محصول در همین کار
- دامنه: API Gateway، Identity & Access، Device Integration، Customer & Household و runtime backend

## زمینه

قرارداد Edge برای هر درخواست، هویت نصب و HMAC را لازم می‌داند و برای mutationها مجوز واقعی اپراتور و scope شعبه را هم می‌خواهد. Windows نباید نقش یا permission را تعیین کند. Gateway نشست مدیریتی cookie-based دارد، ولی IAM هنوز access token قابل‌اعتبارسنجی برای نصب Windows صادر نمی‌کند. ثبت آفلاین مشتری نیز فقط در Windows provisional است و نباید هنگام sync با نام یا تلفن مشابه به مشتری موجود متصل شود.

## تصمیم‌ها

- Gateway تنها نقطه‌ی تبادل نشست مدیریتی با IAM است. درخواست ساخت توکن از نشست معتبر Operations و branch scope تأییدشده می‌آید؛ token به actor، نشست مدیریتی، branch و permissionهای مجاز bind می‌شود. Device Integration نصب ثبت‌شده را به branch همین token محدود می‌کند.
- IAM توکن opaque تصادفی با عمر حداکثر پنج دقیقه صادر می‌کند و فقط hash توکن را نگه می‌دارد. raw token فقط در پاسخ تبادل یک‌باره نمایش داده می‌شود. token هیچ نقش یا permission قابل‌اعتماد از Windows دریافت نمی‌کند.
- Device Integration پس از اعتبارسنجی HMAC و نصب، token را با IAM introspect می‌کند. IAM branch، permission، انقضا، وضعیت لغو و سیاست جاری را بررسی می‌کند؛ خروج از نشست مدیریتی revoke را به IAM می‌فرستد و عمر پنج‌دقیقه‌ای سقف اعتبار باقی‌مانده است. scope یا permissionهای client-supplied قابل اعتماد نیستند. در دسترس نبودن IAM باعث رد درخواست می‌شود.
- token برای یک branch است. permission هنگام صدور فقط از catalog IAM انتخاب می‌شود و IAM آن را برای membership و scope واقعی کاربر ارزیابی می‌کند. درخواست حساس باید permission مخصوص همان عملیات را هنگام استفاده هم دوباره ارزیابی کند.
- Customer & Household مالک رکورد provisional مرکزی است. هر ورودی دارای شناسه‌ی provisional پایدار است و sync با همان Idempotency-Key نتیجه‌ی قبلی را برمی‌گرداند. فقط شناسه‌ی provisional، نصب، branch، actor و status ذخیره می‌شود؛ این رکورد حساب مشتری نیست و تا اتصال صریح و اعتبارسنجی شناسه‌های مالکانه pending می‌ماند. هیچ join یا matching بر اساس نام یا تلفن انجام نمی‌شود. permission مجزای `customer.provisional.create` در catalog نسخه‌ی ۷ استفاده می‌شود.
- ورود، نشست، phone identity و credential در Gateway باقی می‌مانند؛ پروفایل مشتری به‌طور مالکانه به Customer & Household منتقل می‌شود. APIهای Gateway برای Customer Web در زمان فعال‌سازی `CUSTOMER_PROFILE_OWNER_ENABLED` فقط BFF هستند. profile data در Gateway dual-write نمی‌شود؛ انتقال تاریخی ابزار جدا و dry-run پیش‌فرض دارد و تا اجرای کنترل‌شده، cutover پروفایل خاموش می‌ماند.

## الزامات نگهداری و rollout

- token hash، scope، actor، policy/catalog version، session id، انقضا، revokedAt و audit event در migration افزایشی IAM ثبت می‌شوند. پاک‌سازی tokenهای منقضی‌شده دوره‌ای و محدود است؛ audit/idempotency حذف نمی‌شوند.
- Gateway فقط permissionهایی را درخواست می‌کند که از IAM catalog برای Edge تعریف شده‌اند و branch را از مرجع Organization & Branch اعتبارسنجی می‌کند. `customer.provisional.create` فقط برای نقش‌های مدیریتی/صندوق‌دار که مجازند در شعبه رکورد pending ثبت کنند پیش‌فرض می‌شود.
- Device Integration توکن اپراتور را در log، پاسخ خطا، snapshot یا telemetry ثبت نمی‌کند. برای فراخوانی Customer & Household یک service token اختصاصی دوطرفه لازم است؛ این credential با توکن Gateway یا Wallet مشترک نیست. تمام ارتباطات داخلی باید TLS و service-token protected باشند.
- migration در deployment job جدا اجرا می‌شود؛ migration یا backfill روی production در این کار اجرا نمی‌شود.

## پیامدها

- اپراتور برای هر شعبه باید از نشست معتبر Operations توکن کوتاه‌عمر بگیرد. IAM در هر اعتبارسنجی مجوز جاری را دوباره ارزیابی می‌کند؛ لغو نشست از Gateway اعمال می‌شود و توکن حداکثر پنج دقیقه عمر دارد.
- Windows می‌تواند شناسه‌ی provisional را با Idempotency-Key پایدار retry کند، اما Customer & Household هرگز هویت را با شباهت نام یا شماره ادغام نمی‌کند. پاسخ مرکزی `customerConfirmed=false` را برمی‌گرداند.
- Customer & Household منبع حقیقت profile data خواهد بود؛ login identity و session در Gateway باقی می‌ماند. ابزار انتقال و cutover باید از backfill production جدا باشند.
