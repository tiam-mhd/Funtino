# ADR-0030: Windows Edge، دفترکل کارت و قیمت‌گذاری مرکزی

- تاریخ: 2026-11-18
- وضعیت: accepted
- تصمیم‌گیر: درخواست صریح مالک محصول در این کار
- دامنه: Wallet، Device Integration، Pricing & Promotions، Organization & Branch، API Gateway، Realtime Gateway، سه وب‌اپ، قراردادها و دو runtime bundle

## مسئله و زمینه

Wallet فعلی فقط inventory کارت و تخصیص مشترک household را نگه می‌دارد؛ برای هر `(householdId, branchId)` یک تخصیص فعال دارد و ledger مالی مرکزی ندارد. Device Integration نسخه‌ی ۱ رویداد را با HMAC می‌پذیرد، اما `sourceDeviceId` را پیش از ساخت event کنار می‌گذارد. Gateway نیز برای eventهای دستگاه، دفترکل legacy داخل Gateway را می‌نویسد. در مخزن source، برنامه‌ی Windows، پیاده‌سازی قواعد قیمت فعلی و golden test vectorهای آن وجود ندارد؛ این ADR مرز مرکزی و قرارداد قابل‌مصرف از .NET Framework 4.6.1 را تعیین می‌کند و به پیاده‌سازی Windows یا مخزن دیگری وابسته نیست.

ADR-0013 تا این تصمیم، تخصیص کارت به household را در هر شعبه یکتا می‌کرد و مبلغ مالی را خارج از scope می‌گذاشت. الزام صریح این کار و قرارداد مشترک پیوست‌شده، آن بخش‌ها را جایگزین می‌کند.

## تصمیم‌ها

### مالکیت دامنه

- `services/wallet` مالک inventory و lifecycle کارت، تخصیص کارت به household/member، تاریخچه‌ی مالکیت، دفترکل کارت فیزیکی و projection مانده است. Gateway یا سرویس دیگری جدول Wallet را نمی‌خواند.
- `services/customer-household` همچنان تنها مرجع household، member، رابطه و دسترسی خانوادگی است. Wallet برای هر تخصیص `householdId` و `memberId` اختیاری را از API داخلی این مالک اعتبارسنجی می‌کند.
- `services/device-integration` مالک registry دستگاه، هویت نصب Edge، دریافت v1/v2، صف رویداد، snapshot شعبه و وضعیت همگام‌سازی است. شناسه‌ی دستگاه خارجی در این سرویس به `deviceId` پایدار resolve می‌شود.
- `services/pricing-promotions` مالک نسخه‌های قواعد قیمت و promotion خواهد بود؛ این یک service جدید با schema، API، Outbox، audit، migration و process مستقل است. اتصال آن به دو runtime bundle مالکیت داده را مشترک نمی‌کند.
- Organization & Branch مرجع سازمان، شعبه، ساعت و تنظیمات شعبه باقی می‌ماند. Gateway مرز عمومی و BFF است؛ Realtime فقط invalidation مجاز می‌فرستد.

### کارت و تخصیص

- یک کارت فیزیکی در هر لحظه حداکثر یک تخصیص فعال دارد. یکتایی active بر `(householdId, branchId)` حذف می‌شود؛ یک household در یک شعبه می‌تواند چند کارت داشته باشد.
- هر تخصیص دارای `cardId`، `householdId`، `branchId` و `memberId` nullable است. مقدار خالی فقط کارت مشترک household را نشان می‌دهد.
- کارت دستی با verification برابر `unknown` یا رویداد provisional/pending، تخصیص فعال نمی‌سازد. فعال‌سازی فقط پس از اعتبارسنجی شناسه‌های پایدار کارت، household، member و branch توسط ownerهای مربوط انجام می‌شود.
- assign، transfer، cancel، lost، replacement و revoke سوابق append-only با actor، زمان، scope، دلیل و correlation حفظ می‌کنند. transaction مالی، household/member کارت را در زمان رخداد snapshot می‌کند.
- درخواست مشتری برای مفقودی/تعویض، درخواست ممیزی‌پذیر است و خودکار کارت را تغییر وضعیت نمی‌دهد؛ عملیات شعبه با مجوز scopeدار آن را رسیدگی می‌کند.

### Wallet ledger

- دفترکل در Wallet و به‌ازای کارت فیزیکی است. خلاصه‌ی household فقط جمع حساب‌های مجاز در query است و یک حساب مشترک مالی جدید نمی‌سازد.
- eventهای `top_up`، `spend`، `refund`، `adjustment`، `issuance` و `card_replacement` append-only هستند. اصلاح/برگشت رکورد تازه با ارجاع به تراکنش قبلی می‌سازد؛ update/delete مالی ممنوع است.
- idempotency هم بر `eventId` و هم `(sourceInstanceId, localTransactionId)` برقرار است. شناسه‌ی اصلی منبع legacy حفظ می‌شود.
- projection مانده، `lastConfirmedSnapshotAt`، `lastAppliedEventId`، freshness و اختلاف reconciliation را نگه می‌دارد. projection بدون baseline کامل یا snapshot تأییدشده `unknown`/`stale` است؛ از جمع تاریخچه‌ی ناقص عدد ساخته نمی‌شود.
- فقط یک مالک ledger می‌نویسد: Wallet. consumerهای قدیمی Gateway برای رویداد کارت به Wallet داخلی تحویل می‌دهند؛ مسیر legacy عمومی در پنجره‌ی مهاجرت حذف نمی‌شود و dual-write به Gateway و Wallet مجاز نیست.

### Edge و event contract

- نسخه‌ی ۱ Device Integration تا پایان مهاجرت حفظ می‌شود. نسخه‌ی ۲ مستقل است: `POST /internal/v2/edge/events` و `GET /internal/v2/edge/snapshot?branchId=...&cursor=...`.
- v2 با HMAC-SHA256، زمان درخواست، هویت نصب/branch، TLS، rate limit پایدار و کلیدهای قابل‌چرخش محافظت می‌شود. secret فقط در runtime نگهداری می‌شود.
- هر transaction event دست‌کم `eventId`، `sourceInstanceId`، `localTransactionId`، `sourceDatabase`، `organizationId`، `branchId`، `cardId`، household/member اختیاری، `deviceId` و `sourceDeviceId` اختیاری، نوع تراکنش، مقدار صحیح ریال، `IRR`، مبلغ ناخالص/تخفیف/خالص، promotion/rule/pricing version، زمان UTC، sequence، `balanceAfterRial` و نتیجه‌ی عملیات را حمل می‌کند.
- نتیجه‌ی هر event جداگانه `accepted`، `duplicate` یا `rejected` با error code امن و مشخصه‌ی retry است. eventId و localTransactionId با محتوای یکسان duplicate هستند؛ استفاده‌ی دوباره با payload متفاوت رد می‌شود.
- v1 `sourceDeviceId` را از ورودی تا registry/event/read model حفظ می‌کند. v2 یا deviceId معتبر می‌گیرد یا source ID را در registry همان سازمان/شعبه یکتا resolve می‌کند؛ رخداد مبهم رد می‌شود.
- فقط مصرف قطعی و موفق `spend` به‌عنوان استفاده‌ی دستگاه منتشر می‌شود. failure، cancel و refund انواع نتیجه/تراکنش جدا هستند و مصرف موفق جعل نمی‌کنند.
- Wallet consumer از Inbox/idempotency استفاده می‌کند و پس از commit ack می‌دهد. خطای retryable به retry محدود، و داده‌ی نامعتبر به dead-letter با علت قابل‌نمایش می‌رود.

### Snapshot و قیمت آفلاین

- Device Integration snapshot immutable و versioned شعبه می‌سازد: validity، دستگاه/جاذبه، تنظیمات لازم، قواعد قیمت فعال، نگاشت حداقلی کارت/household/member و cursor صفحه.
- snapshot هر صفحه امضاشده و قابل resume است. نسخه‌ی کامل قبلی تا وقتی دریافت نسخه‌ی جدید کامل و تأیید نشده باقی می‌ماند. PII در snapshot قرار نمی‌گیرد.
- قیمت/تخفیف فقط از نسخه‌ی immutable با validity و سیاست سقف/سهمیه اجرا می‌شود. promotion دارای سقف کلی/یک‌بارمصرف بدون offline quota در snapshot برای فروش آفلاین فعال نیست.
- اولویت، stacking و rounding در قرارداد قیمت صریح و deterministic هستند. قواعدی که مرجع parity با رفتار جاری Windows را ندارند قابل cutover نیستند. تا ارائه و اجرای golden vectorهای واقعی، parity تأییدشده گزارش نمی‌شود و هیچ رفتار legacy از روی حدس پیاده یا فعال نمی‌شود.
- مبلغ ناخالص، تخفیف، خالص، promotion، rule، pricing version و snapshot version روی event معامله ثبت می‌شوند.

### API، UI و realtime

- Customer API فقط از نشست Customer در API Gateway عبور می‌کند و household/member را با مالک Customer & Household بررسی می‌کند. داده شامل کارت‌های مشترک/اختصاصی، تخصیص‌های جاری/سابق، مانده با زمان تأیید و freshness، تعداد pending، تاریخچه‌ی cursorدار و جزئیات مجاز تراکنش است.
- UI مشتری `fresh`، `pending_sync`، `stale` و `unknown` را فارسی نمایش می‌دهد و balance قدیمی را قطعی نمی‌نامد. درخواست lost/replacement با audit ثبت می‌شود. حذف مشتری فقط lifecycle نرم/ناشناس‌سازی مجاز است.
- Operations فقط با مجوز و scope شعبه، کارت پوشیده، تخصیص member، lost/replacement و وضعیت sync همان محدوده را می‌بیند. System مدیریت global، configuration و صف بررسی مجاز را انجام می‌دهد.
- کاربر فقط پس از بررسی سرور می‌تواند room خانوار خود را subscribe کند. Realtime payload حداقلی برای invalidation است؛ UI پس از پیام داده را از Gateway دوباره می‌خواند.

### انتقال داده و rollout

- ابزار انتقال به‌صورت dry-run پیش‌فرض، mapping صریح IDهای قدیمی کارت/شعبه/دستگاه/تراکنش، duplicate/unmapped/rejected، جمع مبلغ و checksum را گزارش می‌کند. هیچ backfill خودکار یا اجرا روی production انجام نمی‌شود.
- migrationها additive، نسخه‌دار، مالکانه و بدون پاک‌کردن Outbox/Inbox/audit/idempotency هستند. rollout app، اجرای job migration و backfill سه اقدام جدا می‌مانند.
- تغییرها از source monorepo منتشر می‌شوند. pricing service به Backend bundle و UI/contract مشترک به bundleهای مصرف‌کننده افزوده می‌شود؛ هر دو runtime قبل از push همگام و از clone مقصد اعتبارسنجی می‌شوند.

## پیامدها

- این تصمیم قید assignment قبلی ADR-0013 را supersede می‌کند و APIهای v1 را تا cutover حذف نمی‌کند.
- Wallet تا زمانی که physical-card snapshot یا reconciliation کامل نرسد، balance را unknown نگه می‌دارد؛ زمان migratation قدیمی بدون تاریخچه‌ی معتبر تضمین نمی‌شود.
- رفتار قیمت فعلی Windows در مخزن موجود نیست. انتقال parity و cutover قیمت باز می‌مانند تا مالک محصول golden vectors یا فرمول تأییدشده ارائه کند.
- migration، backfill production، hardware smoke، Runflare Auto Pull و live health با این ADR یا با green CI ادعا نمی‌شوند.

## همگام‌سازی عملیات و rollback

- داشبورد sync از Gateway نشست‌محور وضعیت Device Integration را با scope دقیق شعبه می‌خواند؛ شمار خطاهای دفتر فقط با مجوز کارت افزوده می‌شود.
- replay فقط delivery dead-letter شده را با eventId و envelope اصلی صف می‌کند؛ علت، actor و تلاش‌های قبلی در audit append-only ثبت می‌شوند. رویدادهای Wallet با وضعیت `pending_review` تا اصلاح علت در مالک مربوط قابل replay نیستند.
- دستور اجرا و محدودیت rollback برای migrationهای Wallet و Device Integration در [راهنمای عملیات Windows Edge و Wallet](../WindowsEdgeWalletOperations.md) آمده است. هیچ migration یا backfill روی production اجرا نشده است.