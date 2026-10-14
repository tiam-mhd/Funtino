# مدیریت کارکنان و دسترسی در Operations Web

## مالکیت و محدوده‌ی اعتماد

- Identity & Access مالک membership، role، permission، MFA و override است. Operations Web فقط از BFF نشست‌محور API Gateway استفاده می‌کند و به دیتابیس IAM یا owner سازمان/شعبه دسترسی ندارد.
- scope از انتخاب صریح و سرور-تأییدشده‌ی کاربر می‌آید. هر درخواست فهرست و هر mutation scope دقیق را می‌فرستد و IAM مجوز actor را در همان درخواست بازبینی می‌کند؛ کنترل UI جایگزین این بررسی نیست.
- Operations Web scope مجموعه را به‌عنوان فضای مجموعه نشان می‌دهد و برای عضویت سازمانی، شعب فعال زیر همان مجموعه را نیز جداگانه قابل انتخاب می‌کند. تغییر این انتخابگر فقط مسیر کاربری را باز می‌کند؛ هر endpoint عملیاتی همچنان permission و scope دقیق خودش را در Gateway/IAM بررسی می‌کند.
- شماره‌ی دعوت در فهرست مدیر فقط به‌صورت mask برمی‌گردد. فهرست دعوت شخصی با شماره‌ی OTP تأییدشده‌ی نشست در سرور خوانده می‌شود؛ مرورگر نمی‌تواند شماره‌ی lookup را تعیین کند.
- پذیرش دعوت صریح و idempotent است. endpoint پذیرش شماره نمی‌گیرد؛ Gateway شماره‌ی تأییدشده‌ی هویت جاری را دوباره از Auth می‌خواند. پس از پذیرش، scope به‌صورت خودکار انتخاب نمی‌شود و کاربر باید آن را جداگانه انتخاب کند.
- تغییرات مدیریتی reason و `Idempotency-Key` دارند؛ تغییر نقش علاوه بر آن `If-Match` نسخه‌ی membership را می‌فرستد. IAM مسئول audit، delegation، منع دست‌کاری roleهای سیستمی، precedence رد و حفاظت از آخرین مدیر است.

## قابلیت‌های Operations Web

`apps/operations-web/src/features/staff-access/` این بخش‌ها را پیاده‌سازی می‌کند:

- roster صفحه‌بندی‌شده‌ی همین scope، فیلتر وضعیت، جست‌وجوی شماره‌ی پوشیده/نام نقش و مرتب‌سازی محلی؛
- صدور دعوت به شماره‌ی نرمال‌شده‌ی E.164 با نقش فعال و قابل‌واگذاری موجود در scope؛ فهرست و لغو دعوت‌های صادرشده؛ نقش‌های جایگزین بر اساس scope واقعی همان membership محدود می‌شوند؛
- inbox شخصی در صفحه‌ی انتخاب scope، حالت بی‌دسترسی و workspace فعال؛ نمایش نام زنده‌ی مجموعه/شعبه، وضعیت owner، نقش، شماره‌ی مقصد mask‌شده و مهلت دعوت؛ منبع inactive/unavailable قابل پذیرش نیست؛ دعوت سراسری به صفحه‌ی مدیریت سامانه هدایت می‌شود؛ پذیرش تنها برای کاربر احراز‌شده؛
- تغییر role برای عضویت فعال/معلق با نسخه‌ی مورد انتظار؛ تعلیق عضویت فعال و فعال‌سازی مجدد عضویت معلق؛ عضویت pending/revoked از کنترل نامعتبر lifecycle برخوردار نیست؛
- فهرست، اعطا و لغو override فردی در محدوده‌ی مجاز عضویت: permission از catalog، effect برابر allow/deny، scope، منبع اختیاری، انقضای اختیاری و دلیل؛
- gate تعاملی فرمان‌های پرریسک طبق catalog: OTP ورود مدیریتی به‌تنهایی step-up محسوب نمی‌شود؛ فقط commandهایی که IAM پرریسک طبقه‌بندی کرده‌اند TOTP/recovery می‌خواهند. در صورت نیاز factor enroll می‌شود و recovery codeها فقط یک‌بار نشان داده شده و پیش از ادامه acknowledgment می‌خواهند. session، نسخه‌ی عامل و تازگی evidence را Gateway و IAM کنترل می‌کنند.
- stateهای loading/empty/error، refresh پس از conflict، pagination، پیام موفقیت، فرم‌های RTL/mobile-first و landmark/labelهای صفحه‌خوان.

این برش در Operations Web نقش تازه ایجاد یا permission catalog را تغییر نمی‌دهد؛ فقط role فعال و غیرسیستمی‌ای را می‌توان تخصیص داد که IAM در scope جاری برگردانده است. عملیات ساخت/ویرایش role و مدیریت roleهای سیستمی در مسیر System و bootstrap محدود IAM باقی می‌ماند.

### معرفی مدیر مجموعه در System Web

در صفحه‌ی مدیریت دسترسی System، مدیر سراسری مجموعه‌ها و شعب فعال را از فهرست‌های مجاز Gateway انتخاب می‌کند؛ واردکردن شناسه‌ی خام لازم نیست. برای معرفی مدیر یک مجموعه، scope همان مجموعه را انتخاب می‌کند، نقش را از الگوی `organization_manager` می‌سازد و به شماره‌ی همراه مدیر دعوت می‌فرستد. این الگو همه‌ی مجوزهای مدیریتی tenant در catalog فعلی را دارد و عضویت organization-scope آن روی خود مجموعه و شعب فعلی و بعدی اعمال می‌شود؛ permissionهای global سامانه به مدیر مجموعه واگذار نمی‌شوند. دعوت پس از ورود با همان شماره‌ی تأییدشده و پذیرش صریح فعال می‌شود.

Gateway و IAM همچنان مرجع مجوز هستند: فهرست بر اساس دسترسی سروری محدود می‌شود، هر command scope و parentage را دوباره اعتبارسنجی می‌کند، MFA/delegation/audit اعمال می‌شود و gate تولیدی `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` باید در بازه‌ی انتشار مجاز باز باشد. این مسیر هیچ bypass یا عضویت مدیریتی پنهانی ایجاد نمی‌کند.

## قراردادها و کد

- قرارداد عمومی: `contracts/openapi/gateway.yaml`، مسیرهای `/api/v1/operations/staff`، `/staff/invitations`، `/staff/invitations/pending`، `/roles`، `/permissions` و `/mfa/*`.
- BFF: `apps/api-gateway/src/interfaces/http/operations-access.controller.ts`، clientهای داخلی Identity Access و Organization & Branch؛ session، verified phone، نام/وضعیت لحظه‌ای scope، trusted-origin، idempotency و optimistic concurrency در سرور اعمال می‌شوند.
- System Web نیز همان inbox مشترک را مصرف می‌کند؛ دعوت سراسری در آن بستر قابل پذیرش است، اما scope tenant غیرفعال یا تأییدنشده در هر دو پنل دکمه‌ی پذیرش ندارد.
- مالک دامنه: `services/identity-access/src/application/access-management.service.ts` و API داخلی versioned آن.
- UI و API client: `apps/operations-web/src/features/staff-access/` و `apps/operations-web/src/lib/api/operations-staff.ts`.
- تست client: `apps/operations-web/src/tests/operations-staff.api.spec.ts`؛ تست‌های Gateway و IAM در workspaceهای مالک قرار دارند.

## مرز و gate production

مرز تصمیم با انتخاب مالک محصول در ADR-0010 تثبیت شده است: IAM تنها مرجع مجوز actor، delegation و MFA است؛ Organization & Branch فقط اعتبار resource (وجود، active state و parentage) را از منبع حقیقت خودش پاسخ می‌دهد. پس از authorization، IAM برای هر mutation tenant در production `POST /internal/v1/scopes/validate` را با credential مستقل صدا می‌زند. credential `identity-access` فقط به همین endpoint اجازه دارد. scope نامعتبر به رد عمومی و auditشده و قطع سرویس/timeout/پاسخ ناسازگار به `503` و rollback mutation منجر می‌شود.

تنظیم صحیح `ORGANIZATION_BRANCH_URL` و `ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN` شرط فعال‌شدن مسیر production در runtime است؛ Owner در هر درخواست دوباره خوانده می‌شود و عدم دسترسی به آن fail-closed است. nonproduction همچنان scope opaque را فقط برای توسعه/آزمون می‌پذیرد. این source change نه تنظیم secret واقعی است، نه اجرای staging و نه مجوز deployment/pilot.

مطابق ADR-0011، تمام mutationهای IAM در production، از جمله پذیرش دعوت، یک release gate مستقل دارند و به‌صورت پیش‌فرض بسته‌اند؛ فقط مقدار دقیق `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` در release window تاییدشده آن‌ها را باز می‌کند. این gate اعتبارسنجی زنده‌ی Owner، permission/delegation/MFA و audit هر command را دور نمی‌زند. فقط lifecycle عامل MFA خود کاربر از kill switch جداست تا enrollment و بازیابی ممکن بماند. readiness وضعیت gate مدیریتی و scope tenant را جدا گزارش می‌دهد؛ بستن flag به `false` rollback عملیاتی است.

مدیر سراسری فقط از one-off CLI ساخته یا reconcile می‌شود. Gateway مقصد را از `SYSTEM_ADMIN_OWNER_PHONE_E164` در runtime خودش resolve می‌کند؛ IAM UUID نمی‌پذیرد و شماره را در دیتابیس خود نگه نمی‌دارد. finalize با TOTP/recovery تمام کلیدهای کاتالوگ را می‌دهد و عضویت system-admin دیگر را در همان تراکنش revoke و audit می‌کند. دستورها و متغیرهای Runflare در [ADR-0021](decisions/0021-runflare-bound-system-admin-owner.md) و [راهنمای IAM](../services/identity-access/README.md) آمده‌اند.

## اعتبارسنجی و محدودیت انتشار

- Operations Web: TypeScript، ESLint و production build بررسی می‌شوند؛ چهار تست API client مسیر scope، pagination، پذیرش بدون شماره‌ی client و version/idempotency را پوشش می‌دهند. Gateway نیز ۴۰/۴۰ و Identity & Access برابر ۴۴/۴۴ تست واحد جاری را پاس کرده‌اند.
- تست UI مرورگری/E2E با OTP واقعی، PostgreSQL و دو شعبه در این محیط اجرا نشده است.
- این تغییر source monorepo است؛ deployment repository یا Runflare به‌روزرسانی نشده، migration دیتابیس اجرا نشده و انتشار/پایلوت انجام نشده است.
