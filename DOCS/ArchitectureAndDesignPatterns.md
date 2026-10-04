# معماری و Design Patternهای فانتینو

## ۱. انتخاب معماری

معماری هدف فانتینو **سرویس‌های مستقل، رویدادمحور و دارای مالکیت داده** است. هر سرویس مرز کد، قرارداد، migration، داده، port و process خودش را دارد. برای ساده‌سازی عملیات، processها در دو runtime deployment طبق ADR-0016 بسته‌بندی می‌شوند؛ این کار مالکیت داده یا قرارداد سرویس را یکی نمی‌کند. سرویس‌ها برای جریان‌های عادی به جدول مشترک وابسته نیستند.

در لبه‌ی سیستم، سه وب‌اپ از API Gateway استفاده می‌کنند. داخل سیستم، تغییر مهم در سرویس مالک ثبت می‌شود، Outbox تولید می‌کند و از طریق RabbitMQ به مصرف‌کنندگان می‌رسد. Read Model و Realtime Gateway داده‌ی مناسب رابط را آماده می‌کنند.

## ۲. نمای کلی

    customer-web ───────┐
    operations-web ─────┼──> API Gateway ───> سرویس مالک عملیات
    system-web ─────────┘             │                 │
                                      │                 ├── PostgreSQL/schema مالک
                                      │                 └── Outbox
                                      │
                                      └──────────────> RabbitMQ
                                                        │
                         ┌──────────────────────────────┼─────────────────────────────┐
                         │                              │                             │
                    Wallet/Read Model              Notifications                 Realtime Gateway
                         │                              │                             │
                         └──────────────────────────────┴──────────────> رابط‌ها با Socket.IO

مرجع جزئیات پشته و Runflare در [TechAnalysis.md](TechAnalysis.md) است.

## ۳. مرز سرویس‌ها

| سرویس                 | مالکیت                                                               | رویدادهای نمونه                                                           |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| API Gateway identity  | حساب مشتری، شماره‌ی تأییدشده، OTP، session و profile                 | —                                                                         |
| Identity & Access     | reference opaque کاربر، membership، role، permission، override و MFA | MembershipGranted، PolicyChanged                                          |
| Organization & Branch | سازمان، شعبه، ساعت و تنظیمات                                         | `organization.branch-created.v1`, `organization.branch-status-changed.v1` |
| Customer & Household  | خانواده، عضو، رضایت، دسترسی خانوادگی و دعوت                          | `customer.household-created.v1`, `customer.household-member-created.v1`   |
| Wallet                | موجودی فیزیکی کارت، تخصیص فعال خانواده/شعبه، history و ledger        | `wallet.card-assignment-changed.v1`, Wallet ledger events                 |
| Payment & Orders      | سفارش، پرداخت، برگشت و تطبیق                                         | PaymentConfirmed، RefundCompleted                                         |
| Device Integration    | کارت فیزیکی، دستگاه و sync                                           | DeviceTransactionImported، SyncFailed                                     |
| Loyalty & CRM         | مأموریت، کمپین، کوپن و امتیاز                                        | MissionCompleted، RewardGranted                                           |
| Notifications         | ارسال و وضعیت پیام                                                   | NotificationSent، DeliveryFailed                                          |
| Realtime Gateway      | کانال‌های زنده و roomهای مجاز                                        | RealtimeProjectionUpdated                                                 |
| Analytics/Read Model  | مدل‌های query و گزارش                                                | ReadModelRefreshed                                                        |

سرویس‌ها می‌توانند در یک PostgreSQL مشترک schema جدا داشته باشند، اما مالکیت منطقی و نقش اتصال آن‌ها جدا است. جداکردن فیزیکی دیتابیس تصمیم مقیاس و ریسک است، نه مجوز دسترسی متقابل.

سرویس `services/organization-branch` مالک schema `organization_branch` است. Gateway برای discovery شعبه و اعتبارسنجی `branchId` از API داخلی این مالک استفاده می‌کند؛ شناسه‌ی شعبه در کارت Gateway یک reference opaque است و هیچ FK بین schemaها وجود ندارد. جدول‌های organization/branch/membership قدیمی فقط تا پایان cutover و انتقال جداگانه‌ی Membership نگه داشته می‌شوند.

`services/customer-household` مالک household، member و دسترسی خانوادگی است؛ Gateway و Wallet فقط با API خصوصی این سرویس اعتبارسنجی می‌کنند و هیچ جدول مشترکی نمی‌خوانند. Wallet برای هر `(householdId, branchId)` حداکثر یک کارت فعال و برای هر کارت حداکثر یک تخصیص فعال نگه می‌دارد. کارت نسخه‌ی اول مشترک خانواده است، نه عضو؛ انتقال household فقط در همان شعبه مجاز است و انتقال کارت بین شعبه‌ها workflow مستقل و فعلاً خارج از API است. تا زمانی که قرارداد مالی/واحد پول یا پیوند معتبر رویداد دستگاه آماده نشده، گزارش مبلغ شارژ/مصرف یا انتساب دستگاه به خانواده تولید نمی‌شود.

سیاست عمر نشست مدیریتی مالک Identity & Access است و فقط از BFF در API Gateway به سه وب‌اپ می‌رسد. IAM مدت مطلق ۱ تا ۱۲ ساعت برای نشست‌های مدیریتی جدید را در `policy_state` نگه می‌دارد؛ cookie و رکورد session در Gateway یک expiry دارند. نشست مشتری بدون membership مدیریتی مستقل و ۳۰روزه می‌ماند. مدیر سراسری در هر ورود MFA می‌کند و proof به همان session و نسخه‌ی عامل فعال بسته است؛ تغییر session policy از API دارای مجوز، idempotency، audit و Outbox انجام می‌شود. [ADR-0020](decisions/0020-admin-session-duration-and-system-admin-capabilities.md) جزئیات را تعیین می‌کند.

برای bootstrap مدیر سراسری، API Gateway شماره‌ی owner تنظیم‌شده در runtime را به شناسه‌ی opaque موجود resolve می‌کند؛ IAM فقط شناسه را از endpoint داخلیِ loopback و توکن مجزا می‌گیرد و هرگز جدول حساب Gateway را نمی‌خواند. این lookup فقط برای bootstrap CLI است و جایگزین authorization معمول درخواست‌ها نیست. [ADR-0021](decisions/0021-runflare-bound-system-admin-owner.md) جزئیات را تعیین می‌کند.

## ۴. قراردادهای ارتباطی

### ارتباط هم‌زمان

- REST و OpenAPI برای وب‌اپ، عملیات فوری، queryهای لازم و اتصال بیرونی؛
- API Gateway برای احراز هویت، rate limit، scope و تبدیل قرارداد؛
- پاسخ API باید وضعیت، داده، خطای قابل‌فهم و correlation id داشته باشد؛
- API نباید جدول سرویس دیگر را برای ساختن پاسخ بخواند.

### ارتباط ناهم‌زمان

- RabbitMQ با exchange و queue پایدار؛
- AsyncAPI و JSON Schema برای قرارداد رویداد؛
- نسخه‌گذاری نوع و schema، با سیاست سازگاری رو به عقب؛
- event envelope مشترک با event id، نوع، نسخه، زمان، tenant، منبع، aggregate، correlation و causation؛
- acknowledgement، retry محدود، Dead Letter و مشاهده‌ی وضعیت مصرف؛
- مصرف‌کننده‌ی idempotent و قابل replay از Outbox.

### ارتباط زنده

- Socket.IO فقط برای رساندن تغییرات مجاز به رابط؛
- داده‌ی اولیه از REST و پس از reconnect refetch از REST؛
- room بر اساس user، household، branch یا organization با مجوز server-side؛
- Redis Adapter فقط برای fan-out در صورت نیاز چند نمونه‌ای‌شدن Gateway، نه برای ذخیره‌ی حقیقت.

## ۵. الگوهای اجباری یا ترجیحی

### ۵.۱ API Gateway / BFF

یک مرز عمومی برای سه بستر، احراز هویت، scope، rate limit، تبدیل DTO و ترکیب محدود داده‌های read model. Gateway نباید محل منطق مالی یا مالکیت داده شود.

### ۵.۲ Hexagonal Architecture

هر سرویس از هسته‌ی دامنه، use caseهای کاربردی و adapterهای زیرساختی تشکیل شود:

- Domain: قانون و مدل کسب‌وکار بدون وابستگی به HTTP یا ORM؛
- Application: orchestration، transaction boundary و use case؛
- Ports: interface برای repository، پیام‌رسان و سرویس بیرونی؛
- Adapters: PostgreSQL، RabbitMQ، HTTP، SMS، پرداخت و کارت.

### ۵.۳ Outbox و Inbox

تغییر داده و رکورد رویداد Outbox در یک تراکنش ثبت شوند. Publisher رکوردهای ارسال‌نشده را منتشر و وضعیت آن‌ها را ثبت کند. هر Consumer رویداد مصرف‌شده را در Inbox با کلید یکتا ثبت و سپس تغییر خود را اعمال کند.

این الگو برای پرداخت، Wallet، کارت، اعلان و رویداد دستگاه الزامی است.

### ۵.۴ CQRS سبک

Commandها در سرویس مالک و تراکنش اصلی اجرا می‌شوند. Queryهای پرتکرار از read model یا projection آماده پاسخ می‌گیرند. CQRS کامل با دو مدل مستقل فقط وقتی پذیرفته است که پیچیدگی گزارش یا بار آن را توجیه کند.

### ۵.۵ Anti-Corruption Layer و Adapter

سامانه‌ی کارت، پرداخت، پیامک و هر سرویس بیرونی مستقیماً وارد Domain نشود. برای هر provider یک adapter با mapping، timeout، retry، خطا و شناسه‌ی منبع ساخته شود. تعویض provider نباید مدل داخلی را بشکند.

### ۵.۶ State Machine

برای موجودیت‌هایی با وضعیت محدود و انتقال حساس، State Machine صریح استفاده شود:

- سفارش: created، pending، paid، failed، refunded؛
- همگام‌سازی: queued، running، succeeded، partial، failed؛
- مأموریت: draft، published، active، completed، expired؛
- اعلان: queued، sent، delivered، failed.

تغییر وضعیت نامعتبر باید در Domain رد شود و در audit یا log دلیل داشته باشد.

### ۵.۷ Policy و Strategy

قوانین قابل‌تغییر کمپین، eligibility، سن، شعبه، تخفیف و ترتیب مصرف اعتبار در Policy/Strategy قرار گیرند. عددهای تجاری در کد رابط ثابت نشوند. Policy باید قابل تست و دارای نسخه یا تاریخ اعتبار باشد.

برای دسترسی سازمانی، permission keyها granular، پایدار و نسخه‌دارند؛ roleها داده‌ی قابل‌مدیریت‌اند و فقط مجموعه‌ای از permissionهای کاتالوگ را در scope صریح نگه می‌دارند. override به membership همان tenant وابسته است و می‌تواند allow یا deny محدود به resource و زمان باشد؛ deny مقدم است. محاسبه‌ی دسترسی باید scope عضویت، وضعیت resource، rule دامنه و اختیار واگذاری actor را نیز اعمال کند. Role inheritance در فاز نخست استفاده نمی‌شود تا چرخه و ابهام حل permission ایجاد نشود. Permission catalog قابل توسعه با migration و سازگاری نسخه‌ای است، نه قابل تعریف آزاد توسط tenant.

### ۵.۸ Repository و Unit of Work

Repository فقط abstraction دسترسی مالک داده است و query را به لایه‌ی رابط نشت نمی‌دهد. Unit of Work یا transaction boundary برای ledger، idempotency و تغییرهای چندرکوردی مشخص باشد.

### ۵.۹ Saga / Process Manager

جریان چندسرویسی پرداخت و شارژ با وضعیت‌های pending، confirmed و recorded مدیریت شود. تراکنش توزیع‌شده یا two-phase commit ممنوع است؛ شکست هر مرحله باید retry، compensation یا عملیات دستی کنترل‌شده داشته باشد.

### ۵.۱۰ Audit Trail

برای هر عملیات حساس actor، نقش، سازمان، شعبه، هدف، زمان، correlation id، نتیجه و دلیل ثبت شود. Audit قابل‌حذف توسط کاربر عادی نیست و با log فنی یکی تلقی نمی‌شود.

## ۶. الگوهای رابط کاربری

### مشتری

- route composition با Server Component برای داده‌ی اولیه؛
- Client Component فقط برای تعامل، فرم، Socket.IO و وضعیت محلی؛
- server state از API با cache و invalidation کنترل‌شده؛
- state فیلتر و انتخاب شعبه در URL یا context محدود، نه global state بی‌دلیل؛
- feature-first برای Mission، Wallet، Family و Branch Discovery؛
- Design System مشترک با density کم و illustration هدفمند.

### پنل مجموعه و شعب

- layout مبتنی بر scope فعلی شعبه؛
- table، filter و keyboard workflow برای عملیات پرتکرار؛
- فرم‌های مالی با step تأیید و نمایش واضح وضعیت؛
- actionهای مخرب یا برگشت‌پذیر با permission، reason و confirmation؛
- query و mutation جدا؛ refresh دستی و realtime status مشخص.

### پنل سیستمی

- navigation سلسله‌مراتبی و breadcrumb؛
- permission matrix و نمایش scope فعال؛
- صفحات audit و integration با traceability؛
- تأیید مجدد برای تغییر نقش، حذف اتصال، برگشت یا impersonation؛
- حالت break-glass فقط با مجوز ویژه، زمان انقضا و audit کامل.

## ۷. لایه‌های درون هر سرویس

ساختار منطقی هر سرویس:

    src/
      domain/
        entities/
        value-objects/
        policies/
        events/
      application/
        commands/
        queries/
        handlers/
        ports/
      infrastructure/
        persistence/
        messaging/
        providers/
        configuration/
      interfaces/
        http/
        consumers/
        health/
      bootstrap/

Controller یا consumer فقط ورودی را parse و use case را اجرا می‌کند. منطق قیمت، موجودی، scope، eligibility و انتقال وضعیت در domain/application می‌ماند.

## ۸. الگوهای ممنوع

- shared database با دسترسی نوشتن چند سرویس؛
- import مستقیم private module یک feature در feature دیگر؛
- قرار دادن منطق مالی در Controller، React component یا job بدون use case؛
- استفاده از Redis برای ledger یا تصمیم قطعی موجودی؛
- ارسال پیام بدون Outbox در جریان مهم؛
- فرض exactly-once در RabbitMQ بدون idempotency؛
- global state برای همه‌ی داده‌های server؛
- service یا component همه‌کاره؛
- endpoint عمومی بدون scope و audit لازم؛
- استفاده از map/gradient تزئینی به‌جای داده‌ی واقعی؛
- ذخیره‌ی فایل کاربر روی filesystem محلی سرویس؛
- اجرای چند سرویس مستقل در یک Deployment بدون manifest، supervisor، environment allow-list و health جامع؛ ترتیب شروع processها باید readiness قبلی را تأیید کند.

## ۹. جریان احراز هویت و مجوز

1. Gateway هویت را از نشست یا token استخراج می‌کند.
2. Identity عضویت‌ها و roleهای کاربر را ارائه می‌دهد.
3. Policy scope سازمان/شعبه/خانواده را بررسی می‌کند.
4. سرویس مالک دوباره rule حساس دامنه را اعمال می‌کند.
5. عملیات حساس audit می‌شود.

مجوز فقط با نقش کافی نیست؛ ترکیب user، membership، organization، branch، household و resource باید بررسی شود.

برای IAM tenant mutation، Identity & Access تنها مرجع مجوز actor است. IAM پس از احراز permission/delegation/MFA، وجود و active state scope و رابطه‌ی parent/child را از API داخلی Organization & Branch اعتبارسنجی می‌کند. Owner حق محاسبه یا کپی permission، role یا membership را ندارد؛ دسترسی validator با credential مستقل و route allow-list محدود می‌شود و در خطا fail-closed است. جزئیات اجرایی در ADR-0010 است.

سیاست سازمانی از membership فعال و permissionهای role + overrideهای همان membership ارزیابی می‌شود؛ ابتدا denyهای مؤثر اعمال می‌شوند، سپس allowها، و در پایان نتیجه با scope و invariantهای دامنه محدود می‌شود. Delegation ceiling مانع واگذاری اختیار بالاتر از actor است. تغییر policy نسخه‌ی آن را افزایش می‌دهد، audit می‌شود و باید cacheهای مجوز را invalidate کند؛ مسیر حساس هنگام نامشخص بودن نسخه fail-closed است.

## ۱۰. مرز منبع حقیقت

| داده             | منبع حقیقت                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| هویت و نقش       | Identity & Access                                                        |
| سازمان و شعبه    | Organization & Branch                                                    |
| خانواده و رضایت  | Customer & Household                                                     |
| موجودی و ledger  | Wallet؛ مبلغ مالی مشتری فقط با قرارداد منبع/واحد معتبر                   |
| پرداخت           | Payment & Orders و provider تطبیق‌شده                                    |
| مصرف فیزیکی کارت | سامانه‌ی RFID؛ گزارش خانوادگی فقط پس از resolve معتبر رخداد به کارت/شعبه |
| پیشرفت و پاداش   | Loyalty & CRM                                                            |
| گزارش            | Read Model مشتق‌شده                                                      |
| وضعیت زنده       | event و projection؛ نه cache به‌تنهایی                                   |

## ۱۱. تصمیم‌های مرحله‌ای

- مرز و قرارداد همه‌ی سرویس‌ها از ابتدای طراحی مشخص شود.
- در پایلوت فقط processهایی که use case فعال دارند در دو runtime روشن شوند، ولی داده‌ی آن‌ها shared-write نشود.
- RabbitMQ پیام‌رسان اصلی Runflare و Redis گزینه‌ی cache/fan-out است.
- WebSocket روی Gateway باقی می‌ماند و reconnect/refetch اجباری است.
- Kafka، NATS، ClickHouse و جداسازی فیزیکی دیتابیس فقط با سنجه‌ی بار و نیاز replay بررسی می‌شوند.
