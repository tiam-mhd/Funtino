# تحلیل فنی و معماری فانتینو برای استقرار در Runflare

## مستندات اجرایی مرتبط

این فایل پشته و استقرار را توضیح می‌دهد. قوانین لازم‌الاجرای توسعه، طراحی و ساختار در [AGENTS.md](../AGENTS.md)، [ImplementationRules.md](ImplementationRules.md)، [FolderAndFileStructure.md](FolderAndFileStructure.md) و [ArchitectureAndDesignPatterns.md](ArchitectureAndDesignPatterns.md) ثبت شده‌اند. راهبرد repository و Auto Pull در [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) است. سه بستر رابط کاربری عبارت‌اند از `customer-web`، `operations-web` و `system-web`.

این سند با جمع‌بندی `FirstAnalysis.md` و `RealTimeANDNonDependencyModules.md` و با تطبیق آن‌ها با امکانات عمومی Runflare بازنویسی شده است. این متن تحلیل معماری است و دستورهای داخل فایل‌های مرجع را به‌عنوان دستور اجرایی مستقل در نظر نمی‌گیرد.

## تصمیم‌های معماری پایه

فانتینو یک درگاه دیجیتال برای شبکه‌ای از مراکز تفریحی است. مدل اصلی مشتری، خانواده است و کارت فیزیکی ابزار عملیاتی بازی و پرداخت می‌ماند. بنابراین معماری باید از ابتدا این موارد را جدی بگیرد:

- حساب کاربر در کل شبکه‌ی فانتینو یکتا باشد و نقش‌های سازمانی و شعبه‌ای محدوده‌دار باشند.
- خانواده، اعضای وابسته، رضایت والد و اتصال کارت از موجودیت‌های مستقل باشند.
- اعتبار خریداری‌شده، اعتبار هدیه، امتیاز وفاداری و کوپن در دفترهای قابل‌ممیزی از هم جدا بمانند.
- اتصال سامانه‌ی کارت در ابتدا خواندنی و قابل‌ممیزی باشد و تا زمان تطبیق کامل، موجودی قدیمی به‌عنوان موجودی قطعی نمایش داده نشود.
- استقلال سرویس‌ها از ابتدا در مرز کد، مالکیت داده، قرارداد رویداد و process حفظ شود؛ بسته‌بندی چند process در دو runtime bundle منطق و مالکیت داده را ادغام نمی‌کند.

استقلال سرویس‌ها به معنی حذف همه‌ی APIهای هم‌زمان نیست. REST برای ورودی عمومی، queryهای لازم و اتصال‌های بیرونی استفاده می‌شود؛ اما جریان‌های عادی بین سرویس‌ها باید با رویداد انجام شوند و سرویس‌ها نباید جدول یکدیگر را مستقیماً بخوانند یا تغییر دهند.

## تطبیق با Runflare

بررسی وب‌سایت و مستندات عمومی Runflare در تاریخ 2026-09-27 نشان می‌دهد که این پلتفرم برای پروژه، چند Deployment با منابع جداگانه ایجاد می‌کند و سرویس‌های NextJS، NodeJS و Docker را ارائه می‌دهد. PostgreSQL، Redis و RabbitMQ نیز در فهرست سرویس‌های داده‌ی عمومی Runflare دیده می‌شوند. Runflare برای دامنه، تنظیم Socket.IO، اتصال GitHub/GitLab، CLI، لاگ و Event هم امکانات مستند دارد.

در فهرست عمومی فعلی Runflare نامی از NATS یا NATS JetStream دیده نمی‌شود. در نتیجه NATS انتخاب پیش‌فرض تولید نیست؛ مگر اینکه در پنل همان حساب، سرویس رسمی آن ارائه شود یا یک سرویس خارجی مورد تأیید جداگانه تهیه شود. پیام‌رسان اصلی پیشنهادی برای استقرار Runflare، RabbitMQ است.

| نیاز                    | انتخاب سازگار با Runflare              | تصمیم معماری                                                       |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| وب‌اپ مشتری             | Next.js و TypeScript                   | سرویس مستقل، App Router، mobile-first و PWA تدریجی                 |
| پنل صندوق و مدیریت      | Next.js و TypeScript                   | سرویس مستقل با کنترل نقش و محدوده‌ی شعبه روی سرور                  |
| پنل سیستم               | Next.js و TypeScript                   | سرویس مستقل برای سازمان‌ها، نقش‌ها، اتصال‌ها، سلامت و ممیزی        |
| API و مرز عمومی         | NestJS و TypeScript با Fastify         | REST و OpenAPI؛ فقط API Gateway دامنه‌ی عمومی داشته باشد           |
| سرویس‌های کسب‌وکار      | NestJS و TypeScript                    | هر سرویس مرز کد، داده، migration و process خودش را داشته باشد      |
| پایگاه داده             | PostgreSQL مدیریت‌شده‌ی Runflare       | منبع حقیقت؛ schema و نقش جدا برای هر سرویس                         |
| پیام‌رسان رویداد        | RabbitMQ مدیریت‌شده‌ی Runflare         | exchange و queue پایدار، تأیید پیام، retry و Dead Letter           |
| Cache و fan-out وب‌سوکت | Redis مدیریت‌شده‌ی Runflare            | اختیاری؛ هرگز منبع حقیقت پول یا رویداد durable نباشد               |
| رابط بلادرنگ            | Socket.IO روی NestJS WebSocket Gateway | فعال‌سازی Socket.IO روی دامنه‌ی Runflare و احراز مجوز هر کانال     |
| قرارداد رویداد          | JSON Schema و AsyncAPI                 | نسخه‌بندی، ثبت تغییرات و سازگاری رو به عقب                         |
| فایل و تصویر            | فضای ذخیره‌سازی S3-compatible خارجی    | فایل روی دیسک سرویس نگه‌داری نشود؛ ارائه‌دهنده جداگانه انتخاب شود  |
| اجرای محلی              | Docker Compose                         | فقط برای توسعه و آزمون؛ جایگزین معماری Deploymentهای Runflare نیست |
| اجرای تولید             | دو Docker runtime bundle               | سه web process و نه backend process؛ env هر process جدا allow-list شود |

### اصلاح‌های مهم نسبت به تحلیل قبلی

- `NATS JetStream` به `RabbitMQ` تغییر می‌کند، چون RabbitMQ در فهرست عمومی Runflare وجود دارد و NATS در فهرست عمومی فعلی دیده نمی‌شود.
- `BullMQ` دیگر پیام‌رسان اصلی سیستم نیست. کارهای رویدادمحور و پردازش‌های پایدار از RabbitMQ استفاده می‌کنند؛ Redis فقط برای cache، rate limit، قفل کوتاه‌مدت و در صورت نیاز fan-out Socket.IO است.
- معماری از «بک‌اند ماژولار یکپارچه» به سرویس‌های مستقل رویدادمحور تغییر می‌کند. در پایلوت می‌توان تعداد سرویس‌های کم‌بار را با توجه به سهمیه‌ی Deployment مرحله‌بندی کرد، اما مرز داده و قرارداد آن‌ها نباید حذف شود.
- Kubernetes برای این پروژه مستقیماً مدیریت نمی‌شود. Runflare زیرساخت کانتینری خود را مدیریت می‌کند؛ پروژه باید با نوع سرویس Runflare یا Dockerfile هر سرویس طراحی شود.
- Docker Compose برای محیط محلی می‌ماند و نباید فرض شود که با یک فایل Compose، دیتابیس‌ها و سرویس‌های تولیدی در Runflare ساخته می‌شوند.
- پشتیبان Runflare تنها یکی از لایه‌های پشتیبان است. برای PostgreSQL باید پشتیبان مستقل و آزمون بازیابی خارج از سرویس هم وجود داشته باشد؛ مخصوصاً در پلن رایگان نباید روی Backup حساب کرد.

## پشته‌ی فنی نهایی

| لایه              | فناوری نهایی                             | ملاحظات                                                                      |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| وب‌اپ مشتری       | Next.js، App Router، TypeScript          | PWA ارتقایی؛ مسیرهای اصلی بدون وابستگی به نصب یا قابلیت آفلاین کار کنند      |
| پنل عملیاتی       | Next.js، TypeScript، RTL و Tailwind CSS  | پنل صندوق، اپراتور و مدیریت با مجوز سمت سرور                                 |
| پنل سیستمی        | Next.js، TypeScript، RTL و چگالی مدیریتی | سازمان‌ها، نقش‌ها، اتصال‌ها، سلامت و ممیزی؛ با تأیید مجدد عملیات حساس        |
| API Gateway       | NestJS، Fastify، REST و OpenAPI          | تنها نقطه‌ی عمومی برای API؛ کلاینت TypeScript از قرارداد تولید شود           |
| سرویس‌های دامنه   | NestJS و TypeScript                      | استقرار جداگانه و ارتباط رویدادمحور                                          |
| ORM               | Prisma                                   | برای عملیات عادی؛ SQL هدفمند برای قفل‌گذاری و کیف پول                        |
| پایگاه داده       | PostgreSQL                               | دفتر تراکنش، outbox، inbox و read modelهای لازم                              |
| پیام‌رسان         | RabbitMQ                                 | topic/fanout exchange، queue پایدار، acknowledgement، retry و DLQ            |
| Cache             | Redis                                    | cache، rate limit، session/revocation کوتاه‌مدت و fan-out؛ نه تراکنش         |
| Realtime          | Socket.IO و NestJS Gateway               | داده‌ی اولیه از REST، تغییرات بعدی از WebSocket، بازیابی پس از reconnect     |
| قرارداد ناهم‌زمان | AsyncAPI و JSON Schema                   | `eventId`، نوع و نسخه، زمان، tenant، منبع، correlation و causation           |
| احراز هویت        | OTP پیامکی، cookie امن و HttpOnly        | MFA برای مدیران و service-to-service authentication                          |
| تست               | Playwright و تست قرارداد رویداد          | جریان‌های مالی، دسترسی شعبه، تکرار پیام و PWA موبایل                         |
| پایش              | لاگ JSON ساخت‌یافته و OpenTelemetry      | خروجی لاگ به stdout و ارسال trace/metric به سامانه‌ی پایش خارجی در صورت نیاز |

نسخه‌ی Node.js و نسخه‌ی پایگاه داده باید از نسخه‌های موجود در پنل Runflare انتخاب و در همه‌ی Deploymentها یکسان نگه داشته شود؛ نسخه‌ی مشخصی که در مستندات عمومی ثابت نشده است نباید در این سند hard-code شود.

## مرز سرویس‌ها و مالکیت داده

سرویس‌ها بر اساس مسئولیت کسب‌وکار جدا شوند، نه بر اساس صفحه‌های رابط کاربری:

1. **Identity & Access:** حساب، OTP، نشست، نقش و مجوز محدوده‌دار.
2. **Organization & Branch:** سازمان، شعبه، ساعت کاری و تنظیمات عملیاتی.
3. **Customer & Household:** پروفایل، خانواده، سرپرست، اعضای وابسته و رضایت‌ها.
4. **Wallet:** کارت‌های متصل، اعتبار، هدیه، امتیاز و دفتر تراکنش.
5. **Payment & Orders:** سفارش شارژ، درگاه، تأیید، برگشت و تطبیق پرداخت.
6. **Device Integration:** سامانه‌ی کارت، دستگاه‌ها، رخدادهای بازی و همگام‌سازی.
7. **Loyalty & CRM:** مأموریت، کمپین، کوپن، امتیاز و بخش‌بندی مشتری.
8. **Notifications:** پیامک OTP، اعلان و پیام‌های خدماتی.
9. **Realtime Gateway:** دریافت رویدادهای مجاز و رساندن آن‌ها به رابط‌ها.
10. **Analytics/Read Model:** مدل‌های خواندنی و گزارش‌های تجمیعی.

هر سرویس مالک schema یا database، migration، outbox و read model خودش است. در شروع، برای کاهش تعداد Deployment، این schemaها می‌توانند روی یک PostgreSQL مدیریت‌شده‌ی Runflare باشند؛ اما برای هر سرویس نقش و migration جدا تعریف شود و دسترسی مستقیم به جدول سرویس دیگر ممنوع باشد. با رشد بار یا حساسیت داده، schemaهای پرترافیک به دیتابیس یا کلاستر جدا منتقل شوند.

## جریان رویداد و ارتباط سرویس‌ها

جریان استاندارد هر تغییر مهم چنین است:

```text
درخواست مشتری یا دستگاه
        ↓
API Gateway و سرویس مالک عملیات
        ↓
ثبت تغییر کسب‌وکار و Outbox در یک تراکنش PostgreSQL
        ↓
Publisher سرویس → RabbitMQ durable exchange
        ↓
Queue مستقل هر مصرف‌کننده، با retry و Dead Letter
        ↓
Read Model و Realtime Gateway
        ↓
REST اولیه یا Socket.IO برای رابط مشتری و کارکنان
```

قالب هر رویداد حداقل این فیلدها را داشته باشد: `eventId`، `eventType`، `eventVersion`، `occurredAt`، `organizationId`، `branchId`، `sourceId`، `aggregateId`، `correlationId` و در صورت نیاز `causationId`.

مصرف‌کننده باید در برابر تحویل دوباره‌ی پیام مقاوم باشد. برای این کار، `eventId` یا کلید یکتای منبع در جدول inbox ثبت شود و تغییر داده و ثبت مصرف پیام در یک تراکنش انجام گیرد. RabbitMQ باید از پیام‌های پایدار، queueهای durable، acknowledgement، retry محدود و Dead Letter استفاده کند. تعداد retry نامحدود ممنوع است تا یک پیام خراب، کل سیستم را متوقف نکند.

نمونه‌ی جریان پرداخت:

1. Payment & Orders پرداخت را تأیید و رویداد `PaymentConfirmed` را منتشر می‌کند.
2. Wallet رویداد را یک‌بار مصرف می‌کند و اعتبار را در دفتر خودش ثبت می‌کند.
3. Wallet رویداد `WalletCredited` را منتشر می‌کند.
4. Loyalty، Notifications، Analytics و Realtime هرکدام مستقل واکنش نشان می‌دهند.

اختلال CRM یا اعلان نباید مانع ثبت پرداخت یا تراکنش کیف پول شود. اگر نیاز به بازپخش طولانی‌مدت رویداد، حجم بسیار بالا یا تحلیل جریانی ایجاد شد، Kafka یا یک سرویس رویداد خارجی دوباره بررسی شود؛ در استقرار معمول Runflare، RabbitMQ و Outbox انتخاب کم‌ریسک‌تری هستند.

## معنای ریل‌تایم

صفحه ابتدا داده‌ی معتبر را از REST می‌گیرد. سپس Socket.IO فقط تغییرات مجاز و جدید را برای کاربر، خانواده یا شعبه ارسال می‌کند. WebSocket منبع حقیقت و جایگزین API نیست.

- Gateway باید مجوز کاربر و محدوده‌ی شعبه را پیش از عضویت در هر room بررسی کند.
- پس از قطع اتصال، رابط آخرین زمان همگام‌سازی را نشان دهد و بعد از reconnect داده را از REST تازه‌سازی کند.
- در یک Gateway، RabbitMQ می‌تواند رویدادهای لازم را به Gateway برساند.
- در صورت اجرای چند نمونه‌ی Gateway، برای fan-out اتصال‌ها Redis Adapter یا queue مستقل هر نمونه استفاده شود؛ این لایه فقط پخش زنده است و منبع دائمی داده نیست.
- تنظیم Socket.IO روی دامنه‌ی Runflare باید در محیط پایلوت با reconnect، timeout، proxy و چند اتصال هم‌زمان آزموده شود.

هدف پایلوت می‌تواند رساندن رویداد داخلی به رابط در کمتر از یک ثانیه در صدک ۹۵ باشد. زمان پاسخ سامانه‌ی کارت، کیفیت اینترنت شعبه و سرویس پرداخت بیرونی جداگانه سنجیده شوند و در SLA ریل‌تایم داخلی مخلوط نشوند.

## پایگاه داده، کیف پول و کارت

PostgreSQL منبع اصلی داده است. Redis نباید برای موجودی قابل‌مصرف، ثبت پرداخت یا تاریخچه‌ی تراکنش استفاده شود.

دفتر کیف پول باید تغییرناپذیر و append-only باشد. اصلاح با رویداد برگشت یا اصلاح ثبت شود، نه با ویرایش یا حذف سابقه. شارژ، مصرف، برگشت، webhook تکراری و تطبیق پرداخت باید کلید idempotency و قفل تراکنشی داشته باشند.

در مرحله‌ی اول، سامانه‌ی RFID و کارت موجود منبع حقیقت مصرف فیزیکی بماند. Device Integration رخدادهای آن را با شناسه‌ی یکتا وارد فانتینو کند و زمان آخرین همگام‌سازی را نمایش دهد. فقط پس از شناخت API، قطعی اینترنت، retry، برگشت و تطبیق مالی، شارژ آنلاین یا اجازه‌ی خرج‌کردن مستقیم از Wallet فعال شود.

برای چندشعبه‌ای‌بودن، داده‌های عملیاتی باید `organization_id` و در موارد لازم `branch_id` داشته باشند. مجوز در API اجباری است و Row-Level Security در PostgreSQL می‌تواند لایه‌ی دفاعی اضافه باشد؛ نقش اتصال برنامه باید طوری تنظیم شود که محدودیت‌های RLS دور زده نشود.

## طرح استقرار در Runflare

### محیط محلی

Docker Compose برای اجرای محلی PostgreSQL، RabbitMQ، Redis اختیاری و سرویس‌های NestJS/Next.js استفاده شود. قراردادهای OpenAPI و AsyncAPI، migrationها، retry و جریان WebSocket در همین محیط آزموده شوند.

### راهبرد Repository و Auto Pull

source monorepo مستقیماً به Runflare وصل نمی‌شود. طبق ADR-0016 دو deployment repository خودبسنده تولید می‌شوند: Frontend شامل سه Next.js process و Backend شامل ۹ gateway/worker process. هر bundle یک root Docker، branch و Auto Pull در Runflare دارد؛ PostgreSQL، RabbitMQ و Redis itemهای داده‌ای مستقل می‌مانند.

pipeline انتشار پس از آماده‌شدن source remote با path filter یکی یا هر دو bundle را prune و build می‌کند و به deployment repository مربوط می‌فرستد. Git submodule برای این هدف استفاده نمی‌شود. جزئیات نگاشت، branch، webhook، root و rollback در [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) ثبت شده است.

### پایلوت Runflare

برای پایلوت واقعی، دو runtime application و سرویس‌های داده در نظر گرفته شوند:

- Frontend Runtime: سه web app روی پورت‌های 3000، 3001 و 3002؛
- Backend Runtime: API و Realtime Gateway و هفت Worker روی پورت‌های 4000 تا 4080؛
- PostgreSQL؛
- RabbitMQ؛
- Redis فقط وقتی cache، rate limit یا چندنمونه‌ای‌شدن Gateway به آن نیاز پیدا کند.

پلان رایگان با دو Deployment و منابع محدود برای اثبات مفهوم یا محیط توسعه مناسب است، نه برای معماری تولیدی مستقل. تعداد Deployment و منابع هر سرویس باید قبل از ایجاد پروژه در پنل Runflare بر اساس بار آزمایشی تعیین شود. در صورت حفظ مرز کامل سرویس‌ها، پلن پولی یا سفارشی لازم خواهد بود.

### معماری کامل تولید

در rollout هدف، frontend و backend در دو runtime bundle مستقر می‌شوند و PostgreSQL و RabbitMQ به‌صورت سرویس‌های مدیریت‌شده‌ی جدا باقی می‌مانند؛ Redis پس از اثبات نیاز اضافه می‌شود. runtime bundle فرآیندهای مستقل را در یک failure/scaling domain مشترک قرار می‌دهد.

تعداد Deployment با تعداد replica یکی نیست و به‌تنهایی تضمین‌کننده‌ی تحمل خطا یا مقیاس‌پذیری نیست. تعداد نمونه‌ها، رفتار load balancer، persistence پیام، اتصال داخلی سرویس‌ها و محدودیت WebSocket باید با یک آزمون واقعی در حساب Runflare تأیید شود.

هر bundle به‌صورت Docker مستقر می‌شود و processها از manifest صریح به‌وسیله‌ی supervisor اجرا می‌شوند؛ process پنهان، restart داخلی و health ناقص مجاز نیست. Runflare باید route هر domain/network را به target port فرایند مربوط نگاشت کند.

## استقرار، اسرار و عملیات

- اتصال GitHub و Auto Pull به یکی از دو runtime repository انجام شود؛ source commit، deployment commit و deployed revision ثبت شوند.
- pipeline با path filter همه‌ی bundleهای اثرپذیرفته را کامل تولید می‌کند. Runflare root هر bundle را Docker می‌سازد و command مخفی پنل برای اجرای processها تعریف نمی‌شود.
- تغییرات migration به‌صورت یک مرحله‌ی کنترل‌شده و یک‌باره اجرا شوند، نه هم‌زمان توسط همه‌ی replicaها.
- متغیرهای اتصال، رمزها، کلید JWT، کلید امضای webhook و اطلاعات پیامک در تنظیمات محیطی Runflare نگه‌داری شوند و در مخزن قرار نگیرند.
- فقط Web، API Gateway و Realtime Gateway دامنه‌ی عمومی داشته باشند. PostgreSQL، RabbitMQ و Redis از اینترنت عمومی در دسترس نباشند؛ دسترسی راه دور دیتابیس فقط برای عملیات کنترل‌شده و موقت فعال شود.
- لاگ‌ها به‌صورت JSON روی stdout تولید شوند و با `runflare logs` و حالت دنبال‌کردن لحظه‌ای بررسی شوند. Eventهای عملیاتی Runflare نیز برای deploy، restart و خطاهای زیرساختی پایش شوند.
- برای هر سرویس endpoint سلامت، timeout، graceful shutdown و ثبت `correlationId` در لاگ تعریف شود.
- Backup داخلی Runflare کافی نیست. از PostgreSQL پشتیبان logical یا snapshot مستقل تهیه شود، خارج از سرویس نگه‌داری شود و بازیابی آن به‌صورت دوره‌ای آزمایش شود.
- تصویر شعبه و فایل‌های مشتری روی دیسک محلی سرویس ذخیره نشود؛ از فضای S3-compatible خارجی با URL امضاشده و سیاست نگه‌داری مشخص استفاده شود.

## امنیت و دسترسی

احراز هویت مشتری با شماره موبایل و OTP انجام شود و سرویس پیامک پشت interface قابل‌تعویض بماند. cookie نشست باید `Secure` و `HttpOnly` باشد و سیاست SameSite متناسب با دامنه‌ها تنظیم شود. حساب‌های مدیریتی MFA داشته باشند.

در پنل صندوق و مدیریت، مخفی‌کردن دکمه در رابط کافی نیست؛ سازمان و شعبه‌ی مجاز باید در API و در صورت نیاز در policyهای PostgreSQL بررسی شوند. سرویس‌ها نیز برای مصرف رویداد و API داخلی باید authentication و authorization جدا داشته باشند.

اطلاعات کودک، نشانی منزل، داده‌ی پزشکی و موقعیت مکانی پیوسته جمع‌آوری نشود مگر اینکه قابلیت مشخصی واقعاً به آن نیاز داشته باشد و رضایت و چرخه‌ی نگه‌داری آن تعریف شده باشد.

## تست و معیارهای پذیرش

جریان‌های پرریسک باید قبل از گسترش پوشش داده شوند:

- اتصال کارت به خانواده و جلوگیری از اتصال تکراری؛
- شارژ، مصرف، برگشت، webhook تکراری و retry پیام؛
- تفکیک اعتبار خریداری‌شده، هدیه، امتیاز و کوپن؛
- تفاوت دسترسی مشتری، صندوق‌دار، اپراتور و مدیر شعب مختلف؛
- تحویل دوباره‌ی RabbitMQ، Dead Letter و بازگشت مصرف‌کننده؛
- Outbox و inbox در قطع ارتباط کوتاه با RabbitMQ؛
- همگام‌سازی تکرارشونده‌ی رخداد دستگاه و نمایش زمان آخرین همگام‌سازی؛
- اتصال و reconnect Socket.IO و عدم نشت رویداد بین خانواده‌ها یا شعب؛
- مسیر اصلی PWA در مرورگرهای موبایل و دسترس‌پذیری RTL؛
- آزمون بازیابی PostgreSQL و سنجش تأخیر واقعی سرویس کارت و درگاه.

شاخص‌های مهم پایلوت شامل موفقیت همگام‌سازی کارت، درصد اتصال کارت به خانواده، خطاهای موجودی، تأخیر رویداد داخلی، نرخ تحویل پیامک و تعداد خطاهای مجوز شعبه است.

## فناوری‌های موکول‌شده به آینده

این موارد تا زمانی که داده و بار واقعی نیازشان را ثابت نکرده‌اند، جزو وابستگی‌های اولیه نیستند:

- Kafka یا NATS JetStream، مگر اینکه Runflare برای آن سرویس رسمی یا مسیر خارجی پایدار تأیید کند؛
- ClickHouse یا ابزار BI سنگین برای زمانی که گزارش‌های PostgreSQL عملیاتی را تحت فشار بگذارند؛
- Kubernetes مدیریت‌شده توسط تیم پروژه؛
- Go برای agent محلی فقط در صورت نیاز واقعی به TCP، SDK سخت‌افزار یا پروتکل خاص؛
- Python برای تحلیل یا ML پس از جمع‌شدن داده‌ی باکیفیت؛
- GraphQL، اپ native، Elasticsearch و رزرو/صف مجازی تا وقتی use case و بار آن‌ها روشن شود.

## جمع‌بندی انتخاب‌ها

**از روز اول:** Next.js، TypeScript، NestJS/Fastify، REST/OpenAPI، PostgreSQL، Prisma، RabbitMQ، JSON Schema/AsyncAPI، Outbox و inbox، مصرف‌کننده‌ی idempotent، Socket.IO، OTP، source monorepo، دو runtime deployment repository برای Runflare، Dockerfile/supervisor، لاگ ساخت‌یافته، Playwright و اتصال خواندنی به سامانه‌ی کارت.

**پس از اثبات نیاز در پایلوت:** Redis برای cache، rate limit و fan-out چندنمونه‌ای؛ فضای S3-compatible برای فایل؛ Notifications و Read Model مستقل؛ و تفکیک schema یا PostgreSQL سرویس‌های پرترافیک.

**با رشد واقعی سیستم:** Kafka یا NATS خارجی، ClickHouse، agent محلی Go، BI پیشرفته و replicaهای بیشتر؛ فقط بر اساس سنجه‌های بار، تأخیر، حجم رویداد و هزینه‌ی Runflare.

## منابع بررسی‌شده

- [صفحه‌ی اصلی Runflare و فهرست فریم‌ورک‌ها و سرویس‌های داده](https://runflare.com/)
- [شروع به کار، پروژه، سرویس و مفهوم Deployment](https://runflare.com/docs/get-started/)
- [سرویس Docker و اتصال GitHub/GitLab](https://runflare.com/%D9%87%D8%A7%D8%B3%D8%AA-%D8%A7%D8%A8%D8%B1%DB%8C-docker/)
- [ایجاد سرویس و تخصیص منابع](https://runflare.com/docs/create-service/)
- [پایگاه داده PostgreSQL و اتصال داخلی](https://runflare.com/docs/postgres/)
- [تنظیم WebSocket/Socket.IO روی دامنه](https://runflare.com/docs/how-to-setup-websocket/)
- [استقرار با CLI](https://runflare.com/docs/work-with-cli/cli-deploy/)
- [مشاهده‌ی لاگ سرویس](https://runflare.com/docs/work-with-cli/service-log/)
- [شرایط و محدودیت‌های Backup و سرویس رایگان](https://runflare.com/docs/terms/)
