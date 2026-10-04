# ADR-0018: لاگ تشخیصی هم‌بسته برای backend

- وضعیت: پذیرفته‌شده
- تاریخ: 2026-10-04
- دامنه: هر ۹ process در runtime backend، ارتباط HTTP داخلی، پردازش رویداد و پشتیبانی عملیاتی

## مسئله و زمینه

لاگ پایان درخواست، status و مدت را داشت اما علت خطایی که داخل client به خطای عمومی وابستگی تبدیل می‌شد ثبت نمی‌کرد. در نتیجه از یک `503` مشخص نبود درخواست در Gateway، هنگام اتصال به سرویس داخلی، در اعتبارسنجی قرارداد یا در پایگاه داده شکست خورده است. لاگ خام خطا هم می‌تواند بدنه، credential یا داده‌ی مشتری را افشا کند.

## تصمیم

- ابزار مشترک در `packages/backend-core/src/observability/`، رخدادهای تشخیصی را به‌صورت یک خط JSON روی stdout می‌نویسد. هر رخداد `timestamp`، `level`، `event`، `service`، `environment`، `version` و در صورت دسترس بودن frameهای محل ثبت رخداد (`origin`) دارد.
- ورودی‌های HTTP شناسه‌ی درخواست محلی و `correlationId` را در `AsyncLocalStorage` نگه می‌دارند تا عملیات async همان درخواست و تماس‌های خروجی آن شناسه‌ها را حفظ کنند. برای هر تماس خروجی `requestId` جدید ساخته می‌شود؛ `correlationId` بین سرویس‌های داخلی ثابت می‌ماند.
- خطای HTTP شامل component، stage، route template، method، status، نوع و کد خطا، کدهای پایگاه داده/Prisma در صورت وجود، زنجیره‌ی `cause` و حداکثر شش frame کد کاربردی است. متن خام exception، stack کامل و محتوای response ثبت نمی‌شوند.
- Node.js `fetch` در process backend به‌صورت متمرکز پایش می‌شود. نتیجه‌ی هر تماس خروجی شامل host و port، method، status، outcome، مدت و محل کد فراخواننده است؛ خطای decode کردن JSON پاسخ نیز جداگانه ثبت می‌شود. URL path/query، body و headerها ثبت نمی‌شوند. شناسه‌های همبستگی فقط به مقصد داخلی/first-party فرستاده می‌شوند و به provider بیرونی فرستاده نمی‌شوند.
- consumer رویداد و اتصال RabbitMQ هنگام شکست، stage، queue/dependency، شناسه و نوع رویداد معتبر و خطای امن را ثبت می‌کنند؛ payload رویداد چاپ نمی‌شود. خطاهای batch در Outbox به‌صورت خلاصه‌ی محدود همراه با علت امن و چند نمونه‌ی شناسه/نوع رویداد ثبت می‌شوند.
- readiness دیتابیس و تنظیمات سرویس، dependency، check شکست‌خورده، نام کلید تنظیمات لازم و metadata امن خطای اصلی را ثبت می‌کند؛ مقدار تنظیمات ثبت نمی‌شود.
- خطای uncaught در Node با `process.uncaught_exception` و علت امن ثبت می‌شود؛ monitor رفتار پیش‌فرض توقف process را تغییر نمی‌دهد.
- پاسخ‌های عمومی HTTP تغییر نمی‌کنند. لاگ فنی جای audit دامنه را نمی‌گیرد.

## پیامدها و محدودیت‌ها

- `correlationId` برای جست‌وجوی کل زنجیره و `requestId` برای پیدا کردن یک hop مشخص استفاده می‌شود. اگر یک سرویس لاگ ندارد، آخرین `dependency.http.failed` یا `dependency.http.completed` محل عبور یا توقف را مشخص می‌کند.
- خروجی log بیشتر می‌شود: یک رکورد برای هر تماس `fetch` و رکوردهای جدا برای exception، readiness failure و خلاصه‌ی شکست Outbox ثبت می‌شوند. خطاهای retry در Outbox داخل هر batch محدود و گروه‌بندی می‌شوند.
- پایش خودکار تمام transportها فقط برای Node.js `fetch` است. adapter مبتنی بر کتابخانه‌ی HTTP دیگری باید همین ابزار مشترک را صریحاً صدا کند.
- خطایی که عمداً گرفته و نادیده گرفته شود باید در همان `catch` رخداد امن خودش را ثبت کند؛ وگرنه پس از بلعیده‌شدن exception دیگر منبع اصلی در دسترس نیست.
- هیچ SQL، پارامتر query، شماره مشتری، OTP، token، password، cookie یا بدنه‌ی درخواست/پاسخ نباید به فیلدهای log اضافه شود. فیلدهای `dependencyHost` و `dependencyPort` فقط در log خصوصی backend هستند.
- migration لازم نیست. برای بازگشت، نسخه‌ی قبلی backend runtime پس از تأیید سازگاری schema مستقر می‌شود.

## سرویس‌ها و بسترهای اثرپذیرفته

`packages/backend-core` و هر ۹ process در `funtino-backend-runtime`. Frontend و schema داده تغییر نمی‌کنند.

## مستندات مرتبط

- [ADR-0012: پایش عملیاتی خصوصی](0012-private-operational-telemetry.md)
- [Runbook telemetry](../runbooks/operational-telemetry.md)
- [قواعد لازم‌الاجرای پیاده‌سازی](../ImplementationRules.md)
- [راهبرد استقرار Runflare](../RunflareRepositoryAndDeployment.md)
