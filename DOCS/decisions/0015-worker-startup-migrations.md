# ADR-0015: اجرای امن migration در آغاز پنج Worker

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-03
- دامنه: Docker runtime پنج Worker شامل Identity Access، Organization & Branch، Customer & Household، Wallet و Analytics
- مجوز تصمیم: درخواست صریح مالک محصول برای رفع خطای migration و اجرای خودکار پیش از شروع Worker

## زمینه

پنج Worker پس از راه‌اندازی به جدول‌های مالکانه‌ی خود و Outbox نیاز دارند. logهای production نشان دادند برخی جدول‌ها هنوز وجود ندارند؛ به‌ویژه Analytics با `P2021` برای `projection_control` متوقف شده است. اجرای دستی از Terminal نیز برای مالک محصول قابل‌اتکا نیست. سیاست پیشینِ اجرای یک‌باره‌ی migration جدا از start برای این پنج Worker در محیط فعلی عملیاتی نیست.

## تصمیم

Docker هر یک از پنج Worker پیش از اجرای برنامه، runner ریشه‌ی monorepo را برای همان سرویس اجرا می‌کند. runner به ترتیب:

1. نام Worker و هر دو URL دیتابیس را اعتبارسنجی می‌کند؛ هر دو باید PostgreSQL، دارای نام دیتابیس و `schema` دقیق سرویس باشند و به یک دیتابیس اشاره کنند. host دو URL می‌تواند متفاوت باشد تا runtime از pooler و migration از اتصال مستقیم استفاده کند.
2. bootstrap با Prisma schema مستقل `prisma/bootstrap.prisma` از همان database و با `schema=public` (schema پیش‌فرض PostgreSQL که پیشاپیش وجود دارد) وصل می‌شود و با `CREATE SCHEMA IF NOT EXISTS` فقط schema مالک را می‌سازد. این فایل bootstrap عمداً فهرست multi-schema دیتامدل Worker را بار نمی‌کند.
3. با `prisma migrate deploy` و Prisma schema اصلی، فقط migrationهای نسخه‌دار و pending را روی schema اختصاصی Worker اعمال می‌کند.
4. تنها پس از موفقیت هر دو مرحله، برنامه را با همان environment و user غیر root اجرا می‌کند.

در هر خطا، container با exit code ناموفق خارج می‌شود و اپلیکیشن شروع نمی‌شود. خروجی خام Prisma/PostgreSQL به log می‌رود؛ URLها و secretهای شناخته‌شده پیش از log redacted می‌شوند. eventهای آغاز/پایان/شکست و نام مرحله ثبت می‌شوند. هیچ‌گاه از `db push`، `migrate reset`، `migrate dev`، حذف migration history یا `migrate resolve` خودکار استفاده نمی‌شود. اجرای مجدد پس از موفقیت امن است: schema با `IF NOT EXISTS` آماده می‌شود و Prisma migrationهای اعمال‌شده را از روی `_prisma_migrations` دوباره اجرا نمی‌کند.

## متغیرها و حد دسترسی

برای هر Worker هر دو URL باید در Environment/Secret همان آیتم Runflare باشد؛ URL migration دیگر job موقت نیست و در زمان اجرای دائمی container در دسترس قرار می‌گیرد. این URL باید فقط مالکیت DDL schema همان سرویس را داشته باشد؛ URL runtime نیز باید به همان database/schema متصل شود. secret واقعی نباید وارد Git، image یا log شود.

| Worker                | URL runtime                        | URL migration                                | schema                 |
| --------------------- | ---------------------------------- | -------------------------------------------- | ---------------------- |
| Identity Access       | `IDENTITY_ACCESS_DATABASE_URL`     | `IDENTITY_ACCESS_MIGRATION_DATABASE_URL`     | `identity_access`      |
| Organization & Branch | `ORGANIZATION_BRANCH_DATABASE_URL` | `ORGANIZATION_BRANCH_MIGRATION_DATABASE_URL` | `organization_branch`  |
| Customer & Household  | `CUSTOMER_HOUSEHOLD_DATABASE_URL`  | `CUSTOMER_HOUSEHOLD_MIGRATION_DATABASE_URL`  | `customer_household`   |
| Wallet                | `WALLET_DATABASE_URL`              | `WALLET_MIGRATION_DATABASE_URL`              | `wallet`               |
| Analytics             | `ANALYTICS_DATABASE_URL`           | `ANALYTICS_MIGRATION_DATABASE_URL`           | `analytics_read_model` |

## شکست، تکرار و هم‌زمانی

- خطای اتصال، نبود دسترسی DDL، schema اشتباه، migration خراب یا تاریخچه‌ی migration ناسازگار موجب توقف fail-closed می‌شود. خروجی Prisma شامل کد Prisma و در صورت ارائه، SQLSTATE PostgreSQL است؛ secretها redacted می‌شوند.
- برای خطاهایی مانند migration شکست‌خورده‌ی ثبت‌شده (`P3009`)، runner وضعیت را خودکار resolve یا پاک نمی‌کند. ابتدا log کامل همان مرحله و وضعیت دیتابیس باید بررسی و یک ترمیم کنترل‌شده طراحی شود.
- `prisma migrate deploy` از advisory lock خود Prisma استفاده می‌کند. در rollout هم‌زمان چند replica، هر replica migration را درخواست می‌کند؛ lock باید تغییرها را serialize کند، اما timeout قفل باعث fail-closed شدن replica می‌شود. برای release اولیه یک replica توصیه می‌شود و startup طولانی در سلامت Docker با start-period برابر ۱۸۰ ثانیه پوشش داده می‌شود.
- تغییرات schema همچنان باید backward-compatible و expand/contract باشند. startup migration rollback خودکار DDL انجام نمی‌دهد؛ rollback نسخه‌ی app فقط در صورتی امن است که schema جدید با app قبلی سازگار باشد. backup و آزمون restore مستقل لازم است.

### مهلت اجرا و عیب‌یابی توقف فرمان

- فرمان آماده‌سازی schema باید حداکثر ۳۰ ثانیه و `migrate deploy` حداکثر ۱۲۰ ثانیه تمام شود؛ اتصال Prisma CLI با `connect_timeout=5` محدود است و فرمان bootstrap با `socket_timeout=20` از انتظار نامحدود روی یک statement جلوگیری می‌کند. bootstrap فقط schema URL را موقتاً به `public` تغییر می‌دهد؛ host/database/credential ثابت می‌مانند. سپس `migrate deploy` از Prisma schema اصلی و schema اختصاصی Worker استفاده می‌کند.
- runner زمان مجاز، PID subprocess، مدت انتظار و علت timeout را log می‌کند؛ در timeout کل process group ابتدا با SIGTERM و سپس SIGKILL متوقف می‌شود. برنامه تا موفقیت migration اجرا نمی‌شود. کد Prisma/SQLSTATE اصلی حفظ می‌شود و timeout مستقل با `MIGRATION_COMMAND_TIMEOUT` ثبت خواهد شد.
- timeout نشانه‌ی علت نهایی دیتابیس نیست؛ پس از آن باید `causeCode` و خروجی redacted همان تلاش بررسی شود. هیچ schema lock، migration history یا داده‌ای به‌طور خودکار reset/resolve نمی‌شود.

## خارج از دامنه و پیامد

- این تصمیم فقط برای پنج Worker است. migration API Gateway، وب‌اپ‌ها و سایر سرویس‌ها همچنان release/job کنترل‌شده‌ی جدا دارند.
- healthcheck منتظر HTTP health می‌ماند و برای migration اولیه تا ۱۸۰ ثانیه فرصت می‌دهد؛ زمان طولانی‌تر همچنان باید از log تشخیص داده شود.
- نیاز دائمی Worker به credential DDL ریسک امنیتی بیشتری از migration job کوتاه‌عمر دارد؛ دسترسی باید محدود به schema مالک، قابل rotation و فقط در همان آیتم Worker باشد.
- موفقیت build یا push اثبات نمی‌کند migration روی PostgreSQL واقعی اجرا شده است. تأیید نهایی نیازمند مشاهده‌ی log start، migration completed و health در Runflare است.

## اسناد وابسته

- [ADR-0004: Docker و deployment repositoryها](0004-runflare-docker-pnpm-deployments.md)
- [Runflare Docker Deployment Runbook](../RunflareDockerDeploymentRunbook.md)
- [Runflare Repository and Deployment](../RunflareRepositoryAndDeployment.md)
- [Commit, Push and Deployment Workflow](../CommitPushAndDeploymentWorkflow.md)
