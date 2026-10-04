# ADR-0016: بسته‌بندی دوگانه‌ی runtime برای frontend و backend

- وضعیت: accepted
- تاریخ: 2026-10-03
- دامنه: مرز image، repository استقرار و process در Runflare
- تصمیم قبلیِ superseded: بخش «یک deployment repository برای هر آیتم» در ADR-0002 و نگاشت ۱۲ موردی آن

## مسئله و زمینه

۱۲ آیتم اجرایی فعلی در Runflare، هزینه‌ی تنظیم، انتشار و نگه‌داری زیادی دارند. سورس در عین حال یک monorepo است و سه وب‌اپ، دو gateway و هفت worker را با workspace و packageهای مشترک نگه می‌دارد. خواسته‌ی عملیاتی این است که فقط دو repository و دو سرویس application در Runflare باقی بماند: یکی برای frontend و دیگری برای backend.

این تجمیع مرز کد و داده‌ی دامنه را تغییر نمی‌دهد. API Gateway و هشت backend دیگر همچنان entrypoint، پورت، متغیر محیطی، telemetry، قرارداد و مالکیت داده‌ی مستقل دارند. سه Next.js نیز سه برنامه‌ی مستقل می‌مانند. PostgreSQL، RabbitMQ و Redis در آیتم‌های داده‌ای جداگانه باقی می‌مانند و Git repository ندارند.

## گزینه‌های بررسی‌شده

1. حفظ ۱۲ application deployment فعلی؛
2. یک deployment برای همه‌ی برنامه‌ها؛
3. دو runtime bundle، frontend و backend، با چند process مدیریت‌شده در هر container؛
4. جابه‌جایی سرویس‌ها به یک app واحد یا اتصال مستقیم monorepo به چند build root.

## تصمیم

گزینه‌ی ۳ انتخاب می‌شود:

- source اصلی یک Git repository در ریشه‌ی `Funtino` است؛ این همان monorepo منبع حقیقت و ورودی تحلیل GitNexus خواهد بود.
- دو خروجی self-contained و دو Git repository مستقل، در siblingهای source ساخته می‌شوند: `funtino-frontend-runtime` و `funtino-backend-runtime`.
- runtime frontend سه process را اجرا می‌کند: `customer-web` روی 3000، `operations-web` روی 3001 و `system-web` روی 3002.
- runtime backend نه process را اجرا می‌کند: API Gateway روی 4000، Realtime Gateway روی 4010، Device Integration روی 4020، Notifications روی 4030، Identity & Access روی 4040، Organization & Branch روی 4050، Analytics Read Model روی 4060، Wallet روی 4070 و Customer & Household روی 4080.
- هر bundle یک supervisor صریح دارد. اگر هر child خارج شود، supervisor باقی childها را متوقف می‌کند و با کد غیرصفر خارج می‌شود تا restart و health failure در سطح کل bundle دیده شود. restart loop داخلی پنهان ساخته نمی‌شود.
- Supervisor ترتیب manifest را رعایت می‌کند و process بعدی را فقط پس از پاسخ HTTP موفق readiness قبلی شروع می‌کند. Backend ابتدا پنج Worker دارای migration startup را بالا می‌آورد؛ processهای وابسته بعد از آن‌ها و API Gateway عمومی در آخر شروع می‌شوند. شکست readiness یا پایان مهلت هر process، startup کل bundle را fail-closed می‌کند.
- Dockerfile هر repository مستقل، root اجرایی، install/build/start و health check را تعیین می‌کند؛ هر دو image روی Node.js 22 و pnpm 10.12.4 pin می‌شوند.
- هر child فقط کلیدهای محیطی allow-list شده‌ی خودش را می‌گیرد. `NEXT_PUBLIC_*` فقط برای build فرانت است؛ secretهای backend فقط runtime environment هستند.
- پنج Worker مشخص‌شده در ADR-0015 فقط با runner فعلی و پیش از شروع app migration اجرا می‌کنند. API Gateway، Realtime، Device و Notifications migration را در startup اجرا نمی‌کنند.
- HTTPS برای endpointهای عمومی و hostnameهای production برقرار می‌ماند. ارتباط داخلی processهای Backend از ClusterIP خصوصی Runflare و نام/Port واقعی ثبت‌شده در Runflare استفاده می‌کند، طبق validation محدود ADR-0018؛ hostname سفارشی حدسی قابل استفاده نیست.
- مرحله‌ی گذار، rollback و حذف ۱۲ item قدیمی را خودکار نمی‌کند. itemها تا تکمیل route، environment، migration، smoke و rollback واقعی حفظ می‌شوند.

## پیامدها و trade-offها

### مزایا

- مدیریت release و repository به دو خروجی کاهش می‌یابد و appها/packageهای مشترک در source یکپارچه می‌مانند.
- یک release frontend همه‌ی سه UI را هماهنگ می‌کند؛ release backend همه‌ی producerها و consumerهای داخلی را از یک source revision بسته‌بندی می‌کند.
- routeهای چندپورت Runflare امکان اتصال domain به target port و شبکه‌ی داخلی برای processهای داخل یک سرویس را فراهم می‌کند.

### هزینه‌ها و محدودیت‌ها

- هر process داخل bundle با همان container، image، سقف منابع، چرخه‌ی restart و پنجره‌ی deployment شریک است. CPU/memory contention و خرابی یک process می‌تواند کل bundle را restart کند.
- environment allow-list فقط جلوی نشت اتفاقی config را می‌گیرد؛ processهای یک container با UID مشترک مرز امنیتی قوی در برابر process compromised ندارند. هر bundle یک trust domain مشترک است.
- scale کردن یکی از processها مستقل ممکن نیست؛ replica کردن bundle، هر سه frontend یا هر ۹ backend را با هم تکثیر می‌کند. باید idempotency، session، WebSocket، queue consumer concurrency و database poolها در pilot بررسی شوند.
- Runflare باید برای هر item شبکه‌های ClusterIP و اتصال domain به شبکه‌ی منتخب را در پنل واقعی تأیید کند. endpointهای عمومی HTTPS می‌خواهند؛ فقط مسیر Gateway به Identity & Access می‌تواند مطابق ADR-0017 از alias خصوصی ClusterIP روی HTTP/Port 80 استفاده کند. loopback، NodePort یا HTTP به hostname عمومی جایگزین این مسیر نیست.
- یک release backend واحد، rollback همه‌ی backend processها را با هم انجام می‌دهد. سازگاری schema و قرارداد باید پیش از rollout تضمین شود.
- کاهش itemها نباید باعث ادغام schema، credential، permission، queue ownership یا منبع حقیقت سرویس‌ها شود.

## سرویس‌ها و بسترهای اثرپذیرفته

- frontend: `customer-web`, `operations-web`, `system-web`, `design-system`؛
- backend: API Gateway، Realtime Gateway و هفت service موجود، `backend-core`، `event-contracts` و runner migration فعلی؛
- داده: PostgreSQL، RabbitMQ و Redis همچنان سرویس‌های مستقل Runflare هستند؛
- repositoryها: source monorepo و دو deployment snapshot مستقل.

## برنامه‌ی گذار و rollback

1. دو manifest پردازه، supervisor، health check، Dockerfile و snapshot exporter از source نگه‌داری شوند.
2. دو snapshot محلی ساخته و با Git مستقل مقداردهی شوند؛ این کار به‌تنهایی انتشار یا اتصال Runflare نیست.
3. پیش از تغییر ترافیک، برای frontend هر سه دامنه/پورت و برای backend هفت route داخلی + دو route عمومی/بلادرنگ در Runflare تنظیم شوند؛ endpointهای عمومی با HTTPS و WebSocket و مسیرهای داخلی با ClusterIP name/Port ثبت‌شده و smoke سرویس‌به‌سرویس تأیید شوند.
4. secrets هر child طبق allow-list در Environment/Secret همان item تنظیم شوند. migration jobهای خارج از ADR-0015 پیش از انتشار app جدا اجرا شوند.
5. cutover مرحله‌ای انجام شود و ۱۲ item پیشین تا تأیید سلامت و rollback حفظ شوند.
6. rollback با برگرداندن domain/route به itemهای پیشین یا redeploy snapshot قبلی انجام می‌شود. حذف itemهای قدیمی فقط پس از دوره‌ی پایدار و تأیید backup/restore مجاز است.

## مستندات مرتبط

- [ADR-0002](0002-runflare-deployment-repositories.md)
- [ADR-0015](0015-worker-startup-migrations.md)
- [ADR-0017](0017-runflare-clusterip-service-urls.md)
- [ساختار repository](../FolderAndFileStructure.md)
- [قواعد پیاده‌سازی](../ImplementationRules.md)
- [راهبرد repository و Runflare](../RunflareRepositoryAndDeployment.md)
- [workflow انتشار](../CommitPushAndDeploymentWorkflow.md)
- [runbook دو runtime](../runbooks/GroupedRunflareRuntime.md)
