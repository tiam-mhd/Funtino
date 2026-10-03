# Notifications Worker

این worker رویدادهای `notifications.notification-requested.v1` را از RabbitMQ مصرف می‌کند، با Inbox در حافظه جلوی پردازش تکراری را می‌گیرد و provider پیامک/اعلان را پشت interface نگه می‌دارد. در production باید Inbox و وضعیت ارسال به PostgreSQL منتقل و provider واقعی در environment تنظیم شود.
