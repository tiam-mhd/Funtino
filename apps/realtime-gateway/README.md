# Funtino Realtime Gateway

این سرویس فقط projection زنده را از RabbitMQ به Socket.IO می‌رساند. داده‌ی اولیه همیشه از API Gateway خوانده می‌شود و reconnect باید refetch انجام دهد. هیچ ledger، موجودی یا تصمیم مجوزی در این سرویس نگه‌داری نمی‌شود.

احراز هویت handshake با `auth.sessionToken` انجام می‌شود و Gateway برای اعتبارسنجی آن به endpoint `GET /api/v1/auth/me` در API Gateway درخواست می‌زند.
