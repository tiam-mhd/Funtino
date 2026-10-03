# مستندات پروژه فانتینو

این پوشه مرجع مشترک محصول، معماری، طراحی، قوانین توسعه و برنامه‌ی اجرای فانتینو است.

## تفاوت تحلیل با قانون اجرایی

سه فایل زیر ورودی تحلیل محصول هستند:

- [FirstAnalysis.md](FirstAnalysis.md): مدل محصول، خانواده، کارت، تجربه‌ی مشتری و نقشه‌ی راه اولیه.
- [RealTimeANDNonDependencyModules.md](RealTimeANDNonDependencyModules.md): استقلال سرویس‌ها، رویدادمحوری و تجربه‌ی بلادرنگ.
- [TechAnalysis.md](TechAnalysis.md): پشته‌ی فنی و تطبیق استقرار با Runflare.

این فایل‌ها «دستورهای قابل اجرای مستقل» نیستند. قوانین لازم‌الاجرا در [ImplementationRules.md](ImplementationRules.md) و ریشه‌ی پروژه در [../AGENTS.md](../AGENTS.md) ثبت شده‌اند.

## ترتیب مطالعه

1. [ProjectDocumentation.md](ProjectDocumentation.md) — تعریف محصول، نقش‌ها، محدوده و الزامات.
2. [ImplementationStatus.md](ImplementationStatus.md) — وضعیت واقعی شروع پیاده‌سازی و خروجی‌های تحویل‌شده.
3. [VisualDesignAnalysis.md](VisualDesignAnalysis.md) — تحلیل چهار طرح مرجع و تصمیم طراحی نهایی.
4. [ArchitectureAndDesignPatterns.md](ArchitectureAndDesignPatterns.md) — معماری، مرز سرویس‌ها و الگوهای طراحی.
5. [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) — راهبرد source monorepo، دو runtime bundle و Auto Pull.
6. [Runbook دو runtime](runbooks/GroupedRunflareRuntime.md) — manifestها، portها، environment، شبکه و cutover دو آیتم Runflare.
7. [CommitPushAndDeploymentWorkflow.md](CommitPushAndDeploymentWorkflow.md) — قانون canonical انتخاب bundle، تولید snapshot، conflict check، commit/push و گزارش release.
8. [FolderAndFileStructure.md](FolderAndFileStructure.md) — ساختار مخزن، فولدرها، نام‌گذاری و وابستگی‌ها.
9. [ImplementationRules.md](ImplementationRules.md) — قوانین اجباری توسعه، امنیت، تست و تحویل.
10. [PhasesAndExecutionPlan.md](PhasesAndExecutionPlan.md) — فازبندی سه بستر و فهرست کارهای هر فاز.
11. [TechAnalysis.md](TechAnalysis.md) — جزئیات پشته و استقرار Runflare.
12. [decisions/README.md](decisions/README.md) — ADRهای تصمیم‌های معماری ماندگار.
13. [ReleaseQualityGatesAndPilot.md](ReleaseQualityGatesAndPilot.md) — CI، تست امنیت/scope، telemetry، migration/restore، rollback و گیت پایلوت.

## سه بستر محصول

| بستر             | کاربر اصلی                            | هدف                                              |
| ---------------- | ------------------------------------- | ------------------------------------------------ |
| `customer-web`   | مشتری، والد و اعضای خانواده           | کشف شعبه، کارت، خانواده، مأموریت و پیشنهاد       |
| `operations-web` | صندوق‌دار، اپراتور و مدیر شعبه/مجموعه | عملیات شعبه، کارت، دستگاه، فروش، کمپین و گزارش   |
| `system-web`     | مدیر سامانه و پشتیبانی پلتفرم         | سازمان‌ها، شعب، کاربران، اتصال‌ها، امنیت و ممیزی |

## سطح الزام

- **MUST / باید:** تخلف از آن بدون تصمیم ثبت‌شده مجاز نیست.
- **SHOULD / بهتر است:** انتخاب پیش‌فرض است؛ تغییر آن نیازمند دلیل فنی است.
- **MAY / می‌تواند:** گزینه‌ی مجاز برای یک use case مشخص است.

## اصل حاکم

ابتدا مرز مالکیت داده و مجوز مشخص می‌شود، سپس قرارداد، معماری، API، رابط و در نهایت جزئیات پیاده‌سازی. هیچ صفحه‌ای نباید مستقیماً منبع داده‌ی مالی یا سامانه‌ی کارت را دور بزند.
