# ADR-0009: مالکیت Organization & Branch و انتقال مرحله‌ای مدل legacy

- تاریخ: 2026-09-30
- وضعیت: پذیرفته‌شده
- دامنه: Organization & Branch، Identity & Access، API Gateway، قراردادهای API/event و PostgreSQL

## زمینه

در schema عمومی API Gateway، جدول‌های `organizations` و `branches` هنوز وجود دارند و Gateway آن‌ها را برای discovery و اعتبارسنجی اتصال کارت می‌خواند. کارت‌ها نیز با FK به `branches` متصل‌اند. این مدل با مرز مالکیت ADR-0005 و گیت production در ADR-0008 سازگار نیست. جدول legacy `memberships` نیز به همان مدل اشاره دارد، اما مالک عضویت کارکنان Identity & Access است.

## تصمیم

- `services/organization-branch` مالک انحصاری داده‌ی سازمان و شعبه و schema مستقل PostgreSQL به نام `organization_branch` است. هیچ سرویس دیگری به جدول‌های این schema دسترسی مستقیم ندارد.
- Identity & Access مالک عضویت، role، permission و MFA باقی می‌ماند. Gateway هویت نشست را استخراج می‌کند؛ مجوز actor از IAM می‌آید؛ Organization & Branch فقط وجود، وضعیت و نسبت parent/child منبع را اعتبارسنجی می‌کند. نقش یا membership در سرویس Organization کپی نمی‌شود.
- Gateway فقط از BFF و client داخلی استفاده می‌کند. API داخلی سرویس public ingress ندارد و credential مستقل Gateway و Identity Access می‌گیرد.
- وضعیت organization/branch برابر `active`، `suspended` یا `archived` است؛ آرشیو حذف فیزیکی نیست و terminal است. `Organization`های legacy فعال backfill می‌شوند؛ `Branch.isActive=true` به `active` و `false` به `suspended` نگاشت می‌شود.
- UUID سازمان و شعبه در انتقال تغییر نمی‌کند. جدول‌های legacy تا پایان پنجره‌ی سازگاری و انتقال جداگانه‌ی Membership نگه داشته می‌شوند، اما application جدید آن‌ها را نمی‌خواند یا تغییر نمی‌دهد. FK کارت به جدول legacy حذف می‌شود؛ `branch_id` در Wallet/Gateway یک شناسه‌ی opaque است که قبل از نوشتن از Owner API اعتبارسنجی می‌شود.
- رویدادهای `organization.organization-created.v1`، `organization.organization-updated.v1`، `organization.organization-status-changed.v1`، `organization.branch-created.v1`، `organization.branch-updated.v1` و `organization.branch-status-changed.v1` با schema نسخه‌دار و Outbox در همان تراکنش mutation منتشر می‌شوند. Backfill تاریخی رویداد business تولید نمی‌کند.
- backfill از `public.organizations` و `public.branches` با اتصال read-only مبدأ و credential مستقل کم‌دسترسی مقصد، UUID پایدار، hash snapshot، شمارش، بررسی orphan و تعارض slug انجام می‌شود. حساب مقصد فقط `SELECT`/`INSERT` لازم را دارد و نباید از credential runtime یا migration استفاده کند. dry-run پیش‌فرض است؛ apply به دو تأیید مستقل runtime/CLI نیاز دارد. رکورد مقصد موجود فقط در صورت برابری کامل پذیرفته می‌شود و overwrite نمی‌شود. اعمال فعلی فقط برای snapshotهای حداکثر ۱۰٬۰۰۰ ردیفی در یک تراکنش مجاز است؛ داده‌ی بزرگ‌تر به runbook chunked جدا نیاز دارد. دوگان‌نویسی application ممنوع است.
- `created_at` و `updated_at` legacy از نوع timestamp بدون timezone هستند. backfill مقدار محلی خام آن‌ها را بدون reinterpretation حفظ می‌کند؛ تبدیل آن‌ها به instant زمانی تا تعیین timezone واقعی منبع انجام نمی‌شود.
- migration، backfill production، حذف جدول legacy، بازکردن گیت tenant در IAM و deployment فقط پس از restore test، reconciliation، smoke و ثبت Runflare repository مستقل انجام می‌شوند. این ADR مجوز اجرای عملیاتی یا انتشار نیست.

## ترتیب cutover و rollback

1. اعمال migration schema مالک جدید در محیط non-production و آماده‌سازی credentialهای مجزای runtime.
2. اجرای backfill dry-run؛ توقف و اصلاح در صورت orphan، duplicate یا اختلاف داده.
3. اجرای apply فقط در maintenance window با snapshot، حساب read-only برای منبع و حساب جداگانه‌ی کم‌دسترسی برای مقصد؛ ثبت hash و row count.
4. مقایسه‌ی شمارش/محتوا، تست parent/status، customer branch read، card link و IAM scope validation.
5. تغییر read/write routeها به owner و نگه‌داشتن legacy tables بدون write برای پنجره‌ی rollback.
6. حذف legacy مدل‌ها و جدول‌ها فقط در migration جداگانه، پس از پایان پنجره‌ی سازگاری و انتقال Membership به IAM.

Rollback با توقف mutation در Owner API و برگرداندن Gateway به snapshot قبلی انجام می‌شود. چون UUIDها حفظ می‌شوند و legacy tables حذف نشده‌اند، rollback نیازمند dual-write یا بازسازی ID نیست. schema جدید تا بررسی و reconciliation دست‌نخورده می‌ماند.

## پیامدها و محدودیت‌ها

- customer branch discovery و لینک کارت به availability سرویس Owner وابسته می‌شوند و در خطای آن fail-closed هستند.
- IAM هنوز در production scopeهای tenant را نمی‌پذیرد تا runtime validator و داده‌ی backfill‌شده در محیط واقعی smoke شوند.
- legacy `memberships` به این سرویس منتقل نمی‌شود؛ مهاجرت و تطبیق roleهای legacy متعلق به یک کار جداگانه‌ی Identity & Access است.
- deployment repository و Runflare item سرویس در Organization موجود هنوز ساخته/مستند نشده‌اند؛ source monorepo تنها محل تغییر این کار است.

## اسناد و قراردادهای اثرپذیرفته

- `DOCS/ArchitectureAndDesignPatterns.md`
- `DOCS/FolderAndFileStructure.md`
- `DOCS/PhasesAndExecutionPlan.md`
- `DOCS/RunflareRepositoryAndDeployment.md`
- `DOCS/OrganizationBranchDeviceCardManagement.md`
- `contracts/openapi/organization-branch.yaml`
- `contracts/openapi/gateway.yaml`
- `contracts/asyncapi/events.yaml` و `contracts/events/organization-branch/`
