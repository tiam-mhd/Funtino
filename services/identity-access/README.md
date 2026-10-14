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
- delegation ceiling: actor فقط permissionهایی را واگذار می‌کند که خودش در همان scope دارد و کاتالوگ آن‌ها را delegable اعلام کرده است؛ deny فقط grantهای هم‌سطح/پایین‌تر همان زنجیره‌ی scope را می‌بندد و grant مستقل در scope بالاتر را حذف نمی‌کند؛ deny global روی scopeهای فرزند veto است.
- دعوت staff با انقضای ۷روزه، HMAC نسخه‌دار شماره و شماره‌ی mask‌شده؛ مدیر دعوت‌های scope خود را می‌بیند و می‌تواند پیش از پذیرش لغو کند. دعوت پس از OTP فقط با پذیرش صریح فعال می‌شود. شماره‌ی plaintext وارد IAM، audit یا event نمی‌شود.
- تعلیق، فعال‌سازی مجدد، لغو دائمی عضویت و تغییر role؛ درخواست‌های بعدی پس از commit با policy جاری ارزیابی می‌شوند.
- allow/deny override در سطح membership با scope/resource/انقضا؛ هر تغییر حساس زیر policy lock، با idempotency، audit append-only و outbox نسخه‌دار انجام می‌شود.
- audit خواندنی، صفحه‌بندی‌شده و scopeدار؛ دسترسی موفق مدیریتی به فهرست کارکنان، دعوت‌ها، overrideها و خود audit نیز ثبت می‌شود. تلاش‌های authorization ردشده نیز audit می‌شوند؛ خواندن audit به permission و scope نیاز دارد و MFA step-up نمی‌خواهد.
- idempotency key در هر actor/operation برای ۲۴ ساعت replay می‌شود؛ استفاده‌ی مجدد از همان کلید با body متفاوت `409` می‌دهد. request fingerprint با HMAC ذخیره می‌شود.
- نشست management TTL مطلق تنظیم IAM از ۱ تا ۱۲ ساعت (پیش‌فرض ۱۲) دارد و از ورود بعدی اعمال می‌شود؛ نشست customer سی‌روزه است. ورود مدیریتی با OTP و audience جدا انجام می‌شود؛ MFA هنگام login اجباری نیست و فقط commandهای پرریسک step-up می‌خواهند. IAM در هر درخواست عضویت، role، scope، permission، وضعیت عامل MFA و proof نشست سمت‌سرور Gateway را دوباره بررسی می‌کند.
- تغییر role، membership، invitation و override با policy version، audit before/after و Outbox اتمیک ثبت می‌شود. Outbox ممکن است حداقل‌یک‌بار ارسال شود؛ consumerها باید idempotent باشند.

## Bootstrap مدیر سراسری

Bootstrap endpoint عمومی ندارد و فقط با CLI تعاملی در container Backend انجام می‌شود. مقصد از شماره‌ی canonical E.164 تنظیم‌شده در `SYSTEM_ADMIN_OWNER_PHONE_E164` resolve می‌شود؛ CLI دیگر UUID قابل‌انتخاب نمی‌پذیرد. Gateway شماره را در store مالک هویت جست‌وجو می‌کند و فقط شناسه‌ی opaque را از endpoint loopback با token اختصاصی برمی‌گرداند؛ IAM مستقیم به جدول Gateway وصل نمی‌شود.

1. در Backend Runflare، `SYSTEM_ADMIN_OWNER_PHONE_E164` را برای API Gateway روی شماره‌ی مالک بگذارید؛ حساب آن شماره باید قبلاً با OTP ثبت شده باشد. `SYSTEM_ADMIN_BOOTSTRAP_LOOKUP_TOKEN` را به‌صورت secret تصادفی حداقل ۳۲ نویسه در همان item تنظیم کنید؛ manifest آن را فقط به API Gateway و Identity & Access می‌دهد. مقدار واقعی را در terminal یا repository چاپ/ذخیره نکنید.
2. از terminal تعاملی Runflare، با flag موقت و دلیل ممیزی، prepare را اجرا کنید؛ شماره یا UUID به command داده نمی‌شود:

   `IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true pnpm --filter @funtino/identity-access iam:bootstrap -- prepare "Tiam Mohammadi" "Initial system administrator bootstrap for Funtino"`

3. اگر membership موقت ساخته شد، با همان شماره وارد System Web شوید، TOTP را enroll کنید و recovery codeها را امن نگه دارید. membership موقت ۲۴ ساعت اعتبار دارد. اگر خروجی `owner_admin_exists` بود، حساب از قبل مدیر سراسری است و می‌توان مستقیم finalize را اجرا کرد.
4. با دلیل ممیزی، finalize را اجرا و TOTP یا recovery code را در prompt مخفی وارد کنید:

   `IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true pnpm --filter @funtino/identity-access iam:bootstrap -- finalize "Tiam Mohammadi" "Reconcile the Runflare-configured system owner"`

`system_admin` همه‌ی کلیدهای کاتالوگ جاری را در scope سراسری می‌گیرد، از جمله `system.access.bootstrap` و `system.access.impersonate`; این کلیدها خودشان endpoint ایجاد نمی‌کنند. finalize نقش قبلی همین شماره را کامل می‌کند و membershipهای system admin متعلق به حساب‌های دیگر را در همان transaction با audit/outbox revoke می‌کند. roleهایی با permission ناشناخته یا state ناسازگار fail-closed می‌مانند. جزئیات در [ADR-0021](../../DOCS/decisions/0021-runflare-bound-system-admin-owner.md) آمده است.

`system_admin` و `system_admin_bootstrap` از دعوت، API عادی و UI قابل تخصیص نیستند. `IDENTITY_ACCESS_BOOTSTRAP_ENABLED` را در محیط پایدار Runflare نگه ندارید؛ آن را فقط ابتدای یک invocation تعاملی تنظیم کنید. نشست مدیریتی از ۱ تا ۱۲ ساعت (پیش‌فرض ۱۲) است؛ MFA فقط برای فرمان‌های پرریسک step-up می‌شود و enrollment در login اجباری نیست. تنظیم مدت نشست در System Web از ورود بعدی اعمال می‌شود.

برای writeهای عادی role/staff/permission در production، مقدار `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` را در Runflare روی IAM تنظیم کنید. مقدار پیش‌فرض کد `false` می‌ماند؛ در صورت `false` پاسخ 503 با کد `IAM_MANAGEMENT_WRITES_DISABLED` به معنی بسته‌بودن همین گیت است. bootstrap one-off از این گیت جداست. بستن گیت با `false` rollback عملیاتی است.

### تنظیم مدت نشست مدیریتی

`policy_state.management_session_ttl_hours` با migration نسخه‌دار پیش‌فرض ۱۲ ساعت می‌گیرد. مدیر دارای `system.session_policy.manage` می‌تواند در System Web مدت ۱ تا ۱۲ ساعت را انتخاب کند؛ تغییر از ورود بعدی کارکنان اعمال می‌شود و نشست‌های فعال و نشست مشتریان تغییر نمی‌کنند. دسترسی خواندن و تغییر تنظیم ثبت audit می‌شود؛ تغییر موفق با policy version و identity access Outbox commit می‌شود.

اگر `prepare` وضعیت `owner_admin_exists` را برگرداند، شماره‌ی تنظیم‌شده از قبل مدیر است؛ همان دستور `finalize` بالا را با دلیل ممیزی و TOTP/recovery اجرا کنید. شناسه‌ی کاربر به CLI داده نمی‌شود و مدیر دیگری را نمی‌توان با آرگومان command انتخاب کرد. مقدار bootstrap فقط برای همان invocation فعال باشد و هیچ خروجی command نباید شامل code یا secret باشد.

پس از finalize، برای بازکردن mutationهای عادی IAM باید گیت production را در محیط Runflare به‌صورت دستی و در پنجره‌ی rollout مجاز فعال کرد. این دو عمل جدا هستند: finalize فقط role را با MFA ممیزی‌شده ارتقا می‌دهد و گیت همچنان default-off می‌ماند.

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
