# Runbook پیشین ۱۲ موردی — منسوخ

این فایل runbook تاریخی معماری ۱۲ application deployment قبلی را نگه می‌دارد. از 2026-10-03 به‌بعد اجرای آن دستورالعمل جاری نیست: ADR-0016 و [Runbook دو runtime bundle](runbooks/GroupedRunflareRuntime.md) الگوی فعلی frontend و backend را تعریف می‌کنند.

از جدول ۱۲ repository، دستور اتصال هر repository، ساخت itemهای منفرد یا مراحل حذف/تبدیل آن‌ها برای rollout جدید استفاده نکن. برای inventory تاریخی release قبلی به [ImplementationStatus.md](ImplementationStatus.md) رجوع کن. ۱۲ item قبلی تا پایان cutover و rollback window باید حفظ شوند؛ این فایل اجازه‌ی حذف یا جابه‌جایی آن‌ها نیست.

مراجع جاری:
- [ADR-0016: بسته‌بندی دو runtime](decisions/0016-grouped-frontend-backend-runtime-deployments.md)
- [راهبرد repository و Runflare](RunflareRepositoryAndDeployment.md)
- [workflow commit/push](CommitPushAndDeploymentWorkflow.md)
- [Runbook دو runtime](runbooks/GroupedRunflareRuntime.md)
