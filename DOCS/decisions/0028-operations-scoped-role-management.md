# ADR-0028: مدیریت نقش‌های scoped در پنل Operations

- تاریخ: ۲۰۲۶-۱۰-۱۸
- وضعیت: accepted
- تصمیم‌گیرنده: مالک محصول و معماری Funtino

## مسئله و زمینه

صفحه‌ی اعضای مجموعه/شعب باید بخش مستقلی برای نقش‌ها داشته باشد. نقش‌ها در IAM و با scope مجموعه یا شعبه نگهداری می‌شوند؛ فهرست، جزئیات، اعضای منتسب و همه‌ی mutationها باید از API مالک IAM و مجوز زنده‌ی همان scope استفاده کنند. درخواست محصول برای جست‌وجوی آشکار بالای فهرست و modalهای ساخت/ویرایش با الگوی عمومی فهرست ویرایش در route مستقل ADR-0027 تفاوت دارد.

نقش‌ها به عضویت‌ها، دعوت‌ها و audit ارجاع دارند. حذف فیزیکی آن‌ها ممکن نیست و غیرفعال‌سازی نیز معادل حذف نیست.

## تصمیم نهایی

- مسیر فهرست نقش‌ها در `operations-web` برابر `/staff/roles` و جزئیات برابر `/staff/roles/{roleId}` است. ورودی نقش‌ها زیر گروه اعضا در navigation قرار می‌گیرد و مسیر جزئیات همچنان زیر همان گروه فعال می‌ماند.
- بخش «همکاران» رابط Operations با عنوان «اعضا» نمایش داده می‌شود. فهرست اعضا و فهرست نقش‌ها routeهای مستقل دارند.
- فهرست نقش‌ها از component فهرست مشترک همان app استفاده می‌کند. جست‌وجوی نام نقش با آیکون و textbox آشکار در نوار عملیات، استثنای محدود برای نقش‌ها از قاعده‌ی قراردادن ورودی جست‌وجو در dialog در بخش ۴.۱ `ImplementationRules.md` است. اعمال فیلترهای چرخه‌ی نقش و نوع نقش در modal انجام می‌شود؛ query و فیلتر در IAM سمت سرور اجرا می‌شوند.
- ساخت و ویرایش نقش در modal همین فهرست انجام می‌شود و استثنای محدود از route مستقل ایجاد/ویرایش در ADR-0027 است. جزئیات هر نقش route مستقل دارد. کنترل دسترسی، scope و delegation همیشه در IAM بررسی می‌شوند.
- فهرست نقش‌ها از نام، چرخه (`active`, `disabled`, `deleted`) و نوع (`custom`, `system`) فیلتر می‌کند و صفحه‌بندی cursor فعلی را حفظ می‌کند. endpoint جزئیات نقش، scope نقش، permissionها، نوع، وضعیت، نسخه و نشانگر حذف را برمی‌گرداند. صفحه‌ی جزئیات برای اعضا از endpoint roster با فیلتر `roleId` استفاده می‌کند؛ نبود `staff.read` فقط بخش اعضا را محدود می‌کند و دسترسی `access.role.read` به تعریف نقش را جایگزین یا توسعه نمی‌دهد.
- حذف فقط نقش سفارشی را می‌پذیرد و soft-delete قابل‌بازیابی است: `deletedAt` ثبت، role هم‌زمان `disabled` و version افزایش می‌یابد، permissionها و ارجاع‌های audit حفظ می‌شوند و نقش از فهرست عادی و انتساب‌های جدید خارج می‌شود. کلید یکتای نام در همان scope پس از حذف آزاد می‌شود؛ restore در صورت استفاده‌ی مجدد از نام با conflict رد می‌شود. حذف وقتی حتی یک membership غیر `revoked` یا invitation معتبر `pending` به نقش متصل است با conflict رد می‌شود؛ مدیر ابتدا باید دسترسی‌ها را از مسیرهای رسمی تعیین تکلیف کند.
- نقش حذف‌شده با فیلتر `deleted` قابل مشاهده است. restore فقط به `disabled` برمی‌گرداند و هرگز دسترسی قبلی را خودکار فعال نمی‌کند. حذف و restore هر دو به `access.role.manage` در scope مالک، دلیل ۸ تا ۵۰۰ نویسه، MFA step-up تازه، version مورد انتظار، idempotency و audit قبل/بعد نیاز دارند. نقش `systemManaged` حذف یا restore نمی‌شود.
- endpointهای list، detail، staff roster و mutation در API Gateway فقط به IAM متصل می‌شوند؛ هیچ appی جدول IAM را مستقیم نمی‌خواند. جست‌وجو/فیلتر، roleId و شناسه‌ی scope ورودی غیرقابل‌اعتمادند و مجدداً در IAM اعتبارسنجی می‌شوند.
- migration `deleted_at` و index یکتای نام در مالک IAM نسخه‌دار و مستقل از startup app اجرا می‌شود. تغییرهای `operations-web` در runtime frontend و تغییرهای Gateway/IAM در runtime backend بسته‌بندی می‌شوند؛ چون قراردادهای مشترک و هر دو bundle مصرف‌کننده دارند، انتشار باید هر دو bundle را پوشش دهد.

## گزینه‌های بررسی‌شده

1. پنهان‌کردن محلی role یا تغییر `status` به disabled به‌عنوان حذف؛ رد شد چون چرخه‌ی حذف قابل‌بازیابی و audit را فراهم نمی‌کند.
2. حذف فیزیکی role؛ رد شد چون عضویت‌ها، دعوت‌ها، permissionها و audit به آن ارجاع دارند.
3. soft-delete نسخه‌دار با رد حذف role در حال استفاده و restore به وضعیت disabled؛ انتخاب شد تا دسترسی فعال به‌طور ناگهانی از بین نرود و بازیابی، دسترسی را خودکار اعطا نکند.

## قرارداد و معیار پذیرش

- OpenAPI عمومی و داخلی IAM، schemaهای event/audit مربوط به تغییر policy، migration و Prisma باید lifecycle role و فیلترهای server-side را پوشش دهند.
- UI باید loading، empty، no-result، error/retry، no-access، busy، success، RTL، keyboard/focus، موبایل، modalهای قابل‌بستن با Escape و pagination واقعی را پوشش دهد.
- صفحه‌ی جزئیات باید همه‌ی permission keyهای نقش و فهرست اعضای قابل‌مشاهده را بر اساس مجوزهای مستقل نشان دهد.
- هیچ mutationی به پنهان‌سازی UI اکتفا نمی‌کند؛ delegation، scope مالک، MFA، reason، concurrency و idempotency در IAM باقی می‌مانند.

## پیامدها

- نقش حذف‌شده در داده باقی می‌ماند و قابل restore است؛ پاک‌سازی فیزیکی جزو این قابلیت نیست.
- حذف نقش در حال استفاده ابتدا به تعیین تکلیف membership و invitation نیاز دارد.
- جست‌وجوی inline فقط برای فهرست نقش‌های Operations مجاز است؛ سایر فهرست‌ها از قاعده‌ی عمومی ADR-0027 پیروی می‌کنند.
- ساخت/ویرایش modal فقط برای نقش‌های Operations مجاز است؛ سایر فهرست‌ها همچنان از route مستقل استفاده می‌کنند.

## لینک‌های مرتبط

- [قوانین پیاده‌سازی](../ImplementationRules.md)
- [الگوی معماری](../ArchitectureAndDesignPatterns.md)
- [ساختار مخزن](../FolderAndFileStructure.md)
- [چرخه‌ی فهرست و حذف](0027-management-list-page-and-deletion-lifecycle.md)
- [مدیریت کارکنان و scope](0005-organization-branch-device-card-management.md)
- [فرمان‌های IAM](0008-iam-management-write-gates.md)
- [مرز validation scope](0010-iam-owner-scope-validation-boundary.md)
- [سیاست هویت و ریسک مدیریت](0025-management-audience-optional-password-and-risk-policy.md)

## برنامه‌ی migration یا rollback

- migration فقط `deleted_at` را به جدول role اضافه می‌کند؛ rollback schema بدون حذف داده ممکن است.
- حذف/restore تراکنشی و audit‌شده است. در صورت اشکال، UI می‌تواند موقتاً mutation را پنهان کند؛ داده‌ی نقش و ارجاع‌های موجود حذف فیزیکی نمی‌شوند.
- source monorepo مرجع است؛ هر انتشار آینده با ماتریس هر دو runtime bundle و workflow canonical Runflare انجام می‌شود.
