# Funtino API Gateway

مرز عمومی REST فانتینو برای سه وب‌اپ است. Gateway جریان OTP/session و BFFهای امن سازمان/شعبه، IAM، کارکنان، دستگاه، کارت/تخصیص خانوار و گزارش عملیاتی را به ownerهای مستقل متصل می‌کند؛ نقش و scope روی سرور بازاعتبارسنجی می‌شوند. داده‌های مالی یا سلامت سخت‌افزاریِ بدون منبع معتبر نمایش داده نمی‌شوند.

## اجرا

```bash
pnpm --filter @funtino/api-gateway prisma:generate
pnpm --filter @funtino/api-gateway dev
```

Prisma Client تولیدشده‌ی این app در `generated/prisma/` قرار می‌گیرد و عمداً gitignored است. build، typecheck و test پیش از اجرا آن را از schema همین app می‌سازند؛ migration دیتابیس جداگانه اجرا می‌شود.

بدون `DATABASE_URL` سرویس با `STORAGE_MODE=memory` برای توسعه‌ی امن اجرا می‌شود. در محیط staging/production باید `STORAGE_MODE=postgres`، migration و secretهای واقعی تنظیم شوند.

## endpointهای پایه

- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/auth/otp/request`
- `POST /api/v1/auth/otp/verify`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/operations/mfa/status`
- `POST /api/v1/operations/mfa/enrollment/start`
- `POST /api/v1/operations/mfa/enrollment/confirm`
- `POST /api/v1/operations/mfa/step-up/verify`
- `POST /api/v1/operations/mfa/recovery-codes/regenerate`
- `POST /api/v1/operations/mfa/disable`
- `GET /api/v1/customer/profile`
- `PATCH /api/v1/customer/profile`
- `GET /api/v1/customer/profile/avatar`
- `POST /api/v1/customer/profile/avatar` (multipart field: `file`, JPEG/PNG/WebP, max 2 MB)
- `GET /api/v1/customer/home`
- `GET /api/v1/customer/branches`
- `GET /api/v1/customer/households`
- `POST /api/v1/customer/households`
- `POST /api/v1/customer/households/:householdId/members`
- `GET /api/v1/customer/cards`
- `POST /api/v1/customer/cards/link`
- `GET /api/v1/customer/wallets/:walletId/summary`
- `GET /api/v1/customer/wallets/:walletId/transactions`
- `GET /api/v1/customer/missions`
- `POST /api/v1/customer/missions/:missionId/claim`

ثبت‌نام با OTP فقط حساب کاربری را ایجاد/بازیابی می‌کند و هیچ شعبه‌ای به کاربر تخصیص نمی‌دهد. برای اتصال کارت، `branchId` الزامی است؛ شعبه‌ی مشتری از کارت‌های متصل‌شده به خانواده استخراج می‌شود.

## Parsgreen OTP

آداپتر `ParsGreenOtpSender` از REST API پارس‌گرین استفاده می‌کند: `POST https://sms.parsgreen.ir/Apiv2/Message/SendOtp` با هدر `Authorization: basic apikey:<token>` و بدنه‌ی JSON شامل `Mobile`، `SmsCode`، `TemplateId` و `AddName`. مقدار `PARSGREEN_API_TOKEN` عمداً در repository خالی می‌ماند و باید در Secretهای Runflare قرار بگیرد. endpoint، نام header، شناسه‌ی قالب و timeout با متغیرهای `PARSGREEN_OTP_URL`، `PARSGREEN_AUTH_HEADER`، `PARSGREEN_OTP_TEMPLATE_ID` و `PARSGREEN_REQUEST_TIMEOUT_MS` قابل تنظیم‌اند؛ مقدار `PARSGREEN_AUTH_HEADER` در production باید `Authorization` باشد و شناسه‌ی قالب باید با حساب Parsgreen تطبیق داده شود. در production بدون token، درخواست OTP با خطای dependency رد می‌شود؛ در development بدون token، OTP محلی فقط در صورت `EXPOSE_DEV_OTP=true` قابل مشاهده است.

اگر provider بعد از ارسال احتمالی SMS در مهلت تعیین‌شده پاسخ ندهد، پاسخ OTP با `deliveryStatus: "unknown"` و challenge معتبر برمی‌گردد تا کاربر به صفحه‌ی ورود کد برسد. در این حالت retry خودکار مجاز نیست؛ کاربر فقط پس از cooldown می‌تواند ارسال دوباره را انتخاب کند تا SMS تکراری ناخواسته ایجاد نشود. خطای احراز هویت، قالب یا پاسخ business ناموفق همچنان شکست واقعی محسوب می‌شود.

## Profile storage

اطلاعات تکمیلی پروفایل در `users` نگهداری می‌شود و تصویر کوچک پروفایل در جدول `user_avatars` به‌صورت bytea ذخیره می‌شود تا containerهای Runflare به filesystem محلی وابسته نباشند. انتخاب آواتار preset تصویر قبلی را پاک می‌کند و بارگذاری تصویر، preset را پاک می‌کند.

OTP واقعی، payment provider و سامانه‌ی RFID عمداً پشت adapter باقی مانده‌اند؛ تا قرارداد عملیاتی آن‌ها از فاز G0 تأیید نشود، فعال‌سازی مالی یا نمایش موجودی قطعی مجاز نیست.
