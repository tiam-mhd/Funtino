# ADR-0011: bootstrap امن مدیر و gate بازشدن writeهای IAM در production

- تاریخ: 2026-10-01
- وضعیت: accepted
- تصمیم‌گیر: مالک محصول/مدیر محصول
- دامنه: Identity & Access، API Gateway، System Web و rollout production

## مسئله و زمینه

CLI bootstrap مدیر از قبل دو مرحله‌ای بود، اما اجرای تصادفی آن روی database اشتباه، باقی‌ماندن عضویت موقت، و بازشدن writeهای عادی صرفاً با پیکربندی Owner هنوز کنترل عملیاتی صریح نداشت. همچنین TTL نشست، عمر MFA step-up و عمر cookie در کد جداگانه تعریف شده بودند و readiness دلیل بسته‌بودن write را یکجا گزارش نمی‌کرد.

## گزینه‌ها

1. تکیه بر permission/MFA و اعتبارسنجی Owner، بدون کلید release مستقل؛ ساده‌تر، اما تغییر runtime configuration می‌توانست بدون مرحله‌ی rollout صریح writeهای مدیریتی را فعال کند.
2. بازبودن writeها پس از deploy و اتکا به UI برای کنترل؛ سریع، اما UI مرز امنیتی نیست و rollback عملیاتی کندتر است.
3. افزودن kill switch production با پیش‌فرض بسته، مستقل از gate زنده‌ی Owner؛ Bootstrap جداگانه با اجازه‌ی one-shot، terminal تعاملی و عضویت موقت منقضی‌شونده.

## تصمیم

گزینه‌ی ۳ انتخاب شد. این تصمیم ADR-0006، ADR-0008 و ADR-0010 را محدودتر و اجرایی‌تر می‌کند و مالکیت IAM یا مرز Owner را تغییر نمی‌دهد.

- در `NODE_ENV=production` فرمان‌های مدیریتی role، دعوت/لغو دعوت، تغییر/تعلیق/فعال‌سازی/لغو membership و override فقط وقتی اجرا می‌شوند که `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED` دقیقاً `true` باشد. مقدار غایب، `false`، `1` یا مقدار مبهم معادل بسته است. فقط `NODE_ENV=development` و `NODE_ENV=test` پیش‌فرض توسعه/CI را باز می‌کنند؛ staging، محیط ناشناخته و نبودن `NODE_ENV` بسته‌اند مگر آن‌که flag صریحاً باز شود.
- این kill switch بر تمام mutationهای IAM شامل پذیرش دعوت نیز اعمال می‌شود تا عضویتِ دارای permission از دعوت معوق در زمان بسته‌بودن gate فعال نشود. lifecycle عامل MFA خود کاربر (enrollment، step-up، بازیابی و disable) جدا می‌ماند تا مدیر اولیه بتواند MFA را راه‌اندازی/بازیابی کند؛ این مسیرها خود مجوز مدیریتی ایجاد نمی‌کنند.
- بستن gate پیش از هر mutation مدیریتی انجام می‌شود. تلاش بسته‌شده با `503` رد می‌شود و یک audit حداقلی با actor، operation، correlation و outcome=denied ثبت می‌کند؛ body، شماره، کد MFA یا secret در این audit نوشته نمی‌شود. شکست ثبت audit نیز fail-closed است.
- readiness وضعیت gate مدیریتی و gate tenant را جدا نشان می‌دهد. `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=true` به‌تنهایی Owner را دور نمی‌زند: برای هر tenant mutation در production، permission/delegation/MFA در IAM بررسی می‌شود و سپس Owner همان scope را طبق ADR-0010 زنده اعتبارسنجی می‌کند. وضعیت configured بودن Owner اثبات availability لحظه‌ای نیست.
- bootstrap عمومی یا endpoint ندارد. اجرای CLI در هر محیط به `IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true` در همان فرایند یک‌باره و terminal تعاملی نیاز دارد؛ MFA در finalize بدون echo دریافت می‌شود. این flag در environment سرویس دائمی نگه‌داری نمی‌شود و پس از هر invocation حذف می‌شود.
- membership با role محدود `system_admin_bootstrap` حداکثر ۲۴ ساعت از `createdAt` معتبر است. پس از انقضا از authorization، view عضویت جاری و eligibility عملیات MFA کنار گذاشته می‌شود؛ اجرای prepare بعدی عضویت مانده را ابتدا با audit و outbox به `revoked` تبدیل می‌کند. finalize انقضا را پیش از مصرف proof بررسی و داخل تراکنش دوباره کنترل می‌کند.
- سیاست پذیرفته‌شده‌ی session عوض نمی‌شود: نشست Gateway عمر مطلق ۳۰ روز دارد و تمدید لغزان ندارد؛ cookie در production `Secure` و `HttpOnly` و در تمام محیط‌ها `SameSite=Lax` است. زمان cookie و persistence از یک policy constant می‌آیند.
- MFA همچنان مطابق ADR-0006 است: TOTP و recovery code یک‌بارمصرف، proof متصل به session سمت Gateway، بازبینی نسخه‌ی فعلی عامل توسط IAM، و step-up حداکثر ۳۰۰ ثانیه. ثابت مشترک کد، عمر پاسخ و authorization را هم‌راستا می‌کند.
- این ADR الزام MFA در هر ورود مدیر یا idle-timeout جداگانه برای نشست را تصویب نمی‌کند؛ step-up برای permissionهایی که در policy حساس علامت‌گذاری شده‌اند الزامی است. اگر MFA در هر ورود یا عمر بیکاری کوتاه‌تر لازم است، پیش از پایلوت باید با ADR جداگانه تعیین تکلیف و پیاده‌سازی شود.
- feature gate این ADR فقط mutationهای مدیریتی مالک IAM را می‌بندد/باز می‌کند؛ writeهای داده‌ی دامنه همچنان به مجوز و scope زنده‌ی مالک همان سرویس وابسته‌اند و با این flag به‌تنهایی فعال نمی‌شوند.

## پیامدها، rollback و rollout

- production به‌صورت پیش‌فرض قابل استفاده برای خواندن، مشاهده‌ی وضعیت، ورود و enrollment عامل است، اما فرمان‌های مدیریتی اصلی بسته می‌مانند.
- rollout write نیازمند تایید جداگانه‌ی owner/service credentials، اجرای migrationهای لازم، readiness، smoke/E2E چند scope و approval عملیاتی است؛ سپس flag runtime باز می‌شود. صرف green بودن readiness یا UI کافی نیست.
- rollback فوری با تغییر `IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED=false` و restart/rollout طبق پلتفرم انجام می‌شود. migration جدید لازم نیست؛ انقضای bootstrap از `createdAt` استفاده می‌کند.
- flag bootstrap به deployment service اضافه نمی‌شود. هر bootstrap production فقط پس از آماده‌بودن deployment مستقل IAM، database backup/restore، keyring و runbook مجاز است. در این ADR هیچ bootstrap، secret، migration production یا deploy اجرا نشده است.

## پیاده‌سازی و قراردادهای اثرپذیرفته

- `services/identity-access`: gate در application mutation boundary، denied audit، bootstrap lease و readiness.
- `apps/api-gateway`: policy یکپارچه‌ی session TTL و cookie.
- endpointهای دامنه‌ای تغییر نمی‌کنند؛ قرارداد OpenAPI health readiness به‌صورت additive gate مدیریتی و status جداگانه‌ی tenant را گزارش می‌کند.
- مستندات: `services/identity-access/README.md`، `DOCS/OperationsStaffAccess.md`، `DOCS/RunflareDockerDeploymentRunbook.md` و `DOCS/RunflareRepositoryAndDeployment.md`.
- تست: gateهای env، audit و عدم mutation، انقضای bootstrap، سیاست cookie/session و آزمون‌های regression IAM/Gateway.
