# ADR-0004: استقرار Docker برای deployment repositoryهای pnpm

- وضعیت: accepted
- تاریخ: 2026-09-27
- دامنه: Dockerfile، package manager، build و runtime سرویس‌های متصل به Runflare

## مسئله

هفت deployment repository فانتینو self-contained هستند، اما root scriptهای آن‌ها از workspace و `pnpm --filter` استفاده می‌کنند. اجرای آن‌ها در Native NodeJS/NextJS به رفتار نصب dependency و commandهای پنل Runflare وابسته می‌شود و خطای `pnpm not found` نیز نشان داد که pnpm را نباید به‌صورت پیش‌فرض از محیط Native فرض کرد.

## تصمیم

هر هفت deployment repository زیر با application نوع `Docker` در Runflare مستقر می‌شوند:

- `funtino-customer-app`
- `funtino-operations-web`
- `funtino-system-web`
- `funtino-api-gateway`
- `funtino-realtime-gateway`
- `funtino-device-worker`
- `funtino-notifications-worker`

هر repository در root خود Dockerfile و `.dockerignore` دارد. Dockerfileهای فعلی:

- از `node:22-bookworm-slim` استفاده می‌کنند؛
- `pnpm@10.12.4` را داخل image نصب و registry را روی mirror Runflare تنظیم می‌کنند؛
- با `pnpm install --frozen-lockfile` نصب reproducible انجام می‌دهند؛
- build را داخل image اجرا می‌کنند؛
- port و health check سرویس را اعلام می‌کنند؛
- پس از build با کاربر غیر root اجرا می‌شوند؛
- secret را از repository یا Docker `ARG` دریافت نمی‌کنند.

## دلیل رد Native NodeJS/NextJS برای snapshot فعلی

Native می‌تواند برای یک repository ساده‌ی npm/yarn مناسب باشد، اما این snapshotها root workspace و filter script دارند و باید رفتار pnpm در install/build/start قطعی باشد. Docker به Runflare یک build context روشن و runtime ثابت می‌دهد و خطای وابستگی به pnpm نصب‌شده در پنل را حذف می‌کند.

## پیامدها

### مزایا

- نسخه‌ی Node و pnpm بین local، CI و Runflare قابل تکرارتر می‌شود.
- وب‌اپ، gateway و worker از یک قرارداد build/start/health استفاده می‌کنند.
- Runflare فقط root repository و Dockerfile را می‌بیند و به working directory مخفی نیاز ندارد.
- secretهای runtime از image و GitHub جدا می‌مانند.

### هزینه‌ها و ریسک‌ها

- image فعلی برای اطمینان عملی single-stage است و dev dependencyها را هم در image نگه می‌دارد؛ بعداً می‌توان با آزمون کامل به multi-stage کم‌حجم‌تر مهاجرت کرد.
- build به دسترسی registry و mirror نیاز دارد؛ مقدار پیش‌فرض Dockerfile `https://mirror-npm.runflare.com` است.
- `NEXT_PUBLIC_*` در Next.js build-time هستند؛ تغییر آن‌ها پس از build با restart runtime اثر نمی‌کند و باید build مجدد انجام شود.
- Docker build واقعی تا زمان در دسترس بودن Docker Engine و اجرای build در Runflare/CI کامل محسوب نمی‌شود.

## کنترل‌های اجرایی

- build context هر سرویس فقط root همان deployment repository است.
- قاعده‌ی عمومی اجرای migration جدا از Docker/start است؛ استثنای محدود پنج Worker طبق ADR-0015 است که migration مالکانه را fail-closed پیش از اجرای برنامه انجام می‌دهند. API Gateway و سایر app/serviceها همچنان release step جدا دارند.
- هر تغییر باید ابتدا در source monorepo و pipeline انتشار برگردانده شود؛ Dockerfileهای deployment فعلی برای bootstrap/hotfix ساخته شده‌اند و push آن‌ها بدون sync source نباید به روند عادی تبدیل شود.
- مراحل پنل و environmentها در [RunflareDockerDeploymentRunbook.md](../RunflareDockerDeploymentRunbook.md) اجباری است.

## منابع

- [سرویس Docker Runflare](https://runflare.com/%D9%87%D8%A7%D8%B3%D8%AA-%D8%A7%D8%A8%D8%B1%DB%8C-docker/)
- [اتصال GitHub و Auto Pull Runflare](https://runflare.com/docs/ci-cd-setup/how-to-add-github/)
- [تنظیم environment Runflare](https://runflare.com/docs/setup-environment-variable/)
