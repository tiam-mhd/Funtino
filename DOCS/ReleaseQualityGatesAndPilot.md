# گیت‌های کیفیت، انتشار و پایلوت فانتینو

این سند قرارداد اجرای گیت‌های محلی و CI است. این گیت‌ها کیفیت source monorepo را می‌سنجند؛ سبزشدن CI به‌تنهایی مجوز انتشار production نیست.

## گیت خودکار CI

Workflow در .github/workflows/quality-gates.yml با Node.js 22 و pnpm 10.12.4 اجرا می‌شود و سه job مستقل دارد:

1. quality: نصب frozen، ممیزی همه‌ی dependencyها با آستانه‌ی high، بررسی قالب‌بندی، OpenAPI/AsyncAPI/JSON Schema، اعتبارسنجی wiring و JSON/YAML پایش، `promtool`/`amtool` config validation با secret مصنوعی CI، lint، typecheck، تست‌های package، build همه‌ی workspaceها و E2E امنیتی Gateway.
2. migration-and-restore: PostgreSQL 16 یک‌بارمصرف؛ migration هر پنج مالک داده دو مرتبه اجرا می‌شود و سپس custom archive روی database خالی و مجزای funtino_restore_ci restore و از نظر تعداد relation/schema مقایسه می‌شود.
3. accessibility: build سه وب‌اپ و اجرای Microsoft Edge headless با axe-core روی ورودی‌های Customer، Operations و System. violationهای critical/serious مانع CI هستند؛ moderate/minor گزارش می‌شوند و باید در backlog تجربه ثبت شوند.

بررسی قالب‌بندی pipeline فقط فایل‌های تغییرکرده نسبت به base commit را می‌سنجد؛ فایل‌های generated و build با .prettierignore از دست‌کاری formatter خارج‌اند. بررسی کامل تاریخی در صورت نیاز با pnpm format:all:check اجرا می‌شود.

اجرای محلی:

    pnpm install --frozen-lockfile
    pnpm quality:ci
    pnpm build
    pnpm test:e2e:a11y

برای تست E2E امنیتی، pnpm quality:ci پس از build، Gateway را با storage حافظه‌ای روی پورت آزاد بالا می‌آورد. health و headerهای امنیتی را کنترل می‌کند، هفت مسیر مشتری/operations/system را بدون session فراخوانی می‌کند و انتظار 401 دارد؛ metrics بدون token نیز باید 404 بدهد. این تست هیچ دیتابیس یا سرویس خارجی را تغییر نمی‌دهد.

## Scope، idempotency و event

- تست‌های authorization و controller در IAM/Gateway باید تصمیم دقیق organization/branch، رد scope نامجاز، تعلیق، stale owner و fail-closed هنگام قطع validator را پوشش دهند.
- تست‌های replay/idempotency مالک Organization & Branch، Analytics و event consumer در services/\*/tests و apps/api-gateway/src/tests در اجرای pnpm test شرکت دارند.
- E2E جدید، مرز واقعی HTTP و عدم دسترسی بدون نشست را اثبات می‌کند؛ هنوز جایگزین E2E احراز‌شده‌ی دو tenant، دو شعبه و نقش‌های متفاوت با داده‌ی seed مستقل نیست.
- تست E2E تولیدی با identity واقعی، OTP provider یا مجوز production اجرا نمی‌شود. برای پایلوت باید fixtureهای staging کنترل‌شده و شماره‌ی آزمایشی تأییدشده ایجاد شود.

## Telemetry و محرمانگی

packages/backend-core/src/observability/http-telemetry.ts برای هشت backend process (Gateway، Realtime، Device Integration، Wallet، Notifications، Identity Access، Organization & Branch و Analytics Read Model) نصب شده است:

- log تک‌خطی JSON شامل service، environment، version، request/correlation id، method، الگوی route، status و latency؛ query string، body، cookie، authorization، IP و داده‌ی مشتری ثبت نمی‌شود.
- GET /internal/metrics فقط با Authorization: Bearer پاسخ می‌دهد؛ token با مقایسه‌ی زمان‌ثابت بررسی می‌شود و endpoint بدون token 404 است.
- نام متغیرهای token برای هر backend مستقل است: API_METRICS_TOKEN، REALTIME_METRICS_TOKEN، DEVICE_INTEGRATION_METRICS_TOKEN، NOTIFICATIONS_METRICS_TOKEN، IDENTITY_ACCESS_METRICS_TOKEN، ORGANIZATION_BRANCH_METRICS_TOKEN و ANALYTICS_METRICS_TOKEN.
- هر token باید حداقل ۳۲ نویسه‌ی تصادفی، یکتا برای هر سرویس و محیط، Secret زمان اجرا و فقط برای scraper خصوصی قابل دسترس باشد. سرویس در NODE_ENV=production بدون token معتبر start نمی‌شود.
- شمارنده‌ی درخواست، مجموع latency و histogram با bucketهای محدود و labelهای service/method/route-template/status صادر می‌شود. source پیکربندی Prometheus private scrape با tokenهای مجزای backend، Grafana dashboard، Alertmanager webhook، هشدارهای availability/5xx/p95 و RabbitMQ backlog را دارد. Prometheus، Grafana و Alertmanager نیز به‌عنوان target مانیتور می‌شوند.
- Gateway خلاصه‌ی ثابت Prometheus را فقط پس از session و global permission `system.health.read` می‌خواند؛ query دلخواه، target address یا metricهای خام به کلاینت نمی‌روند. System Web صفحه‌ی loading/error/unknown/stale/empty دارد و public landing همچنان فاقد داده‌ی زنده است.
- RabbitMQ queue depth و consumer count فعال‌اند؛ DLQ/retry، freshness رویداد/دستگاه، business SLO، telemetry پایگاه‌داده و tracing توزیع‌شده هنوز به metric مالکانه متصل نیستند و نباید به‌صورت صفر/سالم نمایش داده شوند. آستانه‌های 5%، یک ثانیه و 1,000 پیام صرفاً candidate هستند.

صفحه‌ی اصلی System Web دیگر نام کاربر، تعداد کاربران/عملیات یا وضعیت سلامت ساختگی نشان نمی‌دهد. تا اتصال source واقعی، وضعیت را «بررسی‌نشده/نامشخص» نمایش می‌دهد. این صفحه‌ی معرفی public، پنل مجاز health یا audit نیست.

## Migration، backup و rollback

- هر owner schema و migration مستقل دارد. CI migration هر owner را روی دیتابیس disposable دو بار اجرا می‌کند؛ تکرار دوم باید بدون تغییر ناخواسته موفق باشد.
- اتصال runtime و migration در Gateway با DATABASE_URL و DATABASE_MIGRATION_URL جدا شده است؛ سایر ownerها نیز متغیر runtime و migration مستقل دارند. در production نقش runtime حداقل‌دسترسی و credential migration فقط در job یک‌باره‌ی انتشار استفاده شود.
- scripts/database/backup-restore-smoke.mjs تنها وقتی هر دو URL صریح داده شوند اجرا می‌شود. restore target باید database متفاوت، تازه و نامش با funtino_restore، funtino_scratch، funtino_test یا funtino_ci شروع شود. اسکریپت database را drop/create نمی‌کند؛ archive موقت را با مسیر تصادفی می‌سازد، restore می‌کند، تعداد relation/schema را مقایسه می‌کند و فقط همان پوشه‌ی موقت را پاک می‌کند. URL، password یا stderr حاوی credential چاپ نمی‌شود.
- migrationهای پروژه قرارداد down ندارند. rollback عادی یعنی deploy کردن image قبلی فقط وقتی schema با نسخه‌ی قبلی backward-compatible است. migration ناسازگار از الگوی expand → deploy سازگار → backfill/verify → contract پیروی می‌کند. بازگردانی دیتابیس فقط از backup تأییدشده، روی incident و با مجوز مالک داده انجام می‌شود؛ هیچ فرمان خودکار production برای drop یا restore وجود ندارد.
- CI یک restore ساختاری را ثابت می‌کند، نه RPO/RTO، صحت داده‌ی مشتری، بازیابی object storage، PITR، replication یا backup خارج از provider. این‌ها باید در staging و runbook عملیات اندازه‌گیری و ثبت شوند.

## گیت دستی انتشار و پایلوت

انتشار فقط پس از تأیید همه‌ی موارد زیر مجاز است:

1. CI اجباری روی commit source موفق باشد و dependency audit بدون آسیب‌پذیری high/critical حل‌نشده بگذرد.
   تنظیم branch protection در GitHub باید هر سه job workflow را required کند؛ این تنظیم remote در این workspace قابل اعمال/تأیید نبود.
2. تصمیم ADR-0010 پذیرفته و مصرف validator در مسیر write پیاده شده است؛ CI باید تست‌های allow/deny/timeout را اجرا کند و staging باید credential، شبکه‌ی داخلی، پاسخ active/inactive و رفتار fail-closed را اثبات کند. تا تأیید staging و deployment، این source change به‌تنهایی مجوز پایلوت نیست.
3. migration و backfill واقعی در staging، reconciliation شمارش/parent/status و rollback سازگار با نسخه‌ی قبلی ثبت شود.
4. E2E احراز‌شده با حداقل دو organization، دو branch و actorهای جدا اثبات کند read/write از scope همسایه عبور نمی‌کند؛ idempotent replay همان نتیجه را می‌دهد و reuse کلید با payload متفاوت conflict است.
5. سه وب‌اپ با Edge/موبایل، RTL، keyboard/focus، empty/error/stale و axe audit بازبینی شوند؛ فقط scan خودکار کافی نیست.
6. metrics tokenها و targetهای واقعی در secret store/شبکه‌ی خصوصی تنظیم شوند؛ Prometheus، dashboard، Alertmanager webhook و alert delivery با synthetic alert به مقصد آزمایشی راستی‌آزمایی شوند؛ آستانه‌ها و log retention/redaction را عملیات تصویب کند. DLQ/freshness فقط پس از پیاده‌سازی metric مالکانه وارد gate شود.
7. backup مستقل، restore کامل همراه داده‌ی آزمایشی و object storage، زمان بازیابی، RPO/RTO و runbook incident تمرین و امضا شود.
8. هر سرویس deploy مستقل image سالم، health/readiness، secret/CORS/domain درست و smoke پس از deploy داشته باشد؛ rollback همان سرویس به image قبلی تمرین شود.
9. شناسه‌ی source commit، deployment commit، branch/repository، آیتم Runflare، نتیجه‌ی migration، approverهای Product/Security/Operations و زمان پایلوت ثبت شوند.

`pnpm test:e2e:a11y` سه وب‌اپ را با build directory جداگانه‌ی `.next-a11y-*` و پورت‌های پویا روی loopback اجرا می‌کند تا با dev server موجود تداخل نداشته باشد. در desktop و viewport موبایل 390px، routeهای ثبت‌شده از نظر `lang`/RTL، overflow افقی، پیمایش Tab و focus قابل‌مشاهده و axe بررسی می‌شوند. stateهای کارت، دستگاه و مجموعه با fixture مصنوعی فقط در مرورگر ساخته می‌شوند؛ این fixtureها مجوز یا E2E احرازشده‌ی staging را اثبات نمی‌کنند. بررسی screen reader واقعی و تأیید نهایی بصری روی دستگاه موبایل همچنان دستی است.

## وضعیت فعلی و محدودیت انتشار

Workflow کیفیت در source ایجاد شده است؛ اجرای GitHub Actions هنوز اثبات نشده، چون این workspace .git و remote قابل استفاده ندارد. تلاش برای ساخت PostgreSQL 17 کاملاً موقت جهت restore drill پیش از راه‌اندازی cluster به‌علت محدودیت ساخت restricted token در sandbox ویندوز شکست خورد؛ هیچ دیتابیسی روی PostgreSQL service موجود ساخته یا تغییر داده نشد. Docker Engine محلی نیز در دسترس نیست. deployment repositoryها/آیتم‌های Runflare برای IAM، Organization & Branch و Analytics هنوز provision نشده‌اند. validator IAM→Owner در source و ADR-0010 پذیرفته شده‌اند؛ اتصال secrets/network و smoke واقعی staging هنوز gate است. این تغییر هیچ clone استقرار را ویرایش، commit، push یا منتشر نمی‌کند.

بنابراین تحویل این گام «پیاده‌سازی و پیکربندی source» است، نه تأیید runtime/production یا پایلوت. باقیمانده‌های صریح: اجرای workflow روی remote، آزمون staging اتصال owner و tenant E2E احراز‌شده، backup/restore واقعی staging، اجرای Prometheus/Grafana/Alertmanager و اثبات alert delivery، آماده‌سازی deployment repositoryهای فاقد provision و تمرین rollback واقعی image/incident. شرح مراحل و رکورد تمرین در [runbook backup/restore و rollback](runbooks/backup-restore-rollback.md) است.
