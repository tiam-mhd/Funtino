# Identity & Access

مالک کاتالوگ permission، role، عضویت کارکنان، دعوت، override فردی، MFA و audit دسترسی است. تمام مجوزها در این سرویس و بر اساس scope مؤثر ارزیابی می‌شوند؛ Gateway تنها BFF عمومی است.

## اجرای محلی

1. متغیرهای `IDENTITY_ACCESS_DATABASE_URL`، `IDENTITY_ACCESS_MIGRATION_DATABASE_URL`، `IDENTITY_ACCESS_SERVICE_TOKEN`، `ORGANIZATION_BRANCH_URL`، `ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN` و keyringهای MFA و lookup را از environment/secret امن تنظیم کنید. هر token داخلی حداقل ۳۲ نویسه و برای هر caller یکتا است. مقدار واقعی secret را در source، تست، log، مستند عمومی یا terminal recording قرار ندهید.
2. `IDENTITY_ACCESS_MFA_ENCRYPTION_KEYS` یک JSON keyring نسخه‌دار از کلیدهای base64 سی‌ودوبایتی AES است؛ `IDENTITY_ACCESS_MFA_ACTIVE_KEY_VERSION` نسخه‌ی فعال را معرفی می‌کند.
3. `IDENTITY_ACCESS_LOOKUP_HMAC_KEYS` یک JSON keyring نسخه‌دار از کلیدهای base64 سی‌ودوبایتی HMAC است؛ `IDENTITY_ACCESS_LOOKUP_ACTIVE_KEY_VERSION` نسخه‌ی فعال را معرفی می‌کند. کلیدهای قبلی تا پایان پنجره‌ی چرخش باید برای lookup دعوت‌های موجود حفظ شوند. readiness با keyring نامعتبر یا غایب fail می‌شود.
4. Docker در هر startup ابتدا URL runtime و DDL را بررسی می‌کند، schema `identity_access` را با `CREATE SCHEMA IF NOT EXISTS` آماده می‌سازد و migrationهای pending از جمله `0004_iam_management` را با `prisma migrate deploy` اعمال می‌کند؛ فقط پس از موفقیت IAM اجرا می‌شود. هر دو URL باید در Secret همین Worker باشند و به همان database/schema اشاره کنند. هیچ `db push`، reset یا resolve خودکاری وجود ندارد؛ برای failure، log کامل Prisma را بدون ارسال secret بفرستید.
5. سرویس را با `pnpm dev:identity` اجرا کنید. Gateway باید از `IDENTITY_ACCESS_URL` و همان service token امن استفاده کند. مرورگر مستقیماً API داخلی را فراخوانی نمی‌کند.

## قابلیت‌های فعال

- role سفارشی در scope سراسری/مجموعه/شعبه، نقش‌های template و optimistic concurrency با `If-Match`؛ role system-managed قابل ویرایش نیست.
- delegation ceiling: actor فقط permissionهایی را واگذار می‌کند که خودش در همان scope دارد و کاتالوگ آن‌ها را delegable اعلام کرده است؛ deny بر allow و role grant مقدم است.
- دعوت staff با انقضای ۷روزه، HMAC نسخه‌دار شماره و شماره‌ی mask‌شده؛ مدیر دعوت‌های scope خود را می‌بیند و می‌تواند پیش از پذیرش لغو کند. دعوت پس از OTP فقط با پذیرش صریح فعال می‌شود. شماره‌ی plaintext وارد IAM، audit یا event نمی‌شود.
- تعلیق، فعال‌سازی مجدد، لغو دائمی عضویت و تغییر role؛ درخواست‌های بعدی پس از commit با policy جاری ارزیابی می‌شوند.
- allow/deny override در سطح membership با scope/resource/انقضا؛ هر تغییر حساس زیر policy lock، با idempotency، audit append-only و outbox نسخه‌دار انجام می‌شود.
- audit خواندنی، صفحه‌بندی‌شده و scopeدار؛ دسترسی موفق مدیریتی به فهرست کارکنان، دعوت‌ها، overrideها و خود audit نیز ثبت می‌شود. تلاش‌های authorization ردشده نیز audit می‌شوند؛ خواندن audit به step-up تازه‌ی MFA نیاز دارد.
- idempotency key در هر actor/operation برای ۲۴ ساعت replay می‌شود؛ استفاده‌ی مجدد از همان کلید با body متفاوت `409` می‌دهد. request fingerprint با HMAC ذخیره می‌شود.
- نشست ورود Gateway همان TTL فعلی ۳۰ روز را دارد. عملیات حساس و خواندن audit با step-up حداکثر ۳۰۰ثانیه‌ای مجاز است و IAM در هر درخواست حساس فعال‌بودن MFA و نسخه‌ی فعلی عامل را بازبینی می‌کند. شواهد MFA فقط از session ذخیره‌شده‌ی Gateway می‌آید، نه body مرورگر.
- تغییر role، membership، invitation و override با policy version، audit before/after و Outbox اتمیک ثبت می‌شود. Outbox ممکن است حداقل‌یک‌بار ارسال شود؛ consumerها باید idempotent باشند.

## Bootstrap مدیر سراسری

Bootstrap endpoint عمومی ندارد و فقط با CLI آفلاین انجام می‌شود:

1. ابتدا حساب کاربر با OTP ساخته/تأیید شود و UUID کاربر از owner هویت دریافت شود؛ IAM برای اعتبارسنجی آن به DB Gateway وصل نمی‌شود.
2. اپراتور مجاز در terminal تعاملی، با flag موقت `IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true` و ticket/شناسه و دلیل ممیزی، فرمان prepare را برای همان invocation اجرا کند: `pnpm --filter @funtino/identity-access run iam:bootstrap prepare <user-uuid> <operator-label> <audit-reason>`. بین نام script و `prepare` از `--` استفاده نکنید؛ pnpm آن را به‌عنوان آرگومان CLI ارسال می‌کند.
3. role موقت فقط ۲۴ ساعت اعتبار دارد. کاربر وارد System Web شود، TOTP را enroll و recovery codeها را خارج از سامانه امن کند.
4. اپراتور flag one-shot را فقط برای invocation نهایی تنظیم کند؛ finalize proof TOTP/recovery را بدون echo می‌گیرد، یک‌بارمصرف می‌کند و membership را به `system_admin` ارتقا می‌دهد: `pnpm --filter @funtino/identity-access run iam:bootstrap finalize <user-uuid> <operator-label> <audit-reason>`. دستور بدون `--` است تا `finalize` اولین آرگومان CLI باشد.

`system_admin` همه‌ی permissionهای قابل‌واگذاری کاتالوگ به‌علاوه‌ی `organization.create` را در scope سراسری می‌گیرد؛ مجوز ساخت مجموعه عمداً غیرقابل‌واگذاری باقی می‌ماند. `system.access.bootstrap` و `system.access.impersonate` به نقش دائمی داده نمی‌شوند. اگر نقش قدیمی دقیقاً مجموعه‌ی permissionهای قابل‌واگذاری قبلی را داشته باشد، finalize با MFA تازه فقط `organization.create` را اضافه و تغییر را با audit/outbox ثبت می‌کند؛ وضعیت‌های ناسازگار fail-closed هستند. جزئیات در [ADR-0019](../../DOCS/decisions/0019-system-admin-organization-provisioning.md) آمده است.

`system_admin` و `system_admin_bootstrap` از دعوت، API عادی و UI قابل تخصیص نیستند. Bootstrap و تغییر role آن audit system-actor، policy version و outbox تولید می‌کند؛ membership موقت منقضی‌شده از authorization و عملیات MFA کنار گذاشته می‌شود و پیش از prepare مجدد به‌طور ممیزی‌شده revoke می‌شود. `IDENTITY_ACCESS_BOOTSTRAP_ENABLED` را در سرویس دائمی تنظیم نکنید؛ آن را فقط به فرایند CLI تعاملیِ one-shot بدهید و پس از هر اجرا حذف کنید. Repository مستقل IAM provision شده است؛ migration schema در هر startup طبق ADR-0015 خودکار است، اما تأیید backup/restore، keyring و runbook عملیاتی همچنان پیش‌نیاز پایلوت و بازکردن writeها هستند.

## بازکردن writeهای مدیریتی در production

`IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED` در production باید غایب یا `false` بماند تا release window مجاز شود. مقدار دقیق `true` فقط با تایید rollout، smoke/E2E چند scope، MFA فعال مدیر bootstrap و آمادگی Owner برای اعتبارسنجی زنده، تمام mutationهای IAM از جمله پذیرش دعوت و مدیریت role/staff/override را باز می‌کند. readiness دو gate مدیریتی و tenant را جدا گزارش می‌کند؛ دسترس‌پذیری Owner فقط هنگام mutation مشخص می‌شود. lifecycle MFA برای enrollment و بازیابی از این kill switch جدا است تا bootstrap و بازیابی دسترسی ممکن بماند؛ این مسیر مجوز مدیریتی ایجاد نمی‌کند. برای rollback سریع، flag را به `false` برگردانید.

## مرز اختیار و اعتبارسنجی scope

IAM تنها مالک permission، membership، role، MFA و تصمیم مجوز actor است. سرویس Organization & Branch فقط وجود، فعال‌بودن و نسبت branch با organization را از منبع خودش تأیید می‌کند؛ آن سرویس هیچ membership یا permissionی را کپی/محاسبه نمی‌کند. IAM از `ORGANIZATION_BRANCH_URL` و token یکتای `ORGANIZATION_BRANCH_IDENTITY_ACCESS_TOKEN` برای `POST /internal/v1/scopes/validate` استفاده می‌کند؛ owner این token را فقط برای همین route می‌پذیرد. URL production باید HTTPS باشد و client redirect را دنبال نمی‌کند تا credential به مقصد دیگری فرستاده نشود.

در هر mutation tenant در production، IAM ابتدا permission، delegation و step-up خود را بررسی می‌کند و سپس owner را به‌صورت زنده صدا می‌زند. scope نامعتبر به رد عمومی و audit‌شده می‌رسد؛ نبود/قطع validator، پاسخ malformed، شناسه یا version ناسازگار به `503` و rollback کامل mutation منجر می‌شود. timeout دو ثانیه است. هیچ fallback به scope opaque در production وجود ندارد. readiness پیکربندی validator را گزارش می‌کند، اما دسترس‌پذیری واقعی فقط هنگام درخواست اثبات می‌شود.

در nonproduction، مطابق ADR-0008، UUIDهای opaque همچنان برای توسعه و آزمون پذیرفته می‌شوند و وجود واقعی scope را ثابت نمی‌کنند. هیچ migration لازم نیست، چون schema عوض نشده است. این تغییر source به‌تنهایی deployment یا مجوز پایلوت نیست؛ پیش از production باید tokenهای مجزا در secret store، شبکه‌ی داخلی، تست staging و CI تأیید شوند.

هیچ migration production، bootstrap تولیدی یا rollout Runflare در این پیاده‌سازی انجام/تأیید نشده است. Repository مستقل `funtino-identity-access-worker` ساخته شده و snapshot آن جداگانه منتشر می‌شود؛ اتصال repository به item و Auto Pull از این محیط قابل راستی‌آزمایی نیست. schema و UI source به‌تنهایی مجوز بازشدن write gate یا پایلوت نیستند.

## قرارداد و تست

- داخلی: `contracts/openapi/identity-access.yaml`
- عمومی Gateway: `contracts/openapi/gateway.yaml`
- event: `contracts/events/identity/access-policy-changed.payload.v1.schema.json`
- تصمیم‌ها: ADR-0005 تا ADR-0011.
- تست‌ها: `pnpm --filter @funtino/identity-access test`، typecheck Gateway و identity-access، typecheck/build system-web و validation قراردادها.
