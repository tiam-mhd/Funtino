# ADR-0032: جفت‌سازی امن اپراتور برای Windows Edge

- تاریخ: 2026-11-22
- وضعیت: accepted
- دامنه: API Gateway، Device Integration، Operations Web و Windows Cash
- مرتبط: ADR-0031 و قرارداد Windows Edge 1.0.0

## مسئله

Gateway در ADR-0031 توکن اپراتور را از نشست مدیریتی Operations صادر می‌کند، اما Windows نشست مرورگر ندارد و نباید cookie، رمز IAM یا نقش محلی را به‌جای مجوز مرکزی ارائه کند. پاسخ مستقیم توکن به مرورگر نیز راه انتقال امن و یک‌بارمصرف آن به نصب Windows نیست.

## تصمیم

1. Windows با HMAC نصب به Device Integration درخواست pairing می‌دهد. سرویس، installation فعال و branch ثبت‌شده را از registry می‌خواند، کد تصادفی کوتاه‌عمر و راز مستقل poll می‌سازد و فقط SHA-256 هر دو را ذخیره می‌کند. کد خام فقط یک‌بار به همان نصب برمی‌گردد؛ راز poll نیز فقط در حافظهٔ نصب می‌ماند.
2. کاربر کد را در صفحهٔ «دستگاه‌ها»ی Operations وارد می‌کند. Gateway نشست `management`، branch فعال و هر permission انتخاب‌شده را از IAM دوباره بررسی می‌کند. صفحه فقط permissionهایی را نشان می‌دهد که IAM برای همان actor و branch مجاز دانسته است؛ انتخاب پیش‌فرض ندارد.
3. Gateway تأیید را با actor، شناسهٔ نشست، organization، branch، permissionهای دقیق و کلید idempotency به Device Integration می‌فرستد. Device Integration این مقادیر را به همان pairing و installation ثبت‌شده متصل می‌کند و رخداد audit می‌سازد.
4. Windows با همان HMAC، شناسهٔ pairing و راز مستقل poll وضعیت را می‌خواند؛ کد قابل‌نمایش فقط برای تأیید در Operations است و credential polling نیست. Device Integration درخواست را برای همان installation/branch می‌یابد، آن را به‌صورت اتمی یک‌بار claim می‌کند و از endpoint داخلی Gateway درخواست تبادل می‌دهد.
5. Gateway پیش از تبادل، نشست مدیریتی را از مخزن خودش با actor و `audience=management` تطبیق می‌دهد و revoked/expiry را رد می‌کند. سپس branch را از Organization & Branch می‌خواند و از IAM توکن عادی Edge را با permissionهای ثبت‌شده می‌خواهد. IAM permission و policy جاری را هنگام صدور ارزیابی می‌کند و فقط hash توکن را نگه می‌دارد. Gateway انقضای پاسخ IAM را نیز fail-closed کنترل می‌کند تا عمر پاسخ از پنج دقیقه بیشتر نشود.
6. توکن opaque با پاسخ داخلی به Device Integration و سپس با پاسخ poll به Windows می‌رسد؛ هیچ‌یک آن را ذخیره یا log نمی‌کنند. Windows آن را فقط در حافظهٔ process نگه می‌دارد؛ اعتبار حداکثر پنج دقیقه است. خروج نشست پس از صدور از مسیر revoke موجود استفاده می‌کند و هر درخواست Edge نیز IAM را دوباره ارزیابی می‌کند.
7. Start، poll و cancel در Device Integration از quota نصب استفاده می‌کنند. کدهای تأیید در Gateway/Device Integration rate limit می‌شوند؛ کد حدس‌پذیر یا قابل بازیابی نیست. پاسخ‌ها `no-store` هستند. کد منقضی، نشست لغوشده، branch نامعتبر یا تغییر permission باعث رد pairing می‌شود.
8. کد pairing فقط یک‌بار claim می‌شود. اگر پاسخ شبکه پس از claim گم شود یا سرویس در میانهٔ تبادل متوقف شود، همان pairing دوباره توکن صادر نمی‌کند؛ Windows باید pairing تازه بسازد. Poll با شناسه و راز جداگانهٔ poll انجام می‌شود. refresh token یا تمدید خودکار وجود ندارد.

## قرارداد و مالکیت

- endpointهای HMAC-only در OpenAPI Device Integration نسخهٔ v2 افزایشی‌اند؛ payload دقیق، پاسخ و خطا در همان قرارداد تعریف می‌شود.
- endpointهای نشست‌محور در OpenAPI Gateway تعریف می‌شوند. endpoint تبادل داخلی فقط credential مجزای Device Integration را می‌پذیرد.
- Identity & Access مالک صدور، hash، TTL، audit، revoke و ارزیابی permission توکن باقی می‌ماند؛ هیچ migration تازه‌ای در IAM لازم نیست.
- Device Integration مالک رکورد pairing، hash کد، نصب/branch، state transition و audit pairing است. migration افزایشی `device_integration` در job مستقل اجرا می‌شود.
- Operations UI از طراحی و shell فعلی Edge Sync استفاده می‌کند؛ کنترل‌های pairing جایگزین permission server-side نیستند.

## امنیت، خطا و rollback

- Windows هیچ cookie یا credential مرورگر/IAM دریافت نمی‌کند و role/branch محلی قابل‌اعتماد نیست.
- code hash، token، body احراز هویت، PII و secret در diagnostics ثبت نمی‌شوند؛ فقط correlation ID و کد خطای امن مجاز است.
- 401 نشست/توکن را نامعتبر می‌کند؛ 403 رد permission/branch است؛ 409 کد مصرف‌شده، انقضا یا رقابت state است؛ 429 و 5xx باعث retry محدود یا pairing تازه مطابق state می‌شود.
- migration اجراشده‌ی این تصمیم در production وجود ندارد. rollback برنامه با حفظ جدول pairing و audit ممکن است؛ pairingهای موقت پس از TTL قابل پاک‌سازی retention جداگانه‌اند. پایین‌آوردن schema خودکار انجام نمی‌شود.

## انتشار و معیار پذیرش

- مسیرهای `apps/api-gateway` و `services/device-integration` و OpenAPIهای Backend، runtime backend را تحت‌تأثیر قرار می‌دهند؛ صفحه و API client در `apps/operations-web` runtime frontend را هم تحت‌تأثیر می‌دهد.
- تست باید کد hash‌شده، branch/install binding، rate limit، idempotency، نشست لغوشده، permission تغییرکرده، تبادل یک‌باره، عدم log/store توکن و failure پس از claim را پوشش دهد.
- تست‌های قرارداد و authorization و buildهای اثرپذیرفته در checkout محلی اجرا شدند. این پذیرش تصمیم و کد repository را پوشش می‌دهد؛ migration production، Runflare environment، revoke واقعی IAM و smoke staging در این کار اجرا نشده‌اند و باید در rollout جداگانه تأیید شوند.
