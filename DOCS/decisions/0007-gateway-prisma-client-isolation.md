# ADR-0007: جداسازی Prisma Client در API Gateway

- تاریخ: 2026-09-30
- وضعیت: پذیرفته‌شده
- تصمیم‌گیر: مهندسی

## زمینه

Gateway از Prisma Client پیش‌فرض مشترک `@prisma/client` استفاده می‌کرد. تولید client در حالی که سرویس محلی از engine مشترک استفاده می‌کند می‌تواند به قفل/تداخل فایل در Windows منجر شود و ارتباط schema با خروجی build را مبهم کند.

## تصمیم

- API Gateway client تولیدشده‌ی schema خودش را در `apps/api-gateway/generated/prisma/` نگه می‌دارد؛ این مسیر generated، محلی و از version control خارج است.
- دستورهای build، typecheck و test ابتدا `prisma:generate` را اجرا می‌کنند. snapshot مستقل استقرار نیز باید همین script را اجرا کند.
- migration همچنان مرحله‌ای جدا از انتشار app است؛ تولید client هیچ migration دیتابیسی را اجرا نمی‌کند.

## پیامدها

- schema، typeها و engine خروجی Gateway باهم ایزوله می‌شوند و generation به فایل مشترک default وابسته نمی‌ماند.
- وابستگی مستقیم `@prisma/client` برای runtime باقی می‌ماند؛ فقط importهای generated به مسیر app-local تغییر می‌کنند.
- deployment pipeline و smoke test باید build را از snapshot self-contained و دارای schema اجرا کنند.

## اسناد مرتبط

- `DOCS/FolderAndFileStructure.md`
- `DOCS/RunflareRepositoryAndDeployment.md`
- `apps/api-gateway/README.md`
