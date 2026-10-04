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

هر process روی port فعلی خودش و host برابر 0.0.0.0 گوش می‌دهد. برای هر target port باید network/route مختص همان process ساخته شود و هر domain به network متناظر وصل شود. مستند Runflare امکان افزودن چند network، انتقال Port به Target Port و اتصال domain به network انتخاب‌شده را توضیح می‌دهد؛ نام دقیق network و mapping پورت باید از حساب واقعی ثبت شود. NodePort مستقیم برای ارتباط backend production انتخاب نشود. [تنظیمات شبکه‌ی Runflare](https://docs.runflare.com/general/network-settings/)

API Gateway، Realtime و سه وب‌اپ route عمومی دارند. هفت worker از اینترنت عمومی route نمی‌گیرند. برای اتصال Gateway به IAM، از نام ClusterIP خصوصی و Port نمایش‌داده‌شده در Runflare استفاده شود. اگر route آن `http:80 -> 4040` است، مقدار `IDENTITY_ACCESS_URL` برابر `http://<network-name>:80` خواهد بود؛ فقط alias تک‌برچسبی `*-service` روی پورت 80 مجاز است. این validation فعلاً فقط در `IdentityAccessClient` پیاده شده؛ URLهای دیگر backend را تا به‌روزرسانی client مربوطه به HTTP تغییر نده. نام `.internal.funtino.ir` تا وقتی در DNS واقعی تعریف نشده استفاده نشود. NodePort و localhost جایگزین ClusterIP نیستند. آدرس‌های عمومی HTTPS می‌مانند. Realtime برای دامنه‌ی خودش نیاز به فعال‌بودن Socket.IO/WebSocket دارد. [راهنمای WebSocket در Runflare](https://runflare.com/docs/how-to-setup-websocket/)

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

## مرز migration و داده

PostgreSQL، RabbitMQ و Redis همچنان itemهای مستقل‌اند. schema، credential، queue ownership و migration هر سرویس جدا می‌ماند.

طبق ADR-0015، فقط Identity & Access، Organization & Branch، Customer & Household، Wallet و Analytics Read Model migrationهای pending را با runner fail-closed پیش از شروع app اجرا می‌کنند. مرحله‌ی ساخت schema با `prisma/bootstrap.prisma` و URL موقت `schema=public` اجرا می‌شود؛ سپس schema اصلی Prisma و URL `schema=<owner>` migrationهای همان Worker را اعمال می‌کنند. این مسیر به API Gateway، Realtime، Device و Notifications تعمیم داده نمی‌شود.

Migrationهای خارج از این پنج Worker با job/فرمان نسخه‌دار مستقل و پیش از rollout app اجرا می‌شوند. deployment bundle به‌صورت ضمنی database migration نمی‌کند. ترتیب additive/expand-contract و rollback schema باید در release ثبت شود.

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
