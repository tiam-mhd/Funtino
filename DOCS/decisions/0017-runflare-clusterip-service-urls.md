# ADR-0017: اتصال Gateway به Identity & Access از Runflare ClusterIP

- وضعیت: accepted
- تاریخ: 2026-10-04
- دامنه: URL وابستگی Gateway به Identity & Access در runtime bundle خصوصی Runflare
- تصمیم مرتبط: این ADR بخش HTTPS داخلی از ADR-0016 را محدود و دقیق می‌کند.
- وضعیت اجرا: دامنه‌ی محدود اولیه‌ی این تصمیم با [ADR-0018](0018-backend-clusterip-service-urls.md) به ارتباط خصوصی بین همه‌ی processهای Backend گسترش یافته است.

## مسئله و شواهد

در مسیر وریفای OTP، API Gateway برای خواندن context دسترسی کاربر به Identity & Access درخواست می‌فرستد. لاگ production خطای DNS `ENOTFOUND` برای `identity-access.internal.funtino.ir:443` نشان می‌دهد؛ این hostname در DNS محیط تعریف نشده است. صفحه‌ی Networks ارائه‌شده برای Runflare، ClusterIP داخلی با نگاشت `http:80 -> Target Port` را نشان می‌دهد. خود سرویس Nest روی Target Port با HTTP گوش می‌دهد. پس ساختن URL HTTPS با hostname حدسی با مسیر واقعی شبکه یکی نیست.

## تصمیم

- ارتباط API Gateway با Identity & Access در همان Runflare project از ClusterIP خصوصی process مقصد انجام می‌شود.
- اگر صفحه‌ی Runflare برای آن ClusterIP نگاشت `http:80 -> <Target Port>` نشان دهد، مقدار URL به شکل `http://<network-name>:80` تنظیم می‌شود. `network-name` باید دقیقاً از پنل همان محیط برداشته شود؛ مقدار فرضی مانند `*.internal.funtino.ir` منبع معتبر نیست.
- در production، `IdentityAccessClient` فقط URLهای HTTPS معمول را می‌پذیرد یا HTTP را وقتی می‌پذیرد که hostname یک label با پسوند `-service` باشد، effective port برابر 80 باشد، credential، path پایه، query و fragment نداشته باشد. این validation اکنون از helper مشترک backend-core استفاده می‌کند.
- این استثنا فقط برای hostnameهای ClusterIP خصوصی است. endpointهای عمومی، custom domain، NodePort و URLهای HTTP دیگر همچنان ممنوع‌اند؛ آن‌ها باید HTTPS داشته باشند.
- ClusterIPهای backend نباید exposure عمومی یا NodePort بگیرند. token سرویس همچنان secret مجزای runtime است و در URL قرار نمی‌گیرد.
- هنگام ثبت این ADR، استثنا فقط برای `IDENTITY_ACCESS_URL` پیاده شده بود. دامنه‌ی فعلی و clientهای دیگری که از همان سیاست استفاده می‌کنند در ADR-0018 آمده‌اند.

## پیامدها و ریسک

- نام شبکه و پورت باید در Environment آیتم Backend Runflare تنظیم شود. تغییر کد hostname ناموجود را حدس نمی‌زند و جای تنظیم پنل را نمی‌گیرد.
- HTTP روی شبکه‌ی خصوصی رمزنگاری لایه‌ی انتقال ندارد؛ ایزوله‌بودن ClusterIP و محدودبودن دسترسی به project جزو مرز اعتماد این تصمیم است. اگر این مرز قابل تضمین نباشد، باید برای route گواهی TLS واقعی فراهم و URL HTTPS استفاده شود.
- هر client backend دیگری که در آینده با ClusterIP HTTP ارتباط بگیرد باید همین قاعده را به‌صورت محدود اعمال کند؛ هیچ‌کدام نباید HTTP عمومی را مجاز کند.
- health و telemetry باید خطای DNS را از connection refusal، timeout و خطای TLS جدا نگه دارند.

## rollout

1. نام ClusterIP Identity & Access و mapping آن را در Networks همان project تأیید کن.
2. `IDENTITY_ACCESS_URL` را روی `http://<network-name>:80` تنظیم و Backend را restart/redeploy کن.
3. وریفای OTP را با یک کد تازه امتحان کن و موفقیت درخواست داخلی IAM و ساخت session را از correlation ID همان درخواست بررسی کن.

## اسناد مرتبط

- [ADR-0016: دو runtime bundle](0016-grouped-frontend-backend-runtime-deployments.md)
- [Runflare repository و deployment](../RunflareRepositoryAndDeployment.md)
- [Runbook دو runtime](../runbooks/GroupedRunflareRuntime.md)
