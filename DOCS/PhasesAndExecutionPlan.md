# فازبندی و فهرست کارهای لازم‌الاجرا

این سند roadmap سطح‌بالا است. هر bullet یک بسته‌ی کاری یا تیتر تحلیل بعدی است؛ جزئیات فنی، برآورد و ترتیب داخل هر بسته باید در زمان شروع همان فاز تحلیل شود.

فازها بر اساس وابستگی و ریسک مرتب شده‌اند، نه تاریخ تقویمی. هیچ فاز تولیدی بدون عبور از gateهای امنیت، قرارداد، تست و عملیات وارد فاز بعد نمی‌شود.

## ۱. فازهای مشترک پایه

### G0 — کشف عملیات و تثبیت نیازمندی

- مشاهده‌ی جریان واقعی صندوق و سامانه‌ی کارت؛
- ثبت سازنده، نسخه، API، webhook و خروجی گزارش کارت؛
- تعریف منبع حقیقت شارژ، مصرف، برگشت و قطعی اینترنت؛
- مصاحبه با مشتری، والد، صندوق‌دار، اپراتور و مدیر شعبه؛
- تثبیت واژگان سازمان، شعبه، خانواده، کارت، اعتبار و پاداش؛
- تعریف scope، نقش‌ها و عملیات حساس؛
- مشخص‌کردن داده‌ی کودک، رضایت و retention؛
- تأیید سیاست اعتبار هدیه، انقضا و اولویت مصرف؛
- ثبت سؤال‌های باز و تصمیم‌های قطعی در ADR.

### G1 — معماری و قراردادهای پایه

- ایجاد monorepo و سه بستر مستقل؛
- تثبیت مرز سرویس‌ها و مالکیت داده؛
- تعریف OpenAPI Gateway؛
- تعریف envelope و schema رویداد؛
- تعریف naming و versioning قراردادها؛
- ایجاد PostgreSQL، RabbitMQ و محیط محلی؛
- طراحی Outbox، Inbox و idempotency؛
- تعریف auth، scope، audit و correlation id؛
- تعریف health، log، metric و trace؛
- ثبت topology و محدودیت Deployment در Runflare.

### G2 — Design System و تجربه‌ی مشترک

- تبدیل تحلیل چهار تصویر مرجع به tokenهای اختصاصی فانتینو؛
- ساخت token رنگ، typography، spacing، radius و motion؛
- ساخت componentهای پایه و حالت‌های accessibility؛
- تعریف RTL، locale، عدد، تاریخ و واحد پول؛
- تعریف shell و navigation هر سه بستر؛
- ساخت نمونه‌ی اولیه مسیرهای اصلی مشتری؛
- تست خوانایی، کنتراست، focus و هدف لمسی؛
- ثبت asset و مجوز تصویر/illustration.

### G3 — امنیت، محیط و تحویل

- تعریف environmentهای local، test، staging و production؛
- ایجاد secret policy و جلوگیری از secret در repository؛
- تعریف branch، commit، review و release policy؛
- ایجاد pipeline build، lint، test و deploy؛
- تثبیت Git source monorepo و دو deployment repository خودبسنده‌ی frontend/backend طبق ADR-0016؛
- تعریف path filter و ماتریس اثر تغییر shared package/contract بر دو runtime bundle؛
- اتصال هر runtime repository به یک branch و Auto Pull مستقل Runflare؛
- تثبیت supervisor fail-fast با startup ترتیبی و انتظار برای HTTP readiness هر process، allow-list متغیرهای محیطی، health پردازه‌ها و mapping شبکه/دامنه/پورت؛
- تعریف migration gate و rollback؛
- تنظیم لاگ و event عملیاتی Runflare؛
- تعریف backup مستقل و restore test؛
- تعریف incident و support runbook.

وضعیت 2026-10-01: در source، workflow کیفیت با dependency audit، contract/lint/typecheck/test/build، E2E عدم‌دسترسی بدون session، migration تکراری روی PostgreSQL disposable، backup/restore smoke و axe/Edge برای سه وب‌اپ اضافه شد. telemetry امن و token-protected برای هشت backend process متصل است؛ Prometheus/Grafana/Alertmanager، ruleهای عملیاتی و خلاصه‌ی System Web پشت permission سراسری IAM نیز در source پیکربندی شده‌اند. تلاش برای ساخت PostgreSQL موقت در sandbox ویندوز پیش از ایجاد cluster با خطای ساخت restricted token متوقف شد و به PostgreSQL service موجود دست زده نشد؛ Docker هم در این محیط در دسترس نیست. workflow هنوز روی remote اجرا نشده و backup مستقل staging، restore واقعی، rollback واقعی image سرویس، E2E احراز‌شده‌ی چند tenant، ارسال عملی alert، provision همه‌ی deployment repositoryها و انتشار Runflare همچنان gate هستند. ADR-0010 پذیرفته شده و validator scope در IAM به Owner متصل است. جزئیات و checklist انتشار در [ReleaseQualityGatesAndPilot.md](ReleaseQualityGatesAndPilot.md) است.

### G4 — هسته‌ی هویت و دسترسی

وضعیت 2026-10-05: نشست مدیریتی مطلق و قابل‌تنظیم ۱ تا ۱۲ ساعت (پیش‌فرض ۱۲)، اعتبار MFA مدیر سراسری تا پایان همان نشست، صفحه‌ی تنظیمات System Web و مجوز اختصاصی غیرقابل‌واگذاری آماده است. Bootstrap اکنون تنها حساب متناظر با شماره‌ی مالک تنظیم‌شده در Runflare را از API Gateway resolve می‌کند؛ IAM UUID آزاد نمی‌پذیرد و به جدول Gateway دسترسی ندارد. مدیر سراسری هنگام finalize تمام کلیدهای کاتالوگ را می‌گیرد و مدیرهای global دیگر در همان تراکنش revoke می‌شوند. Customer-only همچنان ۳۰ روز و step-up کارکنان غیرمدیر سراسری پنج دقیقه است. write gate production همچنان default-off است و باید جداگانه در Runflare روی `true` تنظیم شود تا mutationهای معمول IAM کار کنند. انتشار snapshot بک‌اند و پیکربندی secretهای Runflare هنوز لازم است.

وضعیت 2026-10-01: commandهای IAM (role/membership/invitation/override)، فهرست و لغو دعوت‌های صادرشده، delegation، idempotency، audit/outbox، ممیزی خواندن داده‌های حساس، حفاظت آخرین مدیر، MFA step-up و bootstrap آفلاین در source پیاده‌سازی شده‌اند؛ Operations Web نیز inbox پذیرش دعوت، roster و UI مدیریت role/status/override را به BFF متصل می‌کند. گزینه‌ی ۱ ADR-0010 اجرا شده است: IAM permission/delegation/MFA را ارزیابی می‌کند و سپس در production هر mutation tenant scope را با Owner فعال/هم‌والد بودن بررسی می‌کند. ADR-0011 gate مدیریتی production را default-off، bootstrap را one-shot و membership موقت آن را ۲۴ساعته می‌کند؛ تنظیم نشست‌ها و اعتبار MFA از این پس طبق ADR-0020 هستند. Owner failure یا configuration نامعتبر fail-closed است؛ rollout staging، secretهای مستقل و E2E tenant همچنان gate هستند. این وضعیت مجوز انتشار نیست.

- OTP و session؛
- membership و role؛
- permission catalog نسخه‌دار، نقش پایه/سفارشی، scope و override فردی در سطح membership؛
- delegation ceiling، precedence deny، revocation فوری و audit قبل/بعد؛
- سازمان و شعبه؛
- scope guard و policy؛
- MFA مدیران؛
- audit تغییر نقش و دسترسی؛
- مدیریت account lock و recovery؛
- تست نفوذ سطح مجوز و دسترسی افقی.

## ۲. فازبندی وب‌اپ مشتری

### C0 — Shell و ورود

- ساخت app shell موبایل و bottom navigation؛
- پیاده‌سازی RTL و tokenهای مشتری؛
- صفحه‌ی landing و شعبه‌ی عمومی؛
- ورود با OTP و حالت‌های خطا؛
- session، logout و recovery؛
- loading/empty/error پایه؛
- telemetry مسیر ورود؛
- تست mobile viewport و accessibility.

### C1 — پروفایل، خانواده و رضایت

- ساخت پروفایل کاربر؛
- ایجاد خانواده؛
- افزودن بزرگسال؛
- افزودن عضو وابسته؛
- رابطه و سرپرست؛
- رضایت و تنظیم اعلان؛
- context انتخاب عضو؛
- کنترل والد برای داده و اقدام؛
- audit دعوت و تغییر رابطه.

### C2 — خانه و کشف شعبه

- انتخاب شعبه‌ی فعال یا موردعلاقه؛
- ساعت کاری و وضعیت فعالیت؛
- نشانی و مسیر؛
- تصویر واقعی شعبه؛
- فهرست جاذبه و دستگاه؛
- رویداد و اطلاعیه؛
- پیشنهادهای محلی؛
- branch switcher؛
- stale و unavailable برای داده‌ی شعبه؛
- تست شبکه‌ی ضعیف.

### C3 — کارت، اعتبار و گردش

وضعیت 2026-10-01: Wallet مالک inventory و assignment است؛ Customer & Household مرجع مستقل household/member/access است. کارت مشترک در سطح household تخصیص می‌یابد و یکتایی `(householdId, branchId)` و `cardId` در هر لحظه اعمال می‌شود؛ هر شعبه کارت تخصیصی مستقل دارد و انتقال household فقط در همان شعبه انجام می‌شود. Gateway، Operations Web و Customer Web به APIهای مالک متصل شده‌اند. ثبت دستی تا تأیید فیزیکی `unknown` می‌ماند و قابل تخصیص نیست. Backfill، تطبیق و cutover واقعی، staging، adapter/provider و هرگونه نمایش balance/شارژ/مصرف همچنان به gateهای جداگانه نیاز دارند.

- افزودن کارت با QR یا کد کوتاه؛
- جریان تأیید صندوق؛
- فهرست کارت‌های خانواده؛
- تخصیص کارت مشترک خانواده به هر شعبه؛
- اعتبار پرداختی و هدیه؛
- زمان آخرین همگام‌سازی؛
- تاریخچه‌ی شارژ و مصرف؛
- وضعیت sync، خطا و قدیمی بودن؛
- عدم فعال‌سازی شارژ تا تأیید مسیر مالی؛
- تست idempotency و عدم نمایش موجودی جعلی.

### C4 — مأموریت، نشان و پاداش

- catalog مأموریت؛
- filter بر اساس خانه، شعبه و خانواده؛
- جزئیات شرط و پاداش؛
- progress و step؛
- ثبت QR یا رویداد حضور؛
- وضعیت locked، active، completed و expired؛
- claim idempotent؛
- نشان و پاسپورت بازدید؛
- کوپن و تاریخ اعتبار؛
- leaderboard اختیاری و privacy-safe.

### C5 — اعلان، راهنما و بازخورد

- inbox اعلان؛
- ترجیح و رضایت اعلان؛
- FAQ و راهنمای کارت؛
- ثبت مشکل؛
- پیگیری درخواست؛
- اعلان وضعیت sync یا پرداخت؛
- deep link امن؛
- نمایش وضعیت ارسال و خطا؛
- تست عدم افشای داده‌ی خانواده.

### C6 — پیشنهاد تجاری و پرداخت کنترل‌شده

- نمایش بسته و کمپین؛
- قواعد پیشنهاد پلکانی؛
- سفارش پرداخت؛
- pending/confirmed/failed/refunded؛
- بازگشت و تطبیق؛
- اعتباردهی Wallet پس از event معتبر؛
- رسید؛
- محدودیت retry و جلوگیری از شارژ دوباره؛
- فعال‌سازی فقط بعد از پایلوت read-only کارت.

### C7 — PWA، بهینه‌سازی و رشد

- manifest و install experience؛
- cache محتوای کم‌خطر؛
- اعلان وب در صورت نیاز؛
- performance budget؛
- telemetry funnel؛
- تست مرورگرهای اصلی؛
- تست restore و session expiry؛
- بهینه‌سازی تصویر و فونت؛
- بازبینی accessibility و privacy.

## ۳. فازبندی پنل مجموعه و شعب

### O0 — Shell، نقش و scope عملیاتی

- ورود و session پنل؛
- انتخاب سازمان و شعبه؛
- shell و navigation عملیاتی؛
- role-based menu؛
- policy سمت سرور؛
- branch context در query و mutation؛
- audit ورود و تغییر scope؛
- جدول و فرم پایه؛
- تست دسترسی بین دو شعبه.

### O1 — صندوق و اتصال کارت

وضعیت 2026-10-01: `services/wallet` و Customer & Household owner اکنون منبع موجودی و household/card assignment هستند. Gateway و Operations Web پشتیبانی می‌کنند: فهرست شعبه‌ای، ثبت، فیلتر و صفحه‌بندی، mask شناسه، optimistic status، lookup شماره‌ی دقیق با audit، تخصیص/انتقال/لغو household card با scope، مجوز، MFA، idempotency و تاریخچه. Customer Web تخصیص‌های فعال خانوارهای مجاز را بدون member-specific یا مبلغ مالی نمایش می‌دهد. کارت تا تأیید adapter همچنان `unknown` و غیرقابل تخصیص است؛ migration/backfill/staging، reconciliation، اثبات provider و E2E احراز‌شده هنوز gate هستند.

- جست‌وجوی مشتری و خانواده؛
- مشاهده‌ی وضعیت کارت؛
- تخصیص کارت مشترک خانواده، انتقال به خانواده‌ی دیگر در همان شعبه و لغو با permission؛
- تأیید QR یا کد؛
- ثبت دلیل عملیات؛
- مشاهده‌ی آخرین sync؛
- ثبت خطا و retry کنترل‌شده؛
- صدور یا مشاهده‌ی رسید؛
- جلوگیری از اتصال دوباره.

### O2 — شارژ، فروش و اصلاح کنترل‌شده

- تعریف سفارش؛
- فروش بسته؛
- اتصال به provider پرداخت یا صندوق؛
- تأیید و برگشت؛
- تفکیک اعتبار پرداختی و هدیه؛
- اصلاح با رکورد جدید؛
- daily reconciliation؛
- محدودیت مبلغ و permission؛
- گزارش عملیات مالی؛
- تست webhook تکراری.

### O3 — شعبه، جاذبه و دستگاه

وضعیت 2026-10-01: مالک Device Integration در source شامل registry پایدار دستگاه، اعتبارسنجی branch از مالک Organization & Branch، API داخلی، سلامت نرمال‌شده‌ی idempotent، migration و Outbox نسخه‌دار پیاده و typecheck/build/lint/test شده است (۲۸ تست سرویس، ۷ تست قرارداد رویداد و ۲ تست/typecheck گارد caller). BFF نشست‌محور Gateway و بخش «دستگاه‌ها و پایش» Operations Web نیز به API مالک متصل شده‌اند؛ فهرست و ثبت، فیلتر lifecycle، سلامت/freshness واقعی، stale/unknown، پیگیری اختلال، مجوز scope سمت سرور، pagination، idempotency و کنترل نسخه پیاده و typecheck شده‌اند. آزمون‌های source فعلی شامل ۴۹ تست Gateway و ۷ تست API Operations Web موفق‌اند؛ production build پنل و ESLint فایل‌های اثرپذیرفته نیز موفق‌اند. آزمون E2E با سرویس‌های در حال اجرا و مرورگر واقعی، اجرای migration/rollback و backup/restore روی PostgreSQL واقعی، آداپتر provider سخت‌افزاری و انتشار مستقل همچنان باز هستند؛ این مورد به معنی تکمیل O3 نیست.

- مدیریت ساعت کاری؛
- فهرست جاذبه و دستگاه؛
- وضعیت device؛
- گزارش اختلال؛
- مشاهده‌ی رویداد بازی؛
- اجرای sync دستی با permission؛
- نمایش freshness؛
- ثبت downtime؛
- اتصال adapter به سامانه‌ی کارت.

### O4 — محصول، قیمت و کمپین

- تعریف محصول و بسته؛
- قیمت و اعتبار شعبه؛
- تاریخ شروع و پایان؛
- کمپین و eligibility؛
- مأموریت و پاداش؛
- coupon rule؛
- approval تغییرات؛
- preview و انتشار؛
- rollback تنظیمات؛
- audit کمپین.

### O5 — CRM و گزارش عملیاتی

- بخش‌بندی مشتری؛
- فیلتر مراجعه و رفتار خرید؛
- پیشنهاد و اعلان مجاز؛
- گزارش فروش؛
- گزارش مراجعه؛
- گزارش همگام‌سازی؛
- گزارش عملکرد کمپین؛
- export کنترل‌شده؛
- محدودیت داده‌ی شخصی در گزارش؛
- read model و cache گزارش.

وضعیت برش گزارش عملیاتی (2026-10-01): owner مستقل Analytics و projection بازسازی‌پذیر برای snapshot وضعیت مجموعه/شعبه و device-health/event-count پیاده شده؛ Gateway مجوز و scope را server-side کنترل می‌کند و Operations Web گزارش UTC و export تجمیعی MFA/audit‌شده دارد. این فقط منابع رویدادی معتبر فعلی را پوشش می‌دهد. Backfill داده‌های پیش از شروع consumer، گزارش مالی/فروش/مراجعه/کمپین و CRM تا ساخته‌شدن owner و event contract مربوطه باز هستند؛ migration واقعی، backup/restore، E2E و انتشار Analytics نیز gate باقی می‌مانند. این status، تکمیل O5 را اعلام نمی‌کند.

### O6 — کنترل و بهره‌برداری چندشعبه‌ای

- مقایسه‌ی شعب؛
- نقش مدیر مجموعه؛
- گزارش تجمیعی؛
- alert خطا و دستگاه؛
- approval chain؛
- audit عملیاتی؛
- runbook شیفت و پشتیبانی؛
- آموزش نقش‌ها؛
- تست فشار عملیات صندوق.

## ۴. فازبندی پنل سیستمی

### S0 — هویت مدیریتی و کنترل ویژه

- ورود مدیر با MFA؛ TOTP با پنجره‌ی ۳۰ ثانیه و تلورانس یک بازه و ۱۰ recovery code یک‌بارمصرف (ADR-0006)؛
- نشست مدیر با مدت مطلق ۱ تا ۱۲ ساعت و MFA proof تا پایان همان نشست؛ step-up کارکنان دیگر حداکثر ۳۰۰ ثانیه (ADR-0020)؛
- نقش مدیر سامانه و پشتیبانی؛
- break-glass policy؛
- lock/unlock حساب؛
- ثبت audit ورود و اقدام؛
- عدم نمایش secret؛
- تست privilege escalation.

### S1 — سازمان و شعب

وضعیت 2026-10-01: source سرویس مالک `organization-branch`، schema/migration مستقل، API داخلی lifecycle و scope validation، قرارداد OpenAPI و شش event نسخه‌دار Outbox، CLI backfill خشک/تأییدشده و اتصال discovery/اعتبارسنجی شعبه در Gateway پیاده شده‌اند. BFF نشست‌محور Gateway و صفحه‌ی مدیریت مجموعه/شعبه در System Web نیز در source پیاده شده‌اند: فهرست صفحه‌بندی‌شده، ایجاد، ویرایش با `If-Match`، تعلیق/فعال‌سازی، نمایش وضعیت واقعی owner، stateهای loading/empty/error/stale و کنترل هم‌زمانی در رابط. IAM نیز به validator داخلی owner متصل شده و مرز تصمیم مجوز actor در IAM ثبت شده است. migration/backfill/reconciliation واقعی، پیکربندی secrets شبکه‌ی داخلی، restore/smoke و deployment مستقل هنوز اجرا نشده‌اند؛ gate عملیاتی production تا عبور این گیت‌ها بسته می‌ماند.

- ایجاد سازمان؛
- ایجاد و غیرفعال‌سازی شعبه؛
- تنظیم مالکیت/بهره‌برداری؛
- تنظیم timezone و locale؛
- تعریف محدودیت‌های شعبه؛
- مشاهده‌ی ساختار سازمان؛
- migration و soft delete؛
- audit تغییر ساختار.

### S2 — کاربران، membership و policy

وضعیت 2026-10-05: پنل system و APIهای مدیریت role، staff، فهرست/ایجاد/پذیرش/لغو invite، override و audit به Identity & Access متصل‌اند؛ audit حساس به step-up تازه‌ی نشست نیاز دارد. صفحه‌ی دسترسی System فهرست مجاز مجموعه‌ها و شعب فعال را برای انتخاب scope نشان می‌دهد و واگذاری مدیر مجموعه را با الگوی کامل `organization_manager` و دعوت شماره‌محور راهبری می‌کند؛ مدیر مجموعه scope خود مجموعه و شعب فعال فعلی/آینده‌ی آن را در Operations Web انتخاب می‌کند. عضویت مجموعه روی شعب آن اعمال می‌شود و مجوز global سامانه را واگذار نمی‌کند. IAM پس از permission/delegation/MFA از API زنده‌ی owner برای اعتبارسنجی وجود و active state scope استفاده می‌کند. در production نبودن تنظیمات یا عدم دسترسی owner هر mutation را fail-closed می‌کند؛ nonproduction همچنان scopeهای opaque را فقط برای توسعه/آزمون می‌پذیرد. اجرای staging/E2E و deployment مستقل باقی است.

- جست‌وجوی کاربر؛
- عضویت در سازمان و شعبه؛
- نقش و scope؛
- permission matrix؛
- دعوت، تعلیق و لغو دسترسی؛
- MFA و recovery؛
- تاریخچه‌ی قبل/بعد؛
- تأیید مجدد عملیات حساس.

### S3 — provider و اتصال‌ها

- ثبت provider OTP؛
- ثبت provider پرداخت؛
- تنظیم adapter کارت؛
- سلامت اتصال؛
- timeout و retry policy؛
- credential rotation؛
- تست اتصال بدون نمایش secret؛
- enable/disable کنترل‌شده؛
- نسخه‌ی قرارداد بیرونی.

### S4 — سلامت، رویداد و ممیزی

- وضعیت سرویس‌ها؛
- وضعیت PostgreSQL، RabbitMQ و Redis؛
- queue depth و Dead Letter؛
- sync freshness؛
- خطاهای provider؛
- جست‌وجوی audit؛
- correlation و trace؛
- replay یا retry دستی با permission؛
- export audit کنترل‌شده.

### S5 — تنظیمات سراسری و feature control

- feature flag با scope؛
- تنظیمات عمومی برند و locale؛
- سیاست اعلان؛
- سیاست retention؛
- محدودیت rate و امنیت؛
- rollout مرحله‌ای؛
- rollback flag؛
- audit هر تغییر؛
- جلوگیری از فعال‌سازی قابلیت مالی بدون gate.

### S6 — پشتیبانی و عملیات اضطراری

- مشاهده‌ی timeline کاربر؛
- بررسی درخواست پشتیبانی؛
- ابزار اصلاح محدود و reason-based؛
- impersonation زمان‌دار؛
- incident mode؛
- اجرای runbook؛
- خروجی audit برای بررسی؛
- handoff به مسئول شعبه؛
- تست ثبت کامل عملیات اضطراری.

### F0 — معماری و قرارداد Forms

- مالکیت مستقل سرویس Forms، schema PostgreSQL، مدل نسخه و پاسخ؛
- قرارداد OpenAPI و event نسخه‌دار؛
- catalog مجوز و سناریوی scope/PII/audit؛
- مرزهای retention و storage؛ پاک‌سازی تا تصویب سیاست خاموش می‌ماند و upload تا انتخاب provider خاموش است.

### F1 — سرویس، builder و پنل مدیریت

- draft، validation، preview، publish/pause/archive و immutable version؛
- editor مشترک schema/renderer، scope مجموعه/شعبه، template و API؛
- پاسخ، فهرست scopeدار، وضعیت، audit و CSV کنترل‌شده؛
- تست IDOR بین شعب، مجوز PII، idempotency، نسخه و migration مستقل.

### F2 — customer runtime و rollout

- فرم مهمان/مشتری، رضایت اتصال حساب، فرم عمومی، وضعیت و ارسال idempotent؛
- RTL/mobile/accessibility و renderer مشترک با preview؛
- rate limit، observability، backup/restore و rollout هر دو runtime bundle؛
- file/image/signature فقط پس از تصمیم storage و قرارداد دانلود مجاز.

## ۵. وابستگی فازها

| قابلیت       | پیش‌نیاز مشترک                      | بستر درگیر           |
| ------------ | ----------------------------------- | -------------------- |
| ورود مشتری   | G1 و G4                             | مشتری، سیستم         |
| خانواده      | G4 و قرارداد Customer               | مشتری، سیستم         |
| اتصال کارت   | کشف G0 و Device Integration         | مشتری، عملیات، سیستم |
| نمایش اعتبار | Wallet، sync و read model           | مشتری، عملیات        |
| شارژ آنلاین  | پایلوت read-only و Payment contract | مشتری، عملیات، سیستم |
| کمپین        | Product/Pricing و Loyalty           | هر سه بستر           |
| گزارش        | event contract و read model         | عملیات، سیستم        |
| WebSocket    | RabbitMQ، auth و realtime gateway   | هر سه بستر           |
| Forms        | F0، G1، G2، IAM، event contract     | هر سه بستر           |

## ۶. Gateهای انتشار

### Gate محصول

- سناریوی کاربر و معیار موفقیت تأیید شده؛
- متن، وضعیت و مسیر خطا مشخص است؛
- نقش و scope روشن است.

### Gate فنی

- قراردادها versioned و تست contract دارند؛
- migration و rollback مشخص است؛
- Outbox/Inbox و idempotency برای جریان لازم وجود دارد؛
- health و telemetry فعال است.

### Gate امنیت

- authorization سمت سرور تست شده؛
- secret و داده‌ی حساس در خروجی نیست؛
- audit عملیات حساس ثبت می‌شود؛
- rate limit و session policy بررسی شده است.

### Gate تجربه

- RTL، موبایل، keyboard و screen reader بررسی شده؛
- loading، empty، error، stale و success کامل است؛
- کنتراست و target لمسی قبول شده است.

### Gate عملیات

- deploy و rollback تمرین شده؛
- backup و restore test شده؛
- runbook خطا و پشتیبانی آماده است؛
- اثر فاز روی Runflare و تعداد Deployment روشن است.
