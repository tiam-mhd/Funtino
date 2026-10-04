# Architecture Decision Records

هر تصمیمی که یکی از قواعد محصول، معماری، قرارداد، امنیت، داده یا استقرار را تغییر دهد، باید یک ADR داشته باشد.

## قالب اجباری ADR

- عنوان و شماره؛
- تاریخ و وضعیت: proposed، accepted، superseded یا rejected؛
- مسئله و زمینه؛
- گزینه‌های بررسی‌شده؛
- تصمیم نهایی؛
- پیامدها و trade-offها؛
- سرویس‌ها و بسترهای اثرپذیرفته؛
- برنامه‌ی migration یا rollback؛
- لینک قراردادها و مستندات مرتبط.

تصمیم کوچک داخل همان task و تصمیم معماری ماندگار در یک فایل شماره‌دار ثبت شود. تصمیم جدید نباید بی‌صدا تصمیم قبلی را نقض کند؛ باید آن را supersede کند.

## ADRهای فعلی

- [ADR-0002: تفکیک source monorepo از deployment repositoryهای Runflare](0002-runflare-deployment-repositories.md)
- [ADR-0004: استقرار Docker برای deployment repositoryهای pnpm](0004-runflare-docker-pnpm-deployments.md)
- [ADR-0005: مدیریت سازمان، شعبه، کارکنان، دستگاه و تخصیص کارت — پذیرفته‌شده](0005-organization-branch-device-card-management.md)
- [ADR-0006: MFA مدیران با TOTP و تأیید مجدد نشست — پذیرفته‌شده](0006-administrative-mfa-totp.md)
- [ADR-0007: جداسازی Prisma Client در API Gateway — پذیرفته‌شده](0007-gateway-prisma-client-isolation.md)
- [ADR-0008: فرمان‌های IAM و gate مالکیت scope — پذیرفته‌شده](0008-iam-management-write-gates.md)
- [ADR-0009: مالکیت Organization & Branch و انتقال مرحله‌ای مدل legacy — پذیرفته‌شده](0009-organization-branch-owner-and-legacy-cutover.md)
- [ADR-0010: مرز اعتبارسنجی scope مالک در mutationهای IAM — پذیرفته‌شده](0010-iam-owner-scope-validation-boundary.md)
- [ADR-0011: bootstrap امن مدیر و gate بازشدن writeهای IAM در production — پذیرفته‌شده](0011-iam-bootstrap-and-production-write-release-gate.md)
- [ADR-0012: پایش عملیاتی خصوصی و خلاصه‌ی سلامت مجوزدار — پذیرفته‌شده](0012-private-operational-telemetry.md)
- [ADR-0013: مالکیت Customer & Household و کارت مستقل خانواده در هر شعبه — پذیرفته‌شده](0013-customer-household-owner-branch-card-assignment.md)
- [ADR-0014: MFA در هر ورود مدیر سامانه و پایان نشست بیکار — پذیرفته‌شده](0014-admin-login-mfa-and-idle-timeout.md)
- [ADR-0015: اجرای امن migration در آغاز پنج Worker](0015-worker-startup-migrations.md)
- [ADR-0016: بسته‌بندی دوگانه‌ی runtime برای frontend و backend](0016-grouped-frontend-backend-runtime-deployments.md)
- [ADR-0017: پیش‌بررسی TCP اتصال دیتابیس Worker](0017-worker-database-tcp-preflight.md)
- [ADR-0018: لاگ تشخیصی هم‌بسته برای backend](0018-correlated-backend-diagnostics.md)
- [ADR-0019: مجوز ساخت مجموعه برای مدیر سراسری bootstrapشده](0019-system-admin-organization-provisioning.md)
- [ADR-0020: نشست مدیریتی قابل‌تنظیم و دسترسی مدیر سراسری](0020-admin-session-duration-and-system-admin-capabilities.md)
