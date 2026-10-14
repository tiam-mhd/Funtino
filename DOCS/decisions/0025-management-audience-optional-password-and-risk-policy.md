# ADR-0025: هویت واحد، نشست مدیریتی مستقل و سیاست ریسک احراز هویت

- تاریخ: 2026-10-14
- وضعیت: accepted؛ بر اساس درخواست صریح مالک محصول
- دامنه: API Gateway، Identity & Access، سه وب‌اپ، Wallet، Device Integration، Forms، OpenAPI و هر دو runtime bundle
- supersedes: الزام MFA در هر ورود مدیر سامانه در ADR-0014 و ADR-0020؛ هر حکم متعارض درباره‌ی deny بین عضویت‌ها؛ الزام reason و step-up در endpointهای معمول که در این تصمیم دوباره دسته‌بندی شده‌اند
- preserves: عمر نشست مدیریتی ۱ تا ۱۲ ساعت از ADR-0020، نشست مشتری ۳۰روزه، MFA تازه و یک‌باره‌ی bootstrap در ADR-0021، owner binding، write gate، مالکیت داده، audit/outbox، idempotency و کنترل آخرین مدیر

## زمینه

یک `User` در API Gateway از شماره‌ی تأییدشده‌ی یکتا ساخته می‌شود. همان شناسه می‌تواند چند عضویت فعال در scopeهای سازمانی و شعبه‌ای داشته باشد و هم‌زمان مشتری هم بماند. IAM فقط `userId` و داده‌ی عضویت را نگه می‌دارد؛ بااین‌حال، ترکیب deny بین عضویت‌ها باعث می‌شود deny محلی دسترسی مستقل همان شخص را در scope بالاتر ببندد. نشست واحد نیز مرز مطمئنی میان Customer، Operations و System نیست و ورود مدیر سراسری را بی‌دلیل به enrollment اجباری TOTP وابسته کرده است.

در permission catalog، readهای روزمره و عملیات عادی نیز step-up می‌خواهند. چند مسیر کارت، دستگاه و فرم reason را در API و storage اجباری کرده‌اند، هرچند تغییرهای معمول آن حوزه‌ها نیاز به توجیه متنی ندارند. ممیزی ساختاریافته‌ی actor، scope، operation، outcome و snapshot مستقل از reason باقی می‌ماند.

## تصمیم‌ها

### هویت، عضویت و deny

- شماره‌ی E.164 تأییدشده در جدول `User` در Gateway تنها کلید ساخت/یافتن هویت است. OTP و دعوت عضویت برای همان شماره، همان `userId` و پروفایل را به کار می‌برند؛ upsert پروفایل موجود را overwrite نمی‌کند. IAM، Organization & Branch و دیگر سرویس‌ها نام، نام خانوادگی یا شماره‌ی کامل را کپی نمی‌کنند.
- پاسخ roster از IAM ابتدا با scope و مجوز `staff.read` محدود می‌شود؛ سپس Gateway فقط برای `userId`های همان پاسخ، نام نمایشی امن را از User می‌خواند و به پاسخ اضافه می‌کند. شماره‌ی کامل، تاریخ تولد، ایمیل و تصویر در roster برگردانده نمی‌شود.
- تمام عضویت‌های فعال همان کاربر برای درخواست جمع می‌شوند. role و allow هر membership فقط در scope مجاز همان عضویت ارزیابی می‌شوند. deny محلی فقط grantهای هم‌سطح یا پایین‌تر در همان زنجیره‌ی scope را می‌بندد؛ grant مستقل با scope بالاتر یا tenant دیگر را نمی‌بندد. deny صریح از عضویت global در scope global همچنان روی هر درخواست global، organization و branch مقدم است. resource، انقضا، وضعیت membership/role، policy version و محدودیت delegation همچنان اجباری و fail-closed هستند.
- پنل‌ها نقش‌ها و scopeهای فعال هر `userId` را از عضویت‌های فعلی سرور نمایش می‌دهند؛ انتخاب scope فقط context رابط است و مجوز مستقل ایجاد نمی‌کند.

### نشست‌ها و ورود مدیریتی

- `POST /api/v1/auth/otp/verify` فقط نشست audience=`customer` می‌سازد. ورود Operations/System از مسیر جداگانه‌ی `/api/v1/auth/management/otp/verify` انجام می‌شود و تنها پس از تأیید OTP و وجود حداقل یک عضویت مدیریتی فعال اجازه‌ی ساخت نشست audience=`management` دارد.
- Cookie مشتری `funtino_session` و cookie مدیریت `funtino_management_session` هستند. `SessionGuard` برای `/api/v1/customer/*` فقط audience مشتری و برای `/api/v1/operations/*`، `/api/v1/system/*` و مسیرهای مدیریت در `/api/v1/auth/management/*` فقط audience مدیریت را می‌پذیرد. host، subdomain، body، query، role label یا مخفی‌کردن UI در تعیین audience نقشی ندارد.
- نشست مدیریتی عمر مطلق ۱ تا ۱۲ ساعت IAM را می‌گیرد و نشست مشتری ۳۰ روز می‌ماند. رکوردهای قدیمی نشست که audience ندارند با migration به customer تبدیل می‌شوند؛ کاربر مدیریتی پس از انتشار باید از مسیر management OTP دوباره وارد شود. نشست فعال هرگز از customer cookie به management session ارتقا داده نمی‌شود.
- برای کاربری که رمز مدیریت فعال کرده، OTP مدیریتی ابتدا یک challenge تصادفی، کوتاه‌عمر، یک‌بارمصرف و server-side می‌سازد؛ تا پیش از تأیید رمز هیچ management session ایجاد نمی‌شود. اگر رمز فعال نیست، OTP برای ساخت management session کافی است.
- رمز مدیریت اختیاری و برای همان User میان Operations و System مشترک است. Gateway آن را با scrypt دارای salt تصادفی و پارامترهای نسخه‌دار ذخیره می‌کند؛ طول مجاز ۱۲ تا ۱۲۸ نویسه است. پاسخ API، cookie، log، audit، telemetry، event و UI هیچ‌گاه hash یا رمز را برنمی‌گرداند. تلاش ناموفق محدود، lockout پایدار در PostgreSQL و challenge یک‌بارمصرف جلوی brute-force و replay را می‌گیرند.
- فعال‌سازی اولیه‌ی رمز به OTP تازه روی شماره‌ی User نیاز دارد. تغییر یا خاموش‌کردن رمز علاوه بر OTP تازه، رمز جاری را هم می‌خواهد. پس از تغییر credential، همه‌ی نشست‌های مدیریت به‌جز نشست درخواست‌کننده revoke می‌شوند. عملیات credential audit می‌شود ولی متن رمز و OTP ثبت نمی‌شود.
- MFA با TOTP و recovery code برای ورود عادی اجباری نیست و enrollment اجباری ندارد. step-up فقط برای دستورهای پرریسک پایین‌تر باقی می‌ماند. اثبات TOTP/recovery همچنان به session، نسخه‌ی عامل، scope، عضویت، permission و policy زنده در IAM متصل است. bootstrap یک‌باره‌ی مدیر در ADR-0021 همچنان fresh TOTP/recovery می‌خواهد.

### طبقه‌بندی step-up

- step-up باقی می‌ماند برای `organization.create`، `branch.deactivate`، `access.role.manage`، `access.permission.delegate`، `system.access.bootstrap`، `system.access.impersonate`، `report.export`، `forms.platform.manage`، `forms.responses.correct` و `forms.responses.export`.
- لغو دائمی membership فعال (`staff.membership.revoke`) و تغییر مقدار سیاست عمر نشست فقط در command مربوط step-up می‌خواهند؛ read همان resource step-up نمی‌خواهد.
- همه‌ی readهای عادی از جمله مشاهده‌ی صفحه، roster، خانواده/مشتری، audit، گزارش و PII فرم MFA نمی‌خواهند. `audit.read`, `customer.lookup.limited`, `customer.family.read`, `forms.responses.pii.read` و `report.read` step-up ندارند.
- تغییرهای عادی سازمان/شعبه، دعوت یا لغو دعوت در انتظار، تعلیق/فعال‌سازی مجدد کارکنان، عملیات موجودی/تخصیص معمول کارت، ثبت و نگه‌داری دستگاه و ساخت/ویرایش/انتشار/توقف معمول فرم MFA prompt ندارند. مجوز، scope، invariant دامنه، confirmation، idempotency و audit هرکدام پابرجاست.
- step-up پنج دقیقه است؛ IAM برای مدیر global جاری می‌تواند proof همان session را تا پایان عمر مطلق نشست (حداکثر ۱۲ ساعت) معتبر بداند. اگر نقش یا permission لازم revoke شود، درخواست بعدی به‌خاطر policy زنده رد می‌شود.

### طبقه‌بندی reason

- actor، operation، target، scope، زمان، correlation id، outcome و snapshot لازم همچنان در audit باقی می‌مانند. `reason` جای audit یا permission نیست؛ مقدار خالی/فاصله‌ای به `NULL` تبدیل می‌شود.
- reason اجباری می‌ماند برای: تغییر مؤثر permissionهای role، تغییر role عضویت فعال، ایجاد/revoke override فعال، revoke دائمی membership فعال، تغییر سیاست global عمر نشست، bootstrap/impersonation، archive terminal سازمان/شعبه/فرم، انتقال/تخصیص/لغو تخصیص کارت و اصلاح پاسخ ثبت‌شده‌ی مشتری.
- reason اختیاری است برای: تغییر نام یا اطلاعات عادی سازمان/شعبه، suspend/reactivate برگشت‌پذیر، دعوت یا لغو دعوت در انتظار، ثبت/تغییر lifecycle موجودی کارت، ثبت یا نگه‌داری دستگاه، انتشار/توقف معمول فرم، تغییر status پاسخ و تغییرهای عادی role که permission مؤثر را عوض نمی‌کنند. reason اختیاری در صورت ورود ثبت می‌شود.
- reason از lookup/read عادی حذف می‌شود. ورودی‌های reason با طول حداکثر ۵۰۰ نویسه validate و trim می‌شوند؛ برای فیلد اختیاری حداقل طول ساختگی اعمال نمی‌شود.
- الزام reason در UI، OpenAPI، Gateway و سرویس مالک با nullable بودن audit storage هم‌معنی است. مالک هر migration فقط schema خودش را تغییر می‌دهد.

## مسیرهای مصوب و مرز مالکیت

| تغییر                                                                                        | مسیر مالک                                                                                                                                                                                                                                 | bundle             |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| session audience، management password، OTP/challenge، user identity projection و public auth | `apps/api-gateway/src/{application/auth,domain,infrastructure/store,interfaces/http}` و `apps/api-gateway/prisma/migrations/`                                                                                                             | backend            |
| union permission/deny و catalog                                                              | `services/identity-access/src/domain/authorization/` و `contracts/openapi/identity-access.yaml`                                                                                                                                           | backend            |
| قرارداد endpointها                                                                           | `contracts/openapi/gateway.yaml`، `identity-access.yaml`، `wallet.yaml`، `device-integration.yaml`، `forms-gateway.yaml`، `forms-internal.yaml`                                                                                           | frontend + backend |
| صفحات امنیت حساب مدیریت                                                                      | `apps/operations-web/src/features/security/` و `apps/operations-web/src/app/account/security/management-password/`؛ `apps/system-web/src/features/security/` و `apps/system-web/src/app/[locale]/(console)/security/management-password/` | frontend           |
| reason موجودی کارت                                                                           | `services/wallet/prisma/`، `services/wallet/src/`، Gateway و Operations UI                                                                                                                                                                | backend + frontend |
| reason ثبت دستگاه                                                                            | `services/device-integration/prisma/`، `services/device-integration/src/`، Gateway و Operations UI                                                                                                                                        | backend + frontend |
| reason فرم و اصلاح پاسخ                                                                      | `services/forms/prisma/`، `services/forms/src/`، Gateway و Operations UI                                                                                                                                                                  | backend + frontend |

کد web app فقط زیر `apps/<app>/src/` قرار می‌گیرد. مسیرهای security در ساختار `DOCS/FolderAndFileStructure.md` افزوده می‌شوند؛ IAM به جدول User Gateway وصل نمی‌شود. migration Gateway و Device Integration با job نسخه‌دار مالک خود اجرا می‌شوند. migration Wallet را runner از قبل مجازشده‌ی همان Worker طبق ADR-0015 اعمال می‌کند؛ allow-list startup گسترش نمی‌یابد. schema فرم برای audit reason از قبل nullable است و در این تغییر migration تازه‌ای ندارد؛ reason اصلاح پاسخ همچنان اجباری است.

## rollout و rollback

1. migrationهای Gateway و Device Integration در staging و با credential مالک اجرا شوند؛ migration Wallet فقط از runner موجود ADR-0015 می‌آید. سپس backend bundle با API سازگار و بعد frontend bundle منتشر شود. هر دو bundle به‌دلیل تغییر contract در ماتریس اثر هستند.
2. migration Gateway ستون‌های جدید را با default ثابت اضافه می‌کند تا ردیف‌های قدیمی audience=`customer` بگیرند؛ هیچ UPDATE سراسری روی نشست‌ها اجرا نمی‌شود. migration پیش از هر DDL نسخه‌ی PostgreSQL را کنترل می‌کند و زیر نسخه‌ی 11 fail-closed است. فیلدهای مدیریت رمز برای کاربران موجود NULL/صفر می‌مانند و hash ساخته نمی‌شود.
3. reasonهای قدیمی حفظ می‌شوند. nullable کردن ستون Wallet قید «reason خالی نباشد» را نگه می‌دارد؛ مقدار NULL از آن قید عبور می‌کند. Device نیز reason nullable می‌گیرد و Forms migration تازه ندارد. هیچ backfill یا حذف reason اجرا نمی‌شود.
4. نسخه‌ی قدیمی management cookie را نمی‌شناسد؛ rollback app پس از ایجاد نشست management به خروج/re-login و ارزیابی سازگاری نیاز دارد. rollback migration با DROP ممنوع است. بازگرداندن الزام reason با متن ساختگی ممنوع است.
5. موفقیت فقط پس از contract validation، Prisma validation، تست‌های audience و replay، ماتریس scope/deny و UI هر دو پنل قابل اعلام است. migration و rollout واقعی Runflare جزو این تغییر نیست.

## گزینه‌های ردشده

- ارتقای customer session بر پایه‌ی host یا role: رد شد؛ host قابل‌دست‌کاری است و customer session نباید به نشست مدیریتی تبدیل شود.
- MFA اجباری در هر ورود: رد شد؛ SMS OTP + audience مستقل نشست ورود مدیریتی را انجام می‌دهد و TOTP فقط برای command پرریسک می‌ماند.
- اعمال هر deny روی تمام grantهای User: رد شد؛ مرز membership و scope را نقض می‌کند. deny global استثنای صریح و سراسری می‌ماند.
- reason اجباری برای تمام mutationها: رد شد؛ عملیات عادی همچنان audit کامل دارند و دلیل اختیاری ذخیره می‌شود.
