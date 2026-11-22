# ADR-0033: نمایش snapshot کیف پول در lookup مرورگر NFC

- تاریخ: 2026-11-22
- وضعیت: پذیرفته‌شده

## مسئله و زمینه

Windows برای کارت فیزیکی با کلید مورداعتماد احراز هویت می‌کند و بلوک ۸ را می‌خواند. Web NFC استاندارد فقط داده‌ی NDEF را در اختیار مرورگر می‌گذارد، دسترسی خام به بلوک و احراز هویت چیپ ندارد، و `serialNumber` ممکن است خالی باشد. در مخزن وب یا محیط فعلی پل بومی مورداعتماد و سخت‌افزار آزمایشی موجود نیست. hash چهاربایتی UID نیز راز یا مجوز دسترسی نیست.

## گزینه‌های بررسی‌شده

1. بازنویسی پروتکل فیزیکی در JavaScript یا قراردادن کلید کارت در PWA: رد؛ کلید و فرمان خام به کلاینت منتشر می‌شوند و Web NFC API این دسترسی را ارائه نمی‌کند.
2. نمایش موجودی Wallet به‌عنوان موجودی مستقیم چیپ: رد؛ دو منبع موجودی متفاوت‌اند.
3. lookup محدودشده‌ی سرور با شناسه‌ی قابل‌دسترسی Web NFC و نمایش snapshot Wallet: پذیرفته‌شده؛ فقط در صورت تطبیق assignment و مجازبودن scope.
4. خواندن بلوک واقعی: نیازمند پل بومی/خوانشگر مورداعتماد و اجرای جداگانه‌ی قرارداد [پل خوانش NFC](../NFC/03_قرارداد_پل_خوانش.md) در مخزن Windows است؛ در این ADR پیاده‌سازی یا تأیید نشده است.

## تصمیم

- `packages/nfc-reader` تنها adapter مشترک Customer و Operations است. این adapter فقط NDEF را می‌خواند، شناسه‌ی چهار‌بایتی سازگار با mapping فعلی Windows را در حافظه نرمال و هش می‌کند، و هیچ UID یا هش را به UI نمی‌دهد. هش فقط در body درخواست POST به Gateway ارسال می‌شود؛ هر دو endpoint از session فعلی، strict validation، scope سروری و rate limit استفاده می‌کنند.
- Gateway احراز هویت و ownership/scope را کنترل می‌کند و از Wallet داخلی با service token می‌پرسد. Wallet فقط `CardInventory` فعال و تأییدشده با assignment فعلی را در householdهای مجاز مشتری یا سازمان/شعبه‌ی فعال عملیات تطبیق می‌دهد.
- فقط `balanceRial` امن و snapshot دارای freshness برابر `fresh`، زمان snapshot تأییدشده، صفر تراکنش pending و اختلاف reconciliation صفر یا null قابل‌نمایش است. پاسخ‌های `pending` و `unavailable` مبلغ و شناسه ندارند.
- Operations علاوه بر مجوز موجود صفحه‌ی کارت، به permission مستقل `card.balance.read` نیاز دارد. این permission به template نقش‌های فعلی اضافه نمی‌شود؛ مالک باید آن را صریحاً اعطا کند. audit فقط actor، branch، زمان، نتیجه و correlation ID را ثبت می‌کند.
- هیچ مسیر write، migration، backfill یا تغییر نام پایگاه داده اضافه نمی‌شود. UI و پاسخ API هرگز ادعای خواندن مستقیم چیپ ندارند.

## پیامدها و سرویس‌های اثرپذیرفته

- Customer Web، Operations Web، API Gateway، Wallet، Identity & Access، قراردادهای OpenAPI و Frontend/Backend runtime bundle اثر می‌پذیرند.
- Frontend از `packages/nfc-reader` استفاده می‌کند؛ Backend مالک lookup assignment و projection باقی می‌ماند و هیچ وب‌اپی به DB Wallet وصل نمی‌شود.
- مشتری/کارمند بدون NDEFReader یا شناسه‌ی معتبر مرورگر، وضعیت پشتیبانی‌نشده/ناموجود می‌بیند. سازگاری UID مرورگر با mapping کارت واقعی تا آزمون سخت‌افزاری تأییدنشده است.
- خواندن مستقیم موجودی چیپ تا آماده‌شدن پل مورداعتماد و آزمون کارت واقعی مسدود می‌ماند. قرارداد پل موجود بدون تغییر از Web مصرف می‌شود.

## مهاجرت و rollback

Migration دیتابیس لازم نیست. در صورت مشکل امنیتی یا ناسازگاری سخت‌افزاری، routeها و CTA اسکن را غیرفعال می‌کنیم و permission را اعطا نمی‌کنیم؛ موجودی و دفترکل تغییری نمی‌کنند.

## پیوندها

- [معیارهای پذیرش NFC](../NFC/04_معیارهای_پذیرش.md)
- [راهنمای معماری و منطق NFC](../NFC/02_راهنمای_معماری_و_منطق.md)
- [قرارداد پل خوانش NFC](../NFC/03_قرارداد_پل_خوانش.md)
- [OpenAPI Gateway](../../contracts/openapi/gateway.yaml)
- [OpenAPI Wallet](../../contracts/openapi/wallet.yaml)
- [Runflare repository and deployment](../RunflareRepositoryAndDeployment.md)
