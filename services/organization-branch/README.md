# Organization & Branch owner service

این سرویس تنها مالک نوشتن و خواندن عملیاتی سازمان‌ها و شعبه‌هاست. API Gateway برای discovery شعبه و بررسی فعال‌بودن `branchId` کارت از API داخلی آن استفاده می‌کند؛ هیچ مرورگری نباید مستقیم به این سرویس متصل شود. role، membership، permission و MFA همچنان متعلق به Identity & Access هستند.

## اجرا و داده

- PostgreSQL مستقل در schema `organization_branch`؛ تنظیم‌های لازم: `ORGANIZATION_BRANCH_DATABASE_URL` و `ORGANIZATION_BRANCH_MIGRATION_DATABASE_URL`.
- اجرای cutover از credential جداگانه‌ی `ORGANIZATION_BRANCH_BACKFILL_DATABASE_URL` استفاده می‌کند؛ حساب مقصد فقط به `SELECT` و `INSERT` موردنیاز روی جدول‌های مالک دسترسی داشته باشد و credential برنامه‌ی runtime یا migration را reuse نکند.
- مقدار `.env.example` برای محیط Compose محلی است؛ در production حساب مقصد backfill باید جداگانه و با همین حداقل مجوز provision شود.
- پورت محلی `4050`؛ health بدون داده‌ی حساس در `/health/live` و `/health/ready`.
- برای درخواست‌های داخلی، credentialهای مجزای حداقل ۳۲ نویسه لازم‌اند: `ORGANIZATION_BRANCH_GATEWAY_TOKEN`، `ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN`، `ORGANIZATION_BRANCH_DEVICE_INTEGRATION_TOKEN` و `ORGANIZATION_BRANCH_WALLET_TOKEN`. هدر `x-funtino-service-id` باید با credential متناظر جفت باشد. Identity Access، Device Integration و Wallet فقط مجازند `POST /internal/v1/scopes/validate` را فراخوانی کنند؛ token IAM فقط resource existence/active state/parentage را اعتبارسنجی می‌کند و تصمیم permission actor منحصراً در IAM می‌ماند.
- URL runtime `ORGANIZATION_BRANCH_DATABASE_URL` و URL DDL یعنی `ORGANIZATION_BRANCH_MIGRATION_DATABASE_URL` باید به همان database و schema `organization_branch` اشاره کنند؛ host می‌تواند برای runtime pooler و برای DDL اتصال مستقیم باشد. Docker در هر startup schema را به‌صورت idempotent آماده و migrationهای pending را با `prisma migrate deploy` اعمال می‌کند؛ برنامه فقط پس از موفقیت migration بالا می‌آید. در failure، log کامل Prisma را بدون ارسال secret بفرستید؛ migration history را خودکار resolve نکنید.

## قرارداد و قواعد دامنه

- قرارداد API در `contracts/openapi/organization-branch.yaml` و رویدادها در `contracts/asyncapi/events.yaml` و `contracts/events/organization-branch/` هستند.
- سازمان و شعبه وضعیت `active`، `suspended` یا `archived` دارند؛ archive حذف فیزیکی نیست و بازگشت از آن ممنوع است. شعبه فقط زیر سازمان فعال ساخته/فعال می‌شود. branch فقط وقتی برای مشتری قابل‌مشاهده است که خودش و سازمان والد هر دو فعال باشند.
- همه‌ی mutationها به هویت actor، correlation ID، `Idempotency-Key` یکتا و دلیل نیاز دارند. updateها `If-Match` (نسخه‌ی مثبت فعلی) می‌خواهند. mutation، audit append-only و Outbox در یک تراکنش نوشته می‌شوند.
- رویدادها پس از commit با relay دارای lease، retry محدود و dead-letter منتشر می‌شوند. backfill هیچ رویداد دامنه‌ای تولید نمی‌کند.
- endpoint `POST /internal/v1/scopes/validate` فقط اعتبار و وضعیت منبع و parent/child را اعلام می‌کند؛ این endpoint جایگزین authorization در IAM نیست. IAM، Gateway، Device Integration و Wallet از callerهای محدودشده استفاده می‌کنند؛ دسترسی live و fail-closed باید در staging اثبات شود.

## انتقال از مدل legacy

`src/bootstrap/legacy-backfill.cli.ts` جدول‌های `public.organizations` و `public.branches` را در یک تراکنش `REPEATABLE READ READ ONLY` می‌خواند. URL مبدأ باید credential واقعاً read-only داشته باشد. مقصد با credential جداگانه‌ی `ORGANIZATION_BRANCH_BACKFILL_DATABASE_URL` خوانده و در صورت apply فقط درج می‌شود؛ مجوز `UPDATE`/`DELETE` لازم نیست. UUIDها حفظ می‌شوند، سازمان‌ها `active` و شعبه‌ی legacy فعال/غیرفعال به‌ترتیب `active`/`suspended` می‌شود. timestampهای timezone-less بدون تبدیل در ستون‌های `legacy_*_local` به‌صورت رشته حفظ می‌شوند. Membership منتقل نمی‌شود.

اجرای پیش‌فرض فقط dry-run است و شمارش، hash snapshot و تعارض‌های ساختار، slug، timezone، ساعت کاری و رکورد مقصد را گزارش می‌کند. هیچ تعارضی overwrite نمی‌شود. Apply نیازمند `--apply`، مقدار `ORGANIZATION_BRANCH_BACKFILL_APPLY_ENABLED=true` و `--confirm=<hash>` دقیق همان dry-run است؛ در production یک gate جداگانه نیز لازم است. اجرای واقعی backfill یا migration در این تحویل انجام نشده است. Apply یک تراکنش واحد و حداکثر ۱۰٬۰۰۰ ردیف دارد؛ مجموعه‌ی بزرگ‌تر باید با runbook chunked جداگانه بررسی شود.

مثال محلی (ابتدا فقط dry-run):

```powershell
pnpm --filter @funtino/organization-branch backfill:legacy
pnpm --filter @funtino/organization-branch backfill:legacy -- --apply --confirm=<sha256>
```

قبل از apply، snapshot/backup، حساب read-only مبدأ، reconciliation، پنجره‌ی نگهداری و rollback باید جداگانه تأیید شوند. جدول‌های قدیمی Gateway در این مرحله حذف نمی‌شوند؛ migration Gateway فقط FK کارت را برمی‌دارد تا شناسه‌ی شعبه‌ی معتبر Owner در DB Gateway به FK جدول legacy وابسته نباشد.

## تست و محدودیت تحویل

```powershell
pnpm --filter @funtino/organization-branch typecheck
pnpm --filter @funtino/organization-branch test
pnpm --filter @funtino/organization-branch lint
```

سرویس owner، اعتبارسنجی callerهای IAM/Gateway/Device/Wallet، Gateway BFF و صفحه‌ی مدیریت سازمان/شعبه در System Web در source موجودند. هنوز migration و backfill واقعی، reconciliation، PostgreSQL integration، backup/restore، آزمون staging چند tenant و Runflare rollout تأیید نشده‌اند. Repository مستقل `funtino-organization-branch-worker` ساخته شده است؛ اتصال آن به item و Auto Pull از این محیط قابل راستی‌آزمایی نیست.
