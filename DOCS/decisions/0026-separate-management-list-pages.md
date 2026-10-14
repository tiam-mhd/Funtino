# ADR-0026: تفکیک صفحه‌های فهرستی پنل‌های Operations و System

- تاریخ: 2026-10-14
- وضعیت: accepted؛ مطابق درخواست مالک محصول
- دامنه: `operations-web` و `system-web`؛ frontend runtime
- preserves: APIها و مالکیت داده، مجوز و scope سمت سرور، نشست مدیریت، قراردادهای موجود، جریان‌های فرم و صندوق، و مرز مستقل پنل مشتری

## مسئله و زمینه

چند صفحه‌ی موجود چند مجموعه‌ی مستقل را کنار هم نشان می‌دهند و در Operations بخش‌های navigation فقط تب محلی روی آدرس ریشه‌اند. این ترکیب، پیدا کردن فهرست کارکنان، دعوت‌ها، شعب، فرم‌ها و گزارش‌ها را دشوار می‌کند. در System نیز سازمان/شعبه، چند بخش دسترسی، فرم/قالب و سرویس/هشدار در صفحات مشترک قرار دارند.

گسترش مسیرهای Operations در [ساختار مصوب پروژه](../FolderAndFileStructure.md) به ADR مستقل نیاز دارد. endpointهای فعلی فهرست‌های موردنظر را تأمین می‌کنند؛ این تغییر قرارداد API، مدل دامنه یا مرز مجوز را عوض نمی‌کند.

## گزینه‌های بررسی‌شده

1. حفظ صفحه‌های ترکیبی و فقط تغییر عنوان و بخش‌بندی سایدبار؛
2. ساخت route مستقل برای هر فهرست مستقل و حفظ جزئیات وابسته در جریان context همان داده؛
3. ساخت route و API جدید برای هر زیرمجموعه‌ی وابسته.

## تصمیم نهایی

- گزینه‌ی ۲ انتخاب می‌شود. هر فهرست مستقل موجود route و ورودی navigation مستقل می‌گیرد. گروه‌بندی سایدبار پس از تثبیت همین routeها و بر اساس کار روزانه‌ی کاربر تعریف می‌شود.
- Operations از route group پایدار برای نگه‌داری نشست، scope انتخاب‌شده، callbackهای انقضای نشست و stateهای مشترک استفاده می‌کند. routeها فقط صفحه/feature موجود را compose می‌کنند؛ کنترل scope و مجوز همچنان سمت سرور است.
- مسیرهای Operations: `/` نمای کلی؛ `/branches`؛ `/staff`؛ `/invitations/received`؛ `/invitations/issued`؛ `/devices`؛ `/cards/inventory`؛ `/cards/assignments`؛ `/family`؛ `/family/members`؛ `/family/invitations`؛ `/family/history`؛ `/forms`؛ `/forms/responses`؛ `/forms/branches`؛ `/reports`؛ `/reports/branches`؛ `/reports/daily`.
- مسیرهای System: `/fa/organizations` و `/fa/organizations/branches`؛ `/fa/access/staff`، `/fa/access/invitations/received`، `/fa/access/invitations/issued`، `/fa/access/roles` و `/fa/access/audit`؛ `/fa/forms` و `/fa/forms/templates`؛ `/fa/system-health` و `/fa/system-health/alerts`؛ `/fa/customer-family` برای جست‌وجو، `/fa/customer-family/members`، `/fa/customer-family/invitations` و `/fa/customer-family/history`. مسیرهای امنیت موجود بدون تغییر می‌مانند. مسیرهای پیشین به view اصلی حوزه هدایت می‌شوند و `/fa/access` به فهرست کارکنان می‌رود تا bookmarkهای معتبر نشکنند.
- جزئیات اعضا، دعوت‌ها و تاریخچه‌ی خانواده صفحه و ورودی navigation جدا دارند، اما فقط همان نتایج lookup مجاز را نمایش می‌دهند. هیچ فهرست عمومی یا API تازه‌ای ساخته نمی‌شود؛ context انتخاب‌شده در layout پایدار نگه داشته می‌شود و پس از refresh، کاربر باید دوباره lookup کند. فرم پاسخ نیز به فرم و scope انتخاب‌شده وابسته است؛ صفحه‌ی پاسخ‌ها همان context را از انتخاب فرم یا لینک همان فرم می‌گیرد.
- فهرست شعب Operations فقط در scope سازمانی در دسترس است؛ در scope شعبه هیچ داده‌ای از شعبه‌های دیگر بارگذاری یا نمایش داده نمی‌شود. تخصیص کارت فقط با endpointها و قابلیت‌های فعلی Wallet و scope شعبه‌ی معتبر ارائه می‌شود.
- داده‌ها، فیلترها، صفحه‌بندی، mutationها، confirmation، MFA step-up و audit موجود حفظ می‌شوند. جداکردن یک صفحه به‌تنهایی مجوز سرور ایجاد نمی‌کند و UI عملیات غیرمجاز را قابل اجرا نمی‌کند.
- پنل customer-web و deployment repositoryها از این تصمیم خارج‌اند.

## پیامدها و trade-offها

- routeها قابل لینک، bookmark و بازگشت با حفظ زمینه می‌شوند و فهرست‌های مستقل تراکم کمتری دارند.
- یک endpoint ترکیبی ممکن است در چند route مصرف شود؛ query فقط وقتی اجرا می‌شود که صفحه‌ی مربوط به داده نیاز دارد.
- context وابسته‌ی خانواده و پاسخ فرم به انتخاب صریح مورد نیاز دارند؛ بدون context صفحه باید empty state راهنما نشان دهد و نباید PII یا داده‌ی ساختگی نمایش دهد.
- منو تعداد گزینه‌های بیشتری دارد؛ گروه‌بندی بر اساس کار و مسیرهای واقعی انجام می‌شود و امکان جمع/بازشدن پوسته حفظ می‌شود.

## بسترهای اثرپذیرفته

- `operations-web`: app router، `OperationsEntry`، `OperationsWorkspaceShell` و featureهای staff-access، cashier, reports و forms.
- `system-web`: app router، `SystemShell` و featureهای organizations، access-control، forms و health.
- bundle اثرپذیرفته در صورت انتشار: `funtino-frontend-runtime`؛ backend و قراردادها اثر ندارند.

## migration و rollback

تغییر فقط در source monorepo و routeها/پوسته‌ی دو app انجام می‌شود. routeهای قدیمی معتبر redirect می‌شوند تا bookmarkهای قبلی کار کنند. rollback با بازگرداندن route group و composition قبلی انجام‌پذیر است؛ هیچ migration دیتابیس، تغییر contract یا انتشار مستقل backend لازم نیست.

## اسناد مرتبط

- [ساختار فایل و routeهای app](../FolderAndFileStructure.md)
- [قواعد پیاده‌سازی](../ImplementationRules.md)
- [برنامه‌ی فازها: O0/O1/O3/O5 و S1/S2/S4](../PhasesAndExecutionPlan.md)
