# ساختار فولدر و فایل پروژه فانتینو

## ۱. اصل ساختار

مخزن باید monorepo با مرزهای روشن داشته باشد. سه بستر رابط کاربری، API Gateway، Gateway بلادرنگ و سرویس‌های دامنه مرز کد، process، قرارداد و چرخه‌ی تست مستقل دارند؛ انتشار آن‌ها در دو runtime bundle (frontend و backend) انجام می‌شود. packageهای مشترک فقط برای قرارداد، UI، ابزار فنی و configuration هستند.

منطق کسب‌وکار نباید برای راحتی بین سه وب‌اپ یا package عمومی کپی شود. مالکیت منطق در سرویس دامنه و مالکیت تجربه در بستر مربوط باقی می‌ماند.

این ساختار از اولین commit کد لازم‌الاجرا است، نه یک مقصد برای refactor پایانی. کد هر web app باید از ابتدا زیر `apps/<app-name>/src/` ایجاد شود؛ مسیرهای `apps/<app-name>/app/`، `components/` و `lib/` در ریشه‌ی app مجاز نیستند. پیش از هر پیاده‌سازی، ساختار واقعی repository باید با این سند تطبیق داده شود و هر استثنا پیش از کدنویسی در ADR ثبت شود.

## ۲. ساختار ریشه

    AGENTS.md
    README.md
    package.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    turbo.json
    tsconfig.base.json
    eslint.config.mjs
    prettier.config.mjs
    .editorconfig
    .gitignore
    .prettierignore
    .env.example
    apps/
    services/
    packages/
    contracts/
    infra/
      monitoring/
        prometheus/
          alerts/
        alertmanager/
        grafana/
          dashboards/
          provisioning/
        targets/
          examples/
      rabbitmq/
      runflare-bundles/
        frontend/
        backend/
    scripts/
      deployment/
        export-runflare-bundles.mjs
      runtime-bundle/
        supervisor.mjs
        healthcheck.mjs
        frontend.processes.json
        backend.processes.json
    tests/
    DOCS/
      decisions/
      runbooks/
    .github/
      workflows/

فایل‌های پیکربندی ریشه فقط configuration مشترک هستند و نباید به محل منطق محصول تبدیل شوند.

## ۲.۱ ساختار repository و استقرار Runflare

repository اصلی در ریشه‌ی `Funtino`، monorepo منبع توسعه و ورودی GitNexus است. مسیرهای apps، services، packages و contracts در همین repository قرار می‌گیرند. دو deployment repository خروجی self-contained همین منبع‌اند و کنار source قرار می‌گیرند.

deployment repositoryها در GitHub repositoryهای مستقل و هم‌سطح source repository هستند؛ داخل مسیر funtino و به‌عنوان submodule یا nested repository قرار نمی‌گیرند.

نگاشت اجرایی دو runtime در [CommitPushAndDeploymentWorkflow.md](CommitPushAndDeploymentWorkflow.md) canonical است. cloneهای deployment sibling زیر `D:\Tiam\Projects\Mohammadiig\Funtino-deployments` هستند و فقط دو خروجی زیر را نگه می‌دارند:

| runtime bundle | source scope | deployment repository | پردازه‌ها |
|---|---|---|---|
| Frontend | سه web app و `packages/design-system` | `funtino-frontend-runtime` | Customer :3000، Operations :3001، System :3002 |
| Backend | دو gateway، هفت service، `backend-core`، `event-contracts` و runner migration | `funtino-backend-runtime` | API :4000، Realtime :4010، Device :4020، Notifications :4030، IAM :4040، Organization :4050، Analytics :4060، Wallet :4070، Customer :4080 |

`Funtino-platform.code-workspace` فقط نمای source و همین دو sibling deployment است. بازبودن چند folder در VS Code به‌معنای sync، commit مشترک یا push خودکار نیست. برای تشخیص repository مقصد و کنترل divergence از [قانون canonical انتشار](CommitPushAndDeploymentWorkflow.md) استفاده کن.

ساختار منطقی monorepo:

    funtino/
      apps/
        customer-web/
        operations-web/
        system-web/
        api-gateway/
        realtime-gateway/
      services/
      packages/
      contracts/
      infra/
        monitoring/
          prometheus/
            alerts/
          alertmanager/
          grafana/
            dashboards/
            provisioning/
          targets/
            examples/
      DOCS/
      .github/
        workflows/
          ci.yml
          quality-gates.yml

نمونه‌ی ساختار deployment repository:

    funtino-frontend-runtime/
      package.json
      pnpm-lock.yaml
      pnpm-workspace.yaml
      apps/customer-web/
      apps/operations-web/
      apps/system-web/
      packages/design-system/
      scripts/runtime-bundle/
      Dockerfile
      .dockerignore
      .env.example
      README.md

    funtino-backend-runtime/
      package.json
      pnpm-lock.yaml
      pnpm-workspace.yaml
      apps/api-gateway/
      apps/realtime-gateway/
      services/
      packages/backend-core/
      packages/event-contracts/
      scripts/runtime-bundle/
      scripts/worker-startup.mjs
      Dockerfile
      .dockerignore
      .env.example
      README.md

قواعد اجباری:

- Git submodule یا repository تو‌در‌تو برای appهای فانتینو ساخته نمی‌شود.
- deployment repository با pipeline تولید می‌شود و source of truth نیست.
- تا آماده‌شدن pipeline، snapshot تولیدشده از source می‌تواند با release کنترل‌شده commit/push شود؛ این با توسعه‌ی دستی feature داخل deployment repository تفاوت دارد.
- root هر deployment repository باید package.json یا Dockerfile اجرایی داشته باشد.
- deployment repository نباید برای build به مسیر محلی monorepo یا working directory مخفی وابسته باشد.
- shared package و contract مورد نیاز باید در snapshot بسته‌بندی یا به‌صورت package نسخه‌دار مصرف شود.
- هر runtime deployment repository به فقط یک آیتم Runflare و یک branch استقرار متصل می‌شود.
- چند process فقط از طریق manifest صریح و supervisor ریشه اجرا می‌شوند؛ خروج غیرمنتظره‌ی هر child کل container را fail می‌کند.
- processهای دامنه و appها همچنان مرز کد، مالک داده، پورت و environment allow-list مستقل دارند؛ هم‌گروه‌سازی فقط مرز image/Runflare را تغییر می‌دهد.
- در snapshotهای فعلی، Dockerfile و `.dockerignore` باید در root هر deployment repository باشند؛ build context همیشه همان root است.
- Dockerfile باید نصب package manager، install قفل‌شده، build، port، health check و start را مشخص کند؛ این مراحل نباید به commandهای مخفی پنل یا مسیر parent وابسته باشند.
- تغییر shared package یا contract باید runtime bundle مصرف‌کننده را کامل تولید کند؛ تغییر shared frontend، backend یا contract مشترک ممکن است هر دو bundle را اثرپذیر کند.
- پیش از هر push، clone باید fetch شود و `git rev-list --left-right --count HEAD...origin/main` مقدار `0 0` بدهد؛ force-push و حذف تغییرات موجود ممنوع است.
- جزئیات path filter، branch، webhook و rollback در [RunflareRepositoryAndDeployment.md](RunflareRepositoryAndDeployment.md) است.

## ۳. برنامه‌ها و سرویس‌ها

    apps/
      customer-web/
        src/
        public/
        tests/
      operations-web/
        src/
        public/
        tests/
        Dockerfile
        package.json
      system-web/
        src/
        public/
        tests/
        Dockerfile
        package.json
      api-gateway/
        src/
        tests/
        generated/prisma/  # build-generated, gitignored, schema owned by this app
        Dockerfile
        package.json
      realtime-gateway/
        src/
        tests/
        Dockerfile
        package.json

    services/
      identity-access/
      organization-branch/
      customer-household/
      wallet/
      payment-orders/
      device-integration/
      loyalty-crm/
      notifications/
      analytics-read-model/

هر service فولدرهای استاندارد خود را دارد و نباید با import داخلی از service دیگر وابسته شود.

در هر Worker دارای startup migration طبق ADR-0015، `prisma/schema.prisma` و migrationهای نسخه‌دار زیر `prisma/` همان سرویس باقی می‌مانند؛ `prisma/bootstrap.prisma` فقط برای اتصال به schema موجود `public` هنگام اجرای `CREATE SCHEMA` است و دیتامدل/لیست schemaهای Worker را جایگزین نمی‌کند. در `services/organization-branch/`، API خصوصی در `src/interfaces/http/`، use caseها در `src/application/`، relay در `src/infrastructure/messaging/outbox/` و CLI انتقال در `src/bootstrap/` قرار می‌گیرد. قراردادها در `contracts/openapi/` و `contracts/events/` نسخه‌بندی می‌شوند؛ Gateway فقط client داخلی مصرف می‌کند و نباید Prisma client این سرویس را import کند.

## ۴. packageهای مشترک

    packages/
      design-system/
        src/
          components/
          tokens/
          patterns/
          icons/
          styles/
        tests/
      api-client/
      auth-client/
      event-contracts/
      backend-core/
        src/
          observability/
        tests/
      openapi-types/
      config/
      logger/
      observability/
      validation/
      test-utils/

قواعد package مشترک:

- design-system فقط component و token عمومی دارد؛ منطق خانواده، Wallet یا شعبه در آن ممنوع است.
- api-client از OpenAPI تولید یا براساس قرارداد نگه‌داری می‌شود؛ typeهای API در سه app دستی تکرار نمی‌شوند.
- event-contracts تنها schema، envelope، version و validator رویدادها را نگه می‌دارد؛ handler در این package ممنوع است.
- backend-core زیرساخت فنی مشترک backendها را نگه می‌دارد؛ utilityهای observability در آن مجازند، اما منطق دامنه یا مالکیت داده‌ی هیچ سرویسی به آن منتقل نمی‌شود.
- `contracts/openapi/gateway.yaml` مرجع سطح عمومی است؛ OpenAPI هر سرویس فقط API داخلی همان مالک را تعریف می‌کند و endpoint داخلی به مرورگر یا public ingress وصل نمی‌شود.
- auth-client فقط ابزار اتصال رابط به auth و session است؛ مجوز دامنه در سرور باقی می‌ماند.
- config و logger وابستگی business ندارند.
- package عمومی باید API مشخص و export محدود داشته باشد؛ import از فایل داخلی package ممنوع است.

## ۵. ساختار customer-web

    apps/customer-web/src/
      app/
        [locale]/
          (public)/
            page.tsx
            branches/
            attractions/
            campaigns/
          (auth)/
            login/
            verify-otp/
          (customer)/
            layout.tsx
            home/
            cards/
            missions/
            family/
            account/
              profile/
        api/
        error.tsx
        loading.tsx
        not-found.tsx
      features/
        branch-discovery/
        wallet/
        family/
        missions/
        notifications/
        support/
      components/
        app-shell/
        bottom-navigation/
        feedback/
      lib/
        api/
        auth/
        realtime/
        analytics/
      styles/
      content/
      tests/

قواعد customer-web:

- route فقط composition و اتصال به feature است؛ منطق دامنه در route page پراکنده نمی‌شود.
- مسیرهای عمومی با داده‌ی کم‌خطر کار می‌کنند؛ داده‌ی خانواده و Wallet فقط پس از auth و scope.
- bottom navigation از design token مشترک استفاده می‌کند و در صفحات عمیق وضعیت فعال خود را حفظ می‌کند.
- cache client نباید موجودی را حقیقت فرض کند؛ زمان sync و وضعیت stale همیشه حفظ شود.
- componentهای مأموریت، کارت و خانواده حالت‌های loading، empty، error و disabled داشته باشند.
- عملیات مالی با CTA و confirmation مناسب از مأموریت و محتوای تبلیغاتی جدا بماند.

## ۶. ساختار operations-web

    apps/operations-web/src/
      app/
        [locale]/
          (auth)/
            login/
            verify-otp/
          (workspace)/
            layout.tsx
            dashboard/
            cashier/
              card-lookup/
              card-link/
              top-up/
              receipts/
            branch/
              hours/
              attractions/
              devices/
              products/
              pricing/
            campaigns/
            crm/
            reports/
      features/
        branch-scope/
        staff-access/
        cashier/
        devices/
        products-pricing/
        campaigns/
        reports/
      components/
        workspace-shell/
        tables/
        forms/
        confirmation/
      lib/
        api/
        auth/
        permissions/
        realtime/
      tests/

قواعد operations-web:

- scope فعال سازمان/شعبه در header و navigation همیشه قابل مشاهده باشد.
- هیچ action عملیاتی فقط با مخفی‌کردن دکمه محدود نمی‌شود؛ API مجوز را بررسی می‌کند.
- جدول‌ها filter، sort، pagination، empty و error مشخص دارند.
- عملیات شارژ، برگشت و اصلاح باید reason، confirmation و status قابل‌پیگیری داشته باشند.
- عملیات پرتکرار صندوق برای keyboard و شبکه‌ی ضعیف بهینه شود.
- data table و form از componentهای اختصاصی و قابل تست استفاده کنند؛ query مستقیم در component عمومی ممنوع است.

## ۷. ساختار system-web

    apps/system-web/src/
      app/
        [locale]/
          (auth)/
            login/
            mfa/
              page.tsx
          (console)/
            layout.tsx
            overview/
            organizations/
            branches/
            users/
            memberships/
            roles/
            integrations/
            system-health/
            audit/
            feature-flags/
            support/
      features/
        organizations/
        access-control/
        integrations/
        audit/
        health/
        support/
      components/
        system-shell/
        permission-matrix/
        audit-table/
        danger-zone/
      lib/
        api/
        auth/
        permissions/
        audit/
      tests/

قواعد system-web:

- scope و نقش فعلی در همه‌ی صفحات مدیریتی آشکار باشد.
- تغییر نقش، حذف اتصال، impersonation، برگشت یا تغییر feature flag نیازمند تأیید مجدد و audit است.
- صفحه‌ی system-health برای مشاهده است؛ restart یا عملیات زیرساختی حساس پشت permission جدا باشد.
- داده‌ی خام secret، token provider یا credential در رابط نمایش داده نمی‌شود.
- پنل سیستمی با density بالاتر ساخته می‌شود، اما خوانایی، focus و خطای قابل‌اقدام حفظ می‌شود.
- قابلیت پایش در `features/health/` و route مجاز `app/[locale]/(console)/system-health/` قرار می‌گیرد؛ دریافت telemetry فقط از Gateway و پس از مجوز سراسری IAM انجام می‌شود.

## ۸. ساختار هر سرویس دامنه

    services/<service-name>/
      src/
        domain/
          entities/
          value-objects/
          aggregates/
          policies/
          services/
          events/
        application/
          commands/
          queries/
          handlers/
          ports/
          dto/
        infrastructure/
          persistence/
            prisma/
            repositories/
            migrations/
          messaging/
            outbox/
            inbox/
            publishers/
            consumers/
          providers/
          configuration/
        interfaces/
          http/
            controllers/
            presenters/
            guards/
          consumers/
          health/
        bootstrap/
      tests/
        unit/
        integration/
        contract/
      package.json
      Dockerfile
      README.md

قواعد سرویس:

- domain به framework، ORM، HTTP یا RabbitMQ وابسته نیست.
- application use case و transaction boundary را هدایت می‌کند.
- infrastructure جزئیات PostgreSQL، RabbitMQ و providerها را پیاده می‌کند.
- interfaces فقط ورودی/خروجی را مدیریت می‌کند و منطق دامنه در آن قرار نمی‌گیرد.
- migration هر سرویس جدا ثبت و اجرا می‌شود.
- `scripts/worker-startup.mjs` ابزار استقرار ریشه است، نه منطق دامنه؛ فقط Docker پنج Worker نام‌برده در ADR-0015 آن را برای migration پیش از start اجرا می‌کند.
- ماژول‌های organization/branch، identity/authorization، device registry و card assignment در service مالک خود و زیر ساختار فوق قرار می‌گیرند؛ انتقال owner موجود در Gateway مرحله‌ای و با backfill/compatibility plan است.
- permission catalog و evaluator در `services/identity-access/src/domain/` و use caseهای role/assignment/override زیر `application/` قرار می‌گیرند؛ gateway و web فقط contract و client مصرف می‌کنند.
- پورت اعتبارسنجی scope در IAM زیر `services/identity-access/src/application/ports/` و client خصوصی owner زیر `services/identity-access/src/infrastructure/organization-branch/` قرار می‌گیرد؛ Identity Access implementation سرویس Organization & Branch را import نمی‌کند و فقط OpenAPI/HTTP داخلی را مصرف می‌کند.
- controllerهای عمومی در `apps/api-gateway/src/interfaces/http/` و internal clientهای مالکانه زیر `apps/api-gateway/src/infrastructure/` قرار می‌گیرند؛ هیچ app به Prisma/schema سرویس دیگر import نمی‌کند.
- تست‌های policy (deny, delegation, tenant isolation, revocation) در `services/identity-access/tests/` و تست‌های contract در `contracts/` یا پوشه‌ی contract همان سرویس جای می‌گیرند.
- repository یک سرویس هرگز برای جدول سرویس دیگر ساخته نمی‌شود.

## ۹. قراردادها

    contracts/
      openapi/
        gateway.yaml
        identity/
        customer/
        wallet/
        operations/
      events/
        common/
        identity/
        wallet/
        payment/
        device/
        loyalty/
        notifications/
      asyncapi/
        events.yaml
      changelog/

قواعد قرارداد:

- هر endpoint صاحب مشخص، مثال معتبر و error response دارد.
- هر event type نسخه، schema، producer، consumer و سیاست deprecation دارد.
- تغییر breaking بدون نسخه‌ی جدید و برنامه‌ی migration ممنوع است.
- فایل قرارداد منبع typeهای مشترک است؛ type دستی در appها کپی نمی‌شود.

## ۱۰. تست و مستندات در ساختار

- تست واحد نزدیک domain و application قرار می‌گیرد.
- تست integration کنار adapter یا در tests/integration قرار می‌گیرد.
- تست contract برای OpenAPI و event schema اجباری است.
- تست E2E سه بستر در tests/e2e نگه‌داری می‌شود و مسیر کسب‌وکار را می‌سنجد.
- snapshot بصری فقط برای componentهای پایدار و با دلیل استفاده شود.
- مستند feature یا ADR در DOCS/decisions یا کنار قرارداد مربوط قرار می‌گیرد.

## ۱۱. نام‌گذاری

- فولدرها و فایل‌های عمومی kebab-case.
- componentهای React با PascalCase در export و نام فایل متناسب با convention پروژه.
- hook با use شروع شود؛ provider و adapter نام دقیق نقش خود را داشته باشند.
- test با پسوند test یا spec و نام رفتار نوشته شود.
- نام event در زمان گذشته و domain-specific باشد، نه چیزی مانند DataUpdated.
- نام database column و API field طبق قرارداد همان لایه است؛ mapping در adapter انجام می‌شود.
- فولدر utils عمومی ممنوع است؛ utility باید محل و مسئولیت مشخص داشته باشد.

## ۱۲. قوانین import و وابستگی

جهت وابستگی مجاز:

    UI route → feature → package/adapter
    interfaces → application → domain
    infrastructure → application ports/domain
    service → contracts/packages عمومی

- domain به لایه‌ی بیرونی import نمی‌کند.
- feature از feature دیگر فقط از public API آن استفاده می‌کند.
- appها از service implementation import نمی‌کنند؛ از client و contract استفاده می‌کنند.
- package مشترک نباید به app یا service وابسته باشد.
- circular dependency باید خطای build یا lint باشد.

## ۱۳. فایل‌های محیطی و دارایی

- .env.example فقط نام متغیرها و مقدار نمونه‌ی بی‌خطر دارد.
- secret واقعی در repository، log، error response یا screenshot ممنوع است.
- عکس و icon در public فقط با نام، منبع و وضعیت مجوز مشخص ذخیره می‌شود.
- فایل کاربر در public یا filesystem موقت سرویس ذخیره نمی‌شود؛ object storage استفاده می‌شود.
- هر asset دارای alt یا دلیل decorative بودن است.
