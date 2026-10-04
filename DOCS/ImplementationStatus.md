# وضعیت اجرای پیاده‌سازی فانتینو

آخرین به‌روزرسانی: 2026-10-03

## وضعیت GitHub bootstrap و دو runtime — 2026-10-03

- ADR-0016 نگاشت جاری سه وب‌اپ و نه process بک‌اند را به دو runtime تعریف می‌کند؛ packageها، schemaها و دیتابیس‌های مالکانه جدا باقی مانده‌اند.
- Source monorepo در ریشه‌ی Funtino به `https://github.com/tiam-mhd/Funtino` متصل و روی `main` push شد. این repository منبع حقیقت تغییرات محصول و مستندات است.
- دو snapshot مستقل، `funtino-frontend-runtime` و `funtino-backend-runtime`، به repositoryهای GitHub متناظر متصل و روی `main` push شدند. هر snapshot در `.funtino-snapshot.json` به source revision زمان تولید اشاره می‌کند.
- exporter با pnpm/Turbo workspaceها را prune می‌کند: frontend شامل سه app و design-system (۱۱۳ فایل) و backend شامل دو gateway، هفت service و packageهای `backend-core` و `event-contracts` (۳۰۹ فایل) است. هر snapshot Dockerfile، `.dockerignore`، lockfile، supervisor، manifest، healthcheck و README دارد.
- سه local `main` پس از fetch با `origin/main` برابر شدند (`0 0`). هر دو bundle processهای خود را با supervisor fail-fast و healthcheck تجمیعی TCP اجرا می‌کنند. migration startup طبق ADR-0015 به همان پنج Worker محدود است.
- ۱۲ repository و آیتم قدیمی Runflare و database/queue/cacheهای جدا حذف یا ویرایش نشده‌اند؛ آن‌ها برای rollback و منبع مقایسه باقی مانده‌اند.
- index محلی GitNexus در این task اجرا یا refresh نشد؛ تازگی آن نسبت به تغییرهای اخیر تأیید نشده است. `.claude/`، `CLAUDE.md` و تصویر ریشه فایل‌های local-only هستند، روی دیسک باقی مانده‌اند و وارد commit/push نشده‌اند. فایل حفاظت‌شده نیز خوانده یا پردازش نشده است.
- اتصال repositoryها به آیتم Runflare، Auto Pull/webhook، network/domain/TLS، Environment/Secret و health واقعی هنوز در پنل انجام یا تأیید نشده است. Docker build و تست محلی اجرا نشد.

گام باقی‌مانده برای اتصال واقعی: GitHub remote و commitهای اولیه‌ی source و دو bundle، ساخت دو Docker item، mapping شبکه/domain/target port، تنظیم secretهای واقعی در پنل، build/health/smoke staging، backup/restore و cutover مرحله‌ای با rollback.

## انتشار controlled snapshot دوازده repository — 2026-10-01

- Source monorepo در این workspace فاقد `.git` و remote قابل‌استفاده است؛ بنابراین source commit/source SHA وجود ندارد و ساخته یا گزارش نشده است. تغییرات source در همین مسیر محلی اعمال شده‌اند.
- پیش از انتشار، هفت remote موجود fetch شدند و همگی `0/0` divergence داشتند؛ پنج remote تازه‌ساخته‌شده خالی بودند. هر ۱۲ snapshot پس از push روی `main` دوباره fetch شدند؛ SHA محلی با `origin/main` برابر و clone پاک بود.

| بستر                         | Repository                           | branch / commit                                                                                                                     |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Customer Web                 | `funtino-customer-app`               | [`1b116ee`](https://github.com/Funtino-platform/funtino-customer-app/commit/1b116ee1cb9e4004a9f9c57bcb279877f7393508)               |
| Operations Web               | `funtino-operations-web`             | [`a71a1cd`](https://github.com/Funtino-platform/funtino-operations-web/commit/a71a1cd42d26c58558ea37dc587e51bc287162e4)             |
| System Web                   | `funtino-system-web`                 | [`c5964eb`](https://github.com/Funtino-platform/funtino-system-web/commit/c5964ebda2e4dba54b7e0d33259df97f7e4b31a4)                 |
| API Gateway                  | `funtino-api-gateway`                | [`d548a8f`](https://github.com/Funtino-platform/funtino-api-gateway/commit/d548a8f794f45af94e5d34f5e8679b5019bfc16d)                |
| Realtime Gateway             | `funtino-realtime-gateway`           | [`54d44a8`](https://github.com/Funtino-platform/funtino-realtime-gateway/commit/54d44a8b529c03cab8b8e49dcd781d0354ff99c6)           |
| Device Worker                | `funtino-device-worker`              | [`b1fede1`](https://github.com/Funtino-platform/funtino-device-worker/commit/b1fede1617947b280887e952714570b8ba024e9e)              |
| Notifications Worker         | `funtino-notifications-worker`       | [`0e34078`](https://github.com/Funtino-platform/funtino-notifications-worker/commit/0e34078ff23b85e50cff0d4b4eb3a57f74a1e2f2)       |
| Identity Access Worker       | `funtino-identity-access-worker`     | [`f3786c1`](https://github.com/Funtino-platform/funtino-identity-access-worker/commit/f3786c1329b05357dba2887672252c5c601342a0)     |
| Organization & Branch Worker | `funtino-organization-branch-worker` | [`0b4f64f`](https://github.com/Funtino-platform/funtino-organization-branch-worker/commit/0b4f64fc611b41d5b385d12e3bfc0188ee7e83ce) |
| Customer Household Worker    | `funtino-customer-household-worker`  | [`6652e6a`](https://github.com/Funtino-platform/funtino-customer-household-worker/commit/6652e6a83b0a3c54b131f5ddbcf082d858032241)  |
| Wallet Worker                | `funtino-wallet-worker`              | [`20a54e0`](https://github.com/Funtino-platform/funtino-wallet-worker/commit/20a54e0e5dedfcff18ee44470290e5b8e29b9dd9)              |
| Analytics Worker             | `funtino-analytics-worker`           | [`f1ca582`](https://github.com/Funtino-platform/funtino-analytics-worker/commit/f1ca582983ff0d567489aa9c83a34b8d42df34f4)           |

- کیفیت snapshotها: `pnpm install --frozen-lockfile` در هر ۱۲ مخزن موفق بود؛ سه وب‌اپ typecheck/lint/build را گذراندند (Customer: ۶ تست، Operations: ۱۳ تست؛ System suite مستقل ندارد). هفت backend شامل API Gateway، Identity Access، Organization & Branch، Customer Household، Wallet، Analytics و Device، typecheck/lint/test/build را گذراندند؛ Realtime و Notifications typecheck/lint/build را گذراندند و test script مستقل ندارند. تست و lint هر دو shared package یعنی `event-contracts` و `backend-core` نیز موفق بود. `git diff --check` و کنترل secret/artifact هم برای هر snapshot پاک بود.
- Docker image build در این محیط قابل اجرا نبود: Docker daemon/pipe محلی در دسترس نیست. موفقیت buildهای pnpm جایگزین تأیید build داخل Docker محسوب نمی‌شود.
- اتصال repository/branch هر آیتم به Runflare، Auto Pull، deployment health و webhook از این workspace قابل مشاهده نبود؛ push GitHub به‌تنهایی deployment را تأیید نمی‌کند. Migration/backfill/reconciliation روی staging، E2E چندمجموعه‌ای با سرویس‌های واقعی، backup/restore، remote CI/branch protection و تأیید پایلوت نیز در این انتشار اجرا نشده‌اند.

## Wallet owner و موجودی کارت — 2026-10-01

- سرویس مستقل `services/wallet` با schema مالکانه‌ی PostgreSQL در `wallet`، migration نسخه‌دار، API داخلی Gateway-only و اعتبارسنجی زنده‌ی branch از Organization & Branch اضافه شد؛ branch و organization شناسه‌های opaque هستند و FK/cross-schema read ندارند.
- ثبت، فهرست، مشاهده و تغییر وضعیت موجودی (`in_stock`، `blocked`، `retired`) پیاده شده است. ثبت دستی `verificationStatus=unknown` دارد؛ status retired بازگشت‌ناپذیر است. هر mutation با `If-Match`، idempotency، history/audit و Outbox در یک تراکنش قرار می‌گیرد.
- شناسه‌ی فیزیکی کارت در Wallet ذخیره می‌شود ولی در DTO فقط mask است و وارد event/audit snapshot/idempotency response/log نمی‌شود. هیچ تخصیص household/member، مانده یا ledger مالی ساخته/حدس زده نشده است.
- migration فقط schema خالی مالک را می‌سازد؛ `public.cards` در Gateway هنوز legacy و دست‌نخورده است. BFF و رابط موجودی Operations برای Wallet اضافه شده‌اند، اما Customer read path هنوز legacy است و هیچ تخصیص کارت ساخته نشده؛ backfill، validation معتبر Customer، PostgreSQL واقعی، deployment repository و Runflare به gate بعدی نیاز دارند.
- قرارداد `contracts/openapi/wallet.yaml` و دو event نسخه‌دار inventory، AsyncAPI و package قرارداد event اضافه شدند؛ CI اکنون Wallet را در تکرار migration و گیت‌های backend وارد می‌کند.
- اعتبارسنجی محلی: typecheck Wallet و Organization & Branch، build Wallet و packageهای مشترک، اعتبارسنجی Prisma و تولید Client، validator قراردادها (۶ OpenAPI، ۱۵ event schema، یک AsyncAPI)، ۱۷/۱۷ تست Wallet، ۹/۹ تست package رویدادها (شامل دو تست Wallet) و ۵/۵ تست allow-list Owner موفق شدند. lockfile با parser بررسی و specifierهای Wallet با package.json تطبیق داده شدند؛ SQL تولیدی Prisma از schema با نام‌گذاری migration تطبیق داده شد.
- محدودیت محیط: migration/restore روی PostgreSQL واقعی اجرا نشد و باید در CI روی دیتابیس disposable انجام شود. `pnpm install --frozen-lockfile` به‌دلیل EPERM در realpath پروفایل ویندوز اجرا نشد؛ `tsx` نیز با `uv_os_get_passwd returned ENOMEM` متوقف شد و تست‌ها با TypeScript emit موقت و Node اجرا شدند. ESLint به‌دلیل نصب‌نبودن `eslint-plugin-react-hooks` اجرا نشد؛ green بودن CI یا استقرار ادعا نمی‌شود.

## اتصال Gateway و Operations Web به موجودی Wallet — 2026-10-01

- Gateway اکنون BFF نشست‌محور فهرست/ثبت/تغییر وضعیت موجودی دارد. هر درخواست روی سرور IAM branch scope/resource، وضعیت زنده‌ی مجموعه و شعبه، Trusted Origin در writeها، reason، Idempotency-Key و نسخه‌ی If-Match را کنترل می‌کند. Client داخلی Wallet fail-closed است، پاسخ را با schema سخت‌گیرانه اعتبارسنجی می‌کند و هرگز شناسه‌ی فیزیکی را به UI نمی‌دهد؛ scope کارت پاسخ نیز با scope درخواستی تطبیق داده می‌شود.
- Operations Web فهرست صفحه‌بندی‌شده، انتخاب branch در scope سازمان، فیلتر وضعیت، جست‌وجوی ماسک‌شده روی صفحه‌های بارگذاری‌شده، ثبت، lifecycle، تأیید بازنشستگی دائمی و stateهای loading/empty/error/retry را دارد. برای write، capability از IAM می‌آید و step-up/enrollment MFA به همان نشست متصل است. «نامشخص» به‌عنوان سلامت/تأیید سخت‌افزاری نمایش داده نمی‌شود.
- قرارداد public Gateway و آزمون‌های Gateway/Operations افزوده شده‌اند؛ `WALLET_URL` و `WALLET_GATEWAY_TOKEN` فقط runtime Gateway هستند و توکن با Wallet همان محیط مشترک است. اجرای migration واقعی، deployment repository، network/private ingress و Runflare هنوز انجام نشده‌اند.
- تخصیص/انتقال/لغو و نمایش کارت customer به این BFF متصل نیستند: سرویس Customer & Household و API مرجع بررسی household/member در source وجود ندارد. مسیر کارت مشتری هنوز legacy باقی است؛ انتقال امن مالکیت تا ثبت/پذیرش ADR و contract مربوط باز است.
- اعتبارسنجی این برش: typecheck Gateway و Operations Web، lint فایل‌های اثرپذیرفته، Prettier و validator قراردادها (۶ OpenAPI، ۱۵ event schema، یک AsyncAPI) موفق شدند. کل suite فعلی Gateway با ۶۶/۶۶ و Operations Web با ۱۱/۱۱ تست پاس شد؛ تست‌های جدید Gateway ۹/۹ و API کارت Operations ۲/۲ نیز پس از آخرین اصلاحات دوباره اجرا شدند. به‌دلیل `tsx` و خطای محیطی `uv_os_get_passwd returned ENOMEM`، suiteها با emit موقت TypeScript و Node اجرا شدند. production build و E2E مرورگری این برش اجرا نشد؛ `.next` از قبل در workspace وجود داشت و عمداً بازنویسی نشد.

## Bootstrap امن مدیر، سیاست MFA/session و gate writeهای IAM — 2026-10-01

- ADR-0011 اضافه شد: در production commandهای مدیریت role/staff/override با `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED` دقیقاً `true` و فقط در release window باز می‌شوند؛ پیش‌فرض بسته است. تصمیم actor/MFA در IAM و validation زنده‌ی Owner مطابق ADR-0010 همچنان اجباری‌اند. readiness وضعیت gate مدیریتی و tenant را جدا می‌دهد.
- تلاش برای هر mutation IAM هنگام بسته‌بودن gate (حتی پذیرش دعوت) با `503` رد و بدون body حساس audit می‌شود؛ عدم موفقیت audit نیز fail-closed است. فقط lifecycle MFA خود کاربر برای راه‌اندازی/بازیابی از این kill switch جداست.
- CLI bootstrap به `IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true` در همان invocation و TTY تعاملی نیاز دارد؛ کد MFA بدون echo است. عضویت موقت `system_admin_bootstrap` پس از ۲۴ ساعت از authorization و MFA کنار گذاشته می‌شود و prepare بعدی آن را ممیزی‌شده revoke می‌کند. finalize اعتبار و انقضا را قبل و حین ارتقا کنترل می‌کند.
- سیاست پذیرفته‌شده عوض نشده است: session مطلق ۳۰ روز، cookie هم‌عمر با `Secure` production/`HttpOnly`/`SameSite=Lax` و step-up حداکثر ۳۰۰ ثانیه؛ ثابت‌های cookie، persistence، proof response و authorization یکسان شده‌اند.
- مرز این برش: MFA در هر ورود و idle-timeout کوتاه‌تر تصویب/پیاده‌سازی نشده‌اند؛ gate جدید فقط mutationهای مدیریتی IAM را کنترل می‌کند و جای authorization/scope سرویس‌های دامنه را نمی‌گیرد. وضعیت و پیش‌نیازها در ADR-0011 ثبت شده‌اند.
- هیچ bootstrap واقعی، flag production، secret، migration دیتابیس، deployment repository یا Runflare update اجرا/تنظیم نشده است. این‌ها پس از provision IAM، staging/E2E، backup/restore و approval عملیاتی باقی می‌مانند.
- اعتبارسنجی این برش: Identity Access برابر ۷۱/۷۱ و Gateway برابر ۵۷/۵۷ تست؛ typecheck هر دو پروژه، اعتبارسنجی قراردادها و Prettier برای فایل‌های متمرکز جدید موفق شدند. به‌دلیل خطای محیطی `tsx` (`uv_os_get_passwd returned ENOMEM`)، تست‌ها با emit موقت TypeScript و runner بومی Node اجرا شدند؛ E2E متصل به PostgreSQL/سرویس‌های زنده اجرا نشد.

## گیت‌های کیفیت و آمادگی انتشار — 2026-10-01

- Workflow کیفیت source در .github/workflows/quality-gates.yml افزوده شد: dependency audit، قالب‌بندی فایل‌های تغییرکرده، contract validation، lint، typecheck، تست package، build و HTTP smoke امنیتی Gateway.
- job مستقل PostgreSQL disposable هر پنج owner migration را دو بار اجرا می‌کند و custom backup را به database خالی با نام محدود restore کرده و relation/schema را مقایسه می‌کند؛ job ویندوزی سه وب‌اپ را با Edge/axe برای violationهای جدی/بحرانی بررسی می‌کند.
- telemetry JSON کمینه و HTTP metric token-protected به Gateway و شش backend دیگر متصل است. production بدون token metrics معتبر start نمی‌شود؛ queue/DLQ/freshness alert و tracing هنوز به سامانه‌ی مانیتورینگ وصل نشده است.
- صفحه‌ی اصلی System از آمار، نام مدیر و سلامت ساختگی پاک شد و نبود داده‌ی زنده را صریح نشان می‌دهد.
- اعتبارسنجی محلی: ۳ تست telemetry و contract validation (۵ OpenAPI، ۱۳ رویداد JSON Schema و ۱ AsyncAPI) موفق؛ typecheck مستقیم Gateway، Device Integration، Notifications و Realtime موفق؛ workflow YAML parse و قفل نسخه‌های dependency جدید تأیید شد. smoke اسکریپت backup نیز target با نام ناامن را پیش از اتصال رد کرد.
- pnpm/Corepack و Prisma CLI در ویندوز پیش از اجرای scriptها با EPERM هنگام realpath پروفایل کاربر متوقف شدند؛ بنابراین `quality:ci`، audit آنلاین، build کامل، migration/restore واقعی و browser axe اجرا نشده‌اند. جایگزین محلیِ IAM: `tsc --noEmit` موفق و کل suite همان سرویس با TypeScript emit موقت و Node test runner موفق شد (۵۸/۵۸). چهار تست allow-list credential در Organization & Branch نیز با esbuild و Node موفق شدند؛ typecheck و کل suite آن سرویس به‌علت نبود dependency linkهای محلی آن workspace قابل اجرا نشد و باید در CI پاک تأیید شود. ESLint محلی به‌علت نصب‌نبودن `eslint-plugin-react-hooks` اجرا نشد؛ Prettier برای فایل‌های تازه/متمرکز موفق و برای دو فایل بزرگ موجود `access-management.service.ts` و `access-management.spec.ts` هشدار داد، بنابراین از قالب‌بندی گسترده و خارج از محدوده پرهیز شد. typecheck مستقیم System Web هنوز declarationهای `@types/react` را resolve نمی‌کند و Analytics نیز نیازمند runner پاک است. Docker به‌دلیل نبود Engine و انتشار به‌دلیل نبودن `.git`/remote و deployment itemهای IAM/Organization/Analytics انجام نشده است.
- وضعیت انتشار: آماده‌سازی CI در source انجام شد، اما green بودن remote CI، required بودن jobها در branch protection، E2E احراز‌شده‌ی چند tenant، آزمون staging مرز IAM/Owner، تمرین staging restore/rollback، اتصال dashboard/alert و deployment/pilot همچنان gate هستند. ADR-0010 پذیرفته و validator در source متصل شده است. جزئیات در [گیت‌های کیفیت و پایلوت](ReleaseQualityGatesAndPilot.md) است.

## IAM و اعتبارسنجی scope مالک — 2026-10-01

- مالک محصول گزینه‌ی ۱ ADR-0010 را انتخاب کرد: IAM تنها مرجع مجوز actor، membership، delegation و MFA است؛ Organization & Branch فقط وجود/active state/parentage منبع را تأیید می‌کند و permission یا membership را کپی نمی‌کند.
- IAM در production پس از authorization هر mutation tenant را با `POST /internal/v1/scopes/validate` و credential مستقل بررسی می‌کند. scope نامعتبر audit و رد می‌شود؛ timeout، خطای شبکه، پیکربندی/پاسخ نامعتبر یا شناسه/version ناسازگار `503` می‌دهد و هیچ mutation/idempotency رکوردی commit نمی‌شود. timeout دو ثانیه است؛ URL production باید HTTPS یا ClusterIP محدود طبق ADR-0018 باشد و redirect دنبال نمی‌شود.
- token سرویس `identity-access` در owner فقط برای همین POST مجاز است. readiness configured بودن validator را گزارش می‌کند؛ دسترس‌پذیری owner در هر درخواست بررسی می‌شود. ۵۸ تست IAM و چهار تست allow-list سرویس owner موفق‌اند؛ قراردادها و قالب فایل‌های کد نیز معتبرند. nonproduction همچنان opaque UUID را صرفاً برای توسعه/آزمون می‌پذیرد.
- migration لازم نیست؛ schema تغییر نکرده است. secret واقعی، deployment، staging و E2E چند tenant اجرا نشده‌اند؛ بنابراین انتخاب ADR و اتصال source به معنی مجوز یا تأیید production نیست.

## وضعیت کلی

پیاده‌سازی با تمرکز روی customer-web شروع شده است. repository از حالت فقط مستندات به monorepo اجرایی تبدیل شده و سه وب‌اپ مستقل در آن قرار گرفته‌اند.

## Analytics و گزارش عملیاتی — 2026-10-01

- سرویس مستقل `services/analytics-read-model` مالک journal رویدادهای حداقلی و projectionهای بازسازی‌پذیر است. ورودی فقط قراردادهای نسخه‌دار Organization & Branch و Device Integration از RabbitMQ است؛ eventId یکتا، مصرف idempotent، ترتیب version، generation rebuild، lease و cutover اتمیک دارد.
- شاخص‌های فعلی: snapshot وضعیت مجموعه/شعبه، lifecycle و freshness دستگاه، توزیع سلامت، شمار رویدادهای شعبه/دستگاه به تفکیک روز و scope. کل شمار دستگاه‌ها از سقف ۵۰۰ سطر مقایسه‌ی شعب مستقل است. آستانه‌های سلامت با Device Integration مشترک‌اند.
- Gateway پیش از query/export مجوز و scope دقیق IAM و وضعیت live مالک را کنترل می‌کند. export فقط حداکثر ۳۶۶ ردیف روزانه‌ی تجمیعی، بدون PII/مالی، با `report.export`، Trusted Origin، MFA step-up و audit append-only ارائه می‌شود. Operations Web فیلتر UTC، freshness/coverage، جدول روند و CSV کنترل‌شده دارد.
- قرارداد عمومی و داخلی OpenAPI، migration نسخه‌دار Analytics، تست‌های source/API/UI و راهنمای اجرای سرویس افزوده شده‌اند. Prisma Client در workspace تولید شده است.
- پوشش تاریخی داده‌های پیش از آغاز consumer هنوز backfill ندارد؛ timestamp پوشش به کاربر نشان داده می‌شود و بازه‌ی قدیمی صریحاً غیرکامل علامت می‌خورد. شاخص فروش، بازدید، خرید، کمپین و CRM ارائه نمی‌شود چون owner/event معتبر در scope فعلی وجود ندارد.
- گیت‌های محلی این برش: typecheck چهار workspace (Analytics، Gateway، Identity Access و Operations Web)، build تولیدی سه سرویس TypeScript و build تولیدی Operations Web موفق؛ ESLint فایل‌های تغییرکرده موفق؛ Prisma validate/client generation؛ ۵۵ تست Gateway، ۹ تست Identity Access، ۹ تست Operations API client و ۹ تست Analytics موفق؛ قراردادهای OpenAPI parse و ارجاع‌های محلی resolve شدند؛ manifest و lockfile Analytics با هم تطبیق داده شدند.
- Migration روی PostgreSQL واقعی، RabbitMQ واقعی، E2E مرورگر، restore/backup و deployment اجرا/تأیید نشده‌اند. deployment repository و Runflare item مستقل Analytics هنوز provision نشده است؛ در نتیجه این برش source-complete برای داده‌های موجود است، نه production-ready.

## Customer Web — نمایش جزئیات تخصیص کارت — 2026-10-01

- صفحه‌ی کارت از API نشست‌محور کارت، خلاصه‌ی household/member و فهرست branch استفاده می‌کند؛ هیچ داده‌ی demo یا شناسه‌ی فیزیکی خام در صفحه مصرف نمی‌شود.
- API کارت `householdId` مجاز را برمی‌گرداند و API household فقط `id/name` و `id/displayName` عضوها را می‌دهد. رابط نام عضو را فقط در همان household تطبیق می‌دهد؛ نام شعبه/status را از پاسخ شعب می‌گیرد؛ lookup ناموفق یا ناسازگار را صریح و بدون حدس نشان می‌دهد.
- status کارت و freshness/زمان آخرین sync از API معتبر می‌آیند. صفحه دکمه‌ی تازه‌سازی، loading/empty/error و هشدار جزئیات ناقص دارد. API مشتری و OpenAPI با هم به‌روزرسانی و برای پاسخ حداقلی household تست اضافه شد.
- اعتبارسنجی این برش: typecheck و production build Customer Web، typecheck/build و ۴۹ تست Gateway، ۶ تست Customer Web برای DTOهای runtime و تطبیق household/member/branch/freshness، ESLint فایل‌های اثرپذیرفته و parse/ref-check قرارداد OpenAPI.
- محدودیت منبع: کارت‌های فعلی هنوز از persistence legacy در Gateway خوانده می‌شوند. Wallet owner در برش 2026-10-01 ایجاد شده اما Gateway/customer read path به آن cutover نشده و تخصیص مدیریتی/customer-household validation هنوز پیاده نیست. انتشار cutover آینده به Wallet Worker و همگام‌سازی مستقل Gateway/Customer Web نیاز دارد؛ نام repository Wallet هنوز تعیین نشده و هیچ sync/deploy انجام نشده است.

## Device Integration — registry دستگاه — 2026-10-01

- هسته‌ی registry در source monorepo پیاده‌سازی شده است: مالکیت schema مستقل PostgreSQL، ثبت یکتا در scope سازمان، lifecycle دستگاه، optimistic version، idempotency پایدار، audit append-only و Outbox اتمیک.
- گزارش سلامت نرمال‌شده با HMAC و شناسه‌ی مشاهده‌ی پایدار ذخیره می‌شود؛ retry تکراری side effect ندارد و مشاهده‌ی قدیمی نمی‌تواند سلامت جاری را عقب ببرد. `unknown/online/degraded/stale/offline` از آخرین مشاهده و thresholdهای زمان اجرا محاسبه می‌شوند.
- registration و فعال‌سازی مجدد، branch را از API مالک Organization & Branch اعتبارسنجی می‌کنند و در قطع dependency fail-closed هستند. قراردادهای OpenAPI/AsyncAPI و migration نسخه‌دار اضافه شده‌اند.
- اعتبارسنجی source: typecheck و build سرویس، typecheck تست‌ها، ESLint، Prettier، اعتبارسنجی Prisma و ۲۸ تست سرویس موفق‌اند؛ هفت تست package قراردادهای رویداد و دو تست/typecheck گارد دسترسی Device Integration در Organization & Branch نیز موفق‌اند. parse قراردادها و ارجاع‌های محلی OpenAPI/AsyncAPI معتبرند. migration در برابر Prisma schema مقایسه شده، اما روی PostgreSQL واقعی اجرا نشده است.
- موارد باز مالک Device Integration: تست migration/rollback و backup/restore روی PostgreSQL واقعی، آداپتر/دستگاه فیزیکی و انتشار Runflare. هیچ شناسه یا داده‌ی واقعی دستگاه در fixture ثبت نشده است.

## Operations Web — ثبت و پایش دستگاه — 2026-10-01

- BFF نشست‌محور در API Gateway و UI مدیریت دستگاه به source افزوده شدند. مسیرهای عمومی شامل فهرست با scope صریح سازمان/شعبه، فهرست حداقلی شعب فعال، ثبت دستگاه و تغییر نام/lifecycle هستند؛ دسترسی هر درخواست از IAM و وضعیت فعلی organization/branch از مالک زنده تأیید می‌شود.
- Gateway به‌عنوان تنها ورودی عمومی، قرارداد owner را با Zod اعتبارسنجی و با credential داخلی زمان اجرا فراخوانی می‌کند. ثبت/تغییر با actor و correlation مشتق‌شده از نشست، UUID idempotency key، `If-Match` و Trusted Origin انجام می‌شود؛ عملیات حساس MFA step-up دارند و UI راه‌اندازی/تأیید MFA و نگه‌داری اجباری recovery codeها را ارائه می‌کند. هیچ مسیر UI/BFF برای ثبت دستی health وجود ندارد.
- Operations Web در workspace دارای scope، بخش «دستگاه‌ها و پایش» دارد: ثبت به شعبه، فیلتر lifecycle سمت سرور، فیلترهای سلامت/نوع/شعبه/جست‌وجو بر داده‌های بارگذاری‌شده، صفحه‌بندی، refresh دوره‌ای در تب فعال روی صفحه‌ی اول (پس از پیمایش به صفحات بعدی برای جلوگیری از جابه‌جایی نتایج مکث می‌کند)، نمایش زمان مشاهده و freshness، تفکیک `unknown` از stale/offline و فهرست پیگیری اختلال. `unknown` هرگز آنلاین نمایش داده نمی‌شود؛ بازنشستگی نیازمند تأیید صریح و وضعیت `retired` پایانی است.
- اعتبارسنجی این برش: typecheck API Gateway و Operations Web، ۴۹ تست Gateway (شامل BFF/client جدید)، ۷ تست API Operations Web، parse قرارداد Gateway، production build پنل و ESLint فایل‌های اثرپذیرفته موفق شدند. `tsx` در این محیط پیش از اجرای تست به خطای Node `uv_os_get_passwd` رسید؛ برای اجرا، TypeScript با compiler محلی emit و تست‌ها با Node test runner مستقیم اجرا شدند. آزمون E2E با سرویس‌های در حال اجرا و مرورگر واقعی، PostgreSQL، heartbeat سخت‌افزاری و Runflare deployment در این برش تأیید نشده‌اند.
- اثر deployment در انتشار آینده: `funtino-api-gateway` و `funtino-operations-web`؛ snapshotهای موجود Device Worker و Organization/Branch نیز فقط در انتشار قابلیت مالک قبلی اثر می‌پذیرند. sync، commit/push یا انتشار انجام نشده است.

## برش S0 — MFA مدیران و step-up — 2026-09-30

- ADR-0006 تصویب‌شده اجرا شد: TOTP، کلید رمزگذاری AES-256-GCM با keyring نسخه‌دار، ده recovery code یک‌بارمصرف، قفل ۱۵ دقیقه‌ای پس از پنج شکست و step-up حداکثر پنج‌دقیقه‌ای.
- Identity Access مالک credential، مصرف recovery code و audit append-only است. مسیرهای داخلی MFA فقط برای membership کارکنان فعال‌اند؛ Gateway وضعیت تأیید step-up را در نشست سرور نگه می‌دارد و IAM عامل، نشست، نسخه‌ی factor و انقضا را دوباره بررسی می‌کند.
- Gateway مسیرهای نشست‌محور MFA و Trusted Origin برای mutationها دارد؛ system-web صفحه‌ی واکنش‌گرای MFA برای ورود کارکنان، راه‌اندازی، نمایش یک‌باره‌ی recovery code، step-up، بازتولید و غیرفعال‌سازی ارائه می‌کند.
- این برش MFA lifecycle و اثبات step-up را آماده می‌کند؛ الزام TOTP در هر ورود مدیریتی، timeout سیاستی نشست و guard سراسری برای همه‌ی endpointهای مدیریتی هنوز تکمیل نشده‌اند. تا ساخت آن‌ها هیچ command عملیاتی مدیریتی نباید باز شود و مجوزهای حساس step-up fail-closed می‌مانند.
- قراردادهای OpenAPI و migrationهای نسخه‌دار Identity Access و Gateway اضافه شدند. تنظیم keyring تولیدی secret زمان اجراست و در repository مقدار واقعی ندارد.
- اعتبارسنجی: Identity Access برابر ۴۰/۴۰ تست، Gateway برابر ۱۸/۱۸ تست؛ typecheck سرویس‌های IAM و Gateway، lint هر سه workspace، Prettier، اعتبارسنجی هر دو Prisma schema، parse قراردادهای OpenAPI و build تولیدی system-web موفق. regression مربوط به حفظ lockout پس از انقضای enrollment نیز پوشش داده شد.
- محدودیت انتشار: migrationها روی PostgreSQL واقعی اجرا نشده‌اند؛ Identity Access هنوز deployment repository/Runflare مستقل ندارد؛ راه‌اندازی production تا bootstrap امن مدیر اولیه، تنظیم keyring و آماده‌شدن مسیر انتشار متوقف است. چرخش کلید production هم تا آماده‌شدن ابزار re-encryption انجام نمی‌شود.
- commandهای IAM و idempotency/audit آن‌ها در source پیاده شده‌اند. سرویس owner سازمان/شعبه، BFF/UI مدیریت سازمان و شعبه در System Web و UI مدیریت کارکنان در Operations Web اضافه شده‌اند؛ مصرف scope validator در IAM، انتقال عملی داده و deployment هنوز باقی‌اند. tenant write gate در production تا تعیین تکلیف مرز ADR-0008/0009 fail-closed می‌ماند.

## خروجی تحویل‌شده در شروع

- ایجاد workspace ریشه با pnpm و Turborepo.
- ایجاد packages/design-system با tokenهای رنگ، سطح، badge، button، progress و heading مشترک.
- اعمال فونت محلی Estedad برای customer-web و Vazirmatn برای هر دو پنل، بدون وابستگی runtime به CDN.
- بازطراحی UI نمایشی customer-web با hero کوچک شهربازی، کارت‌های sharp و glass، motion کنترل‌شده و مجموعه‌ی SVG داخلی برای iconها.
- ایجاد customer-web با App Router، مسیر فارسی، RTL، PWA manifest و حالت‌های loading/error/not-found.
- ایجاد خانه‌ی مشتری با شعبه‌ی فعال، اعتبار کارت، امتیاز، دسترسی سریع، مأموریت و فعالیت اخیر.
- ایجاد مسیرهای اولیه‌ی کارت‌ها، مأموریت‌ها، خانواده، حساب و کشف شعبه.
- ایجاد shell و داشبورد نمایشی اولیه‌ی operations-web.
- ایجاد shell و نمای سلامت مشاهده‌ای اولیه‌ی system-web.
- قرار دادن داده‌ی Demo در adapter مشخص و جلوگیری از القای داده‌ی واقعی.
- فعال‌سازی scriptهای typecheck، lint و build برای همه‌ی workspaceها.

## خروجی جدید customer identity/profile — 2026-09-27

- ورود و ثبت‌نام واقعی با OTP موبایل، session cookie امن، cooldown، expiry، سقف تلاش و verify محلی اضافه شد.
- آداپتر Parsgreen با token خالی و تنظیمات قابل‌تغییر برای endpoint/header/template در runtime اضافه شد؛ بدون token در production fail-closed است.
- تکمیل اجباری پروفایل شامل نام، نام خانوادگی، تاریخ تولد، جنسیت، شهر و تصویر یا avatar preset در customer-web اجرا شد.
- انتخاب و بارگذاری avatar، نمایش preview، ویرایش بعدی پروفایل، خروج از حساب و حالت‌های loading/error در UI پیاده شد.
- ثبت‌نام هیچ شعبه‌ای را فعال نمی‌کند؛ اتصال کارت با `branchId` رابطه‌ی مشتری/شعبه را ایجاد می‌کند و این قاعده در memory adapter، Prisma، OpenAPI و تست جریان اصلی اعمال شد.
- migration جدید `0002_customer_profile_and_card_branch` و ADR/مستند اجرایی مرتبط ثبت شد.
- در operations-web پرونده‌های مشتری، تکمیل پروفایل و وضعیت کارت/شعبه برای مدیریت شعبه اضافه شد؛ در system-web سیاست‌های OTP، profile gate و branch linking به‌صورت مشاهده‌ای قابل پایش است.

## اصلاح قرارداد Parsgreen — 2026-09-30

- Adapter ارسال OTP به قرارداد REST منتشرشده‌ی Parsgreen اصلاح شد: endpoint `sms.parsgreen.ir/Apiv2/Message/SendOtp`، هدر `Authorization: basic apikey:<token>` و بدنه‌ی JSON رسمی provider.
- مقدار شناسه‌ی قالب از مقدار حدسی به تنظیم runtime تبدیل شد؛ شناسه‌ی واقعی قالب باید از حساب Parsgreen در Runflare تنظیم شود و token همچنان فقط Secret زمان اجرا است.
- تست واحد قرارداد درخواست و نگاشت شکست business provider اضافه شد؛ پاسخ provider در log فقط با status/code/message محدود و بدون token یا کد OTP ثبت می‌شود.
- timeout بعد از ارسال احتمالی provider به وضعیت `deliveryStatus: unknown` تبدیل شد تا challenge ذخیره و صفحه‌ی ورود کد باز شود؛ retry خودکار انجام نمی‌شود و تست مسیر ambiguous delivery اضافه شد.

## اصلاح پروفایل customer و CORS — 2026-09-30

- preflight API برای ویرایش پروفایل اصلاح شد؛ `PATCH` و `OPTIONS` اکنون در CORS Gateway به‌صورت صریح مجاز هستند و headerهای لازم customer نیز اعلام می‌شوند.
- انتخاب تصویر پروفایل یک cropper تعاملی دارد: جابه‌جایی و zoom داخل قاب ثابت `1:1`، خروجی ۵۱۲×۵۱۲ JPEG و سپس upload به API.
- انتخاب تاریخ تولد از input بومی مرورگر به wheel سه‌ستونه‌ی شمسی (روز/ماه/سال) با scroll نرم و نشانگر انتخاب مرکزی منتقل شد؛ مقدار ارسالی همچنان ISO Gregorian مطابق قرارداد API است.
- دکمه‌ها و لیست preset avatar فعلاً در کد کامنت شده و render نمی‌شوند تا catalogue نهایی برند مشخص شود.

## معیار پذیرش این مرحله

- سه app با Design System مشترک build می‌شوند.
- customer-web روی /fa و مسیرهای اصلی آن قابل prerender است.
- رابط‌ها RTL و mobile-first هستند و حالت‌های پایه‌ی loading، error و not-found دارند.
- customer-web مستقیماً به دیتابیس یا سامانه‌ی کارت وصل نیست؛ مسیر هویت و پروفایل از API Gateway عبور می‌کند. اتصال واقعی RFID، پرداخت و منبع مالی هنوز adapter قراردادی می‌خواهد.
- هیچ credential یا داده‌ی واقعی وارد repository نشده است.

## نتیجه‌ی اعتبارسنجی

- `pnpm format:check` با موفقیت اجرا شد.
- `pnpm lint` برای هر چهار workspace با موفقیت اجرا شد.
- `pnpm typecheck` برای هر چهار workspace با موفقیت اجرا شد.
- `pnpm build` به‌صورت ترتیبی برای customer-web، operations-web و system-web با موفقیت اجرا شد.
- smoke test نسخه‌ی production روی `/fa`، `/fa/missions` و `/manifest.webmanifest` با پاسخ HTTP 200 انجام شد.
- بررسی dev server هر سه app، وجود CSS فونت و ارائه‌ی فایل‌های local `woff2` با موفقیت انجام شد.

## گام بعدی لازم

1. اتصال provider واقعی Parsgreen با Secretهای Runflare و اجرای تست integration محدود.
2. جایگزینی داده‌ی Demo خانه/کارت/ماموریت با projectionهای API و stateهای stale/error.
3. اضافه‌کردن تست Playwright برای مسیر OTP، تکمیل پروفایل، آواتار، خانه، کارت و مأموریت.
4. تکمیل adapter قراردادی RFID و اعتبارسنجی کارت قبل از فعال‌سازی.
5. آماده‌سازی migration/restore و deployment snapshot سرویس‌ها طبق راهبرد Runflare.

## تحلیل مدیریت سازمان/شعبه/کارکنان/دستگاه/کارت — 2026-09-28

- طرح end-to-end و ترتیب مرحله‌ای در [OrganizationBranchDeviceCardManagement.md](OrganizationBranchDeviceCardManagement.md) ثبت شد: مدل دامنه و منبع حقیقت، نقش سفارشی و override فردی، جریان کارکنان و تخصیص کارت، API/eventها، صفحه‌های سه بستر، migration، گزارش، gateهای امنیت/کیفیت و اثر deployment.
- یافته‌های این بند snapshot تحلیل اولیه‌ی 2026-09-28 است؛ پیاده‌سازی‌های بعدی سازمان/شعبه، کارکنان، registry دستگاه و رابط Operations در بخش‌های تاریخ‌دار همین سند و فاز O3 ثبت شده‌اند. انتشار مستقل این قابلیت همچنان باز است.
- پس از تأیید مالک محصول، [ADR-0005](decisions/0005-organization-branch-device-card-management.md) پذیرفته شد: roleهای پایه، نقش سفارشی، permission catalog ریزدانه و نسخه‌دار، override allow/deny در سطح membership، deny precedence، delegation ceiling، دعوت pending، bootstrap یک‌باره با MFA/audit و registry دستی پایلوت.
- customer-web صفحه‌ی کارت را به `GET /api/v1/customer/cards` متصل می‌کند و شعبه را از API عمومی شعب می‌گیرد؛ مقدار اعتبار ساختگی و CTAهای بی‌عمل حذف شدند. حالت loading، empty، error/retry و sync قدیمی/نامشخص دارد.
- API کارت برای مشتری و پاسخ اتصال، شناسه‌ی فیزیکی را ماسک می‌کند و household scope موجود را حفظ می‌کند. Schemaهای OpenAPI برای کارت/شعبه و envelope پاسخ اضافه شدند.
- regression تست کارت، عدم افشای شناسه‌ی خام و جداسازی دو household را پوشش می‌دهد.

## سرویس مالک Organization & Branch و رابط مدیریت — 2026-10-01

- Prisma با multi-schema صریح پیکربندی شده است تا همه‌ی enum/tableها واقعاً در `organization_branch` قرار بگیرند؛ فهرست‌های مدیریتی با keyset pagination محدودشده (۱ تا ۱۰۰ ردیف) ارائه می‌شوند و Gateway صفحه‌های discovery را با cursor معتبر و سقف fail-closed دنبال می‌کند.
- سرویس `services/organization-branch` با PostgreSQL schema مستقل `organization_branch`، enum وضعیت، version optimistic concurrency، unique slug، رابطه‌ی restrict بین شعبه/سازمان و migration مستقل اضافه شد. archive نرم و terminal است.
- API داخلی برای lifecycle سازمان/شعبه، فهرست شعب فعال، خواندن مدیریتی، و validation وضعیت/رابطه‌ی scope اضافه شد. credentialهای Gateway و IAM جدا هستند؛ mutation به actor، reason، correlation، `Idempotency-Key` و update به `If-Match` نیاز دارد.
- هر mutation واقعی audit append-only و Outbox رویداد نسخه‌دار را در همان تراکنش می‌نویسد؛ relay lease/retry/dead-letter دارد. backfill historical event تولید نمی‌کند.
- شش رویداد organization/branch با AsyncAPI، JSON Schema و Zod contract ثبت شدند.
- Gateway در حالت PostgreSQL دیگر branch را مستقیماً query نمی‌کند و startup رکورد نمایشی organization/branch/mission نمی‌سازد. branch discovery و اعتبارسنجی لینک کارت از owner API انجام می‌شود و در نبود dependency/token fail-closed است. migration Gateway فقط FK کارت را حذف می‌کند؛ UUID کارت حفظ و جدول‌های legacy و membership باقی می‌مانند.
- CLI backfill با اتصال read-only مبدأ و credential مستقل مقصدِ بدون مجوز update/delete، snapshot تکرارپذیر، hash، dry-run پیش‌فرض، بررسی orphan/slug/timezone/opening-hours/مغایرت مقصد و apply دوگیتی افزوده شد. timestamp timezone-less در رشته‌ی `legacy_*_local` بدون reinterpretation نگهداری می‌شود. حداکثر ۱۰٬۰۰۰ ردیف برای تراکنش واحد پذیرفته می‌شود.
- BFF مدیریتی در Gateway با `SessionGuard`، ارزیابی مجوز/محدوده از IAM، محافظت origin برای mutation، `Idempotency-Key`، `If-Match`، no-store و DTO عمومی محدودشده پیاده شده است. فهرست global فقط با مجوز global خوانده می‌شود و فهرست scoped از membershipهای فعال IAM استخراج و تک‌به‌تک مجازسنجی می‌شود.
- صفحه‌ی `system-web` در `src/features/organizations` فهرست صفحه‌بندی‌شده، نمایش status/version/updatedAt واقعی owner، ایجاد و ویرایش مجموعه/شعبه، ساعت کاری، تعلیق/فعال‌سازی مجدد، تأیید دلیل و نمایش loading/empty/error/stale را دارد. ویرایش نسخه‌ی آغاز فرم را برای جلوگیری از بازنویسی تغییر هم‌زمان نگه می‌دارد؛ archive برگشت‌ناپذیر در UI ارائه نشده است.
- اعتبارسنجی این برش: TypeScript، ESLint، Prettier و production build در System Web پاس شدند؛ route در سرور محلی با HTTP 200 و markup راست‌به‌چپ smoke شد؛ ۳۰/۳۰ تست Gateway پاس شدند (۷ تست مستقیماً BFF/client/scope این قابلیت را پوشش می‌دهند)؛ فایل‌های OpenAPI از نظر YAML parse شدند.
- وضعیت تحویل: source و migrationها نسخه‌گذاری شده‌اند؛ هیچ migration/backfill واقعی، restore/reconciliation، deployment یا بازکردن gate production انجام نشده است. مصرف واقعی scope validator در IAM، عملیات cutover و استقرار مستقل باقی‌اند.

یادداشت: گزارش‌های پس از این snapshot، سوابق تاریخی هر برش در زمان اجرای آن هستند؛ برای وضعیت جاری، snapshot تاریخ‌دار بالاتر مرجع است.

تحلیل ساختار، قوانین لازم‌الاجرا، قراردادها و اثر استقرار پیش از شروع بررسی شد. ADR-0005 و اسناد ساختار/معماری/مجوز به‌روزرسانی شده‌اند. در ابتدای تحلیل endpoint مدیریتی یا deployment سرویس جدیدی وجود نداشت؛ وضعیت فعلی در ادامه ثبت شده است.

- قراردادهای اولیه‌ی Gateway و Identity Access برای context دسترسی، نقش، دعوت کارکنان، lifecycle عضویت و override فردی اضافه شدند.
- هسته‌ی دامنه‌ی Identity Access در `services/identity-access` permission catalog نسخه‌دار، scope evaluator، deny precedence بین چند membership حتی با role غیرفعال، delegation ceiling، MFA fail-closed و invariant آخرین مدیر را پیاده‌سازی می‌کند. ۱۲ تست واحد، lint، build و typecheck پاس شده‌اند.
- مرحله‌ی read/evaluate Identity Access شامل schema/migration مستقل PostgreSQL، API خصوصی با service token، health/readiness و Gateway BFF نشست‌محور است. تصمیم مجوز در هر درخواست از DB و snapshot تراکنشی خوانده می‌شود و cache ندارد.
- برش بعدی زیرساخت audit/outbox را اضافه می‌کند: `AccessMutationJournalService` نسخه‌ی policy، audit append-only و event نسخه‌دار را برای استفاده در تراکنش command فراهم می‌کند؛ relay دارای lease، retry محدود و dead-letter است. قرارداد `identity.access-policy-changed.v1` payload حداقلی دارد. هیچ route نوشتنی هنوز این primitiveها را صدا نمی‌زند.
- مسیر نوشتن role، دعوت/عضویت و override همچنان planned است تا owner سازمان/شعبه مشخص و commandها به MFA step-up، journal/audit، idempotency اجرایی، delegation ceiling، invariant آخرین مدیر و bootstrap متصل شوند. retention audit نیز عمداً بدون پاک‌سازی خودکار است تا سیاست مصوب شود. در نبود اتصال IAM، Gateway fail-closed و 503 می‌دهد.
- migrationهای Identity فقط نسخه‌گذاری/اعتبارسنجی می‌شوند؛ روی دیتابیس واقعی اجرا نشده‌اند. تست integration واقعی PostgreSQL/RabbitMQ و deployment repository/Runflare IAM هنوز وجود ندارد و انتشار انجام نشده است.
- اعتبارسنجی برش فعلی: Identity برابر ۲۸/۲۸ تست، event-contracts برابر ۳/۳ و API Gateway برابر ۹/۹ تست؛ lint سه workspace، backend typecheck و build هر ۷ workspace موفق؛ Prisma schema با URLهای placeholder معتبر است. migration روی PostgreSQL واقعی و relay روی RabbitMQ واقعی اجرا نشده‌اند؛ اتصال آزمایشی محلی نیز به‌دلیل ردشدن credential placeholder انجام نشد.
- Migration فقط نسخه‌گذاری و اعتبارسنجی شده است؛ روی دیتابیس واقعی اجرا نشده. هنوز deployment repository/Runflare item مستقل IAM وجود ندارد و انتشار انجام نشده است.
- اعتبارسنجی این برش: build/typecheck هدفمند برای Identity و Gateway و dependencyهای backend موفق؛ lint هر دو workspace موفق؛ ۲۰ تست Identity و ۹ تست Gateway موفق؛ smoke محلی HTTP برای سرویس داخلی و OTP-session → Gateway → permission catalog موفق. اتصال integration به PostgreSQL و اجرای migration عمداً انجام نشد.

اعتبارسنجی برش قبلی کارت مشتری: customer-web و API Gateway typecheck، lint و build موفق؛ چهار تست API Gateway موفق.

## نکته‌ی معماری

این مرحله عمداً vertical slice رابط کاربری است. Demo data منبع حقیقت نیست و نباید برای تصمیم مالی، مجوز، موجودی یا وضعیت واقعی شعبه استفاده شود. هر قابلیت واقعی بعدی باید طبق ترتیب قرارداد، مالک داده، API، تست و telemetry در AGENTS.md پیاده شود.

## Operations Web login and scope — 2026-10-01

- Operations Web authenticates through the existing Gateway OTP/session flow and loads eligible organization/branch scopes from IAM-backed memberships plus live Organization & Branch status.
- Gateway revalidates each selection and records organization/branch scope, actor, and correlation ID in the existing audit table. Every later operations query and mutation must independently authorize its exact scope and permission.
- The former synthetic dashboard data was removed. The scoped shell clearly states that operational modules are not connected yet.
- Verified: Operations Web typecheck, lint, production build; Gateway typecheck/lint and 40 tests; Gateway OpenAPI YAML parse. No production OTP, database, migration, or deployment test was run.
- O0 remains partial: role-based navigation, scoped module APIs, forms/tables, and live cross-branch end-to-end isolation tests remain.

## Operations Web staff and access management — 2026-10-01

- Operations Web now connects the active-scope workspace to real IAM-backed roster, role catalog, permission catalog and issued-invitation endpoints. The personal invitation inbox is available before scope selection and in the no-access state; Gateway derives its lookup phone from the verified session, and acceptance is explicit and idempotent.
- Staff actions include assigning an existing active non-system role with `If-Match`, suspending/reactivating eligible memberships, revoking pending invitations, and managing individual allow/deny overrides with reason, idempotency and MFA step-up. IAM remains the server-side authorization/audit/last-administrator authority.
- The shared personal-invitation BFF resolves current organization/branch display names and status through the owner API with bounded concurrency. Missing or unavailable scopes return no stale label and cannot be accepted in Operations Web; global invitations remain available to System Web. Both web consumers were synchronized with the expanded response.
- The UI includes pagination, local roster filtering/sorting, responsive RTL states, error/empty/loading feedback and stale-version refresh. The API client has four passing request-contract tests.
- Verified: Operations/System Web and Gateway TypeScript + ESLint; production builds of both web apps; Gateway OpenAPI parse; 40/40 Gateway tests, 44/44 Identity Access tests, and 4/4 Operations API client tests. `tsx` itself could not start in this Windows environment (`uv_os_get_passwd` returned `ENOMEM`); test sources were bundled with the installed esbuild and run through Node's test runner. No live OTP, database, migration, browser E2E or deployment test was run.
- Historical production limitation at that snapshot: tenant writes awaited owner validation and ADR-0010. The decision was later accepted and the source validator integration is recorded in the current IAM scope section above; staging, deployment and pilot gates remain.

## Backend baseline — 2026-09-27

پیاده‌سازی پایه‌ی بک‌اند در [BackendImplementation.md](BackendImplementation.md) ثبت شد. خروجی فعلی شامل API Gateway واقعی با دو adapter حافظه/PostgreSQL، Prisma migration، OTP/session cookie، household/card/wallet/mission، Outbox/RabbitMQ/DLQ، wallet event consumer، Realtime Gateway، Device Integration و Notifications worker است.

اعتبارسنجی‌های انجام‌شده: backend typecheck، build سرویس‌ها، lint، سه تست جریان اصلی و smoke test HTTP موفق بودند. اجرای integration واقعی Docker به‌دلیل در دسترس نبودن Docker Desktop Engine در این محیط انجام نشد؛ بنابراین قبل از staging باید migration، RabbitMQ، providerهای OTP/payment/card و تست restore در محیط Runflare جداگانه اجرا شوند.

## بسته‌بندی Docker برای Runflare — 2026-09-27

- برای هر ۷ deployment repository سازمان `Funtino-platform`، Dockerfile و `.dockerignore` در root آماده شد و README هر repository به runtime Docker، پورت، health و commandهای build/start اشاره می‌کند.
- Dockerfileها Node.js 22، pnpm 10.12.4، mirror نصب dependency، `pnpm install --frozen-lockfile`، build، اجرای non-root و health check دارند.
- راهنمای عملی پنل Runflare در [RunflareDockerDeploymentRunbook.md](RunflareDockerDeploymentRunbook.md) و تصمیم معماری در [ADR-0004](decisions/0004-runflare-docker-pnpm-deployments.md) ثبت شد.
- Docker Engine در محیط فعلی در دسترس نبود؛ بنابراین build واقعی image در این workspace اجرا نشد و باید در CI یا خود Runflare تأیید شود.
- تغییرات deployment با commitهای مستقل به branch `main` هر ۷ repository پوش شدند و HEAD محلی/remote برای همه‌ی آن‌ها یکسان تأیید شد: API `cf8b6f1`، Customer `807a50c`، Device `81afaf1`، Notifications `98de286`، Operations `b60d8c3`، Realtime `99bfe28` و System `85952f9`.
- source monorepo فعلی در این workspace `.git` و remote ندارد؛ بنابراین تغییرات `AGENTS.md` و `DOCS` فعلاً فقط در workspace محلی ثبت هستند و در هیچ repository GitHub پوش نشده‌اند.

## رفع startup پنج Worker در Runflare — 2026-10-03

- هر پنج Dockerfile پیش از نصب dependencyهای Prisma، OpenSSL را در image مبتنی بر Debian Bookworm نصب و نسخه‌ی آن را در build log چاپ می‌کند؛ `APP_VERSION` اضافه یا بررسی نشده است.
- چهار relay مربوط به Identity Access، Organization & Branch، Customer Household و Wallet اکنون در خطای batch، نام/code امن exception و cause را ثبت می‌کنند؛ message خام، URL اتصال و secret وارد log نمی‌شود. تست‌های regression این redaction اضافه شدند.
- اعتبارسنجی source با `pnpm exec turbo run lint typecheck test build --concurrency=1 --force` برای پنج Worker و dependencyهای مشترک با موفقیت انجام شد (۲۸/۲۸ task). در هر پنج deployment clone نیز install منطبق با lockfile و lint، typecheck، test و build موفق شد؛ تست‌های سرویس به‌ترتیب ۷۶، ۱۷، ۷، ۲۲ و ۱۲ مورد پاس شدند.
- snapshotها بدون force-push به branch `main` مقصدشان منتشر شدند و پس از push، `HEAD` با `origin/main` برابر و working tree هر clone پاک تأیید شد: Identity Access `e09bdf9`، Organization & Branch `1e5b5a7`، Customer Household `611e35c`، Wallet `6e282c4` و Analytics `b3d27cf`.
- Docker Engine محلی در دسترس نبود؛ بنابراین ساخت image واقعی و سلامت runtime در Runflare هنوز تأیید نشده است. migration روی دیتابیس واقعی اجرا نشد و باید طبق روند جداگانه‌ی staging انجام شود.
- source monorepo در این workspace `.git`/remote ندارد؛ تغییرهای source و این گزارش محلی‌اند و commit source ایجاد یا push نشده است. commitهای بالا فقط snapshotهای deployment هستند.

## اصلاح فرمان migration و تشخیص خطای schema پنج Worker — 2026-10-03

- علت ریشه‌ای محتمل با شواهد source تأیید شد: فرمان قدیمی `prisma:bootstrap` فقط `prisma db execute` روی `bootstrap.sql` را اجرا می‌کرد و صرفاً namespace/schema دیتابیس را می‌ساخت؛ migrationهای نسخه‌دار را اعمال نمی‌کرد. این با خطای Analytics برای جدول موجودنبودۀ `analytics_read_model.projection_control` سازگار است. `P2010` چهار relay خطای اجرای raw SQL است؛ علت نهایی آن‌ها تا اجرای migration و مشاهده‌ی SQLSTATE امن مشخص نمی‌شود.
- در هر پنج Worker، `prisma:schema` فقط schema را می‌سازد؛ `prisma:migrate` ابتدا schema را آماده و سپس `prisma migrate deploy` اجرا می‌کند؛ `prisma:bootstrap` به همین عملیات کامل one-shot اشاره می‌کند؛ `prisma:migrate:status` برای بررسی دستی موجود است. اجرای خودکار پیش از start به‌تازگی با ADR-0015 افزوده شده است.
- نام URLهای مالکانه برای اجرای migration: `IDENTITY_ACCESS_MIGRATION_DATABASE_URL`، `ORGANIZATION_BRANCH_MIGRATION_DATABASE_URL`، `CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL`، `WALLET_MIGRATION_DATABASE_URL` و `ANALYTICS_MIGRATION_DATABASE_URL`. هرکدام باید به همان database مورد استفاده‌ی runtime و schema اختصاصی همان سرویس با مجوز DDL وصل باشد. نام متغیرهای runtime نیز در README هر Worker و `RunflareDockerDeploymentRunbook.md` ثبت شده است.
- `APP_VERSION` از `.env.example` پنج سرویس حذف شد؛ هیچ gate اجرایی به آن اضافه نشده است. چهار relay در خطای P2010 فقط SQLSTATE پنج‌کاراکتری PostgreSQL را گزارش می‌کنند و متن query، URL یا رازها را log نمی‌کنند.
- source: `lint/typecheck/test/build` با Turbo موفق (۲۸/۲۸ task) و Prettier check موفق. پنج deployment snapshot نیز هر چهار گیت lint/typecheck/test/build را گذراندند: IAM ۷۷ تست، Organization & Branch ۱۸، Customer Household ۸، Wallet ۲۳ و Analytics ۱۲؛ جمعاً ۱۳۸ تست.
- snapshotهای مستقل، فقط روی `main`، با fetch و شرط divergence صفر، بدون force-push منتشر و remote/HEAD و پاکی working tree پس از push تأیید شدند: `funtino-identity-access-worker` `093fc74085a855a1737169f8c58ab7f7cc13cbc8`؛ `funtino-organization-branch-worker` `d1ae4150196437df1083148b05af82c06dde6e5d`؛ `funtino-customer-household-worker` `25be6feeafc33e3bfe22ae7cb6639021b76da5b3`؛ `funtino-wallet-worker` `284533b55d0ae36c3373e48c93afb41b7a89d0c9`؛ `funtino-analytics-worker` `cf69430ffc380a36dd65f9d028baf0645a73a570`.
- migration واقعی هنوز در Runflare/staging اجرا نشده و health واقعی پس از این تغییر تأیید نشده است. Docker image جدید در startup هر پنج Worker migration را خودکار اجرا می‌کند؛ پس از push/redeploy باید logهای مرحله‌ای و health مشاهده شوند. اگر startup شکست خورد، `service.startup_failed` و خروجی Prisma پیشین آن را بدون هیچ متغیر/secret ارسال کنید. `42P01` می‌تواند جدول/رابطه‌ی ناموجود و `42501` مجوز ناکافی را نشان دهد؛ علت نهایی relayهای قبلی تا دیدن SQLSTATE قابل تعیین نیست.
- source monorepo این workspace `.git` و remote ندارد؛ بنابراین commit منبع وجود ندارد. SHAهای بالا فقط متعلق به deployment repositoryهای متناظر هستند.

## اجرای امن migration پیش از startup در پنج Worker — 2026-10-03

- طبق ADR-0015، runner مشترک `scripts/worker-startup.mjs` برای هر Worker نام، PostgreSQL بودن URLها، نام database یکسان و schema دقیق مالک را اعتبارسنجی می‌کند؛ host runtime و DDL می‌تواند متفاوت باشد. سپس `CREATE SCHEMA IF NOT EXISTS` و `prisma migrate deploy` را به‌ترتیب اجرا می‌کند و تنها بعد از موفقیت برنامه را start می‌کند.
- شکست config، schema bootstrap یا migration با exit code ناموفق، event مرحله‌دار و خروجی Prisma/PostgreSQL قابل‌تشخیص container را متوقف می‌کند؛ URL، password و token از stdout/stderr پاک می‌شوند ولی Prisma code و SQLSTATE حفظ می‌شود. reset، `db push` و resolve خودکار وجود ندارد. start-period healthcheck هر پنج Dockerfile به ۱۸۰ ثانیه رسید.
- package test، README و `.env.example` هر Worker به‌روزرسانی شدند تا نیاز دائمی runtime به دو URL و DDL scope محدود روشن باشد؛ ADR-0015، AGENTS و runbookهای migration نیز استثنای محدود پنج Worker را ثبت می‌کنند. `APP_VERSION` نه اضافه شده و نه بررسی می‌شود.
- گیت source: `pnpm exec turbo run lint typecheck test build ... --concurrency=1 --force` با ۲۶/۲۶ task موفق؛ هفت تست runner، syntax، Prettier و lint runner موفق. هر پنج deployment clone نیز lint، typecheck، test و build را گذراندند و test اختصاصی runner در هرکدام اجرا شد. Docker Engine daemon در workspace فعال نبود؛ build واقعی image، اجرای migration روی دیتابیس و health Runflare هنوز تأیید نشده‌اند.
- هر پنج branch قبل از commitهای نهایی با fetch روی `main` در وضعیت zero-divergence بودند؛ کد و runner با commit مستقل و push fast-forward (بدون force) منتشر شدند؛ سپس `.env.example` برای حذف `APP_VERSION` و رفع توضیح قدیمیِ migration یک commit مستنداتی جدا گرفت. SHA نهایی remote با commit محلی برابر و working tree هر clone پاک بررسی شد: `funtino-identity-access-worker` `1cc850827d7a57907c2a966dd6741d63360482e0`؛ `funtino-organization-branch-worker` `b170134274ceb8844307b9e8b198fe610d0bb0fb`؛ `funtino-customer-household-worker` `c7558e874af859dc52460a7b91380e142dd9b4e4`؛ `funtino-wallet-worker` `7e2ee3cc522cdf6bb9a658ece6e3e097187ac1c6`؛ `funtino-analytics-worker` `3970c575d5e5bf6a831ccc7525012f7903fdaa1a`.
- source در این workspace همچنان Git metadata/remote ندارد؛ کد، ADR و تغییر مستندات source فقط در workspace محلی‌اند و source commit ندارند. commitهای بالا پنج snapshot قابل‌استقرار مستقل‌اند. تکمیل نهایی production وابسته به Auto Pull/redeploy، مشاهده‌ی لاگ دو مرحله‌ی migration و health سبز هر Worker است.

## تشخیص توقف bootstrap در Runflare و محدودکردن زمان انتظار — 2026-10-03

- لاگ‌های «لاگ‌های قبلی» هر پنج Worker به‌طور یکسان `service.startup.started` و سپس `service.migration.started` با `phase=create_schema` را نشان دادند؛ هنوز نتیجه‌ی اجرای SQL در تصویر نبود. بنابراین شواهد، توقف/انتظار داخل `prisma db execute` را نشان می‌دهند، نه خطای مشخص اتصال، مجوز یا SQL؛ علت نهایی تا گرفتن خروجی subprocess قابل انتساب نیست.
- runner اکنون برای CLI مهاجرت `connect_timeout=5` را اعمال می‌کند و برای statement آماده‌سازی schema مقدار `socket_timeout=20` دارد؛ کل bootstrap حداکثر ۳۰ ثانیه و `migrate deploy` حداکثر ۱۲۰ ثانیه اجرا می‌شود. PID و زمان انتظار log می‌شوند، پس از timeout کل process group خاتمه می‌یابد و اپلیکیشن start نمی‌شود. خطای Prisma/SQLSTATE حفظ، URL/credential پاک‌سازی و timeout با `MIGRATION_COMMAND_TIMEOUT` از خطای SQL تفکیک می‌شود.
- runner اکنون ۱۰ تست دارد؛ آزمون واقعی timeout روی process ساختگی نیز تأیید کرد فرمان terminate و نتیجه‌ی زمان‌پایان ثبت می‌شود. اجرای جدید روی دیتابیس یا staging انجام نشده؛ تأیید نهایی نیازمند deploy همین نسخه و دریافت `service.migration.completed` یا خطای محدودشده به زمان است.
- Turbo source: ۲۶/۲۶ task و تست runner ۱۰/۱۰ موفق؛ `pnpm test` هر پنج snapshot نیز موفق شد و تست timeout مشترک در هر clone اجرا شد. فقط runner و تست آن به snapshotهای استقرار افزوده شدند و هر پنج push fast-forward، بدون force و بدون conflict انجام شد؛ remote SHA و working tree پاک پس از push تأیید شد: Identity Access `00220c6154c336e6bde72de82a363902a1300eb2`؛ Organization & Branch `897560c53c3ec7a5137c94bd824938a22bf72887`؛ Customer Household `f37ab21cce9a3ec867604b39913c92632fa75c51`؛ Wallet `1e5b3b4ab00b0dd34c059771772189a8dd3e306a`؛ Analytics `abd02354b7e7c3b336b0a4521a192bb85cccb1fe`.
- source workspace Git metadata/remote ندارد؛ کد و مستندات source محلی‌اند و commit source ندارند. هنوز Docker daemon، محیط اجرای Runflare یا دیتابیس واقعی برای تأیید build image/migration/health در دسترس نبود.
