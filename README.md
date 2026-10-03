# فانتینو

فانتینو یک monorepo سه‌وب‌اپلیکیشنی برای تجربه‌ی مشتری، عملیات شعب و مدیریت سامانه است.

## خروجی فعلی

- customer-web: vertical slice اولیه‌ی وب‌اپ مشتری با خانه، کارت‌ها، مأموریت‌ها، خانواده، حساب و کشف شعبه.
- operations-web: shell و داشبورد نمایشی اولیه‌ی پنل مجموعه و شعب.
- system-web: shell و نمای سلامت اولیه‌ی پنل سیستم.
- packages/design-system: tokenها و primitiveهای مشترک رابط.

داده‌ی فعلی وب‌اپ‌ها نمایشی و صریحاً با برچسب Demo است. هیچ موجودی، کارت، پرداخت یا مجوز واقعی از این داده‌ها نتیجه‌گیری نمی‌شود.

## اجرای محلی

پیش‌نیاز: Node.js 22 یا بالاتر.

    corepack enable
    pnpm install
    pnpm dev:customer

پورت‌ها:

- customer-web: http://localhost:3000/fa
- operations-web: http://localhost:3001
- system-web: http://localhost:3002

## کنترل کیفیت

    pnpm typecheck
    pnpm lint
    pnpm format:check
    pnpm build

جزئیات قراردادها، قواعد پیاده‌سازی، ساختار فولدر و راهبرد استقرار در [DOCS/README.md](DOCS/README.md) و [AGENTS.md](AGENTS.md) قرار دارد.

## Runtimeهای Runflare

انتشار برنامه در دو runtime bundle انجام می‌شود: Frontend سه Next.js process روی پورت‌های 3000 تا 3002 و Backend نه gateway/worker process روی پورت‌های 4000 تا 4080 دارد. هر دو snapshot از source monorepo ساخته می‌شوند و supervisor خروج هر process را به‌صورت fail-fast به کل container منتقل می‌کند. PostgreSQL، RabbitMQ و Redis جدا باقی می‌مانند.

ساخت خروجی‌های محلی:

    node scripts/deployment/export-runflare-bundles.mjs frontend
    node scripts/deployment/export-runflare-bundles.mjs backend

خروجی‌ها در siblingهای D:\Tiam\Projects\Mohammadiig\Funtino-deployments قرار می‌گیرند. ساخت snapshot به معنی push یا اتصال Runflare نیست. ماتریس شبکه، environment و cutover در [runbook دو runtime](DOCS/runbooks/GroupedRunflareRuntime.md) ثبت شده است.

## Backend

بک‌اند در `apps/api-gateway`، `apps/realtime-gateway`، `services/device-integration` و `services/notifications` قرار دارد. وضعیت دقیق پیاده‌سازی و مرز providerهای بیرونی در [DOCS/BackendImplementation.md](DOCS/BackendImplementation.md) و گزارش تعاملی در [DOCS/BackendImplementationCanvas.html](DOCS/BackendImplementationCanvas.html) است.

فرمان‌های اصلی:

```powershell
corepack pnpm install --no-frozen-lockfile
corepack pnpm dev:api
corepack pnpm backend:typecheck
corepack pnpm --filter @funtino/api-gateway test
corepack pnpm --filter @funtino/api-gateway prisma:generate
corepack pnpm --filter @funtino/api-gateway prisma:migrate
```

برای PostgreSQL، RabbitMQ و Redis محلی:

```powershell
docker compose -f infra/docker-compose.yml up -d
```
