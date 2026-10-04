# ADR-0018: URLهای ClusterIP برای ارتباط داخلی Backend

- وضعیت: accepted
- تاریخ: 2026-10-04
- دامنه: ارتباط HTTP بین processهای Backend در یک پروژه‌ی خصوصی Runflare
- تصمیم تکمیلی: گسترش سیاست اولیه‌ی ADR-0017 از Gateway-to-IAM به همه‌ی backend service clientهای متأثر؛ جایگزینی transport-only شرط HTTPS در ADR-0010
- جایگزینی جزئی: فقط شرط transport در ADR-0010 و محدودیت دامنه‌ی اولیه‌ی ADR-0017؛ مالکیت داده و authorization آن تصمیم‌ها دست‌نخورده می‌مانند.

## زمینه و علت

Runflare شبکه‌ی داخلی هر process را با یک ClusterIP و Port قابل‌دسترسی معرفی می‌کند؛ سرویس‌های NestJS داخل runtime روی target port خودشان HTTP گوش می‌دهند. لاگ‌های صفحه‌ی کارت‌ها نشان دادند API Gateway و سرویس‌های downstream با پاسخ سریع 503 روبه‌رو می‌شوند، در حالی که endpointهای عمومی و processهای اصلی آماده‌اند. Clientهای مشترک از نظر ساخت URL و ارتباط HTTP، سیاست یکسانی نداشتند: برخی فقط HTTPS را در production می‌پذیرفتند، در حالی‌که topology خصوصی Runflare به URLهایی مثل `http://<exact-network-name>:80` نیاز دارد.

## تصمیم

- processهای Backend در همان پروژه‌ی خصوصی Runflare می‌توانند از ClusterIP مقصد و Port 80 برای ارتباط داخلی استفاده کنند.
- HTTPS همچنان مجاز است. HTTP در production فقط وقتی پذیرفته می‌شود که hostname یک DNS label با پسوند `-service` باشد، effective port برابر 80 باشد، و URL credential، path پایه، query یا fragment نداشته باشد.
- اعتبارسنجی در `packages/backend-core/src/network/runflare-cluster-ip-url.ts` متمرکز است. هیچ URL عمومی HTTP، NodePort، localhost، IP خام، alias چندبخشی یا URL دارای path از این استثنا عبور نمی‌کند.
- Gateway و serviceهای دامنه برای URLهای داخلی از همین validation استفاده می‌کنند. درخواست‌های حاوی service token redirect را دنبال نمی‌کنند.
- Environment هر URL باید نام دقیق ClusterIP را از صفحه‌ی Networks همان Runflare project بگیرد. نام host در کد حدس زده یا hardcode نمی‌شود.
- database، Redis، RabbitMQ، endpointهای عمومی، callbackها و providerهای بیرونی تحت این تصمیم نیستند و validation جداگانه‌ی خود را حفظ می‌کنند.

## پیامدها و ریسک

- `.env.example`های محلی برای توسعه می‌توانند آدرس loopback یا نام سرویس Docker داشته باشند؛ در production باید آدرس ClusterIP واقعی روی Port 80 تنظیم شود.
- HTTP رمزنگاری لایه‌ی انتقال ندارد. این مجوز به ClusterIP خصوصی و ایزوله در همان پروژه محدود است. اگر این جداسازی برقرار نباشد، برای route گواهی TLS معتبر لازم است و باید HTTPS استفاده شود.
- redirectهای HTTP رد می‌شوند تا service token به مقصد دیگری فرستاده نشود.
- تغییر helper مشترک، همه‌ی clientهای مصرف‌کننده را در runtime Backend بازمی‌سازد؛ runtime Frontend تحت‌تأثیر نیست.

## rollout

1. در Runflare نام ClusterIP و `Port 80 -> Target Port` هر worker را از صفحه‌ی Networks بردار.
2. URLهای داخلی backend را با همان hostname دقیق و `http://<name>:80` تنظیم کن؛ secretها را تغییر نده.
3. Backend runtime را redeploy کن و health همه‌ی processها، سپس endpointهای شعب، خانواده و کارت را بررسی کن.
4. در صورت باقی‌ماندن 503، `dependency.configuration.invalid` را از timeout/refusal شبکه تفکیک کن و request/correlation ID همان درخواست را دنبال کن.

## clientهای مشمول

- API Gateway به Identity & Access، Organization & Branch، Device Integration، Wallet، Customer & Household و Analytics Read Model
- Identity & Access به Organization & Branch
- Wallet به Organization & Branch و Customer & Household
- Device Integration به Organization & Branch

## مراجع

- [ADR-0017: Gateway به Identity & Access از ClusterIP](0017-runflare-clusterip-service-urls.md)
- [Runflare repository و deployment](../RunflareRepositoryAndDeployment.md)
- [Runbook دو runtime](../runbooks/GroupedRunflareRuntime.md)
