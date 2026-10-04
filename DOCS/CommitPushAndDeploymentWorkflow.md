# قانون canonical برای commit، push و انتشار فانتینو

## ۱. Repositoryها

| نقش | مسیر محلی | کاربرد |
|---|---|---|
| Source monorepo | D:\\Tiam\\Projects\\Mohammadiig\\Funtino | تمام توسعه، قرارداد، shared package و تغییرات مستند |
| Frontend runtime | D:\\Tiam\\Projects\\Mohammadiig\\Funtino-deployments\\funtino-frontend-runtime | snapshot قابل اجرا برای یک Runflare item |
| Backend runtime | D:\\Tiam\\Projects\\Mohammadiig\\Funtino-deployments\\funtino-backend-runtime | snapshot قابل اجرا برای یک Runflare item |

Source Git فقط در ریشه‌ی Funtino است. هر دو runtime repository، Git مستقل sibling هستند؛ داخل source submodule یا nested repository ساخته نمی‌شود. Funtino-platform.code-workspace فقط پوشه‌ها را باز می‌کند و هیچ sync یا push خودکاری انجام نمی‌دهد.

Source monorepo منبع حقیقت است. Runtime repositoryها snapshot قابل استقرارند و محل توسعه‌ی feature نیستند. Git init محلی، commit، remote، GitHub، Auto Pull و Runflare اتصال‌های جدا هستند؛ آماده‌سازی snapshot هیچ‌یک را به‌خودی‌خود ایجاد نمی‌کند.

## ۲. نگاشت source به bundle و Runflare

| Source path | Bundle/repository | Processها | Runflare item |
|---|---|---|---|
| apps/customer-web، apps/operations-web، apps/system-web، packages/design-system | frontend / funtino-frontend-runtime | 3000، 3001، 3002 | Funtino Frontend |
| apps/api-gateway، apps/realtime-gateway، هفت service موجود در services/*، packages/backend-core، packages/event-contracts، scripts/worker-startup.mjs و scripts/runtime-bundle | backend / funtino-backend-runtime | 4000 تا 4080 طبق manifest | Funtino Backend |
| infra/docker-compose.yml یا providerهای managed | بدون Git deployment | PostgreSQL، RabbitMQ، Redis | itemهای داده‌ی مستقل |

فرانت سه host مستقل را به پورت‌های 3000 تا 3002 route می‌کند. Backend، api.funtino.ir را به 4000 و realtime.funtino.ir را به 4010 route می‌کند. پورت‌های 4020 تا 4080 فقط route خصوصی دارند. endpointهای عمومی HTTPS هستند؛ processهای Backend برای ارتباط داخلی از ClusterIP name/Port واقعی Runflare طبق ADR-0018 استفاده می‌کنند.

هر تغییر app به bundle والد می‌رود. تغییر design-system، backend-core یا event-contracts bundle مصرف‌کننده را کامل می‌سازد. تغییر root toolchain، lockfile یا contract مشترک که هر دو را تحت تأثیر می‌گذارد، هر دو snapshot را تولید می‌کند. تغییر مستندات صرفاً مستقر نمی‌شود.

ماتریس دقیق entrypoint، port، network، domain و env در [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) و manifestهای scripts/runtime-bundle قرار دارد.

## ۳. ترتیب کار

1. منبع حقیقت، source path، processها و bundleهای اثرپذیرفته را مشخص کن.
2. AGENTS.md، ImplementationRules، FolderAndFileStructure، ArchitectureAndDesignPatterns، RunflareRepositoryAndDeployment، فاز مرتبط و ADR/contracts مرتبط را بخوان.
3. تغییر عادی را ابتدا فقط در source monorepo انجام بده. منطق app/service را برای راحتی در snapshot توسعه نده.
4. اسناد، contract، migration، telemetry و env example لازم را source-side به‌روزرسانی کن.
5. پیش از release، گیت‌های کیفیت متناسب با source و snapshot را اجرا کن. مستندات کیفیت/پایلوت مرجع است.
6. snapshot خودبسنده را با exporter رسمی source به هر bundle متأثر تولید کن. خروجی نباید به parent source، node_modules، cache، .env واقعی یا buildهای محلی وابسته باشد.
7. از clone مقصد build و بررسی diff انجام بده. هیچ deployment را با overwrite خاموش تغییرات محلی sync نکن.
8. فقط پس از درخواست روشن انتشار، remote هر clone را fetch و divergence را کنترل کن. stage باید pathهای موردنظر را صریح نام ببرد.
9. بعد از push، commit و Auto Pull/redeploy را جداگانه ثبت و وضعیت health را بررسی کن.

این کارِ پیاده‌سازی repository و snapshot را آماده می‌کند؛ commit/push یا تغییر واقعی در پنل Runflare بدون درخواست صریح انتشار انجام نمی‌شود.

## ۴. ساخت snapshot

فرمان source برای تولید خروجی:
- node scripts/deployment/export-runflare-bundles.mjs frontend
- node scripts/deployment/export-runflare-bundles.mjs backend
- node scripts/deployment/export-runflare-bundles.mjs all

Exporter از چند-scope prune در pnpm/Turbo استفاده می‌کند و runtime supervisor، manifest، worker-startup runner و Dockerfile متناظر را به root snapshot می‌گذارد. Exporter مسیر مقصد را به دو sibling مصوب محدود می‌کند، receipt هش‌دار برای snapshot می‌سازد و مقصد دارای فایل تغییرکرده، staged یا اضافه را overwrite نمی‌کند.

در inventory محتوای clone مقصد، فقط مسیرهای خروجی و cache استاندارد (`node_modules`، `.next`، `dist`، `generated`، `.turbo` و `coverage`) نادیده گرفته می‌شوند تا build محلی مانع انتشار نشود؛ فایل‌های غیر از این مسیرها همچنان با receipt و وضعیت Git کنترل می‌شوند. خروجی Turbo prune نیز پیش از ساخت snapshot از cache محلی پاک می‌ماند.

در clone دارای origin، exporter عادی از sync خودداری می‌کند. فقط برای release درخواست‌شده از گزینه‌ی `--release` استفاده شود؛ این حالت ابتدا working tree را پاک می‌خواهد، سپس `git fetch origin main` و divergence برابر `0 0` را کنترل می‌کند و snapshot را آماده‌ی stage می‌سازد. این گزینه commit یا push نمی‌کند. برای اولین bootstrap، ابتدا snapshot محلی را بساز و بعد remote را متصل کن.

Dockerfile root از Node.js 22 و pnpm 10.12.4 استفاده می‌کند. NEXT_PUBLIC_* فقط build-time است. هیچ secretی وارد Docker ARG، image layer یا repository نمی‌شود. secret هر process فقط در runtime Environment/Secret و طبق env allow-list آن child تعریف می‌شود.

## ۵. کنترل conflict پیش از commit/push

برای هر یک از دو clone:

- git status --short --branch
- git fetch origin main
- git rev-list --left-right --count HEAD...origin/main

فقط مقدار 0 0 برای ادامه مجاز است. اگر remote وجود ندارد یا هنوز first commit/branch نساخته، push متوقف می‌شود و باید وضعیت دقیق repository مشخص شود. در تغییرات uncommitted overwrite/reset/rebase مخفی انجام نده.

پیش از commit:
- git diff --check
- git diff --stat
- git status --short

بعد از stage فقط pathهای مشخص را اضافه کن و این‌ها را اجرا کن:
- git diff --cached --check
- git diff --cached --stat
- git status --short

force-push، force-with-lease، reset --hard و checkout -- . برای حل اختلاف ممنوع‌اند.

## ۶. Commit و release identity

Source commit، deployment commit و deployed revision سه مقدار مستقل هستند. اگر source remote ندارد، گزارش دقیق بنویسد: Source commit: unavailable — source monorepo has no configured Git remote. هرگز SHA deployment را به‌جای source commit معرفی نکن.

هر deployment repository commit مستقل دارد. پس از راه‌اندازی remote، branch متصل به Runflare معمولاً main خواهد بود. تا پیش از اتصال remote هیچ ادعایی درباره‌ی GitHub، webhook، Auto Pull یا deploy انجام نده.

نمونه‌ی مرحله‌ی push که نیازمند درخواست انتشار کاربر است:
- git add <paths-explicitly-listed>
- git commit -m "<release subject>"
- git push origin main

## ۷. Migration و ترتیب انتشار

Database schema و migration با انتشار app یکی فرض نمی‌شود. Migration نسخه‌دار، owner-specific و قبل از consumer اجرا می‌شود. فقط پنج Worker مشخص‌شده در ADR-0015 startup migration دارند. API Gateway، Realtime، Device Integration و Notifications migration را در startup اجرا نمی‌کنند.

تغییر contract/database باید سازگاری processهای هر دو revision را بررسی کند. برای migration ناسازگار برنامه‌ی expand/contract و rollback لازم است. یک backend bundle واحد کل ۹ process را با هم rollback می‌کند.

## ۸. گزارش اجباری انتشار

| فیلد | مقدار لازم |
|---|---|
| Source path و source revision | مسیرهای واقعی و hash source، یا اعلام نبود remote |
| Bundle | frontend، backend یا هر دو و دلیل انتخاب |
| Deployment repository | نام، مسیر clone و branch |
| Deployment commit | hash همان repository |
| Runflare item | نام، ports، domains و revision مشاهده‌شده |
| Validation | lint/typecheck/test/build، Docker، health و smoke |
| Push safety | fetch، divergence و نبود force-push |
| Secrets/network | فقط وضعیت تأیید، بدون مقدار credential |
| Open risks | migration، ClusterIP/private network، منابع، rollback یا setup تأییدنشده |

اگر هر مورد از پنل/remote قابل مشاهده نباشد، «تأیید نشده» ثبت می‌شود؛ نبود مشاهده به‌معنای موفقیت نیست.

## مراجع

- [ADR-0016](decisions/0016-grouped-frontend-backend-runtime-deployments.md)
- [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md)
- [Runbook دو runtime](runbooks/GroupedRunflareRuntime.md)
