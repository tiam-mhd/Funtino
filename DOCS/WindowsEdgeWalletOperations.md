# عملیات Edge ویندوز، Wallet و rollback

## مالک‌ها و مسیر داده

- Device Integration مالک نصب Windows، heartbeat، snapshot شعبه، دریافت Edge v1/v2 و outbox انتشار است.
- Wallet مالک تخصیص کارت، ledger append-only، projection موجودی و inbox رویدادهای واردشده است.
- Operations از Gateway نشست‌محور و مجوز دقیق شعبه استفاده می‌کند. Gateway فقط APIهای داخلی مالکان را فراخوانی می‌کند.
- داشبورد sync از Device Integration وضعیت نصب، snapshot و صف ارسال را می‌خواند. شمار رویدادهای نیازمند بررسی Wallet فقط در صورت داشتن `card.inventory.read` افزوده می‌شود.
- replay فقط رویداد delivery dead-letter شده را می‌پذیرد. اپراتور علت را ثبت می‌کند؛ همان envelope و eventId دوباره صف می‌شود. شمار تلاش‌های دور جدید از صفر آغاز می‌شود و تعداد قبلی، error قبلی، actor، علت و کلید idempotency در audit append-only می‌ماند.
- خطای `pending_review` در Wallet با replay صف Device Integration رفع نمی‌شود. ابتدا داده یا mapping باید در مالک مربوط اصلاح شود؛ تغییر دستی payload یا بازنویسی ledger مجاز نیست.
- `localSequence` در Edge شماره‌ی ترتیبی نصب است و به‌تنهایی تعداد رویدادهای جاافتاده‌ی یک کارت را نشان نمی‌دهد. Wallet از آن برای شمردن تراکنش‌های کارت استفاده نمی‌کند؛ watermark خواندن فیزیکی مانع بازنویسی projection با رویداد قدیمی همان نصب می‌شود. اختلاف با مانده‌ی ledger در `reconciliationDifferenceRial` و freshness `stale` باقی می‌ماند تا بررسی شود.

## Migrationهای این بسته

Migrationها به ترتیب نسخه‌ی همان مالک اعمال می‌شوند:

| مالک                 | Migration                            | تغییر                                                                                                                    |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Device Integration   | `0003_preserve_source_device_id`     | نگهداری شناسه‌ی منبع دستگاه در import قبلی                                                                               |
| Device Integration   | `0004_edge_ingestion`                | نصب Edge، import یکتا، rate limit و outbox v2                                                                            |
| Device Integration   | `0005_edge_snapshots`                | snapshot شعبه‌ی امضاشده و نسخه‌دار                                                                                       |
| Device Integration   | `0006_edge_sync_replay_audit`        | audit تغییرناپذیر برای replay رویداد مرده                                                                                |
| Wallet               | `0004_card_ledger_multi_assignment`  | تخصیص چندکارت، ledger، projection و inbox                                                                                |
| Wallet               | `0005_card_lifecycle_requests`       | درخواست مفقودی/تعویض و اتصال کارت جایگزین                                                                                |
| Wallet               | `0006_card_balance_reconciliation`   | audit append-only خواندن فیزیکی کارت و watermark snapshot برای جلوگیری از بازنویسی با رویداد قدیمی                       |
| Wallet               | `0007_edge_card_uid_hash_attraction` | hash UID canonical برای mapping خصوصی Edge و نگهداری attractionId در ledger؛ هیچ backfill روی UIDهای موجود انجام نمی‌دهد |
| Customer & Household | `0003_customer_profile_owner`        | افزودن مخزن نسخه‌دار پروفایل مشتری و avatar با شناسه‌ی opaque Gateway؛ بدون انتقال خودکار داده                           |

این migrationها را روی دیتابیس آزمایشیِ جداگانه با credential همان مالک اجرا و نتیجه را بازبینی کنید. هیچ‌کدام به startup runner اضافه نشده‌اند و انتشار app آن‌ها را اجرا نمی‌کند. روی production یا از روی export آزمایشی این بسته backfill اجرا نشده است.

## Rollback امن

- Rollback اپلیکیشن با بازگرداندن snapshot قبلی انجام می‌شود؛ جدول‌های inbox/outbox، ledger، idempotency، replay audit و تاریخچه‌ی تخصیص حفظ می‌شوند.
- Migration `0004_card_ledger_multi_assignment` قید یکتایی «یک کارت برای household در هر شعبه» را حذف می‌کند. بعد از ثبت چند کارت، بازگرداندن آن قید بدون پاک‌کردن یا ادغام تخصیص‌ها ممکن نیست؛ بنابراین downgrade خودکار این migration ممنوع است. نسخه‌ی قبلی app می‌تواند در rollback اجرا شود، اما schema جدید حفظ می‌شود.
- Migration `0006_card_balance_reconciliation` audit تطبیق و watermark آخرین خواندن فیزیکی را اضافه می‌کند. حذف ستون‌ها یا audit در rollback خودکار مجاز نیست؛ نسخه‌ی قبلی app با ستون‌های افزوده اجرا می‌شود و داده‌ی reconciliation حفظ می‌ماند.
- Migration `0007_edge_card_uid_hash_attraction` فقط ستون‌های nullable و قید یکتایی hash را اضافه می‌کند؛ UIDهای موجود را hash/backfill نمی‌کند. در rollback اپلیکیشن ستون‌ها و index را حفظ کنید. downgrade schema فقط پس از اثبات عدم استفاده از mapping و بررسی داده‌ی مالکانه مجاز است.
- Migration `0003_customer_profile_owner` تا پیش از backfill و نوشتن owner قابل بازگردانی دستی است. بعد از هر profile write در Customer & Household جدول یا enum را حذف نکنید؛ نسخه‌ی قبلی Gateway فقط زمانی امن است که flag cutover هنوز خاموش باشد. بعد از cutover، rollback با restore یا forward migration انجام می‌شود.
- triggerهای append-only ledger و replay audit را در rollback اپ حذف نکنید. event یا audit مالی را برای بازگرداندن نسخه پاک نکنید.
- snapshotهای Edge immutable هستند. دریافت snapshot ناقص یا rollback app مجوز پاک‌کردن snapshot قبلی را نمی‌دهد.
- حذف schema فقط با migration معکوس جداگانه، بررسی داده‌ی واقعی توسط مالک همان سرویس و تأیید مستقل مجاز است؛ این بسته migration معکوس مخرب تولید نمی‌کند.

## Dry-run تاریخچه‌ی Windows

منبع باید export کامل دیتابیس عملیاتی Windows باشد. فایل mapping باید کلیدهای صریح `cards`، `branches` و `devices` را داشته باشد. نمونه‌ی ورودی واقعی یا شناسه‌ی مشتری را در Git نگذارید.

```powershell
node scripts/migrations/edge-history-dry-run.mjs `
  --source <operational-export.json> `
  --mapping <explicit-mappings.json>
```

ابزار فقط فایل‌های ورودی را می‌خواند و در stdout تعداد خوانده‌شده، قابل ورود، تکراری، بدون mapping، ردشده و نیازمند reconciliation، جمع مبلغ‌ها، کدهای رد و checksum طرح را می‌دهد. هیچ DB client یا مسیر write ندارد. هر ردیف بدون breakdown معتبر gross/discount/net در `needsReconciliation` می‌ماند؛ از جمع ناقص نمی‌توان موجودی را حدس زد. پس از دریافت mapping یا golden vector جدید، dry-run را دوباره اجرا و checksum و جمع‌ها را با مالک عملیات تطبیق دهید؛ اجرای واقعی backfill خارج از این ابزار و نیازمند migration/job جداگانه‌ی بازبینی‌شده است.

## Dry-run انتقال مالکیت پروفایل

Migration پروفایل مستقل از Edge ledger است. ابتدا schema افزایشی Customer & Household را روی دیتابیس آزمایشی همان owner اعمال کنید. ابزار زیر از Gateway `DATABASE_URL` فقط خواندن می‌کند و مقصد را با `CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL` می‌خواند؛ حالت پیش‌فرض dry-run است و فقط شمارش، کد رد و checksum چاپ می‌کند:

```powershell
node scripts/migrations/customer-profile-owner-backfill.mjs
```

`--apply` فقط برای کار یک‌باره‌ی کنترل‌شده است، checksum dry-run را می‌خواهد، ردیف موجود را overwrite نمی‌کند و عملیات قابل resume است. روی production در این کار اجرا نشده است. برای ترتیب توقف write، flag `CUSTOMER_PROFILE_OWNER_ENABLED` و rollback به [راهنمای هویت و پروفایل](CustomerIdentityAndProfile.md) مراجعه کنید.

## وضعیت قیمت‌گذاری آفلاین

Pricing/Promotions آماده‌ی تعریف، نسخه‌گذاری و audit قواعد است، اما snapshot شعبه صریحاً `disabled` با دلیل `PENDING_WINDOWS_GOLDEN_VECTORS` می‌دهد. تا ثبت و تأیید سناریوهای واقعی Windows، اجرای قیمت یا تخفیف جدید، parity و cutover ادعا نمی‌شود. هیچ قیمت یا کمپین فرضی ساخته نشده است.

## کلید و امضای Edge

- `DEVICE_EDGE_HMAC_KEYS` یک JSON object از `keyId` به secret نصب است. همان کلید درخواست HMAC نصب، cursor و page signature را امضا/تأیید می‌کند؛ `signingKeyId` در JSON canonical امضاشده قرار دارد.
- تبادل توکن اپراتور از `POST /api/v1/operations/edge/operator-token` انجام می‌شود. Gateway فقط نشست مدیریتی، شعبه‌ی فعال و permissionهای مجاز IAM را می‌پذیرد؛ IAM برای درخواست Gateway از `IDENTITY_ACCESS_SERVICE_TOKEN` و برای اعتبارسنجی Device Integration از جفت مستقل `IDENTITY_ACCESS_DEVICE_INTEGRATION_TOKEN` در IAM و `DEVICE_INTEGRATION_IDENTITY_ACCESS_TOKEN` در Device Integration استفاده می‌کند. این دو secret باید جداگانه در runtime ساخته و در دو process متناظر ثبت شوند؛ هیچ‌کدام در Git یا log قرار نمی‌گیرند.
- mutationها علاوه بر HMAC نصب، header `Authorization: Bearer <token>` می‌فرستند. IAM در هر درخواست branch، مجوز، انقضا و وضعیت فعلی مجوز را بررسی می‌کند؛ role یا permission ارسالی از Windows پذیرفته نیست.
- ثبت شناسه‌ی مشتری موقت از `POST /internal/v2/edge/customers/temporary` انجام می‌شود و body فقط `provisionalId` دارد. Device Integration نصب و branch را از registry می‌گیرد، permission `customer.provisional.create` را اعتبارسنجی و رکورد حداقلی را به Customer & Household واگذار می‌کند. پاسخ `customerConfirmed=false` و `status=pending_review` است؛ نه نام و تلفن دریافت می‌شود و نه حساب قطعی مشتری ساخته می‌شود.
- Device Integration برای ثبت این رکورد به `CUSTOMER_HOUSEHOLD_INTERNAL_URL` و secret سمت خروجی `DEVICE_INTEGRATION_CUSTOMER_HOUSEHOLD_TOKEN` نیاز دارد. همان secret در Customer & Household با نام `CUSTOMER_HOUSEHOLD_DEVICE_INTEGRATION_TOKEN` ثبت می‌شود؛ برای این جفت یک مقدار تصادفی مستقل runtime بسازید و آن را با tokenهای Gateway، Wallet یا IAM مشترک نکنید.
- POST رویدادها و mutationها HMAC را روی raw body می‌سازند. GET snapshot روی بدنه‌ی خالی امضا می‌شود؛ URL و query جزو HMAC نیستند. امضا باید دقیقاً `sha256=` و ۶۴ رقم hex کوچک باشد.
- در rotation، کلید فعلی و قبلی نصب تا پایان عمر snapshot/cursor معتبر می‌مانند. Windows در همه‌ی صفحه‌های یک snapshot همان `keyId` را می‌فرستد. کلید قبلی را فقط پس از پایان TTL و sync نصب‌ها حذف کنید.
- `DEVICE_EDGE_SNAPSHOT_SIGNING_SECRET` و `DEVICE_EDGE_SNAPSHOT_SIGNING_KEY_ID` دیگر برای v2 استفاده نمی‌شوند؛ بعد از انتشار نسخه‌ی جدید، این دو متغیر قدیمی را از آیتم Device Integration حذف کنید.
- فیلد mapping شبکه‌ی Wallet فقط `cardUidHash` را می‌دهد. UID خام در response یا log مجاز نیست. UIDهای موجود با hash خالی تا زمان re-registration/تأیید مالکانه در snapshot آفلاین ظاهر نمی‌شوند.

## جفت‌سازی امن اپراتور ویندوز

Windows برای خواندن مرکزی، درخواست `POST /internal/v2/edge/operator-pairings` را با HMAC همان نصب و بدنهٔ `{}` آغاز می‌کند. پاسخ شامل `pairingId`، کد قابل‌تأیید در Operations، `pollSecret`، زمان انقضا و فاصلهٔ poll است. Device Integration فقط SHA-256 کد و راز poll را ذخیره می‌کند. کد نمایشی برای مسیر مرورگر است؛ Windows برای poll و cancel از `pairingId` و `pollSecret` استفاده می‌کند.

اپراتور در نشست مدیریت‌شدهٔ Operations، branch فعال را انتخاب می‌کند. فهرست دسترسی‌ها از `GET /api/v1/operations/edge/pairing-permissions?branchId=...` و ارزیابی زندهٔ IAM می‌آید؛ انتخابی از پیش فعال نیست. تأیید با `POST /api/v1/operations/edge/pairing-approvals`، کلید UUID در `Idempotency-Key` و بررسی دوبارهٔ همهٔ permissionهای انتخاب‌شده انجام می‌شود. Gateway نشست/actor، branch فعال و trusted origin را کنترل می‌کند. سرویس Device Integration کد را با installation و branch ثبت‌شده تطبیق می‌دهد و approval را audit می‌کند.

Windows با همان `x-edge-installation-id`، `x-edge-key-id` و امضای `x-edge-signature` درخواست `POST /internal/v2/edge/operator-pairings/poll` را می‌فرستد. Device Integration فقط یک‌بار pairing تأییدشده را claim می‌کند و Gateway پیش از تبادل، فعال‌بودن نشست مدیریت و branch را دوباره می‌سنجد. IAM توکن عادی Edge را با permissionهای انتخاب‌شده می‌دهد؛ Gateway انقضای آینده و سقف پنج دقیقه را هم بررسی می‌کند. پاسخ start/poll و exchange دارای `Cache-Control: no-store, private` است. توکن، کد و راز poll در log، فایل config یا دیتابیس Windows نوشته نمی‌شوند؛ token فقط تا انقضا یا خروج در حافظهٔ فرایند می‌ماند. خروج نشست مدیریت، توکن‌های متصل به همان نشست را در IAM revoke می‌کند.

Secret سرویس بین Gateway و Device Integration باید یک مقدار تصادفی مشترک با حداقل ۳۲ کاراکتر باشد؛ در Gateway با نام `EDGE_OPERATOR_PAIRING_DEVICE_INTEGRATION_TOKEN` و در Device Integration با نام `DEVICE_INTEGRATION_EDGE_OPERATOR_PAIRING_TOKEN` تنظیم می‌شود. این دو مقدار فقط در secret manager/runtime هم‌محیط وارد می‌شوند و `.env.example` صرفاً نام خالی آن‌ها را نشان می‌دهد. manifest هر child فقط secret خودش را allow-list می‌کند.

migration افزایشی `services/device-integration/prisma/migrations/0007_edge_operator_pairings` متعلق به schema سرویس Device Integration است و فقط با job مستقل همان مالک اجرا می‌شود. این migration در کار حاضر روی محیط واقعی اجرا نشده است. پیش از rollout باید نسخهٔ پشتیبان، دسترسی DDL محدود، اجرای آزمایشی staging، آزمون rollback کاربردی و تایید lock/زمان اجرا ثبت شود؛ هیچ migration یا backfill production انجام نشده است.

پاسخ 401/403 pairing را مجاز نمی‌کند؛ 409 نیاز به pairing تازه دارد؛ 429 و خطای شبکه retry محدود با همان عملیات/کلید معتبر می‌خواهد. انقضا، نشست لغوشده، branch نامعتبر یا رد IAM باید در Windows وضعیت خطا بماند و cache فقط‌خواندنی stale را به‌عنوان موفقیت مرکزی نشان ندهد. قرارداد route و فیلدها در OpenAPI و [ADR-0032](decisions/0032-edge-operator-device-pairing.md) مرجع است.
