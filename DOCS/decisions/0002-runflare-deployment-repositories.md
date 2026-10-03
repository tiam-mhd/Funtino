# ADR-0002: تفکیک source monorepo از deployment repositoryهای Runflare

- وضعیت: accepted با نگاشت اولیه‌ی superseded‌شده توسط ADR-0016
- تاریخ: 2026-09-27
- دامنه: اتصال GitHub، Auto Pull و استقرار سرویس‌های مستقل فانتینو در Runflare

## مسئله و زمینه

فانتینو چند خروجی قابل استقرار دارد: سه وب‌اپلیکیشن مشتری، عملیات و سیستم، و چند gateway/worker. توسعه‌ی این اجزا به قراردادها و packageهای مشترک وابسته است؛ بنابراین نگهداری آن‌ها در یک source monorepo مزیت دارد.

مستندات عمومی Runflare برای اتصال GitHub، انتخاب repository و branch و فعال‌سازی Auto Pull را توضیح می‌دهند، اما برای هر آیتم مسیر کاری مستقل یا subdirectory build context را به‌صورت قابل اتکا مشخص نمی‌کنند. در نتیجه اتصال مستقیم یک monorepo به چند آیتم Runflare می‌تواند باعث شود هر آیتم context اشتباه یا کل پروژه را دریافت کند.

## گزینه‌های بررسی‌شده

1. یک monorepo و اتصال مستقیم همان repository به چند آیتم Runflare با مسیرهای متفاوت.
2. یک repository مستقل برای هر سرویس از ابتدای پروژه.
3. یک source monorepo به‌عنوان منبع حقیقت و یک deployment repository تولیدشده برای هر آیتم قابل استقرار.
4. استفاده از Git submodule یا nested repository برای شبیه‌سازی جداسازی سرویس‌ها.

## تصمیم

گزینه‌ی ۳ انتخاب می‌شود:

- source monorepo محل توسعه، قراردادها، تست‌ها و review است.
- برای هر آیتم قابل استقرار Runflare یک deployment repository مستقل تولید می‌شود. این نگاشت اولیه بعداً با دو bundle repository طبق ADR-0016 supersede شد.
- ریشه‌ی deployment repository باید context کامل و مستقل سرویس را داشته باشد؛ برای NodeJS package.json و برای Docker Dockerfile در ریشه قرار می‌گیرد.
- مسیر هدف GitHub Actions با path filter تغییرات را بررسی می‌کند، سرویس اثرپذیرفته را build/test و snapshot می‌کند و خروجی را به deployment repository مربوط push می‌کند. تا زمان آماده‌شدن این pipeline، همین کار به‌صورت controlled snapshot release از source و با fetch/divergence check، commit مستقل و push non-force انجام می‌شود.
- هر آیتم Runflare فقط به deployment repository خودش، branch مشخص و Auto Pull/webhook همان repository متصل می‌شود.
- deployment repository خروجی pipeline است و نباید محل توسعه‌ی دستی یا منبع حقیقت باشد.
- Git submodule و nested repository برای این هدف استفاده نمی‌شود.

## نگاشت اولیه — تاریخی، superseded توسط ADR-0016

| آیتم                 | مسیر source               | deployment repository پیشنهادی      |
| -------------------- | ------------------------- | ----------------------------------- |
| وب‌اپ مشتری          | apps/customer-web         | funtino-deploy-customer-web         |
| پنل مجموعه و شعب     | apps/operations-web       | funtino-deploy-operations-web       |
| پنل سیستمی           | apps/system-web           | funtino-deploy-system-web           |
| API Gateway          | apps/api-gateway          | funtino-deploy-api-gateway          |
| Realtime Gateway     | apps/realtime-gateway     | funtino-deploy-realtime-gateway     |
| Device Worker        | apps/device-worker        | funtino-deploy-device-worker        |
| Notifications Worker | apps/notifications-worker | funtino-deploy-notifications-worker |

PostgreSQL، RabbitMQ و Redis سرویس‌های داده‌ای Runflare هستند و deployment repository ندارند.

## پیامدها

### مزایا

- context ریشه‌ی هر deployment برای Runflare صریح و قابل آزمون است.
- Auto Pull هر سرویس مستقل می‌ماند و push یک سرویس، سرویس نامرتبط را redeploy نمی‌کند.
- source monorepo، اشتراک packageها و قراردادها، review یکپارچه و path ownership را حفظ می‌کند.
- commit منبع، commit تولید deployment و commit مستقرشده قابل ردیابی می‌شوند.

### هزینه‌ها و محدودیت‌ها

- pipeline باید snapshot مستقل تولید و به چند repository push کند.
- تغییر package یا contract مشترک می‌تواند چند deployment را تحت تأثیر قرار دهد و باید در path-impact matrix ثبت شود.
- برای deployment repositoryها باید دسترسی GitHub و webhook/Auto Pull جداگانه مدیریت شود.
- rollback باید با revert یا snapshot قبلی انجام شود و همراه با migration gate باشد.

## قوانین اجرایی

- توسعه‌ی feature و ویرایش مستقیم انسانی در deployment repository ممنوع است؛ push controlled snapshot تولیدشده از source، وقتی pipeline در دسترس نیست و کاربر انتشار را خواسته است، مجاز است.
- پیش از هر push باید remote همان clone fetch و `git rev-list --left-right --count HEAD...origin/main` برابر `0 0` باشد؛ non-fast-forward، force-push و حذف تغییرات موجود ممنوع است.
- اگر source monorepo remote نداشته باشد، نبود source commit باید گزارش شود و deployment commit نباید به‌عنوان source commit معرفی شود.
- secretهای runtime در Environment/Secret Runflare نگهداری می‌شوند و وارد source یا deployment repository نمی‌شوند.
- branch استقرار هر deployment repository باید پایدار و مشخص باشد؛ پیشنهاد پایه main است.
- قبل از فعال‌سازی production، برای هر آیتم یک deploy آزمایشی، redeploy خودکار، health check و rollback تمرین می‌شود.
- اگر Runflare در آینده working directory مستقل را به‌صورت مستند و قابل استفاده ارائه کرد، گزینه‌ی اتصال مستقیم monorepo فقط پس از آزمون محیطی و ثبت ADR جایگزین بررسی می‌شود.

## برنامه‌ی گذار و بازگشت

1. ایجاد source monorepo و تعریف مالکیت مسیرها.
2. ساخت اولین deployment repository برای customer-web و آزمون end-to-end.
3. فعال‌سازی Auto Pull پس از تأیید root، branch، webhook و health check.
4. تکرار الگو برای سایر web appها، gatewayها و workerها.
5. در صورت شکست pipeline، آخرین commit معتبر deployment repository حفظ می‌شود و redeploy از همان commit یا snapshot قبلی انجام می‌گیرد.

## مستندات مرتبط

- [راهبرد Repository و استقرار Runflare](../RunflareRepositoryAndDeployment.md)
- [ساختار فولدر و فایل](../FolderAndFileStructure.md)
- [قوانین پیاده‌سازی](../ImplementationRules.md)
- [قوانین عامل پروژه](../../AGENTS.md)
- [قانون canonical commit/push و انتشار](../CommitPushAndDeploymentWorkflow.md)

## منابع رسمی Runflare

- [اتصال GitHub و Auto Pull](https://runflare.com/docs/ci-cd-setup/how-to-add-github/)
- [استقرار NodeJS با CLI](https://docs.runflare.com/nodejs/nodejs-deploy-cli/)
- [ریشه‌ی استقرار CLI](https://runflare.com/docs/work-with-cli/delete-deploy-root/)
