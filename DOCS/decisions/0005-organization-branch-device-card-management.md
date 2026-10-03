# ADR-0005: مدیریت سازمان، شعبه، کارکنان، دستگاه و تخصیص کارت

- وضعیت: accepted
- تاریخ: 2026-09-28
- دامنه: system-web، operations-web، customer-web، API Gateway، Identity & Access، Organization & Branch، Device Integration، Wallet، Analytics/Read Model و قراردادهای OpenAPI/AsyncAPI

## زمینه

مدل‌های `Organization`، `Branch` و `Membership` در Prisma فعلی وجود دارند، اما API مدیریتی و مجوز scope‌دار ندارند. صفحه‌های operations/system نمایشی‌اند. Device Integration فقط دریافت رخداد دارد و صفحه‌ی کارت مشتری اکنون به API متصل شده است. قرارداد واقعی RFID و منبع حقیقت مالی هنوز تأیید نشده‌اند. مالک محصول ماتریس دسترسی کم‌دسترسی، دعوت pending، bootstrap/MFA و ثبت دستی داخلی برای پایلوت را تأیید کرده و تأکید کرده است نقش‌ها و دسترسی هر کاربر باید انعطاف‌پذیر و قابل‌تغییر باشند.

## گزینه‌ها

1. افزودن mutation مستقیم به UI یا API Gateway بدون ماتریس مجوز: رد؛ با قواعد authorization سمت سرور سازگار نیست.
2. نگه‌داشتن همه‌ی داده‌ی سازمان، دستگاه و کارت در یک جدول/مالک مشترک: رد؛ مرز مالکیت و ممنوعیت cross-service access را نقض می‌کند.
3. اجرای قابلیت در مالک‌های دامنه‌ی Organization & Branch، Identity & Access، Device Integration، Wallet و Analytics، با Gateway به‌عنوان BFF و قراردادهای نسخه‌دار: پذیرفته.
4. ادعای sync یا گزارش مالی با داده‌ی شبیه‌سازی‌شده پیش از قرارداد provider: رد؛ منبع حقیقت را جعل می‌کند.

## تصمیم نهایی

### دامنه و مالکیت

- Organization & Branch مالک سازمان، شعبه، وضعیت و تنظیمات شعبه است.
- Identity & Access مالک membership کارکنان، دعوت، نقش، مجوز، MFA و audit دسترسی است. هویت کاربر با شناسه‌ی opaque سرویس مالک هویت ارجاع می‌شود.
- Device Integration مالک registry دستگاه، اتصال آن به شعبه، رخداد سلامت و adapter سامانه‌ی بیرونی است. وضعیت آنلاین فقط از مشاهده‌ی معتبر محاسبه می‌شود.
- Wallet مالک موجودی فیزیکی کارت، تخصیص و تاریخچه‌ی تخصیص است؛ منطق مانده‌ی مالی تا قرارداد و منبع حقیقت مالی مستقل غیرفعال می‌ماند.
- Analytics/Read Model مالک projection گزارش است، نه حقیقت عملیاتی یا مالی. Gateway فقط authentication عمومی، orchestration محدود و تبدیل DTO را انجام می‌دهد و به جدول سرویس‌ها دسترسی ندارد.

### سیاست مجوز انعطاف‌پذیر (RBAC با scope و override)

- permission keyهای ریزدانه، پایدار، نسخه‌دار و تعریف‌شده در کاتالوگ مرکزی هستند؛ UI نمی‌تواند permission جدید بسازد یا نام permission را به‌عنوان مجوز جعل کند.
- نقش‌ها داده‌ی قابل‌مدیریت‌اند، نه شرط‌های ثابت کدنویسی‌شده. نقش‌های پایه‌ی تأییدشده seed می‌شوند؛ مدیر مجاز می‌تواند نقش سفارشی سازمانی یا شعبه‌ای بسازد و permissionهای مجاز را تغییر دهد.
- نقش همواره به scope صریح `global`، `organization` یا `branch` متصل است. عضویت فعال در سازمان/شعبه و scope منبع هر درخواست جداگانه بررسی می‌شوند؛ نقش هیچ‌گاه scope را گسترش نمی‌دهد.
- استثناهای فردی به `membershipId` در همان سازمان/شعبه متصل می‌شوند، نه به User سراسری؛ هر override دارای اثر `allow` یا `deny`، permission، scope/resource محدود، دلیل، actor، زمان ایجاد و در صورت نیاز انقضا است. `deny` بر `allow` مقدم است.
- مجوز مؤثر از permissionهای نقش به‌علاوه‌ی allowهای معتبر، منهای denyهای معتبر محاسبه و سپس با scope عضویت، tenant، وضعیت resource و rule دامنه محدود می‌شود. override نمی‌تواند از scope عضویت یا اختیار واگذاری مدیر فراتر رود.
- مدیر فقط می‌تواند permissionهایی را واگذار کند که اختیار واگذاری آن‌ها را دارد؛ ایجاد/ویرایش نقش، انتساب نقش یا override با سطحی فراتر از اختیار actor رد می‌شود. آخرین مدیر واجد مجوز در هر scope قابل حذف یا تنزل بدون جایگزین معتبر نیست.
- نقش سراسری system admin و مسیر break-glass از نقش‌های tenant قابل‌ویرایش جدا و محافظت‌شده‌اند. bootstrap اولیه یک‌باره، خارج از endpoint عمومی، با MFA، audit و runbook انجام می‌شود.
- مجوز سمت سرور در هر درخواست authoritative است. cache فقط با version/invalidation امن، scope‌دار و با revocation فوری قابل استفاده است؛ نقش/permission ذخیره‌شده در browser یا JWT بلندعمر منبع حقیقت نیست.
- هر تغییر نقش، permission، scope، override، دعوت، تعلیق یا MFA، audit تغییرناپذیر با actor، هدف، scope، قبل/بعد، دلیل، نسخه‌ی policy، correlation id و نتیجه می‌سازد. عملیات حساس نیازمند MFA/تأیید مجدد است.
- نقش‌های پایه‌ی مورد تأیید: `system_admin` سراسری؛ `organization_manager` در سازمان عضو؛ `branch_manager` در شعبه‌ی عضو؛ `cashier` با دسترسی حداقلی عملیاتی؛ `operator` برای سلامت دستگاه؛ `crm_manager` برای گزارش تجمیعی محدود؛ `support` فقط‌خواندنی و scope‌دار؛ `customer` فقط در household خودش. کاتالوگ مجوز و نقش‌های سفارشی امکان تغییر این پیش‌فرض‌ها را بدون تغییر کد business فراهم می‌کنند، با رعایت مرزهای واگذاری بالا.

### جریان‌های محصول

- دعوت کارمند با شماره‌ی موبایل حتی اگر حساب OTP نداشته باشد به‌صورت pending ثبت می‌شود؛ دعوت فقط پس از احراز مالکیت شماره و پذیرش کاربر به membership فعال متصل خواهد شد.
- ثبت دستی داخلی کارت/دستگاه برای پایلوت مجاز است. تا دریافت قرارداد provider هیچ sync، سلامت آنلاین، شناسه‌ی تأییدشده یا مانده‌ی مالی واقعی ادعا نمی‌شود؛ وضعیت ناشناخته/تأییدنشده در UI مشخص می‌ماند.
- تخصیص کارت به مشتری فقط پس از اعتبارسنجی رابطه‌ی household/member در مالک Customer و اعمال ruleهای Wallet انجام می‌شود؛ هر کارت حداکثر یک تخصیص فعال دارد و تغییر وضعیت با تاریخچه‌ی append-only و idempotency ثبت می‌شود.
- customer-web فقط کارت‌های household مجاز را می‌خواند، شناسه‌ی فیزیکی را mask می‌کند و داده‌ی sync کهنه/نامشخص را صریح نشان می‌دهد.
- گزارش‌های اولیه فقط شمارش و شاخص‌های عملیاتی مجاز را ارائه می‌کنند؛ داده‌ی تماس/کودک در گزارش تجمیعی و هر شاخص مالی بدون منبع حقیقت حذف می‌شود.

## پیامدها و trade-offها

- تحویل مرحله‌ای و قراردادمحور طولانی‌تر از CRUD نمایشی است، اما امکان جایگزینی provider، افزایش tenantها و تغییر سیاست دسترسی را بدون بازنویسی business logic می‌دهد.
- کاتالوگ permission باید سازگاری نسخه‌ای، migration و تست deny-by-default داشته باشد. تغییر role/policy می‌تواند چند app را متأثر کند و باید مصرف‌کننده‌ها همگام منتشر شوند.
- سرویس‌های جدید deployment repository و آیتم Runflare مستقل لازم دارند. این ADR مجوز انتشار یا دسترسی خارجی ایجاد نمی‌کند؛ پیش از استقرار باید ماتریس و pipeline مطابق مستند Runflare آماده شود.
- شناسه‌ی مشتری/عضویت میان سرویس‌ها opaque است؛ اعتبارسنجی cross-domain با API/event قراردادشده انجام می‌شود، نه foreign key یا query مستقیم دیتابیس.

## migration و rollback

- پیش از انتقال، داده‌های `organizations`، `branches`، `memberships` و `cards` snapshot، شمارش و با شناسه‌ی پایدار تطبیق داده می‌شوند.
- ابتدا schema و API مالک مقصد ساخته و داده backfill می‌شود؛ سپس read path و بعد write path به‌صورت کنترل‌شده منتقل می‌شوند. dual-write در app ممنوع است؛ برای انتقال event/outbox یا write-pause و reconciliation مستند لازم است.
- حذف schema قدیمی فقط پس از تأیید برابری شمارش، دسترسی، audit، restore و پایان پنجره‌ی سازگاری مجاز است.
- rollback با توقف write جدید، برگشت router به مالک قبلی و restore/reconciliation انجام می‌شود؛ migration مخرب تا تأیید restore اجرا نمی‌شود.

## سرویس‌ها، قراردادها و اسناد مرتبط

- ساختار مقصد در `DOCS/FolderAndFileStructure.md`، مالکیت در `DOCS/ArchitectureAndDesignPatterns.md` و قواعد مجوز در `DOCS/ImplementationRules.md` است.
- فازها: G0/G1/G4، S0/S1/S2/S4، O0/O1/O3/O5/O6 و C3.
- قراردادهای عمومی در `contracts/openapi/gateway.yaml` و قرارداد داخلی Identity & Access در `contracts/openapi/identity-access.yaml`؛ رویدادها در `contracts/asyncapi/events.yaml` و schemaهای نسخه‌دار. تغییرات permission با version policy و audit همراه‌اند.
- ADR مرتبط: [ADR-0003: هویت مشتری و اتصال شعبه با کارت](0003-customer-identity-profile-and-branch-linking.md).

## تصمیم‌های مصوب مالک محصول

- ماتریس پایه‌ی کم‌دسترسی و قابلیت نقش سفارشی/permissionهای ریزدانه و override فردی مطابق این ADR تأیید شد.
- دعوت pending برای شماره‌ای که هنوز حساب OTP ندارد تأیید شد.
- bootstrap اولیه‌ی system admin یک‌باره و خارج از endpoint عمومی، با MFA و audit تأیید شد؛ نوع عامل، عمر step-up و recovery در [ADR-0006](0006-administrative-mfa-totp.md) تعیین شده‌اند. تا آماده‌شدن bootstrap عملیاتی و migrationها، عملیات حساس همچنان fail-closed است.
- ثبت دستی داخلی کارت و دستگاه در پایلوت تأیید شد؛ sync واقعی، وضعیت اتصال معتبر و مانده‌ی مالی همچنان به قرارداد provider/مالی نیاز دارند.
