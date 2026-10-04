# Runbook دو runtime bundle فانتینو

این سند شیوه‌ی ساخت و استقرار دو repository اجرایی را مشخص می‌کند. تغییر تعداد Runflare item یا ترافیک production نیازمند دسترسی به حساب Runflare و گیت‌های cutover است؛ این runbook به‌تنهایی اثبات اتصال یا انتشار نیست.

## ۱. محدوده‌ی خروجی

| Repository / item                           | Container processها                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| funtino-frontend-runtime / Funtino Frontend | Customer Web :3000، Operations Web :3001، System Web :3002                                                                                                           |
| funtino-backend-runtime / Funtino Backend   | API :4000، Realtime :4010، Device :4020، Notifications :4030، Identity :4040، Organization & Branch :4050، Analytics :4060، Wallet :4070، Customer & Household :4080 |

PostgreSQL، RabbitMQ و Redis همچنان itemهای داده‌ای مستقل‌اند. تعداد workerها و schemaهای مستقل تغییری نمی‌کند.

## ۲. ساخت محلی و Git

Source repository در D:\Tiam\Projects\Mohammadiig\Funtino است. دو خروجی sibling در D:\Tiam\Projects\Mohammadiig\Funtino-deployments قرار می‌گیرند و هر خروجی Git مستقل خودش را دارد. هیچ‌کدام submodule یا nested repository source نیست.

فرمان exporter:

- node scripts/deployment/export-runflare-bundles.mjs frontend
- node scripts/deployment/export-runflare-bundles.mjs backend
- node scripts/deployment/export-runflare-bundles.mjs all

Exporter قبل از sync وجود package.json، Dockerfile، .dockerignore، lockfile، manifest و فایل‌های runtime را بررسی می‌کند. اگر مقصد فایل تغییرکرده، staged یا اضافه داشته باشد متوقف می‌شود؛ snapshot آن فایل‌ها را overwrite نمی‌کند. اگر destination به origin وصل شده باشد، release باید صریحاً با `--release` انجام شود؛ exporter ابتدا working tree پاک، fetch روی main و divergence برابر 0 0 را لازم دارد. این حالت فقط snapshot را آماده می‌کند و commit/push ندارد.

## ۳. Docker build و process lifecycle

هر Dockerfile:

- از Node.js 22 و pnpm 10.12.4 استفاده می‌کند؛
- در backend، openssl را برای Prisma 6 نصب می‌کند؛
- از root snapshot نصب قفل‌شده انجام می‌دهد؛
- همه‌ی packageهای manifest‌شده را build می‌کند؛
- container را با کاربر non-root راه می‌اندازد؛
- healthcheck دارد و command شروع آن supervisor همان bundle است.

Supervisor childها را به ترتیب manifest و تک‌به‌تک بالا می‌آورد و برای هر process تا پاسخ موفق endpoint readiness آن صبر می‌کند. Backend پنج Worker دارای migration startup را قبل از بقیه آماده می‌کند و API Gateway آخر شروع می‌شود. timeout یا شکست readiness، خطای start یا خروج هر child باعث توقف graceful سایر childها و exit غیرصفر supervisor می‌شود. restart داخلی per-child وجود ندارد تا health/failure در item گم نشود. SIGTERM و SIGINT به childها forward می‌شود؛ shutdown timeout بعد از آن childهای مانده را kill می‌کند.

Healthcheck ریشه endpointهای HTTP readiness همه‌ی processها را probe می‌کند؛ backendها از `/health/ready` و Next.jsها از `/` استفاده می‌کنند (redirect رابط نیز پاسخ آماده محسوب می‌شود). مهلت startup پیش‌فرض هر Worker در backend سه دقیقه است و چهار process غیرمهاجر یک دقیقه؛ Docker start-period backend برابر ۲۰ دقیقه است تا پنج migration ترتیبی فرصت اجرا داشته باشند. frontend برای هر app یک دقیقه و start-period چهار دقیقه دارد. readiness endpoint سلامت وابستگی‌های تعریف‌شده‌ی همان app را می‌سنجد؛ health/telemetry دامنه‌ای نیز باید پایش شود.

## ۴. Environment و secret

Supervisor به هر child فقط process environment allow-list شده‌ی همان process را می‌دهد، به‌علاوه‌ی کلیدهای غیرsecret لازم برای runtime مانند PATH، HOME، NODE_ENV و APP_VERSION. PORT عمومی پلتفرم به childها forward نمی‌شود تا Analytics روی port 4060 باقی بماند. این allow-list مانع نشت اتفاقی بین processهاست؛ چون childها در یک container و با یک UID اجرا می‌شوند، مرز امنیتی در برابر process مخرب/compromised محسوب نمی‌شود و هر دو bundle یک trust domain مشترک‌اند.

### Frontend

- NEXT_PUBLIC_API_BASE_URL=https://api.funtino.ir
- NEXT_PUBLIC_DATA_MODE=api

این دو مقدار هنگام Docker build به Next.js داده می‌شوند و در bundle کلاینت embed می‌شوند. مقدار آن‌ها secret نیست. هر تغییر نیازمند build تازه است. Next processها برای runtime فقط تنظیمات مشترک غیرمحرمانه لازم را می‌گیرند.

### Backend

Backend item محیط مجموع هر ۹ process را در پنل نگه می‌دارد اما supervisor متغیرها را به allow-list child جدا می‌کند. فهرست کلیدها در manifest backend و .env.example همان snapshot canonical است. جدول خلاصه:

| Process               | متغیرهای اختصاصی/secret اصلی                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Gateway           | API*PORT، API_METRICS_TOKEN، CORS_ORIGINS، API_BASE_URL، STORAGE_MODE، DATABASE_URL، RABBITMQ_URL، REDIS_URL، PROMETHEUS_INTERNAL_URL، SESSION_COOKIE_DOMAIN، EXPOSE_DEV_OTP، PARSGREEN*\*، URL و tokenهای IAM، Organization & Branch، Device، Wallet، Customer & Household و Analytics |
| Realtime              | REALTIME_PORT، REALTIME_METRICS_TOKEN، CORS_ORIGINS، API_BASE_URL، RABBITMQ_URL                                                                                                                                                                                                         |
| Device                | DEVICE*PORT، DEVICE_INTEGRATION*_، ORGANIZATION*BRANCH_INTERNAL_URL، tokenهای device/org، RABBITMQ_URL، DEVICE_HEALTH*_ و credential اتصال DB مالک خودش                                                                                                                                 |
| Notifications         | NOTIFICATIONS_PORT، NOTIFICATIONS_METRICS_TOKEN، RABBITMQ_URL                                                                                                                                                                                                                           |
| Identity & Access     | IDENTITY*ACCESS*\*، کلیدهای MFA/lookup، ORGANIZATION_BRANCH_URL، tokenهای داخلی، RABBITMQ_URL و URLهای DB مالک خودش                                                                                                                                                                     |
| Organization & Branch | ORGANIZATION*BRANCH*\*، tokenهای مصرف‌کننده، RABBITMQ_URL و URLهای DB مالک خودش                                                                                                                                                                                                         |
| Analytics Read Model  | ANALYTICS*\*، DEVICE_HEALTH*\*، RABBITMQ_URL و URLهای DB مالک خودش                                                                                                                                                                                                                      |
| Wallet                | WALLET\_\*، URLهای خصوصی Organization & Branch و Customer & Household، RABBITMQ_URL و URLهای DB مالک خودش                                                                                                                                                                               |
| Customer & Household  | CUSTOMER*HOUSEHOLD*\*، tokenهای داخلی، RABBITMQ_URL و URLهای DB مالک خودش                                                                                                                                                                                                               |

جزئیات کامل نام متغیرها در .env.example هر app/service source و env allow-list قابل اجرا در manifest قرار دارد. هیچ مقدار runtime واقعی را در مستند، Git یا build argument قرار نده. Runflare Secret را برای credential، URL دیتابیس/queue، token، کلید رمزنگاری، secret webhook و Parsgreen استفاده کن. تغییر متغیر محیطی باعث restart سرویس می‌شود؛ مقدار و زمان تغییر باید release log شود. [راهنمای Environment Variable در Runflare](https://runflare.com/docs/setup-environment-variable/)

DATABASE_MIGRATION_URL در API Gateway migration job فقط است و به process API runtime داده نمی‌شود. پنج Worker استثنایی طبق ADR-0015 هرکدام فقط migration URL و runtime URL schema مالک خود را به runner می‌دهند. migration credential هرگز بین processها share نمی‌شود.

## ۵. Network, domain و TLS

Runflare network settings می‌تواند چند network را برای یک سرویس ثبت کند. Port بیرونی به Target Port داخل container می‌رود و domain می‌تواند به network انتخابی متصل شود. از ClusterIP برای مسیرهای داخلی استفاده کن و NodePort مستقیم را برای production قرار نده. [راهنمای Network Settings Runflare](https://docs.runflare.com/general/network-settings/)

### Frontend item

| Domain           | Target port | دسترسی |
| ---------------- | ----------: | ------ |
| app.funtino.ir   |        3000 | عمومی  |
| web.funtino.ir   |        3001 | عمومی  |
| admin.funtino.ir |        3002 | عمومی  |

### Backend item

| Domain/route                      | Target port | دسترسی                          |
| --------------------------------- | ----------: | ------------------------------- |
| api.funtino.ir                    |        4000 | عمومی                           |
| realtime.funtino.ir               |        4010 | عمومی؛ WebSocket/Socket.IO فعال |
| device integration private route  |        4020 | داخلی                           |
| notifications private route       |        4030 | داخلی                           |
| identity access private route     |        4040 | داخلی                           |
| organization branch private route |        4050 | داخلی                           |
| analytics private route           |        4060 | داخلی                           |
| wallet private route              |        4070 | داخلی                           |
| customer household private route  |        4080 | داخلی                           |

قبل از rollout، برای هر route ثبت کن: Runflare network name، external Port، Target Port، domain/hostname، ClusterIP یا public exposure، TLS mode و مصرف‌کنندگان. URLهای خصوصی باید همچنان HTTPS باشند چون برخی clientها در production HTTP را رد می‌کنند. مستند عمومی network امکان انتقال پورت/انتخاب network را توضیح می‌دهد اما گواهی HTTPS داخلی و تعداد مجاز network را برای حساب خاص اثبات نمی‌کند. تا مشاهده‌ی TLS معتبر، پاسخ DNS درست از همان network و اتصال end-to-end، مسیرهای production service-to-service تغییر نکنند.

فقط API، Realtime و سه web app exposure عمومی می‌گیرند. Worker network عمومی یا NodePort نمی‌گیرد. Realtime Socket.IO روی domain خودش فعال شود. [تنظیم WebSocket در Runflare](https://runflare.com/docs/how-to-setup-websocket/)

## ۶. Migration

| Process               | رفتار startup                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Organization & Branch | runner ADR-0015                                                                                                         |
| Identity & Access     | runner ADR-0015: validate، اتصال bootstrap به `public`، create owner schema، migrate deploy روی schema اختصاصی، سپس app |
| Customer & Household  | runner ADR-0015                                                                                                         |
| Wallet                | runner ADR-0015                                                                                                         |
| Analytics Read Model  | runner ADR-0015                                                                                                         |
| Device Integration    | بدون migration در startup؛ job مالک جدا                                                                                 |
| Notifications         | migration ندارد                                                                                                         |
| Realtime Gateway      | migration ندارد                                                                                                         |
| API Gateway           | بدون migration در startup؛ migration job جدا؛ آخرین process برای آماده‌سازی route عمومی                                 |

Runner فعلی فقط همان پنج Worker را قبول می‌کند و stage شکست را با log ساخت‌یافته گزارش می‌دهد. پیش از اجرای Prisma، ابتدا DNS و سپس دسترسی TCP به پورت URL migration همان Worker با مهلت ۵ ثانیه بررسی می‌شود؛ این probe اعتبارنامه نمی‌فرستد و اتصال دیتابیس یا مجوز SQL را تأیید نمی‌کند. برای رفع وابستگی bootstrap به schema هنوز ساخته‌نشده، `prisma/bootstrap.prisma` فقط به `public` موجود وصل می‌شود و SQL نام schema مالک را صریح می‌سازد؛ بعد `prisma/schema.prisma` اصلی و URL دارای `schema=<owner>` برای migrationهای نسخه‌دار استفاده می‌شوند. URL هر مرحله در صورت نداشتن `application_name` یک نام `funtino-<worker>-<phase>` می‌گیرد تا نشست‌های احراز‌شده‌ی PostgreSQL قابل تشخیص باشند. دستور دستی `prisma:schema` همان runner را در حالت `--bootstrap-only` فراخوانی می‌کند تا منطق URL bootstrap یکسان بماند. هر Worker URL دیتابیس/credential migration مالک خودش را به کار می‌برد. در rollout نخست replica را یکی نگه دار تا رفتار startup و زمان migration روشن شود. برای API Gateway و Device Integration job/command یک‌باره‌ی release اجرا کن و compatibility/rollback آن را ثبت کن.

برای تشخیص مرحله از Runflare log استفاده کن:

- `service.database.dns_lookup.failed`: hostname همان URL migration resolve نشده؛ network attachment و نام سرویس داخلی را بررسی کن.
- `service.database.dns_lookup.completed` سپس `service.database.tcp_connect.failed`: نام داخلی resolve شده ولی TCP به port باز نشده؛ service/network attachment و mapping عددی port به targetPort را بررسی کن. کدهای معمول `ECONNREFUSED`، `ETIMEDOUT` و `ENETUNREACH` مسیرهای متفاوتی را نشان می‌دهند.
- `service.database.tcp_connect.completed`: TCP باز است؛ اگر `create_schema` شکست خورد، مرحله‌ی بعدی احراز هویت، نام database، PostgreSQL protocol یا مجوز DDL است و خروجی redacted Prisma را بررسی کن.
- برای دیدن نشست‌های migration در زمان startup، از pgAdmin این query فقط‌خواندنی را اجرا کن:

```sql
SELECT application_name, client_addr, state, wait_event_type, wait_event,
       now() - backend_start AS connected_for
FROM pg_stat_activity
WHERE datname = 'postgresquk_db'
  AND application_name LIKE 'funtino-%'
ORDER BY backend_start;
```

هیچ ردیفی یعنی نشست احراز‌شده‌ای با این نام هنگام query موجود نبوده؛ خود TCP preflight هم عمداً کوتاه و بدون login است و در این جدول ردیف نمی‌سازد. بنابراین برای نتیجه‌ی TCP، eventهای `service.database.tcp_connect.*` را ببین و برای migration/احراز هویت از خروجی Prisma استفاده کن.

## ۷. Cutover

1. دو Runflare Docker item را از branch مربوط به دو snapshot وصل کن؛ repository source مستقیم متصل نشود.
2. ابتدا منابع هر item را برآورد کن. Backend ۹ process، Prisma poolها و هم‌زمانی مصرف‌کنندگان queue را با بار واقعی بسنج؛ هیچ process به‌صورت مستقل scale نمی‌شود.
3. Environment/Secret را بر پایه‌ی allow-list‌ها وارد کن؛ URL خصوصی HTTPS، health token، CORS و cookie domain را با hostname واقعی همان محیط هماهنگ کن.
4. هفت internal route، دو route عمومی backend و سه route frontend را بساز؛ WebSocket Realtime را فعال کن.
5. image build/start، health هر ۱۲ process، API، سه web، اتصال workerها به RabbitMQ/DB، HTTPS بین backendها، session/CORS، Socket.IO reconnect و telemetry را در staging بررسی کن.
6. backup PostgreSQL و restore واقعی را قبل از تغییر production domain آماده کن.
7. routeها را مرحله‌ای عوض کن و error rate، latency، CPU/RAM، queue lag، DB pool و restarts را بسنج.
8. تا پایان rollback window هر ۱۲ item قدیمی را روشن/قابل بازگشت نگه دار. هر کدام فقط پس از صحت backup، route و rollback قابل حذف است.

یک crash/restart در Backend کل ۹ process را هم‌زمان تحت تأثیر می‌گذارد؛ restart فرانت هر سه web را جابه‌جا می‌کند. Replica جدید Backend همه‌ی Worker consumerها را هم تکثیر می‌کند. این trade-off باید در پایلوت پذیرفته شود؛ اگر مسئله‌ساز بود، تعداد process/item باید با ADR جدید بازنگری شود.

## ۸. Rollback و incident

- failure در یک process یعنی health کل bundle ناموفق است؛ supervisor childهای باقی‌مانده را متوقف می‌کند. ابتدا exit event و علت child را از logها پیدا کن.
- migration worker fail-closed می‌شود و همان process app را start نمی‌کند. migration history را دستی پاک/resolve نکن؛ log و وضعیت DB owner را بررسی کن.
- برای rollback، snapshot/image قبلی همان bundle را redeploy یا domain/network را به item قدیمی برگردان.
- schema rollback خودکار نیست؛ تغییرات داده‌ای نیازمند migration rollback/forward-fix مستند است.
- secret در log یا گزارش قرار نگیرد.

## ۹. وضعیت اتصال

Source monorepo و دو snapshot runtime در GitHub روی branch `main` commit و push شده‌اند؛ هر snapshot source revision خود را در `.funtino-snapshot.json` ثبت می‌کند. اتصال دو repository به Runflare، Auto Pull/webhook، network/domain/TLS، Environment/Secret و health واقعی باید در پنل تأیید شود. تا پایان staging و cutover، ۱۲ آیتم قدیمی و database/queue/cacheهای جدا را برای rollback نگه دار.
