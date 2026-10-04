# قوانین لازم‌الاجرای پیاده‌سازی و توسعه

## ۱. دامنه‌ی الزام

این سند برای هر سه بستر، سرویس‌های backend، قراردادها، تست، زیرساخت و مستندات لازم‌الاجرا است. واژه‌ی «باید» یعنی تغییر بدون تصمیم ثبت‌شده مجاز نیست.

## ۲. قبل از شروع هر کار

هر تغییر باید پیش از کدنویسی این خروجی‌ها را داشته باشد:

- نام بستر یا سرویس درگیر؛
- نقش کاربر و scope سازمان/شعبه/خانواده؛
- مسئله و سناریوی موفق؛
- منبع حقیقت داده؛
- وضعیت‌ها و transitionهای مجاز؛
- API یا event contract مورد نیاز؛
- ریسک امنیتی، مالی، حریم خصوصی و rollback؛
- معیار پذیرش و تست‌های لازم.

اگر کار فقط مستندسازی است، تغییر کد ممنوع است. اگر نیازمندی با تحلیل‌های موجود ناسازگار است، تضاد و تصمیم جدید در DOCS/decisions ثبت شود.

### ۲.۱ گیت انطباق مستندات و ساختار

پیش از ایجاد اولین فایل کد هر قابلیت، این کنترل‌ها الزامی هستند:

- `AGENTS.md`، این سند، سند ساختار فولدر، معماری، راهبرد Runflare و فاز مربوطه خوانده و تطبیق داده شوند؛
- مسیر نهایی هر فایل و مرز مالکیت آن پیش از ایجاد فایل مشخص باشد؛
- ساختار واقعی repository با `DOCS/FolderAndFileStructure.md` مقایسه شود؛
- برای web appها، مسیر کد از ابتدا زیر `apps/<app-name>/src/` باشد؛ ایجاد `app/`، `components/` یا `lib/` در ریشه‌ی app به‌عنوان مسیر موقت ممنوع است؛
- package، service، contract و deployment repository در محل مصوب خود ایجاد شوند و برای رفع ابهام به مسیر دیگری منتقل نشوند؛
- اثر تغییر بر workspace، shared package، قرارداد و deployment Runflare قبل از کدنویسی مشخص باشد.

اگر هر مغایرتی بین اسناد و repository وجود داشت، پیاده‌سازی باید متوقف شود تا یکی از این دو کار انجام شود: اصلاح ساختار/اسناد پیش از کدنویسی، یا ثبت ADR و اصلاح صریح سند ساختار. انتقال دیرهنگام فایل‌ها برای هم‌ترازکردن implementation با قوانین، نشانه‌ی عبور ناقص از این gate است و نباید تکرار شود.

## ۳. قواعد معماری

- سه web app مستقل: customer-web، operations-web و system-web.
- API Gateway تنها مرز عمومی برای API است.
- سرویس دامنه مالک داده و rule خودش است.
- database مشترک فقط با schema/role/migration مالکانه مجاز است؛ shared write ممنوع است.
- ارتباط رویدادمحور پیش‌فرض است؛ API هم‌زمان فقط وقتی latency و consistency آن ضروری است.
- PostgreSQL منبع حقیقت داده‌ی عملیاتی و مالی است.
- Redis فقط cache، rate limit، lock کوتاه‌مدت یا fan-out است.
- RabbitMQ پیام‌رسان اصلی Runflare است؛ Outbox برای publish و Inbox برای مصرف ضروری است.
- WebSocket فقط projection زنده است؛ رابط پس از reconnect باید refetch کند.
- providerهای کارت، پرداخت، OTP و فایل با adapter و Anti-Corruption Layer جدا شوند.
- افزودن microservice، queue، database یا provider جدید باید use case و مالک مشخص داشته باشد.

### ۳.۱ مجوزهای قابل‌پیکربندی

- نقش فقط ظرفی برای permissionهای کاتالوگ نسخه‌دار است؛ شرط‌های نقش ثابت و پراکنده در controller، UI یا query ممنوع است.
- نقش‌های پایه seed می‌شوند و نقش سفارشی در scope مجاز سازمان/شعبه قابل‌ساخت و ویرایش است. permissionهای کاتالوگ از کد/قرارداد نسخه‌دار می‌آیند و tenant نمی‌تواند کلید دلخواه را فعال کند.
- override فردی فقط روی membership همان scope ذخیره می‌شود، نه User سراسری؛ شامل allow/deny، محدوده‌ی resource، دلیل، actor و زمان/انقضا است. deny بر allow مقدم است.
- permission مؤثر همواره به عضویت فعال، scope عضویت، scope منبع و invariant دامنه محدود می‌شود. مدیر نمی‌تواند permission یا scopeی فراتر از اختیار واگذاری خود اعطا کند.
- تغییر role، permission، assignment، override و scope باید MFA/reauth متناسب، audit قبل/بعد و جلوگیری از حذف آخرین مدیر مجاز داشته باشد.
- authorization هر درخواست server-side و fail-closed است. cache فقط با versioning/invalidation قابل اتکا و revocation فوری مجاز است؛ browser، localStorage یا claim بلندعمر منبع حقیقت نیست.
- MFA مدیران طبق [ADR-0006](decisions/0006-administrative-mfa-totp.md) با TOTP و ۱۰ کد بازیابی یک‌بارمصرف است؛ OTP ورود MFA محسوب نمی‌شود. مدیر سامانه در هر ورود MFA می‌کند. نشست مدیریتی مطلق و ۱ تا ۱۲ ساعت، با پیش‌فرض ۱۲ ساعت، از تنظیم IAM خوانده می‌شود؛ پنل نشست فعال را به علت بی‌فعالیتی قطع نمی‌کند. MFA مدیر سراسری تا پایان همان نشست معتبر است و نسخه‌ی عامل، membership، scope، مجوز و policy در IAM زنده بررسی می‌شود. step-up سایر کارکنان حداکثر ۳۰۰ ثانیه باقی می‌ماند. secret با AES-256-GCM و keyring نسخه‌دار runtime محافظت می‌شود. [ADR-0020](decisions/0020-admin-session-duration-and-system-admin-capabilities.md) مرجع سیاست جدید است.
- تغییر عامل یا مصرف recovery code بدون ثبت audit append-only و بدون redaction کامل secret/code مجاز نیست. شکست keyring، نشست یا سرویس IAM باید برای عملیات step-up به رد دسترسی منجر شود.
- endpointهای مدیریت permission خودشان با مجوزهای مدیریتی مستقل محافظت می‌شوند؛ مخفی‌کردن منو یا دکمه جایگزین authorization نیست.

## ۴. قوانین مشترک رابط کاربری

- RTL واقعی از layout تا فرم، table، icon و keyboard order رعایت شود.
- Design token به‌جای رنگ، فاصله، radius و font پراکنده استفاده شود.
- component عمومی نباید منطق کسب‌وکار، مجوز یا query خاص داشته باشد.
- هر صفحه حالت loading، empty، error، stale، success و در صورت نیاز offline دارد.
- هر action اصلی یک CTA روشن دارد؛ actionهای خطرناک جدا و تأییدشده‌اند.
- هر فرم validation سمت رابط برای تجربه و سمت سرور برای امنیت دارد.
- هیچ داده‌ی مالی یا scope از localStorage به‌عنوان حقیقت پذیرفته نمی‌شود.
- componentهای تعاملی keyboard، focus، screen reader label و target لمسی مناسب دارند.
- رنگ تنها روش نمایش status نیست؛ text، icon یا pattern همراه آن استفاده شود.
- toast برای اطلاعاتی که باید در تاریخچه بمانند استفاده نشود.
- modal برای تصمیم مهم است؛ فرم طولانی و navigation اصلی داخل modal قرار نگیرد.
- متن خطا باید بگوید چه اتفاقی افتاده و کاربر چه اقدامی می‌تواند انجام دهد.
- client component فقط برای تعامل لازم استفاده شود و مرز server/client بی‌دلیل بزرگ نشود.

## ۵. قوانین customer-web

- اولویت با موبایل، شبکه‌ی ضعیف و استفاده‌ی یک‌دستی است.
- نوار اصلی فقط پنج مقصد مصوب دارد: خانه، کارت‌ها، مأموریت‌ها، خانواده، حساب.
- تجربه‌ی صفحه‌ی خانه باید از وضعیت شعبه و اقدام بعدی شروع شود، نه از تزئین.
- اعتبار پرداختی، هدیه، امتیاز و کوپن جدا و با label واضح نمایش داده شوند.
- زمان آخرین همگام‌سازی همیشه کنار داده‌ی کارت یا موجودی نمایش داده شود.
- دکمه‌ی شارژ فقط وقتی نمایش/فعال شود که مسیر مالی و سامانه‌ی کارت آماده و تأییدشده باشد.
- مشاهده‌ی کودک از تغییر وضعیت یا عملیات مالی والد جدا باشد.
- مأموریت باید شرط، پاداش، انقضا، progress و وضعیت خود را واضح نشان دهد.
- leaderboard پیش‌فرض عمومی نیست؛ رضایت، نام مستعار یا نمایش ناشناس لازم است.
- PWA برای محتوای کم‌خطر ارتقایی است؛ offline نباید به معنی ثبت قطعی پول باشد.
- اطلاعات تازه از API می‌آید و Socket.IO فقط update را می‌رساند.

## ۶. قوانین operations-web

- scope سازمان و شعبه‌ی فعال در shell، breadcrumb یا context selector همیشه قابل مشاهده است.
- هر query و mutation scope را به سرور ارسال و سرور دوباره validate می‌کند.
- هیچ عملیات مالی با یک کلیک بی‌دلیل نهایی نمی‌شود؛ preview، reason و confirmation لازم است.
- اصلاح و برگشت به جای ویرایش سابقه، رکورد جدید ایجاد می‌کند.
- interface صندوق برای سرعت، keyboard، scanner/QR و خطای شبکه طراحی می‌شود.
- جدول‌های عملیاتی دارای filter، pagination، sort، export کنترل‌شده و empty state هستند.
- status دستگاه با زمان آخرین update نشان داده می‌شود؛ status قدیمی با status فعلی اشتباه نشود.
- تغییر قیمت، کمپین و ساعت کاری audit و در صورت نیاز approval می‌خواهد.
- مدیر شعبه فقط داده‌ی شعبه‌ی مجاز و مدیر مجموعه فقط scope مصوب شبکه را می‌بیند.
- dashboard مدیریتی از داده‌ی read model استفاده کند و گزارش سنگین مسیر تراکنش را قفل نکند.

## ۷. قوانین system-web

- system-web ابزار پشتیبانی و کنترل است، نه محل دسترسی آزاد به دیتابیس.
- همه‌ی عملیات بر اساس role، organization، branch و سطح حساسیت محدود می‌شوند.
- تغییر role، membership، provider، feature flag، اتصال و قفل حساب نیازمند re-auth یا تأیید مجدد است.
- هر عملیات حساس actor، دلیل، scope، قبل/بعد و نتیجه‌ی audit دارد.
- secret، token و password provider هرگز در UI نمایش داده نمی‌شود.
- impersonation فقط با permission ویژه، دلیل، زمان انقضا و banner واضح مجاز است.
- حذف داده و اتصال تا حد ممکن soft delete، two-step confirmation و امکان recovery دارد.
- health و event برای مشاهده باز هستند؛ restart، replay یا retry دستی permission جدا می‌خواهد.
- پنل سیستم از component مشتری reuse می‌کند، اما tone و density آن باید مناسب مدیریت حساس باشد.

## ۸. قوانین backend

- Controller فقط parse، validate، authorize و اجرای use case را انجام می‌دهد.
- business rule در domain/application است، نه در React، Controller، SQL پراکنده یا consumer.
- Domain به framework، ORM، transport و provider وابسته نیست.
- DTO مرز API است و entity داخلی مستقیماً به بیرون برگردانده نمی‌شود.
- خطاهای domain، validation، authorization، infrastructure و external provider از هم تفکیک می‌شوند.
- هر سرویس health، readiness، graceful shutdown و correlation id دارد.
- job و consumer باید timeout، retry محدود، backoff و مسیر Dead Letter داشته باشند.
- webhook پیش از پردازش signature، timestamp، idempotency و source را بررسی می‌کند.
- provider کند یا قطع‌شده نباید request اصلی را بدون timeout و status مشخص معطل کند.
- log حاوی OTP، token، password، اطلاعات کامل کودک یا شماره کامل کارت نیست.
- lookup اطلاعات خانوادگی باید به شماره‌ی دقیق، مجوز مستقل و scope شعبه محدود باشد؛ شماره‌ی خام در URL، audit، log و telemetry قرار نمی‌گیرد و rate limit باید بین replicaهای production مشترک و اتمیک باشد.

## ۹. قوانین داده و تراکنش

- migration forward-only و review‌شده است؛ تغییر دستی production بدون ثبت ممنوع است.
- هر جدول عملیاتی سازمان و در صورت نیاز شعبه را مشخص می‌کند.
- ledger مالی append-only است؛ delete و update روی رکورد مالی ممنوع است.
- مبلغ با نوع عدد دقیق و واحد مشخص ذخیره می‌شود؛ float برای پول ممنوع است.
- timezone ذخیره‌سازی استاندارد و نمایش محلی از هم جدا است.
- idempotency key برای پرداخت، webhook، اتصال کارت و رویداد دستگاه اجباری است.
- transaction boundary عملیات مالی صریح است و lock/constraint لازم در دیتابیس تعریف می‌شود.
- cache دارای TTL، کلید scope‌دار، invalidation و fallback است.
- داده‌ی مشتق‌شده قابل بازسازی از source و event باشد؛ گزارش read model حقیقت مالی نیست.
- داده‌ی کودک و داده‌ی حساس حداقلی، با retention و دسترسی مشخص نگه‌داری شود.

## ۱۰. قوانین رویداد

- event نام گذشته و domain-specific دارد؛ نام مبهم مانند DataUpdated ممنوع است.
- envelope شامل event id، type، version، occurred at، source، aggregate، tenant و correlation است.
- schema پیش از انتشار version و compatibility policy دارد.
- publisher فقط از Outbox منتشر می‌کند و consumer فقط با Inbox/idempotency تغییر می‌دهد.
- acknowledgement پس از تکمیل transaction انجام می‌شود.
- retry نامحدود ممنوع؛ پیام خراب به Dead Letter و alert منتقل می‌شود.
- consumer نباید با دیدن پیام تکراری side effect دوباره انجام دهد.
- event payload حداقلی و بدون secret یا اطلاعات غیرضروری شخصی است.
- حذف یا تغییر معنی event قبلی ممنوع؛ event جدید و migration استفاده شود.
- event برای realtime منبع query نیست؛ read model و API مسیر بازیابی هستند.

## ۱۱. احراز هویت، مجوز و حریم خصوصی

- OTP دارای انقضا، محدودیت تلاش، rate limit و audit حداقلی است.
- session cookie امن، HttpOnly و SameSite مناسب دارد.
- MFA برای مدیریت سامانه و عملیات حساس فعال است.
- authorization دو مرحله دارد: نقش/scope و rule دامنه.
- نقش‌ها و overrideهای membership با مدل policy نسخه‌دار و audit‌شده ارزیابی می‌شوند؛ نقش به‌تنهایی مجوز resource خارج از scope نیست.
- انتساب permission تابع اصل delegation-of-authority است: actor فقط اختیار واگذاری permissionهای قابل‌واگذاری خودش را دارد؛ مسیر break-glass و system admin از tenant policy جدا است.
- نقش سراسری `system_admin` در bootstrap، تمام permissionهای `delegable` کاتالوگ به‌علاوه‌ی `organization.create` و `system.session_policy.manage` را می‌گیرد. دسترسی جدید به تنظیم نشست غیرقابل‌واگذاری است؛ `system.access.bootstrap` و `system.access.impersonate` به نقش دائمی منتقل نمی‌شوند. roleهای قبلی فقط با finalize یک‌باره و MFA تازه، از مجموعه‌ی دقیق شناخته‌شده به کاتالوگ جدید ارتقا می‌یابند. جزئیات در [ADR-0019](decisions/0019-system-admin-organization-provisioning.md) و [ADR-0020](decisions/0020-admin-session-duration-and-system-admin-capabilities.md) است.
- revoke/تعلیق membership و تغییر permission باید بدون اتکا به refresh دستی مرورگر فوراً در درخواست بعدی اثر کند.
- هیچ شناسه یا branch id دریافت‌شده از client قابل اعتماد نیست.
- دسترسی به کودک، خانواده و کارت بر اساس رابطه و رضایت بررسی می‌شود.
- داده‌ی حساس در log، analytics، URL و error response قرار نمی‌گیرد.
- secretها فقط از environment/secret manager خوانده می‌شوند.
- CORS، CSRF، security headers و validation در مرز عمومی تنظیم می‌شوند.
- audit با log فنی جایگزین نمی‌شود و retention آن مشخص است.

## ۱۲. تست اجباری

هر feature متناسب با ریسک خود این تست‌ها را دارد:

- unit برای rule و state transition؛
- integration برای repository، transaction و adapter؛
- contract برای OpenAPI و event schema؛
- authorization برای role، organization، branch و household؛
- idempotency برای webhook و event تکراری؛
- E2E برای مسیر کامل هر بستر؛
- accessibility برای component و صفحه‌ی اصلی؛
- failure test برای timeout، retry، قطع queue و stale data.

گیت source در .github/workflows/quality-gates.yml باید پیش از merge، contract validation، dependency audit، lint، typecheck، unit/integration test، production build، E2E عدم‌دسترسی بدون session، migration تکراری و restore smoke را اجرا کند. گیت browser دسترس‌پذیری روی هر سه بستر نیز لازم است. سبزشدن CI معادل تأیید release نیست؛ E2E احراز‌شده‌ی scope و تمرین staging/production طبق [ReleaseQualityGatesAndPilot.md](ReleaseQualityGatesAndPilot.md) جداگانه لازم است.

حداقل جریان‌های مشترک:

- OTP و session؛
- ساخت خانواده و رضایت؛
- اتصال کارت؛
- مشاهده‌ی موجودی با زمان sync؛
- پرداخت، Wallet، برگشت و webhook تکراری؛
- مأموریت، claim دوباره و انقضا؛
- تفاوت دسترسی دو شعبه؛
- reconnect و عدم نشت رویداد در Socket.IO؛
- بازیابی PostgreSQL.

## ۱۳. پایش و عملیات

- log ساخت‌یافته با level، service، environment، request id و correlation id.
- metric برای latency، error rate، queue depth، retry، sync freshness و payment state.
- trace برای مسیر API تا event و provider بیرونی در صورت امکان.
- alert برای Dead Letter، failure sync، خطای پرداخت، افت OTP و stale شدن موجودی.
- هیچ endpoint health نباید secret یا داده‌ی مشتری برگرداند.
- داشبورد عملیاتی برای سرویس، queue، database و adapterهای بیرونی تعریف شود.
- Runflare logs/events برای تشخیص استقرار و زیرساخت استفاده شود؛ جایگزین telemetry دامنه نیست.
- telemetry HTTP باید JSON ساخت‌یافته، کمینه و redacted باشد؛ body، query، credential، cookie و داده‌ی مشتری log نشود.
- endpoint metrics فقط روی شبکه‌ی داخلی و با token تصادفی مجزای هر سرویس/محیط قابل scrape باشد؛ metrics token در production اجباری است.
- backup فقط وقتی قابل اتکا است که restore مجزا و اندازه‌گیری‌شده داشته باشد؛ smoke CI جایگزین تمرین staging، PITR یا هدف RPO/RTO نیست.

## ۱۴. استقرار و Runflare

- مرز process و service مستقل است، اما انتشار application در دو runtime bundle `frontend` و `backend` طبق ADR-0016 انجام می‌شود؛ دیتابیس، RabbitMQ و Redis همچنان itemهای داده‌ی جدا هستند.
- Docker Compose فقط برای توسعه و آزمون محلی است.
- deployment repositoryهای متصل به Runflare با application نوع Docker مستقر می‌شوند؛ Dockerfile root مسئول نصب Node.js 22، pnpm 10.12.4، install قفل‌شده، build، start، port و health check است.
- برای این snapshotها command نصب یا build جداگانه در Native NodeJS/NextJS تعریف نمی‌شود؛ اگر آیتم هنوز Native است باید به Docker تبدیل یا به‌صورت Docker item جدید ساخته شود.
- build، start، migration و health check هر Deployment مستند است.
- secret در repository قرار نمی‌گیرد و environment تولید از development جدا است.
- دامنه‌ی عمومی فقط برای web، API Gateway و Realtime Gateway است.
- remote access دیتابیس فقط موقت و کنترل‌شده فعال می‌شود.
- Backup Runflare تنها backup نیست؛ backup مستقل و restore test لازم است.
- object storage برای فایل استفاده می‌شود، نه filesystem محلی container.
- اجرای migration در startup فقط برای پنج Worker و طبق ADR-0015 مجاز است؛ runner از `prisma migrate deploy` و advisory lock استفاده می‌کند و در شکست fail-closed می‌شود. rollout اولیه با یک replica انجام شود؛ برای سایر app/serviceها همچنان migration job جداگانه لازم است.
- deploy باید قابل rollback و دارای commit/version ثبت‌شده باشد.

## ۱۵. قوانین Repository و Auto Pull

- monorepo منبع حقیقت توسعه است؛ deployment repository خروجی استقرار است.
- deployment repository محل توسعه‌ی feature نیست؛ تا زمان آماده‌شدن pipeline انتشار، snapshot self-contained تولیدشده از source می‌تواند با controlled release commit/push شود.
- Git submodule یا repository تو‌در‌تو برای جداکردن appها ساخته نمی‌شود.
- اتصال مستقیم یک monorepo به چند آیتم Runflare بدون working directory مستند و آزمایش‌شده ممنوع است.
- هر runtime bundle یک deployment repository، branch و Auto Pull مستقل دارد؛ repository source مستقیماً به Runflare متصل نمی‌شود.
- root deployment repository باید package.json یا Dockerfile قابل‌اجرا داشته باشد.
- در deployment repositoryهای فعلی، Dockerfile و `.dockerignore` باید در root باشند و build context به همان root محدود باشد.
- ماتریس اثر تغییر باید از مسیرهای source، packageها و contractها استخراج شود؛ push فقط deploymentهای اثرپذیرفته مجاز است و اگر اثر shared نامشخص بود، دامنه‌ی محافظه‌کارانه‌ی بزرگ‌تر انتخاب می‌شود.
- تغییر shared package، contract یا configuration باید bundle مصرف‌کننده را کامل منتشر کند؛ تغییر package یا contract مشترک بین frontend و backend هر دو bundle را اثرپذیر می‌کند.
- تغییر feature مستقیم در deployment repository ممنوع است؛ تغییر باید از monorepo بیاید. نبود pipeline، مانع controlled snapshot release نیست، اما باید در گزارش اعلام شود.
- credential اتصال Runflare به GitHub از credential نوشتن pipeline به deployment repository جدا است؛ هر دو حداقل دسترسی لازم را دارند.
- pipeline نباید deployment repository را force-push یا تاریخچه‌ی آن را بازنویسی کند.
- source commit، deployment commit، سرویس Runflare و وضعیت webhook باید قابل ردیابی باشند.
- اگر source monorepo remote ندارد، عبارت `Source commit: unavailable` ثبت می‌شود و deployment hash جای source hash گزارش نمی‌شود.
- پیش از stage برای هر clone باید `git fetch origin main` و `git rev-list --left-right --count HEAD...origin/main` اجرا شود؛ ادامه فقط با وضعیت `0 0` مجاز است. remote ahead یا non-fast-forward باید متوقف و گزارش شود.
- push دستی snapshot فقط با درخواست انتشار کاربر، stage صریح، build/test از خود clone و بدون force-push مجاز است.
- rollback با snapshot یا commit قبلی deployment repository انجام می‌شود.
- چند app/process در هر آیتم فقط در دو bundle مصوب ADR-0016 و از طریق manifest و supervisor مشخص اجرا می‌شوند؛ Supervisor هر process را پس از پاسخ موفق endpoint readiness همان process شروع می‌کند. افزودن process تازه نیازمند به‌روزرسانی ترتیب startup و ماتریس پورت/environment/readiness است.
- جزئیات نگاشت، ماتریس اثر، workflow commit/push و چک‌لیست در [CommitPushAndDeploymentWorkflow.md](CommitPushAndDeploymentWorkflow.md) و [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) اجباری است.

## ۱۶. قوانین Git و Review

- commit کوچک، مشخص و مربوط به یک هدف باشد.
- تغییرات feature، refactor و formatting در commitهای جدا نگه‌داری شوند.
- هر runtime deployment repository commit مستقل خودش را دارد؛ یک commit source را در چند repository با همان hash یا با copy خام تکرار نکن.
- قبل از commit `git diff --check` و بعد از stage `git diff --cached --check` اجرا شود؛ فقط pathهای اثرپذیرفته stage شوند.
- بعد از push، `git status --short --branch` و `git rev-list --left-right --count HEAD...origin/main` باید clean و `0 0` باشند.
- `git push --force`، `git push --force-with-lease`، `git reset --hard` و `git checkout -- .` برای حل اختلاف deployment ممنوع است.
- تغییر قرارداد باید همراه consumer/provider و migration لازم بررسی شود.
- تغییر UI باید screenshot یا توضیح حالت‌های اصلی داشته باشد.
- تغییر مالی یا مجوز بدون تست regression پذیرفته نیست.
- review باید security، scope، failure state، accessibility و observability را بررسی کند.
- فایل تولیدی، secret، build output و asset بدون مجوز به repository اضافه نمی‌شود.

## ۱۷. Definition of Done

یک کار فقط وقتی Done است که:

- نیازمندی و scope روشن و سناریوی موفق/ناموفق مشخص باشد؛
- قرارداد API/event به‌روز و versioned باشد؛
- rule در مالک صحیح داده پیاده شده باشد؛
- authorization و audit لازم وجود داشته باشد؛
- loading، empty، error، stale و success رابط بررسی شده باشد؛
- تست‌های متناسب اجرا و نتیجه ثبت شده باشد؛
- log، metric، timeout و retry لازم اضافه شده باشد؛
- مستندات و ساختار فولدر به‌روز باشد؛
- هیچ secret یا دسترسی مستقیم غیرمجاز باقی نمانده باشد؛
- rollback و اثر روی سرویس‌های دیگر معلوم باشد.
