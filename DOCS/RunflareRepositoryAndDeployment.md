# راهبرد repository و استقرار Runflare فانتینو

## تصمیم فعلی

ADR-0016 نگاشت ۱۲ application deployment قبلی را با دو runtime bundle جایگزین کرده است. این تصمیم تنها تعداد imageهای برنامه را تغییر می‌دهد؛ سه frontend، دو gateway و هفت worker همچنان processها و مرزهای منطقی جدا دارند.

| لایه             | repository / item                 | محتوا                                                                               |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| Source           | ریشه‌ی Funtino در Git محلی        | monorepo کامل؛ منبع تغییر و ورودی GitNexus                                          |
| Frontend runtime | funtino-frontend-runtime          | customer-web، operations-web، system-web و design-system؛ سه process                |
| Backend runtime  | funtino-backend-runtime           | دو gateway، هفت service، backend-core، event-contracts و startup runner؛ نه process |
| Data             | itemهای جدا در Runflare، بدون Git | PostgreSQL، RabbitMQ و Redis                                                        |

دو deployment repository کنار source و به‌صورت Git repository مستقل قرار می‌گیرند؛ داخل source submodule یا nested repository نیستند. Snapshot از source ساخته می‌شود و محل توسعه‌ی feature نیست. وجود Git محلی یا snapshot به‌تنهایی remote، GitHub، Auto Pull یا اتصال Runflare را ایجاد نمی‌کند.

ADR-0002 تصمیم اولیه‌ی یک repository به‌ازای هر item را ثبت می‌کند؛ نگاشت آن بخش اکنون historical است و ADR-0016 تصمیم جاری را مشخص می‌کند. ۱۲ repository و item فعلی تا پایان cutover و rollback window حفظ می‌شوند.

## مرز process، port و routing

| Bundle   | Process               | Port | Routing هدف                                       |
| -------- | --------------------- | ---: | ------------------------------------------------- |
| Frontend | Customer Web          | 3000 | app.funtino.ir                                    |
| Frontend | Operations Web        | 3001 | web.funtino.ir                                    |
| Frontend | System Web            | 3002 | admin.funtino.ir                                  |
| Backend  | API Gateway           | 4000 | api.funtino.ir، عمومی                             |
| Backend  | Realtime Gateway      | 4010 | realtime.funtino.ir، عمومی با Socket.IO/WebSocket |
| Backend  | Device Integration    | 4020 | شبکه‌ی داخلی                                      |
| Backend  | Notifications         | 4030 | شبکه‌ی داخلی                                      |
| Backend  | Identity & Access     | 4040 | شبکه‌ی داخلی                                      |
| Backend  | Organization & Branch | 4050 | شبکه‌ی داخلی                                      |
| Backend  | Analytics Read Model  | 4060 | شبکه‌ی داخلی                                      |
| Backend  | Wallet                | 4070 | شبکه‌ی داخلی                                      |
| Backend  | Customer & Household  | 4080 | شبکه‌ی داخلی                                      |
| Backend  | Forms                 | 4090 | شبکه‌ی داخلی                                      |

هر process روی port فعلی خودش و host برابر 0.0.0.0 گوش می‌دهد. برای هر target port باید network/route مختص همان process ساخته شود و هر domain به network متناظر وصل شود. مستند Runflare امکان افزودن چند network، انتقال Port به Target Port و اتصال domain به network انتخاب‌شده را توضیح می‌دهد؛ نام دقیق network و mapping پورت باید از حساب واقعی ثبت شود. NodePort مستقیم برای ارتباط backend production انتخاب نشود. [تنظیمات شبکه‌ی Runflare](https://docs.runflare.com/general/network-settings/)

API Gateway، Realtime و سه وب‌اپ route عمومی دارند. هفت worker از اینترنت عمومی route نمی‌گیرند. ارتباط HTTP بین processهای Backend از ClusterIP خصوصی مقصد و Port 80 انجام می‌شود؛ URL هر متغیر باید نام دقیق همان Network از پنل Runflare را داشته باشد. در production فقط HTTPS یا `http://<single-label-ending-in--service>:80` بدون credential/path/query/fragment مجاز است و redirect درخواست‌های دارای service token دنبال نمی‌شود. برای مثال، اگر ClusterIP هویت `http:80 -> 4040` را نشان دهد، `IDENTITY_ACCESS_URL` برابر `http://<exact-identity-network-name>:80` است؛ همین قاعده برای Organization & Branch، Customer & Household، Wallet، Device Integration و Analytics در متغیرهای داخلی مربوط اعمال می‌شود. نام `.internal.funtino.ir` تا وقتی DNS و TLS واقعی ندارد استفاده نشود. NodePort و localhost جایگزین ClusterIP نیستند. آدرس‌های عمومی HTTPS می‌مانند. جزئیات در [ADR-0018](decisions/0018-backend-clusterip-service-urls.md) آمده است. Realtime برای دامنه‌ی خودش نیاز به فعال‌بودن Socket.IO/WebSocket دارد. [راهنمای WebSocket در Runflare](https://runflare.com/docs/how-to-setup-websocket/)

## ساخت و اجرای دو bundle

هر snapshot باید از root خودش self-contained باشد و این‌ها را داشته باشد:

- package.json، pnpm-lock.yaml و pnpm-workspace.yaml متناسب با بسته‌های انتخاب‌شده؛
- Dockerfile و .dockerignore در root؛
- source، config، shared package و generated migration/client لازم؛
- manifest پردازه، supervisor و healthcheck؛
- .env.example بدون مقدار محرمانه و README عملیاتی.

Dockerfileها Node.js 22 و pnpm 10.12.4 را pin می‌کنند. NEXT_PUBLIC_API_BASE_URL و NEXT_PUBLIC_DATA_MODE مقادیر build-time غیرمحرمانه‌اند و در image فرانت مصرف می‌شوند. secretهای backend فقط runtime environment همان Runflare item هستند؛ در build args، source یا image قرار نمی‌گیرند.

Supervisor برای هر bundle processها را به ترتیب manifest و تک‌به‌تک راه می‌اندازد؛ تا وقتی endpoint HTTP readiness یک process پاسخ موفق ندهد، بعدی شروع نمی‌شود. Backend ابتدا پنج Worker دارای migration startup را آماده می‌کند، سپس processهای دیگر را بالا می‌آورد و API Gateway را آخر شروع می‌کند تا ترافیک عمومی زودتر از سرویس‌هایش پذیرفته نشود. Timeout یا شکست readiness و نیز خروج هر child کل bundle را fail می‌کند و childهای دیگر graceful متوقف می‌شوند؛ restart loop جداگانه یا فرایند zombie پنهان مجاز نیست. healthcheck کانتینر نیز endpoint readiness همه‌ی processها را کنترل می‌کند و جای telemetry دامنه را نمی‌گیرد.

Environment هر child از system environment محدود و allow-list همان process ساخته می‌شود. API Gateway نباید secretهای runtime سرویس‌های دیگر را بگیرد؛ migration URLهای Worker فقط در startup runner خود همان Worker حضور دارند. NODE_ENV و APP_VERSION مشترک‌اند. envهای public فرانت هنگام build تزریق می‌شوند، نه از Secret runtime.

### Environment خانواده و دعوت

- در process `api-gateway`، `CUSTOMER_FAMILY_PHONE_HASH_SECRET` را به‌صورت Secret مستقل و تصادفی با ۳۲ تا ۵۱۲ کاراکتر تنظیم کن و همان مقدار ثابت را به همه‌ی replicaهای Gateway بده. نبودن یا نامعتبر بودن آن، وضعیت `degraded` و `customerFamilyConfigured: false` را در `/health/ready` گزارش می‌کند؛ مسیرهای خانواده fail-closed می‌مانند تا processهای دیگر Gateway در دسترس بمانند. این کلید فقط HMAC شماره‌ی normalize‌شده‌ی دعوت‌های خانواده و match کردن inbox همان حساب را می‌سازد؛ به process Worker خانواده داده نمی‌شود. چرخاندن کلید، match دعوت‌های شماره‌ای ایجادشده با کلید قبلی را می‌شکند.
- در process `customer-household`، `CUSTOMER_FAMILY_UNREGISTERED_INVITATION_TTL_DAYS` عدد ۱ تا ۳۰ و پیش‌فرض ۷ است. این مقدار فقط لینک شماره‌ی ثبت‌نشده را کنترل می‌کند؛ invitation حساب ثبت‌شده expiry ندارد.
- توکن اشتراک دعوت با ۳۲ بایت CSPRNG ساخته می‌شود؛ `CUSTOMER_FAMILY_INVITATION_TOKEN_SECRET` وجود ندارد و لازم نیست. فقط SHA-256 توکن در دیتابیس ذخیره می‌شود.
- کلیدهای محیطی در `.env.example` و allow-list manifest هر process منعکس شده‌اند. مقدار secret را در Git، Docker build arg، image یا log قرار نده.

## مرز migration و داده

PostgreSQL، RabbitMQ و Redis همچنان itemهای مستقل‌اند. schema، credential، queue ownership و migration هر سرویس جدا می‌ماند.

طبق ADR-0015، فقط Identity & Access، Organization & Branch، Customer & Household، Wallet و Analytics Read Model migrationهای pending را با runner fail-closed پیش از شروع app اجرا می‌کنند. مرحله‌ی ساخت schema با `prisma/bootstrap.prisma` و URL موقت `schema=public` اجرا می‌شود؛ سپس schema اصلی Prisma و URL `schema=<owner>` migrationهای همان Worker را اعمال می‌کنند. این مسیر به API Gateway، Realtime، Device و Notifications تعمیم داده نمی‌شود.

Migrationهای خارج از این پنج Worker با job/فرمان نسخه‌دار مستقل و پیش از rollout app اجرا می‌شوند. deployment bundle به‌صورت ضمنی database migration نمی‌کند. ترتیب additive/expand-contract و rollback schema باید در release ثبت شود.

تغییر سیاست نشست، migration افزایشی `identity_access.policy_state.management_session_ttl_hours` را به Worker ‏Identity & Access اضافه می‌کند؛ طبق ADR-0015 هنگام startup همان Worker اعمال می‌شود. API Gateway و System Web باید با هم از snapshotهای backend و frontend منتشر شوند. پس از انتشار، role مدیر فعلی با CLI یک‌باره و TOTP به permission جدید مجهز می‌شود و `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` فقط در پنجره‌ی rollout مجاز، روی process مربوط به IAM در item بک‌اند تنظیم می‌شود؛ این گیت در image یا source باز نمی‌شود.

ADR-0025، هر الزام per-login MFA را supersede می‌کند و customer/management session را با audience و cookie جدا تعریف می‌کند. migration Gateway برای audience، رمز اختیاری و challengeهای مدیریت فقط با job نسخه‌دار Gateway اجرا می‌شود؛ startup migration جدید به هیچ Worker افزوده نمی‌شود. migration Gateway پیش از DDL، PostgreSQL 11+ را لازم می‌داند، روی انتظار lock پنج ثانیه و هر statement حداکثر ۱۲۰ ثانیه limit می‌گذارد و هیچ UPDATE سراسری نشست‌ها ندارد. پیش از job این مقدار را از اتصال مالک بخوان: `SELECT current_setting('server_version_num')::integer;`. نسخه‌ی پایین‌تر از 110000 باید پیش از rollout ارتقا یابد.

فرمان‌های مالکانه از snapshot backend:

```sh
pnpm --filter @funtino/api-gateway prisma:migrate
pnpm --filter @funtino/device-integration prisma:migrate
```

هر دو job باید URL/credential migration مستقل همان مالک را داشته باشند؛ Gateway از `DATABASE_MIGRATION_URL` و Device از `DEVICE_INTEGRATION_MIGRATION_DATABASE_URL` استفاده می‌کند. چون Prisma schema هر دو datasource URL را تعریف می‌کند، job باید هر دو متغیر URL را مقداردهی کند و آن‌ها را به همان database/schema مالک اشاره دهد؛ URL مستقیم migration با مجوز DDL استفاده می‌شود. این secretها فقط در محیط همان job قرار می‌گیرند و به process دائمی API Gateway یا Device Integration داده نمی‌شوند. اگر job شکست خورد یا timeout شد، rollout متوقف بماند؛ وضعیت Prisma و lockهای PostgreSQL بررسی شود و migration history خودکار resolve یا پاک نشود.

Wallet در فهرست پنج Worker از قبل مجازشده در ADR-0015 است؛ startup runner خودش migration نسخه‌دار Wallet را با `WALLET_MIGRATION_DATABASE_URL` و fail-closed اجرا می‌کند. برای این تغییر Worker جدیدی به runner اضافه نشود. schema audit reason در Forms از قبل nullable است و در این تغییر migration تازه‌ای ندارد. nullable-reason migrationهای Wallet و Device هر کدام حد انتظار lock پنج ثانیه و زمان statement برابر ۱۲۰ ثانیه دارند. تغییر auth/session در API Gateway و تمام OpenAPI/UIهای مصرف‌کننده هر دو snapshot backend و frontend را اثر می‌دهد؛ هیچ secret رمز یا hash به Docker build arg، image یا repository نمی‌رود.

Bootstrap مالک مقید به شماره طبق ADR-0021 است و migration تازه‌ای ندارد. تغییر CLI، Gateway endpoint داخلی و allow-listها فقط Backend bundle را اثر می‌دهد. در Runflare Backend، شماره‌ی مالک را در `SYSTEM_ADMIN_OWNER_PHONE_E164`، secret lookup را در `SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_TOKEN` و برای mutationهای عادی IAM، `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` را تنظیم کن؛ دستور نهایی user UUID نمی‌پذیرد و مقصد را از Gateway روی loopback می‌گیرد.

## اثر تغییر و انتشار

| تغییر source                                          | Runtimeهای لازم                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| یکی از سه web app یا design-system                    | Frontend                                                                  |
| یکی از دو gateway یا هفت service                      | Backend                                                                   |
| backend-core یا event-contracts                       | Backend                                                                   |
| package/config/contract مشترک میان backend و frontend | هر دو                                                                     |
| root toolchain، lockfile یا exporter مشترک            | هر دو، اگر خروجی snapshot آن‌ها تغییر کند                                 |
| فقط DOCS                                              | هیچ‌کدام، مگر Dockerfile/manifest/runtime config هم عوض شود               |
| migration                                             | job مالک و compatibility release؛ workerهای استثنای ADR-0015 پیش از start |

تا وقتی pipeline انتشار وجود ندارد، انتشار مجاز فقط controlled snapshot از source است. پیش از push برای هر repository باید remote fetch و divergence برابر 0 0 باشد، diff بررسی شود، stage با path روشن انجام شود و force-push ممنوع است. این task فقط snapshot و repository محلی را آماده می‌کند؛ push به GitHub و اتصال به Runflare بخش جداگانه‌ی انتشار است.

بعد از آماده‌شدن source remote و pipeline، pipeline با path filter bundleهای متأثر را کامل prune/build و به دو deployment repository push می‌کند. هر repository یک branch مشخص، ترجیحاً main، و Auto Pull همان item را دنبال می‌کند. Source commit، deployment commit و deployed image/revision جداگانه ثبت می‌شوند.

## گذار و rollback

1. ابتدا routeهای موازی پورت و domain در حساب Runflare ایجاد شوند؛ public HTTPS، ClusterIP name/Port خصوصی، WebSocket، CORS، callback و service-to-service smoke تأیید شوند.
2. متغیرهای هر child با allow-list به Runflare item مربوط وارد شوند؛ هیچ Secret از source کپی نشود.
3. startup و health تمام processها، منابع CPU/memory، database pool، queue consumer concurrency، session و reconnect Socket.IO در staging اندازه‌گیری شوند.
4. ابتدا route ترافیک کم‌ریسک تغییر کند و log/health/telemetry و backup/restore پایش شوند.
5. ۱۲ item قبلی تا پایان دوره‌ی rollback در دسترس بمانند. rollback یعنی تغییر route/domain به itemهای قبلی یا redeploy snapshot قبلی؛ حذف موردهای قدیمی خودکار نیست.

دو bundle سقف منابع و چرخه‌ی restart مشترک دارند. افزایش replica، کل bundle را تکثیر می‌کند و process منفرد را جداگانه scale نمی‌کند. اگر pilot نشان دهد queue/database contention یا بار UI این شکل را نامناسب می‌کند، ADR تازه لازم است؛ تعداد repository و process را یکی فرض نکن.

## اسناد مرجع

- [ADR-0016: دو runtime bundle](decisions/0016-grouped-frontend-backend-runtime-deployments.md)
- [قانون commit/push](CommitPushAndDeploymentWorkflow.md)
- [Runbook اجرایی دو runtime](runbooks/GroupedRunflareRuntime.md)
- [ADR-0015: migration پنج Worker](decisions/0015-worker-startup-migrations.md)
- [ADR-0022: فرم‌ساز و مالکیت پاسخ‌ها](decisions/0022-dynamic-forms.md)

### Forms

- `services/forms` یک process داخلی از `funtino-backend-runtime` و port آن `4090` است؛ snapshot باید manifest، supervisor، healthcheck، Dockerfile، `.dockerignore` و build check را همگام نگه دارد.
- `FORMS_DATABASE_URL` فقط به process Forms و `FORMS_API_GATEWAY_TOKEN` به Forms و API Gateway allow-list می‌شود. Gateway با `FORMS_URL` داخلی به سرویس متصل می‌شود. secretها runtime-only هستند.
- رابط مدیریت فرم برای ساخت پیوند عمومی از `NEXT_PUBLIC_CUSTOMER_WEB_URL` در build استفاده می‌کند؛ مقدار production برابر `https://app.funtino.ir` است و این تنظیم public است، نه secret.
- migrationهای schema در Forms، هرگاه لازم شوند، با job/فرمان نسخه‌دار و credential migration مستقل اجرا می‌شوند؛ startup migration برای Forms ممنوع است. تغییر فعلی در Forms migration دیتابیس ندارد؛ ستون audit reason از قبل nullable است و reason اصلاح پاسخ همچنان الزامی می‌ماند.
- هر تغییر API Gateway، Forms، `event-contracts` یا backend shared package روی Backend اثر دارد. تغییر `forms-schema`, `forms-renderer` یا UI روی Frontend هم اثر دارد؛ تغییر مشترک پیش از انتشار هر دو bundle را همگام می‌کند.
