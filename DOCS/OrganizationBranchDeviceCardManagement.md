# طرح پیاده‌سازی مدیریت مجموعه، شعبه، کارکنان، دستگاه و کارت

تاریخ بررسی: 2026-09-28
وضعیت: طرح تأییدشده بر اساس ADR-0005؛ پیاده‌سازی مرحله‌ای است. sync واقعی RFID و مانده‌ی مالی همچنان به قراردادهای بیرونی نیاز دارند.

سیاست هویت و دسترسی در 2026-10-14 با [ADR-0025](decisions/0025-management-audience-optional-password-and-risk-policy.md) به‌روز شد: user مرکزی می‌تواند چند membership داشته باشد؛ union مجوزها با deny محدود به scope و استثنای deny سراسری ارزیابی می‌شود. نشست مدیریتی از customer جداست، MFA فقط برای commandهای پرریسک است، و عملیات عادی موجودی کارت نه MFA و نه reason اجباری می‌خواهد.

وضعیت تکمیلی 2026-10-01: BFF نشست‌محور Gateway و صفحه‌ی System Web برای مدیریت مجموعه/شعبه در source پیاده شده‌اند. فهرست، ایجاد، ویرایش نسخه‌محور، تعلیق/فعال‌سازی برگشت‌پذیر و نمایش status واقعی از سرویس مالک فراهم است؛ دسترسی در هر درخواست server-side بررسی می‌شود. این تغییر به معنی اجرای migration/backfill، اتصال deployment repository یا انتشار production نیست؛ validator در IAM و gateهای cutover/restore/deployment همچنان بازند.

وضعیت تکمیلی 2026-10-01 — دستگاه‌ها: BFF عمومی و بخش مدیریت/پایش دستگاه در Operations Web پیاده و به Device Integration واقعی متصل شده‌اند. مسیرهای `GET /api/v1/operations/devices`, `GET /api/v1/operations/organizations/{organizationId}/branches`, `POST /api/v1/operations/organizations/{organizationId}/branches/{branchId}/devices` و `PATCH .../{deviceId}` نشست‌محورند؛ IAM scope/resource، وضعیت زنده‌ی owner، Trusted Origin، idempotency و optimistic concurrency در Gateway بررسی می‌شوند. UI ثبت دستگاه، pagination، فیلتر lifecycle و فیلترهای محلی روی صفحات بارگذاری‌شده، health/freshness معتبر، جداسازی unknown/stale و پیگیری degraded/offline را ارائه می‌دهد. سلامت فقط از مشاهده‌ی امضاشده‌ی مالک می‌آید و مدیریت رخداد/تعمیرات مستقل یا اتصال سخت‌افزار در این برش ادعا نمی‌شود. migration/restore واقعی، provider و deployment همچنان بازند.

وضعیت تکمیلی 2026-10-01 — Wallet owner و inventory Operations (سیاست MFA/reason بعداً با ADR-0025 اصلاح شد): `services/wallet` مرجع موجودی فیزیکی کارت است و API داخلی آن از Gateway فراخوانی می‌شود. Gateway BFF و Operations Web فهرست/ثبت/تغییر وضعیت کارت را با IAM scope/resource، وضعیت زنده‌ی organization/branch، Trusted Origin، idempotency و optimistic concurrency ارائه می‌کنند؛ inventory command به MFA یا reason اجباری نیاز ندارد و دلیل اختیاری ثبت می‌شود. شناسه فقط mask می‌شود و ورودی دستی تا تأیید provider `unknown` است. این برش هیچ تخصیص مشتری نمی‌سازد: Customer & Household owner/API برای اعتبارسنجی household/member در repository موجود نیست. customer read path هنوز legacy است؛ backfill، assignment/transfer/unassign، ledger/مانده‌ی مالی، migration روی PostgreSQL واقعی و deployment مستقل همچنان gateهای بازند.

## هدف و دامنه

یک جریان یکپارچه برای ساخت و مدیریت سازمان و شعبه، عضویت و نقش کارکنان، ثبت و پایش دستگاه‌های هر شعبه، موجودی و تخصیص کارت به مشتری/عضو خانواده، مشاهده‌ی کارت در customer-web و گزارش‌های مدیریتی فراهم شود. API مرجع اعمال مجوز و scope است؛ هیچ UI به‌تنهایی مرز دسترسی محسوب نمی‌شود.

این قابلیت عملیات مالی، شارژ یا تغییر مانده را فعال نمی‌کند. ثبت دستی داخلی کارت/دستگاه برای پایلوت تأیید شده، اما رکورد ثبت‌شده تا مشاهده/تأیید provider «تأییدنشده/نامشخص» است. گزارش‌های اولیه فقط شاخص‌های سازمانی و عملیاتی را نشان می‌دهند؛ هر عدد مالی تا تعیین منبع حقیقت و قرارداد RFID/مالی از گزارش حذف می‌شود.

## یافته‌های مخزن و اسناد

- ساختار ریشه با monorepo مصوب منطبق است. سه web app کد را زیر `src/` نگه می‌دارند و قرارداد عمومی در `contracts/openapi/gateway.yaml` است.
- Prisma در API Gateway از قبل `Organization`، `Branch` و `Membership` دارد؛ برای آن‌ها API مدیریتی، lifecycle عضویت، guard مبتنی بر نقش و scope، و audit کامل وجود ندارد.
- تصمیم cutover در [ADR-0009](decisions/0009-organization-branch-owner-and-legacy-cutover.md) ثبت شد: owner service/schema مستقل ایجاد شده، Gateway branch discovery و بررسی شعبه‌ی کارت را از API داخلی می‌گیرد، و legacy tables/Membership تا cutover جداگانه حفظ می‌شوند.
- صفحه‌های فعلی operations-web و system-web داشبوردهای نمایشی با اعداد و کاربران ثابت‌اند. API عملیاتی برای سازمان، کارکنان، دستگاه و گزارش وجود ندارد.
- مورد بالا snapshot تحلیل اولیه است؛ اکنون registry مالک Device Integration و اتصال BFF/UI عملیات در source پیاده شده‌اند. hardware provider، اجرای migration و restore واقعی و deployment همچنان gateهای باز هستند (وضعیت جزئی در `DOCS/ImplementationStatus.md` و فاز O3).
- API مشتری `GET /api/v1/customer/cards` وجود دارد و بر household کاربر scope می‌شود؛ در شروع بررسی صفحه‌ی کارت داده‌ی ثابت، اعتبار ساختگی و شناسه‌ی خام نشان می‌داد. در برش اجرایی همین کار، صفحه به API وصل شده و پاسخ کارت شناسه‌ی ماسک‌شده می‌دهد.
- `DOCS/BackendImplementation.md` مدیریت سازمان، membership و policy را عمداً موکول کرده است. قرارداد واقعی سامانه‌ی RFID/کارت و منبع معتبر مانده/مصرف مالی هم هنوز ثبت نشده است.
- مرجع اجرایی این کار `AGENTS.md`، `ImplementationRules.md`، `FolderAndFileStructure.md`، `ArchitectureAndDesignPatterns.md`، فازهای G0/G1/G4، S1/S2/S4، O0/O1/O3/O5/O6 و C3، قراردادها و ADR-0003 است. تحلیل‌های قدیمی‌تر فقط ورودی تصمیم‌اند.

## مدل دامنه و منبع حقیقت

| دامنه                            | مالک داده‌ی هدف       | قاعده‌ی داده                                                                                                                                          |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| سازمان و شعبه                    | Organization & Branch | سازمان مالک شعبه است؛ غیرفعال‌سازی soft و قابل audit است؛ branch ID از client اعتماد نمی‌گیرد.                                                        |
| هویت کارکنان، عضویت، نقش و scope | Identity & Access     | یک User می‌تواند هم مشتری و هم کارمند باشد؛ عضویت سازمانی از رابطه‌ی خانوادگی جداست؛ دعوت/تعلیق/لغو سابقه‌ی قابل بازیابی دارد.                        |
| دستگاه و اتصال فیزیکی            | Device Integration    | دستگاه به شعبه‌ی معتبر متصل است؛ سلامت از heartbeat/رویداد تأییدشده و زمان آخرین مشاهده محاسبه می‌شود؛ ثبت دستی «آنلاین» ممنوع است.                   |
| کارت و تخصیص مشتری               | Wallet                | شناسه‌ی فیزیکی یکتا است؛ هر کارت حداکثر یک تخصیص فعال دارد؛ تخصیص به household و در صورت لزوم member است؛ انتقال با سابقه‌ی append-only انجام می‌شود. |
| گزارش                            | Analytics/Read Model  | projection قابل بازسازی و فقط خواندنی است؛ source of truth و ledger نیست؛ هر درخواست با organization/branch مجاز فیلتر می‌شود.                        |

Gateway فقط هویت نشست، کنترل ورودی و ترکیب APIها را انجام می‌دهد. سرویس‌ها جدول سرویس دیگر را نمی‌خوانند یا تغییر نمی‌دهند. PostgreSQL حقیقت داده‌ی عملیاتی است؛ event با Outbox/Inbox و مصرف idempotent منتشر می‌شود. Redis و Socket.IO جای query مرجع را نمی‌گیرند.

## جریان‌های کاری هدف

1. مدیر سامانه با OTP مدیریتی وارد می‌شود؛ MFA فقط برای فرمان‌های پرریسک step-up می‌شود. bootstrap اولیه با رویه‌ی یک‌باره، خارج از endpoint عمومی و قابل audit انجام می‌گیرد و MFA تازه می‌خواهد.
2. مدیر مجاز سازمان را ایجاد می‌کند و سپس شعبه را با نشانی، شهر، timezone و ساعت کاری می‌سازد یا غیرفعال می‌کند.
3. مدیر، کارمند را با شماره‌ی موبایل دعوت و نقش و محدوده‌ی سازمان/شعبه را تعیین می‌کند. دعوت تا اتصال امن به User وضعیت pending دارد؛ کارمند تعلیق‌شده فوراً از APIهای عملیاتی منع می‌شود.
4. مدیر شعبه دستگاه را ثبت می‌کند و شناسه/نوع/جایگاه آن را می‌بیند. وضعیت «دیده‌شده»، «قدیمی»، «در حال نگه‌داری» و «نامشخص» از timestamp معتبر به‌دست می‌آید؛ نبود قرارداد provider با داده‌ی ساختگی پوشانده نمی‌شود.
5. کارمند مجاز کارت را با اسکن/ورود شناسه در موجودی شعبه ثبت می‌کند. یکتایی، branch، وضعیت موجودی و idempotency پیش از تخصیص کنترل می‌شود.
6. کارمند با جست‌وجوی محدود و audit‌شده‌ی مشتری، household و در صورت نیاز عضو را انتخاب می‌کند. عملیات در یک تراکنش ثبت می‌کند؛ تخصیص تکراری یا انتقال بدون مجوز/دلیل رد می‌شود.
7. customer-web کارت‌های householdهای قابل‌دسترسی کاربر را از API می‌خواند و شعبه، عضو، وضعیت و زمان آخرین sync را نشان می‌دهد. شناسه‌ی فیزیکی فقط به‌صورت masked برمی‌گردد؛ موجودی فقط پس از قرارداد مالی معتبر نمایش داده می‌شود.
8. گزارش سازمانی/شعبه‌ای شاخص شمارش شعب، کارمند فعال، دستگاه سالم/قدیمی/نگه‌داری‌شده، کارت موجود/تخصیص‌یافته و روند تخصیص را با بازه‌ی زمانی، pagination و export مجاز ارائه می‌کند. اطلاعات تماس و داده‌ی کودک در گزارش تجمیعی نیست.

## ماتریس نقش پایه و مدل دسترسی پویا

ماتریس پایه طبق ADR-0005 تأیید شده است. این‌ها role templateهای اولیه‌اند، نه شرط‌های ثابت در کد؛ سازمان می‌تواند role سفارشی بسازد و permissionهای مجاز را تغییر دهد.

| نقش                    | محدوده              | سازمان/شعبه         | کارکنان                                | دستگاه‌ها               | کارت و مشتری                      | گزارش                                       |
| ---------------------- | ------------------- | ------------------- | -------------------------------------- | ----------------------- | --------------------------------- | ------------------------------------------- |
| `system_admin`         | سراسری              | ایجاد/مدیریت        | مدیریت همه‌ی عضویت‌ها                  | مشاهده/مدیریت اتصال     | مشاهده/مدیریت تخصیص               | تجمیعی سراسری                               |
| `organization_manager` | سازمان‌های عضو      | مدیریت شعب سازمان   | مدیریت نقش‌های پایین‌تر در همان سازمان | مدیریت شعب همان سازمان  | مدیریت شعب همان سازمان            | تجمیعی همان سازمان                          |
| `branch_manager`       | شعبه‌ی عضو          | مشاهده              | مدیریت نقش‌های عملیاتی همان شعبه       | مدیریت دستگاه همان شعبه | تخصیص/انتقال با دلیل در همان شعبه | همان شعبه                                   |
| `cashier`              | شعبه‌ی عضو          | مشاهده‌ی حداقلی     | بدون مدیریت                            | مشاهده                  | جست‌وجو و تخصیص طبق مجوز صندوق    | گزارش محدود صندوق                           |
| `operator`             | شعبه‌ی عضو          | مشاهده‌ی حداقلی     | بدون مدیریت                            | ثبت اختلال و مشاهده     | بدون تخصیص                        | سلامت دستگاه                                |
| `crm_manager`          | سازمان/شعبه‌ی عضو   | مشاهده‌ی حداقلی     | بدون مدیریت                            | بدون تغییر              | مشاهده‌ی حداقلی مشتری             | گزارش تجمیعی؛ export نیازمند permission جدا |
| `support`              | scope پشتیبانی مصوب | فقط خواندنی         | فقط خواندنی                            | فقط خواندنی             | فقط خواندنی و audit               | فقط خواندنی                                 |
| `customer`             | household خودش      | بدون دسترسی مدیریتی | —                                      | —                       | فقط مشاهده‌ی کارت‌های مجاز خود    | —                                           |

نقش bootstrapشده‌ی `system_admin` همه‌ی permissionهای catalog جاری را در scope سراسری دارد؛ MFA برای ورود او اجباری نیست و فرمان‌های پرریسک طبق catalog step-up می‌خواهند. bootstrap یک‌باره همچنان به MFA تازه نیاز دارد (ADR-0021/0025).

در همه‌ی نقش‌ها، بررسی role، membership فعال، resource scope و rule دامنه روی سرور انجام می‌شود. عضویت سازمانی به‌تنهایی به معنی دسترسی به شعبه‌ی دیگر نیست. عملیات actor، scope، before/after و outcome را audit می‌کند؛ reason فقط برای commandهای فهرست‌شده اجباری است و برای بعضی عملیات عادی اختیاری می‌ماند. MFA فقط برای commandهای پرریسک catalog لازم است؛ ورود مدیریتی MFA اجباری ندارد.

### مدل محاسبه و تغییر permission

- کاتالوگ permission مرکزی، ریزدانه و نسخه‌دار است؛ نمونه‌ها: `organization.read`, `organization.update`, `branch.create`, `branch.update`, `staff.invite`, `staff.suspend`, `access.role.manage`, `access.permission.delegate`, `device.register`, `device.maintenance.manage`, `device.health.read`, `card.inventory.manage`, `card.assign`, `card.transfer`, `customer.lookup.limited`, `report.read`, `report.export`, `audit.read`.
- کلیدهای permission توسط محصول/versioned contract عرضه می‌شوند؛ مدیر tenant فقط می‌تواند role را با subset مجاز کاتالوگ بسازد/ویرایش کند. نقش‌های پایه نیز قابل تنظیم‌اند ولی آخرین مسیر مدیر مجاز و system/break-glass محافظت می‌شود.
- Role دارای scope مشخص است: global فقط برای عملیات سیستمی، organization برای tenant، branch برای شعبه. هیچ assignmentای از scope والد به فرزند به‌صورت ضمنی دسترسی ایجاد نمی‌کند.
- استثنای فردی روی `membershipId` همان tenant اعمال می‌شود، نه شناسه‌ی User سراسری. override می‌تواند allow یا deny و محدود به resource/زمان باشد؛ دامنه‌ی deny طبق ADR-0025 ارزیابی می‌شود.
- مجوز مؤثر: membership فعال + permissionهای role + allowهای معتبر − denyهای معتبر، سپس محدودسازی به scope و invariant دامنه. actor فقط permissionهایی را واگذار می‌کند که delegation authority آن را دارد؛ تنزل/تعلیق باید در درخواست بعدی نافذ باشد.
- mutation دسترسی before/after، policy version، actor و audit دارد؛ reason و MFA فقط برای commandهایی اجباری‌اند که ADR-0025 فهرست کرده است. تغییرات هم‌زمان با version/ETag محافظت می‌شوند. cache permission باید با versioning و invalidation قطعی و revocation فوری کار کند؛ در خطای policy سرویس، fail-closed.
- در فاز اول inheritance بین roleها وجود ندارد؛ composition صریح permissionها، تست و auditپذیرتر است. قابلیت‌های آینده مانند approval chain، separation-of-duties، زمان‌بندی و policyهای context-aware باید بدون تغییر API مصرف‌کننده، از نسخه‌ی policy گسترش یابند.

## API و قراردادها

مسیرهای عمومی در `contracts/openapi/gateway.yaml` تعریف می‌شوند. قرارداد داخلی Identity & Access در `contracts/openapi/identity-access.yaml` است؛ سرویس داخلی عمومی نیست و Gateway فقط از شبکه‌ی خصوصی و با credential سرویس به آن وصل می‌شود.

قراردادهای public Gateway و internal owners در `contracts/openapi/` نگه‌داری می‌شوند. مدیریت سازمان/شعبه، کارکنان، دستگاه‌ها، موجودی کارت و گزارش‌های فعلی در برش‌های مشخص source پیاده شده‌اند؛ assignment کارت به household/member در جدول همچنان هدف است و قبل از پیاده‌سازی به Customer & Household owner و قراردادهای معتبر وابسته است.

| گروه     | مسیرهای قراردادی/هدف                                                                                                                                                                                                                                                                       | رفتار اصلی                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| system   | `GET/POST /api/v1/system/organizations`, `GET/PATCH /api/v1/system/organizations/{organizationId}`, `GET/POST /api/v1/system/organizations/{organizationId}/branches`, `PATCH /api/v1/system/branches/{branchId}`                                                                          | ایجاد و مدیریت ساختار با scope سراسری یا سازمانی مجاز                                                                                   |
| staff    | `GET/POST /api/v1/operations/staff`, `PATCH /api/v1/operations/staff/{membershipId}`, `POST /api/v1/operations/staff/{membershipId}/suspend`, `POST /api/v1/operations/staff/{membershipId}/reactivate`                                                                                    | دعوت/عضویت، تغییر نقش و lifecycle عضویت؛ عملیات reason-based و audit‌شده                                                                |
| access   | `GET/POST /api/v1/operations/roles`, `GET/PATCH /api/v1/operations/roles/{roleId}`, `GET /api/v1/operations/permissions`, `GET/PUT /api/v1/operations/staff/{membershipId}/permission-overrides`, `DELETE /api/v1/operations/staff/{membershipId}/permission-overrides/{overrideId}`       | مدیریت role سفارشی و override همان membership؛ delegation check، version/ETag، MFA و audit                                              |
| device   | `GET /api/v1/operations/devices`, `GET /api/v1/operations/organizations/{organizationId}/branches`, `POST /api/v1/operations/organizations/{organizationId}/branches/{branchId}/devices`, `PATCH /api/v1/operations/organizations/{organizationId}/branches/{branchId}/devices/{deviceId}` | ثبت هویت، lifecycle نسخه‌محور و سلامت/freshness مشتق از Device Integration با IAM scope                                                 |
| cards    | `GET/POST /api/v1/operations/organizations/{organizationId}/branches/{branchId}/cards`, `PATCH .../{cardId}`, `POST .../{cardId}/assign`, `POST .../{cardId}/transfer`, `POST .../{cardId}/unassign`                                                                                       | موجودی فیزیکی در Gateway/Operations پیاده شده؛ تخصیص idempotent پس از validation از Customer owner؛ تغییر مالکیت بدون حذف تاریخچه ممنوع |
| customer | `GET /api/v1/customer/cards`                                                                                                                                                                                                                                                               | فقط کارت‌های household مجاز؛ شناسه‌ی masked، شعبه/عضو، status و freshness                                                               |
| reports  | `GET /api/v1/operations/reports/summary`, `GET /api/v1/system/reports/organizations`                                                                                                                                                                                                       | فیلتر بازه و scope، pagination، export دارای permission و audit                                                                         |

خطاهای 401/403/404/409/422 و correlation ID در همه‌ی مسیرها استاندارد می‌مانند. عملیات حساس برای retry امن `Idempotency-Key` می‌گیرند. response شامل entity داخلی ORM نیست.

رویدادهای موردنیاز پس از نهایی‌شدن قرارداد شامل `organization.created`, `branch.created`, `staff.membership-changed`, `device.registered`, `device.health-observed`, `wallet.card-registered`, `wallet.card-assigned`, `wallet.card-transferred` است. هر رویداد version، tenant/branch، aggregate، correlation و schema مستقل دارد؛ شماره‌ی کارت و داده‌ی کودک در payload غیرضروری قرار نمی‌گیرد.

## صفحه‌ها و تجربه‌ی کاربری

- `system-web`: فهرست/جزئیات مجموعه و شعبه، ایجاد و غیرفعال‌سازی، کارکنان و نقش‌ها، مرور ممیزی؛ MFA و scope فعال همیشه روشن.
- `operations-web`: انتخاب مجموعه/شعبه مجاز، نمای سلامت، roster کارکنان، فهرست/ثبت دستگاه، مدیریت موجودی فیزیکی کارت و گزارش شعبه؛ UI تخصیص/انتقال تا آماده‌شدن مرجع Customer ارائه نمی‌شود.
- `customer-web`: فهرست کارت واقعی، کارت خالی، loading/error/retry، وضعیت کارت، شعبه، عضو و freshness؛ بدون موجودی ساختگی، شناسه‌ی کامل یا دکمه‌ی غیرفعالِ شارژ.
- همه‌ی مسیرها RTL، mobile-first در تجربه‌ی مشتری، keyboard-accessible، دارای focus واضح و stateهای loading/empty/error/stale/success هستند. گزارش و جدول filter، pagination و empty state دارند.

## ترتیب اجرا و gateها

1. **G0 و ADR:** بسته شد با تأیید مالک محصول؛ قرارداد واقعی RFID/مالی برای sync و مانده جداگانه باز می‌ماند.
2. **G1/G4:** permission catalog و evaluator دامنه آماده است؛ schema/migration خواندنی Identity، API داخلی محافظت‌شده و Gateway BFF برای context/permission/role read پیاده شده‌اند. باقی‌مانده‌ی این گام شامل commandهای write، delegation در زمان واگذاری، MFA/reauth، audit append-only، Outbox/idempotency، bootstrap کنترل‌شده، scope provisioning و تست integration روی PostgreSQL است.
3. **S1/S2:** migration سازگار سازمان/شعبه/کارمند، API مالک، صفحات system و انتقال داده بدون حذف/گم‌شدن تاریخچه.
4. **O0/O6:** ورود کارکنان، scope selector، مدیریت roster، suspension فوری و audit.
5. **O3:** registry دستگاه‌ها و سلامت مبتنی بر heartbeat/آخرین رخداد؛ Adapter فقط پس از قرارداد واقعی.
6. **O1 و C3:** موجودی کارت، تخصیص/انتقال/لغو با تاریخچه و هم‌زمانی امن؛ API مشتری، mask شناسه و صفحه‌ی واقعی کارت.
7. **O5/S4:** read model گزارش، فیلتر scope و زمان، CSV کنترل‌شده، audit export و dashboard بدون قفل‌کردن مسیر تراکنش.
8. **Gate انتشار:** تست unit/integration/contract/authorization/idempotency/E2E/accessibility، migration/rollback، health/telemetry، backup/restore و smoke هر سه app.

هیچ مرحله‌ی بعدی قبل از عبور مرحله‌ی قبلی از gate امنیت، قرارداد، داده و تجربه وارد production نمی‌شود.

## داده، migration و بازیابی

- migrationها نسخه‌دار و forward-only هستند؛ انتقال مالکیت یا schema با backfill، شمارش تطبیقی و پنجره‌ی rollback انجام می‌شود.
- ایجاد و تغییر مهم همراه Outbox در همان تراکنش ثبت می‌شود؛ مصرف‌کننده Inbox یکتا دارد.
- عضویت و تخصیص کارت soft-state هستند؛ تاریخچه‌ی تغییر role، suspension، branch و card assignment append-only است.
- کاتالوگ permission نسخه‌دار و role/overrideها در مالک Identity نگهداری می‌شوند؛ هر تغییر policy نسخه و audit دارد و revoke در درخواست بعدی باید نافذ باشد.
- یکتایی شناسه‌ی دستگاه در scope مالک و شناسه‌ی کارت در کل سامانه با constraint دیتابیس محافظت می‌شود.
- عملیات انتقال کارت با transaction، optimistic version یا row lock و idempotency در برابر درخواست هم‌زمان ایمن می‌شود.
- اطلاعات مشتری در lookup حداقلی است؛ شماره در UI فقط mask می‌شود، جست‌وجو rate limit و audit دارد، و export پیش‌فرض خاموش است.
- rollback اپ با snapshot سرویس انجام می‌شود؛ migration destructive خودکار نیست و restore PostgreSQL پیش از تغییر مالکیت تمرین می‌شود.

## ماتریس اثر Runflare

| تغییر                                    | استقرارهای اثرپذیرفته                                          |
| ---------------------------------------- | -------------------------------------------------------------- |
| Customer card contract/UI                | Customer Web و API Gateway                                     |
| Operations/system pages                  | Operations Web، System Web و API Gateway                       |
| Organization/Identity/Wallet APIs        | سرویس مالک جدید/متأثر، API Gateway، هر سه web app              |
| Device registry یا adapter               | Device Worker، API Gateway، Operations Web، گزارش مصرف‌کننده   |
| OpenAPI/event contract یا shared package | همه‌ی producer/consumer و web appهای مصرف‌کننده                |
| migration                                | release step سرویس مالک؛ پنج Worker طبق ADR-0015 startup دارند |
| تغییر صرفاً مستند                        | بدون redeploy محصول                                            |

در حال حاضر برای سرویس‌های جدید نگاشت deployment repository و Runflare item مستند نشده است؛ پیش از انتشار باید به‌روزرسانی شود. این کار درخواست commit/push/deploy نیست و deployment cloneها منبع توسعه نخواهند بود.

## معیار تکمیل قابلیت

- هیچ سازمان/شعبه/کارمند/دستگاه/کارت بین scopeهای نامجاز قابل خواندن یا تغییر نیست.
- role سفارشی و override کاربر، حتی در چند tenant، بدون نشت scope کار می‌کند؛ deny precedence، delegation ceiling، لغو فوری و محافظت از آخرین مدیر تست شده‌اند.
- ساخت شعبه، دعوت/تعلیق کارمند، ثبت دستگاه، تخصیص/انتقال کارت و retry تکراری رفتار idempotent و قابل audit دارند.
- تغییرات مهم در PostgreSQL و Outbox اتمیک‌اند؛ retry/Dead Letter و health قابل مشاهده است.
- مشتری فقط کارت‌های household مجاز را می‌بیند؛ شناسه‌ی خام کارت و موجودی نامعتبر نمایش داده نمی‌شود.
- گزارش برای هر نقش دقیقاً scope مجاز، بازه‌ی زمانی و شاخص تعریف‌شده را می‌دهد.
- سه وب‌اپ از OpenAPI type/client مشترک مصرف می‌کنند و UI RTL، responsive و keyboard-accessible است.
- build/typecheck و تست‌های متناسب موفق‌اند؛ نتیجه، deployment matrix، migration و rollback مستند است.

## تصمیم‌های محصول بسته‌شده و گیت‌های باقی‌مانده

- ماتریس نقش پایه، نقش سفارشی، مجوزهای ریزدانه و override فردی، دعوت pending، bootstrap یک‌باره و ثبت دستی پایلوت طبق ADR-0005 تأیید شده‌اند.
- پیش از عملیات حساس باید نوع/عمر MFA، re-auth، rotation کلیدهای internal service و حدود نرخ جست‌وجوی مشتری در S0 مشخص و تست شود؛ تا آن زمان mutation حساس fail-closed است.
- مسیرهای فعلی Identity فقط health و read/evaluate را ارائه می‌کنند؛ قراردادهای نوشتن در OpenAPI به‌عنوان `planned` علامت خورده‌اند. journal تراکنشی audit/policy/outbox و event `identity.access-policy-changed.v1` آماده‌ی اتصال از commandهاست، اما تا بسته‌شدن گیت‌های بالا route mutation نداریم. برای تست/استقرار، token داخلی و URL سرویس باید در environment هر دو طرف جداگانه تنظیم شوند؛ هیچ tokenی در مخزن ثبت نمی‌شود.
- هسته‌ی registry و قرارداد normalized health با HMAC، نگه‌داری append-only و freshness پایدار در Device Integration پیاده شده‌اند؛ این قرارداد عمومی provider-specific نیست و اتصال/تأیید سخت‌افزار واقعی، rotation credential مخصوص provider، مانده/مصرف/برگشت مالی، export حساس و زمان‌بندی retention همچنان نیازمند تصمیم/قرارداد مجزای مرتبط‌اند.
- برای استقرار سرویس‌های جدید، repository/Runflare item و pipeline مستقل باید پیش از انتشار ثبت و smoke-test شوند؛ در این کار هیچ deployment خارجی انجام نشده است.
