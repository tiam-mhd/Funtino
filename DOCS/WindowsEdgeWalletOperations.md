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

| مالک | Migration | تغییر |
| --- | --- | --- |
| Device Integration | `0003_preserve_source_device_id` | نگهداری شناسه‌ی منبع دستگاه در import قبلی |
| Device Integration | `0004_edge_ingestion` | نصب Edge، import یکتا، rate limit و outbox v2 |
| Device Integration | `0005_edge_snapshots` | snapshot شعبه‌ی امضاشده و نسخه‌دار |
| Device Integration | `0006_edge_sync_replay_audit` | audit تغییرناپذیر برای replay رویداد مرده |
| Wallet | `0004_card_ledger_multi_assignment` | تخصیص چندکارت، ledger، projection و inbox |
| Wallet | `0005_card_lifecycle_requests` | درخواست مفقودی/تعویض و اتصال کارت جایگزین |
| Wallet | `0006_card_balance_reconciliation` | audit append-only خواندن فیزیکی کارت و watermark snapshot برای جلوگیری از بازنویسی با رویداد قدیمی |

این migrationها را روی دیتابیس آزمایشیِ جداگانه با credential همان مالک اجرا و نتیجه را بازبینی کنید. هیچ‌کدام به startup runner اضافه نشده‌اند و انتشار app آن‌ها را اجرا نمی‌کند. روی production یا از روی export آزمایشی این بسته backfill اجرا نشده است.

## Rollback امن

- Rollback اپلیکیشن با بازگرداندن snapshot قبلی انجام می‌شود؛ جدول‌های inbox/outbox، ledger، idempotency، replay audit و تاریخچه‌ی تخصیص حفظ می‌شوند.
- Migration `0004_card_ledger_multi_assignment` قید یکتایی «یک کارت برای household در هر شعبه» را حذف می‌کند. بعد از ثبت چند کارت، بازگرداندن آن قید بدون پاک‌کردن یا ادغام تخصیص‌ها ممکن نیست؛ بنابراین downgrade خودکار این migration ممنوع است. نسخه‌ی قبلی app می‌تواند در rollback اجرا شود، اما schema جدید حفظ می‌شود.
- Migration `0006_card_balance_reconciliation` audit تطبیق و watermark آخرین خواندن فیزیکی را اضافه می‌کند. حذف ستون‌ها یا audit در rollback خودکار مجاز نیست؛ نسخه‌ی قبلی app با ستون‌های افزوده اجرا می‌شود و داده‌ی reconciliation حفظ می‌ماند.
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

## وضعیت قیمت‌گذاری آفلاین

Pricing/Promotions آماده‌ی تعریف، نسخه‌گذاری و audit قواعد است، اما snapshot شعبه صریحاً `disabled` با دلیل `PENDING_WINDOWS_GOLDEN_VECTORS` می‌دهد. تا ثبت و تأیید سناریوهای واقعی Windows، اجرای قیمت یا تخفیف جدید، parity و cutover ادعا نمی‌شود. هیچ قیمت یا کمپین فرضی ساخته نشده است.
