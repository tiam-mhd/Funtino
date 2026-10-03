# قوانین اجرای پروژه فانتینو

این فایل قرارداد اجرایی پروژه است و برای هر تغییر کد، تنظیمات، تست یا مستندات در مخزن باید رعایت شود.

## سلسله‌مراتب تصمیم‌گیری

1. درخواست صریح کاربر در همان کار.
2. این فایل و قوانین لازم‌الاجرای [DOCS/ImplementationRules.md](DOCS/ImplementationRules.md).
3. تصمیم‌های معماری و طراحی در مستندات اجرایی `DOCS`.
4. فایل‌های `FirstAnalysis.md`، `RealTimeANDNonDependencyModules.md` و `TechAnalysis.md` به‌عنوان تحلیل و منبع تصمیم، نه دستور اجرایی مستقل.

اگر دو منبع هم‌سطح ناسازگار باشند، قبل از پیاده‌سازی تعارض را در مستند تصمیم ثبت و برای انتخاب نهایی سؤال کن. از حدس‌زدن در مورد منبع حقیقت مالی، مجوز دسترسی یا قرارداد سرویس مجاز نیست.

## گیت اجباری پیش از کدنویسی

پیش از ایجاد یا ویرایش هر فایل تولیدی، باید همه‌ی قوانین و اسناد مؤثر بر آن تغییر خوانده و با هم تطبیق داده شوند؛ فقط خواندن یک تحلیل یا یک فایل ساختار کافی نیست. حداقل منابع بررسی عبارت‌اند از:

- همین فایل؛
- `DOCS/ImplementationRules.md`؛
- `DOCS/FolderAndFileStructure.md`؛
- `DOCS/ArchitectureAndDesignPatterns.md`؛
- `DOCS/RunflareRepositoryAndDeployment.md`؛
- فاز مربوط در `DOCS/PhasesAndExecutionPlan.md`؛
- قراردادها و ADRهای مرتبط در `contracts/` و `DOCS/decisions/`، در صورت وجود.

خروجی این بررسی باید پیش از کدنویسی روشن کند:

1. فایل جدید دقیقاً در کدام مسیر مصوب قرار می‌گیرد؛
2. مرز app، service، package، contract و deployment چیست؛
3. ساختار واقعی repository با ساختار مستندشده سازگار است؛
4. قرارداد، منبع حقیقت، scope، تست و معیار پذیرش چیست؛
5. اثر تغییر بر deployment repository و آیتم Runflare چیست.

ساختن ساختار موقت و انتقال آن در پایان کار مجاز نیست. اگر ساختار فعلی با سند ناسازگار است، ابتدا باید سند/ADR و ساختار هدف تعیین تکلیف شود و تا آن زمان کد تولیدی ایجاد نشود. هر استثنا باید پیش از پیاده‌سازی در `DOCS/decisions/` ثبت و به اسناد ساختار و قوانین منعکس شود.

## قواعد غیرقابل‌مذاکره

- محتوای فایل `این فایل رو نمیخواد بخونی هیچ وقت.txt` محرمانه‌ی محلی است؛ آن را با هیچ ابزار، جست‌وجوگر، analyzer یا فرایند packaging باز یا پردازش نکن. فایل در Git ignore می‌ماند.
- محصول سه بستر مستقل دارد: `customer-web`، `operations-web` و `system-web`.
- هر سه بستر باید RTL، mobile-first در مسیرهای لازم، قابل‌دسترس و مبتنی بر Design System مشترک باشند؛ شخصیت بصری هر بستر می‌تواند متناسب با نقش کاربر تغییر کند.
- سرویس‌های دامنه مالک داده‌ی خود هستند. خواندن یا نوشتن مستقیم جدول سرویس دیگر ممنوع است.
- ارتباط عادی بین سرویس‌ها رویدادمحور است. رویدادها باید قرارداد نسخه‌دار، Outbox/Inbox و مصرف‌کننده‌ی idempotent داشته باشند.
- PostgreSQL منبع حقیقت داده‌های عملیاتی و مالی است. Redis هرگز منبع حقیقت موجودی، پرداخت یا دفتر تراکنش نیست.
- کارت و سامانه‌ی فیزیکی در شروع از طریق Adapter/Anti-Corruption Layer و ترجیحاً به‌صورت خواندنی متصل می‌شوند.
- مجوز هر درخواست بر اساس نقش و محدوده‌ی سازمان/شعبه روی سرور بررسی می‌شود؛ پنهان‌کردن کنترل در رابط کافی نیست.
- اطلاعات کودک و داده‌های حساس حداقلی جمع‌آوری می‌شوند و هر دسترسی مدیریتی حساس audit می‌شود.
- هیچ راز، رمز، توکن یا داده‌ی واقعی مشتری در کد، تست، commit یا مستند عمومی قرار نمی‌گیرد.
- تغییرات مالی باید append-only، قابل‌ممیزی، idempotent و قابل‌بازیابی باشند.
- هر قابلیت قبل از تکمیل باید قرارداد، تست، لاگ، خطا، دسترس‌پذیری و مستندات لازم خود را داشته باشد.

## قانون Repository و استقرار Runflare

- repository اصلی فانتینو یک monorepo و منبع حقیقت توسعه است؛ Git ریشه‌ی source از Git دو deployment repository مستقل جداست.
- فایل `Funtino-platform.code-workspace` فقط نمای چندریپویی VS Code است و هیچ همگام‌سازی خودکاری بین source monorepo و deployment repositoryها انجام نمی‌دهد.
- تمام تغییرات عادی کد، رابط کاربری، قرارداد و shared package باید ابتدا در source monorepo و مسیر مصوب آن‌ها انجام شوند؛ ویرایش مستقیم cloneهای متصل به Runflare محل توسعه‌ی اصلی نیست.
- قانون جزئی و اجرایی commit/push در [DOCS/CommitPushAndDeploymentWorkflow.md](DOCS/CommitPushAndDeploymentWorkflow.md) ثبت شده و برای هر چت/عامل توسعه لازم‌الاجرا است؛ در صورت ابهام، همان سند مرجع انتخاب repository مقصد، ماتریس اثر و کنترل conflict است.
- برای app یا serviceهای قابل استقرار، Git submodule یا repository تو‌در‌تو داخل monorepo نساز.
- هر آیتم application از یکی از دو runtime bundle مصوب ADR-0016 می‌آید: `funtino-frontend-runtime` یا `funtino-backend-runtime`. هر repository فقط به یک item Runflare و یک branch متصل می‌شود؛ PostgreSQL، RabbitMQ و Redis همچنان itemهای داده‌ی بدون Git هستند.
- source monorepo مستقیماً به Runflare متصل نمی‌شود؛ دو bundle snapshot self-contained با root اجرایی مشخص تولید می‌شوند. هر دو app و serviceهای داخل bundle مرز کد/process، port، owner، قرارداد و environment allow-list مستقل خود را حفظ می‌کنند.
- deployment repository خروجی pipeline یا controlled snapshot release است و محل توسعه‌ی feature نیست. تا وقتی pipeline انتشار آماده نیست، تولید snapshot از source و commit/push کنترل‌شده‌ی deployment repository مجاز است.
- در وضعیت فعلی source monorepo remote/pipeline انتشار قابل‌استفاده ندارد؛ hash deployment هرگز به‌عنوان source commit گزارش نمی‌شود و نبود source commit باید صریح اعلام شود.
- انتشار باید با ماتریس اثر انجام شود؛ تغییر shared package/contract/config همه‌ی bundleهای اثرپذیرفته را بسته‌بندی می‌کند.
- هر runtime repository به یک آیتم Runflare، یک branch و یک webhook/Auto Pull مشخص متصل می‌شود.
- credential اتصال Runflare به GitHub از credential نوشتن pipeline جدا و هر دو حداقل‌دسترسی هستند؛ force-push به deployment repository ممنوع است.
- نام repositoryهای استقرار فعلی Organization در [RunflareRepositoryAndDeployment.md](DOCS/RunflareRepositoryAndDeployment.md) مرجع است؛ bootstrap اولیه‌ی ریپوهای خالی می‌تواند یک‌بار دستی انجام شود و تا آماده‌شدن pipeline، controlled snapshot release نیز طبق سند canonical مجاز است؛ بعد از آماده‌شدن pipeline، همان pipeline مسیر پیش‌فرض انتشار خواهد بود.
- هرگاه کاربر درخواست «commit»، «push»، «انتشار» یا «به‌روزرسانی Runflare» داد، ابتدا باید همه‌ی app/service/package/contractهای اثرپذیرفته مشخص شود، تغییر در source monorepo انجام شود، سپس snapshot self-contained هر bundle متناظر تولید/همگام و از همان clone اعتبارسنجی شود؛ فقط bundleهای اثرپذیرفته commit/push شوند.
- اگر تغییر در shared package، contract یا قابلیت مشترک باشد، همه‌ی runtime bundleهای اثرپذیرفته باید پیش از commit/push شناسایی، همگام و redeploy شوند؛ انتشار فقط بخشی از bundle backend یا frontend مجاز نیست.
- قبل از هر commit/push باید اختلاف source و deployment بررسی شود، `git fetch origin main` و `git rev-list --left-right --count HEAD...origin/main` برای همان clone اجرا شود و فقط در وضعیت `0 0` ادامه داده شود. در گزارش، source revision/نبود remote، deployment commit، repository مقصد، branch، آیتم Runflare، نتیجه‌ی build/test و وضعیت Auto Pull ذکر می‌شود. اگر source هنوز remote یا pipeline انتشار ندارد، وضعیت controlled/manual snapshot و محدودیت باید صریح گزارش شود؛ هرگز ادعا نکن که sync خودکار انجام شده است.
- ویرایش مستقیم deployment repository فقط با درخواست صریح برای hotfix مجاز است؛ در این حالت همان تغییر باید بلافاصله به source monorepo برگردانده شود تا در انتشار بعدی از بین نرود.
- push دستی snapshot در deployment repository، وقتی از source تولید شده و pipeline انتشار در دسترس نیست، با درخواست انتشار کاربر مجاز است و «ویرایش مستقیم feature» محسوب نمی‌شود؛ stage باید pathهای صریح داشته باشد و force-push، reset مخرب و overwrite تغییرات uncommitted ممنوع است.
- تمام deployment snapshotهای Docker متصل به Runflare باید Dockerfile و `.dockerignore` را در root داشته باشند. نوع سرویس Runflare برای این snapshotها `Docker` است؛ نصب pnpm، build، start و health check داخل Dockerfile کنترل می‌شود و نباید در پنل Native NodeJS/NextJS command جداگانه تعریف شود.
- processهای هر bundle از manifest و supervisor صریح اجرا می‌شوند؛ خروج child باید کل container را fail کند و health check root همه‌ی portهای manifest را بسنجد. هر child فقط allow-list environment خودش را دریافت می‌کند؛ این allow-list جداسازی امنیتی processهای یک container/UID نیست.
- Dockerfileهای فعلی روی Node.js 22 و pnpm 10.12.4 pin شده‌اند. متغیرهای `NEXT_PUBLIC_*` در زمان build کلاینت Next.js مصرف می‌شوند و secretهای backend فقط به‌صورت Environment/Secret زمان اجرا در خود آیتم Runflare تنظیم می‌شوند؛ هیچ secretی در `ARG`، image یا repository قرار نمی‌گیرد.
- تغییر shared package یا contract باید همه‌ی runtime bundleهای مصرف‌کننده‌ی اثرپذیرفته را redeploy کند؛ redeploy فقط process تغییرکرده در یک bundle در این حالت ممکن نیست.
- migration دیتابیس اصولاً از انتشار app جدا، نسخه‌دار و قابل rollback است؛ فقط برای پنج Worker مشخص‌شده در ADR-0015، به درخواست صریح مالک محصول، startup runner امن و fail-closed پیش از start برنامه migrationهای pending را اجرا می‌کند. این استثنا به API Gateway، وب‌اپ‌ها یا سرویس دیگر تسری ندارد.
- جزئیات این تصمیم در [DOCS/CommitPushAndDeploymentWorkflow.md](DOCS/CommitPushAndDeploymentWorkflow.md)، [DOCS/RunflareRepositoryAndDeployment.md](DOCS/RunflareRepositoryAndDeployment.md) و ساختار آن در [DOCS/FolderAndFileStructure.md](DOCS/FolderAndFileStructure.md) اجباری است.

## نظم اجرای کار

برای هر قابلیت این ترتیب رعایت شود:

1. تعیین بستر، نقش کاربر، محدوده‌ی دسترسی و منبع حقیقت.
2. تعریف مدل دامنه و وضعیت‌های مجاز.
3. تعریف OpenAPI و در صورت نیاز AsyncAPI/JSON Schema.
4. پیاده‌سازی مالک داده و تراکنش.
5. پیاده‌سازی Outbox/Inbox و مصرف idempotent در صورت رویداد.
6. پیاده‌سازی API و سپس رابط کاربری هر بستر.
7. افزودن تست، telemetry، audit و مستندات.
8. بررسی Definition of Done در `DOCS/ImplementationRules.md`.

فقط بعد از کامل‌شدن تحلیل و قرارداد می‌توان کد تولیدی نوشت. اگر درخواست کاربر فقط مستندسازی است، هیچ کد محصولی ایجاد یا اصلاح نکن.

## تحویل هر تغییر

در پایان هر کار باید این موارد گزارش شوند:

- فایل‌های تغییرکرده و دلیل هر تغییر؛
- قراردادها و تصمیم‌های معماری اثرپذیرفته؛
- تست‌های اجراشده یا دلیل اجرا نشدن آن‌ها؛
- ریسک‌ها، فرض‌ها و سؤال‌های باز؛
- تغییرات لازم در مستندات.

## قانون اجرایی هویت مشتری

- اپلیکیشن مشتری سطح اصلی اجرای پروژه است. هر تسک مشتری باید end-to-end شامل API، persistence، validation، امنیت، stateها، UI واکنش‌گرا و تست انجام شود؛ پنل‌های operations و system فقط سطح مدیریتی لازم برای مدیریت همان قابلیت را پیاده می‌کنند، اما UI آن محدوده باید کامل باشد.
- ثبت‌نام/ورود OTP فقط identity و session مشتری را ایجاد یا بازیابی می‌کند و هرگز شعبه‌ای را خودکار انتخاب یا تخصیص نمی‌دهد.
- رابطه‌ی مشتری با شعبه فقط از کارت متصل‌شده با `branchId` معتبر به‌دست می‌آید. در onboarding پروفایل مشتری نباید انتخاب شعبه اضافه شود.
- credentialهای Parsgreen فقط secret زمان اجرا هستند. `PARSGREEN_API_TOKEN`، کد واقعی OTP و پاسخ provider حاوی credential هرگز نباید commit شوند؛ در production نبودن token باید fail-closed باشد.
- قبل از نمایش navigation اصلی، تکمیل پروفایل با نام، نام خانوادگی، تاریخ تولد، جنسیت، شهر و یک تصویر بارگذاری‌شده یا avatar preset تأییدشده لازم است.
- تغییر این قواعد فقط وقتی کامل محسوب می‌شود که [CustomerIdentityAndProfile.md](DOCS/CustomerIdentityAndProfile.md)، ADR مرتبط در `DOCS/decisions/`، OpenAPI، تست‌ها و یادداشت تنظیمات deployment نیز به‌روز شده باشند.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Funtino** (8830 symbols, 21053 relationships, 758 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/Funtino/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Funtino/clusters` | All functional areas |
| `gitnexus://repo/Funtino/processes` | All execution flows |
| `gitnexus://repo/Funtino/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
