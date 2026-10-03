# ADR-0013: مالکیت Customer & Household و کارت مستقل خانواده در هر شعبه

- تاریخ: 2026-10-01
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول
- دامنه: Customer & Household، Wallet، API Gateway، Customer Web، Operations Web، Analytics و قراردادهای OpenAPI/AsyncAPI

## مسئله و زمینه

Household و member هنوز در مدل legacy متعلق به API Gateway هستند؛ در مقابل، Wallet مالک موجودی فیزیکی کارت است. نیاز محصول این است که هر خانواده در هر شعبه کارت مستقل داشته باشد و بتوان سابقه‌ی تخصیص و شاخص‌های معتبر همان رابطه‌ی خانواده/شعبه را گزارش کرد. گزارش مبلغ شارژ یا انتساب مصرف به دستگاه تا تعیین منبع معتبر مالی و تأیید اتصال رخداد دستگاه به registry معتبر، نباید از داده‌ی legacy یا رخداد تأییدنشده ساخته شود.

## گزینه‌ها

1. نگه‌داشتن خانواده/عضو در Gateway و کپی‌کردن آن در Wallet: رد؛ مالکیت مبهم و ناسازگار با ممنوعیت خواندن مستقیم دیتابیس سرویس دیگر است.
2. تخصیص کارت به یک کودک/عضو و یکی‌گرفتن آن با خانواده: رد برای نسخه‌ی اول؛ با نیاز کارت خانواده در هر شعبه و حداقل‌سازی داده‌ی کودک سازگار نیست.
3. سرویس مستقل Customer & Household و ارجاع opaque در Wallet، با تخصیص یکتای خانواده/شعبه: پذیرفته.

## تصمیم نهایی

- `services/customer-household` مرجع حقیقت household، member و دسترسی صاحب/سرپرست household است. شناسه‌ی کاربر ورودی از Identity مشتری، opaque است؛ سرویس هیچ جدول Gateway/IAM را نمی‌خواند و هیچ FK بین سرویس‌ها ندارد.
- Gateway فقط BFF است. مجازبودن کاربر برای household از API مالک Customer & Household تأیید می‌شود. Wallet هنگام ایجاد تخصیص، زنده‌بودن household را از API همین مالک با credential سرویس بررسی می‌کند؛ خطای شبکه، پاسخ نامعتبر یا وضعیت نامشخص به معنی رد عملیات است.
- کارت نسخه‌ی اول در سطح household مشترک است و به member مشخص متصل نمی‌شود. برای هر `(householdId, branchId)` حداکثر یک تخصیص فعال مجاز است؛ برای هر کارت نیز حداکثر یک تخصیص فعال وجود دارد. یک household می‌تواند در شعبه‌های مختلف تخصیص مستقل داشته باشد.
- کارت فقط وقتی قابل تخصیص است که وضعیت موجودی `in_stock` و تأیید فیزیکی `verified` باشد. ثبت دستی کارت همچنان `unknown` می‌ماند و تا تأیید از adapter/فرایند مصوب قابل تخصیص نیست. کارت `blocked`، `retired`، `rejected` یا `unknown` خودکار به موجودی برنمی‌گردد.
- جست‌وجوی خانواده فقط با مجوز جداگانه‌ی `customer.lookup.limited`، شماره‌ی دقیق در بدنه‌ی درخواست POST و پس از احراز scope فعال انجام می‌شود. سقف پایلوت برای هر actor در هر شعبه ۳۰ جست‌وجو در پنجره‌ی ثابت ۱۵ دقیقه است؛ شمارنده در PostgreSQL مشترک بین replicaهای Gateway و اتمیک است. audit تلاش و عبور از سقف شماره‌ی خام را ذخیره نمی‌کند.
- تخصیص، انتقال بین householdها در همان شعبه و لغو، با دلیل، actor، scope، correlation، نسخه، تاریخچه‌ی قابل ممیزی، Outbox و idempotency ثبت می‌شود. انتقال در یک تراکنش تخصیص قبلی را می‌بندد و تخصیص جدید را ایجاد می‌کند. لغو، کارت را فقط وقتی به `in_stock` برمی‌گرداند که هنوز `verified` و قابل‌استفاده باشد.
- جابه‌جایی فیزیکی کارت بین شعبه‌ها عملیاتی جدا از انتقال بین householdها است؛ در این نسخه endpoint جابه‌جایی شعبه ارائه نمی‌شود. کارت باید ابتدا طبق دلیل لغو معتبر آزاد شود و ورود آن به شعبه‌ی دیگر نیازمند workflow مستقل انتقال موجودی و audit است.
- Customer Web فقط تخصیص فعال Wallet را برای householdهای مجاز همان کاربر نشان می‌دهد: کارت ماسک‌شده، شعبه‌ی معتبر، وضعیت تخصیص/کارت و freshness. مقدار مالی یا freshness دستگاه از روی ثبت تخصیص حدس زده نمی‌شود؛ state نامشخص صریح است.
- دامنه‌ی گزارش پایلوت محدود به مجموعه/شعبه، وضعیت/freshness دستگاه و شمار رخدادهای ثبت‌شده‌ی معتبر است. نیاز محصول به «مبلغ شارژ خانواده در هر شعبه» تا تعیین مالک مالی و ارز/واحد و تطبیق با دفترکل معتبر، در UI و export نمایش داده نمی‌شود. «دستگاه استفاده‌شده» تنها وقتی قابل گزارش است که شناسه‌ی منبع رخداد به دستگاه ثبت‌شده‌ی همان شعبه resolve و اعتبارسنجی شود؛ `sourceDeviceId` خام کافی نیست. شمار رخداد دستگاه به معنی مبلغ مالی معتبر نیست.
- افزایش این سهمیه باید براساس نرخ واقعی استفاده و audit پایلوت انجام شود؛ rate limit جایگزین permission، MFA، audit یا کنترل شبکه نیست.
- داده‌ی فعلی Household/Card در Gateway فقط منبع legacy مهاجرت است. cutover خواندن/نوشتن پس از snapshot، dry-run، تطبیق شناسه و شمار، آزمون staging، reconciliation و runbook rollback جداگانه انجام می‌شود؛ این ADR مجوز اجرای backfill روی داده‌ی واقعی یا deployment نیست.

## پیامدها، migration و rollback

- Customer & Household و Wallet هرکدام schema و migration مستقل، API خصوصی و Outbox دارند. Gateway از هیچ جدول آن‌ها مستقیم نمی‌خواند.
- تا پایان reconciliation، endpointهای legacy حذف نمی‌شوند و وضعیت cutover باید صریح بماند؛ dual-write در request path مجاز نیست.
- migration توسعه additive است. rollback نرم‌افزار با برگرداندن Gateway به مسیر legacy فقط پیش از cutover و طبق snapshot/reconciliation مجاز است. بعد از شروع write به owner، داده‌ی owner حفظ می‌شود و rollback دیتابیس خودکار نیست.
- سرویس جدید به deployment repository مستقل و آیتم Runflare مستقل نیاز دارد. تا تأیید جداگانه‌ی مالک محصول، هیچ repo، remote، GitHub workflow، secret یا deployment ایجاد/تغییر نمی‌شود.

## قراردادها و اسناد مرتبط

- `contracts/openapi/customer-household.yaml`، `contracts/openapi/wallet.yaml` و `contracts/openapi/gateway.yaml`
- `contracts/asyncapi/events.yaml` و `packages/event-contracts`
- `DOCS/ArchitectureAndDesignPatterns.md`، `DOCS/FolderAndFileStructure.md`، `DOCS/PhasesAndExecutionPlan.md`، `DOCS/CustomerIdentityAndProfile.md`، `DOCS/ReleaseQualityGatesAndPilot.md`
- ADR-0003، ADR-0005، ADR-0009 و ADR-0010
