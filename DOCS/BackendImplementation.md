# Backend implementation baseline

تاریخ این نسخه: 2026-09-27

این سند وضعیت واقعی پیاده‌سازی بک‌اند را ثبت می‌کند. سندهای تحلیل و قوانین پروژه منبع تصمیم هستند؛ این فایل گزارش implementation است و جای آن‌ها را نمی‌گیرد.

## خروجی پیاده‌سازی‌شده

### API Gateway

`apps/api-gateway` با NestJS، Fastify و REST versioned ساخته شده است:

- OTP با normalize شماره، انقضا، حداکثر پنج تلاش، rate limit اولیه و session cookie امن؛
- `GET /health/live` و `GET /health/ready`؛
- پاسخ استاندارد `status/data/meta` با `requestId` و `correlationId`؛
- خطای استاندارد برای validation، authentication، authorization، conflict، not found و dependency failure؛
- مرز DTO و Zod برای ورودی HTTP؛
- household و member با بررسی مالکیت/عضویت؛
- اتصال کارت با جلوگیری از اتصال کارت متعلق به خانواده دیگر؛
- wallet summary و ledger query؛
- فهرست mission و claim idempotent؛
- audit برای تغییرات حساس؛
- CORS credentialed و security headers پایه؛ CORS صراحتاً `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` و headerهای `Content-Type`, `Authorization`, `X-Requested-With` را برای preflight مجاز می‌کند؛
- Outbox relay با RabbitMQ Confirm Channel و رفتار امن در نبود RabbitMQ.

### Storage و transaction

- `InMemoryFuntinoStore` فقط برای توسعه و تست است.
- `PrismaFuntinoStore` منبع اجرای PostgreSQL است و با `STORAGE_MODE=postgres` فعال می‌شود.
- migration اولیه در `apps/api-gateway/prisma/migrations/0001_initial` ثبت شده است.
- OTP attempt/consume، ساخت خانواده، اتصال کارت، claim و ledger در adapter پایدار ذخیره می‌شوند.
- ledger append-only است و idempotency key یکتا دارد.
- Outbox در همان transaction تغییر دامنه ذخیره می‌شود.
- Wallet event consumer مأموریت و رخداد دستگاه را به ledger تبدیل می‌کند و event `wallet.wallet-credited.v1` را از مسیر Outbox می‌سازد.

### Event و workerها

- `packages/event-contracts`: envelope نسخه‌دار، payload schema، routing key و validation.
- `packages/backend-core`: خطای دامنه، correlation ID، hash secret، RabbitMQ publisher/consumer و DLQ topology.
- `apps/realtime-gateway`: Socket.IO namespace `/realtime`، احراز session از API و room کاربر.
- `services/device-integration`: webhook امضاشده روی raw HTTP body، بررسی timestamp، dedupe اولیه و انتشار `device.transaction-imported.v1`.
- `services/notifications`: مصرف `notification-requested` و تولید `notification-sent` به‌عنوان adapter توسعه‌ای.

## مسیرهای HTTP فعلی

```text
GET  /health/live
GET  /health/ready

POST /api/v1/auth/otp/request
POST /api/v1/auth/otp/verify
POST /api/v1/auth/logout
GET  /api/v1/auth/me

GET  /api/v1/customer/branches
GET  /api/v1/customer/branches/:branchId
GET  /api/v1/customer/home
GET  /api/v1/customer/profile
PATCH /api/v1/customer/profile
GET  /api/v1/customer/profile/avatar
POST /api/v1/customer/profile/avatar
GET  /api/v1/customer/households
POST /api/v1/customer/households
POST /api/v1/customer/households/:householdId/members
GET  /api/v1/customer/cards
POST /api/v1/customer/cards/link
GET  /api/v1/customer/wallets/:walletId/summary
GET  /api/v1/customer/wallets/:walletId/transactions
GET  /api/v1/customer/missions
POST /api/v1/customer/missions/:missionId/claim
```

`GET /api/v1/customer/cards` و پاسخ `POST /api/v1/customer/cards/link` فقط شناسه‌ی ماسک‌شده‌ی کارت را به مشتری برمی‌گردانند؛ شناسه‌ی خام در backend برای تطبیق adapter باقی می‌ماند. این پاسخ فقط householdهای مجاز کاربر را شامل می‌شود.

## اجرای محلی

```powershell
corepack pnpm install --no-frozen-lockfile
docker compose -f infra/docker-compose.yml up -d
corepack pnpm --filter @funtino/api-gateway prisma:generate
corepack pnpm --filter @funtino/api-gateway prisma:migrate
corepack pnpm dev:api
```

برای اجرای سریع بدون زیرساخت محلی، `STORAGE_MODE=memory` بگذارید. این حالت برای production مجاز نیست.

اعتبارسنجی پیش از انتشار:

```powershell
corepack pnpm backend:typecheck
corepack pnpm --filter @funtino/api-gateway test
corepack pnpm backend:build
corepack pnpm format:check
```

## اعتبارسنجی انجام‌شده

- `corepack pnpm backend:typecheck` — موفق، ۶ workspace backend؛
- `corepack pnpm backend:build` — موفق؛ هر ۶ واحد backend خروجی `dist` تولید کردند؛
- lint همین سرویس‌ها — موفق؛ تنها warning عمومی eslint درباره تشخیص نسخه React باقی است؛
- `corepack pnpm --filter @funtino/api-gateway test` — ۳ تست موفق؛
- Prisma schema validation — موفق؛
- اجرای واقعی `apps/api-gateway/dist/main.js` در حالت production و پاسخ `GET /health/live` — موفق؛
- `corepack pnpm format:check` — موفق؛
- smoke test HTTP روی localhost — health، OTP، cookie، household، card و mission claim موفق؛
- Docker integration test در این محیط اجرا نشد چون Docker Desktop Engine در دسترس نبود.

## مرزهای عمداً موکول‌شده

این موارد بدون قرارداد واقعی نباید با mock به‌عنوان production اعلام شوند:

1. provider واقعی SMS برای ارسال OTP؛
2. API و firmware قرارداد سامانه RFID/card؛
3. درگاه پرداخت، verify، refund و reconciliation؛
4. مدیریت کامل organization/membership و policyهای پنل operations/system؛
5. provider واقعی notification و delivery status؛
6. durable Inbox مستقل برای workerهای notifications و realtime در محیط چند replica؛
7. migration/restore واقعی روی PostgreSQL مدیریت‌شده Runflare.

برای هر مورد ابتدا قرارداد provider، مالک داده، schema، retry و تست integration باید ثبت شود. تا آن زمان adapter باید fail-safe بماند و نباید موفقیت مالی یا sync واقعی جعل کند.

## Customer identity/profile slice — 2026-09-27

برای اجرای اولویت‌دار customer-web، جریان کامل identity و profile به baseline اضافه شد. جزئیات تصمیم و معیار پذیرش در [CustomerIdentityAndProfile.md](CustomerIdentityAndProfile.md) و [ADR 0003](decisions/0003-customer-profile-and-branch-linking.md) ثبت شده است.

- `ParsGreenOtpSender` پشت port مستقل `OtpSender` قرار دارد. در production توکن از `PARSGREEN_API_TOKEN` خوانده می‌شود و در source خالی می‌ماند.
- OTP در API با hash challenge، expiry، محدودیت درخواست و سقف تلاش محلی verify می‌شود؛ provider فقط delivery را انجام می‌دهد.
- profile endpointهای GET/PATCH و avatar endpointهای GET/POST اضافه شده‌اند. avatar با سقف ۲MB و فرمت‌های JPEG/PNG/WebP در PostgreSQL نگهداری می‌شود.
- customer-web پیش از POST آواتار، تصویر را در مرورگر داخل قاب اجباری `1:1` برش می‌دهد و خروجی square JPEG ارسال می‌کند؛ کنترل CORS برای `PATCH /api/v1/customer/profile` نیز در API Gateway صریح شده است.
- ثبت‌نام شعبه‌ای ایجاد نمی‌کند. `branchId` در link card الزامی است و `cards.branch_id` مبنای دسترسی شعبه‌ای، home فعال و missionهای شعبه‌ای است.
- migration `0002_customer_profile_and_card_branch` باید قبل از اجرای `STORAGE_MODE=postgres` deploy شود.

## قاعده توسعه و استقرار

کد فقط در source monorepo تغییر می‌کند. deployment repositoryهای Runflare snapshot قابل استقرار هستند و محل توسعه دستی نیستند. هر تغییر backend باید پس از typecheck، test، build و ثبت اثر deployment به repository مربوط به همان سرویس sync شود؛ تغییر shared contract یا package همه مصرف‌کننده‌های اثرپذیرفته را redeploy می‌کند.
