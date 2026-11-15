# Tulpar в Microsoft Store

Store бесплатно регистрирует частных разработчиков и **сам подписывает** пакет MSIX —
поэтому у пользователей не будет окна SmartScreen, а обновления придут через Store.

## 1. Регистрация (один раз, делаете вы)

1. Откройте https://storedeveloper.microsoft.com → **Get started for free** → **Individual developer**.
2. Войдите личным аккаунтом Microsoft, пройдите проверку: удостоверение личности + селфи.
3. Дождитесь подтверждения (бывает от нескольких минут до пары дней).

## 2. Карточка приложения

1. Partner Center → **Apps and games** → **New product** → **MSIX or PWA app**.
2. Зарезервируйте имя **Tulpar** (если занято — например, «Tulpar Code»).
3. Откройте **Product management → Product identity** и выпишите три значения:
   - `Package/Identity/Name` — например `12345Artur.Tulpar`
   - `Package/Identity/Publisher` — начинается с `CN=`
   - `Package/Properties/PublisherDisplayName` — ваше имя

## 3. Сборка пакета

На своём компьютере (нужен Windows SDK — ставится вместе с Visual Studio Build Tools, «Разработка на C++»):

```powershell
.\store\build-msix.ps1 -IdentityName "12345Artur.Tulpar" -Publisher "CN=…" -PublisherDisplayName "Artur"
```

Готовый файл появится в `store\out\Tulpar_0.x.y.0_x64.msix`. **Не подписывайте его** — Store подпишет сам.

Проверить пакет у себя до отправки можно только с тестовым сертификатом — обычно этот шаг пропускают
и сразу отправляют в Store: там его проверят автоматически.

## 4. Первая отправка (руками)

В карточке приложения: **Start your submission** →
- **Pricing and availability** — бесплатно, все рынки;
- **Properties** — категория «Developer tools»;
- **Age ratings** — анкета (ответы «нет»);
- **Packages** — перетащите `.msix`;
- **Store listings** — описание и скриншоты (минимум один, 1366×768 или больше);
- **Submission options** — в поле для проверяющих напишите, что `runFullTrust` нужен редактору кода для терминала и запуска программ.

Отправка проверяется обычно 1–3 рабочих дня.

## 5. Дальше — автоматически через GitHub

Когда GitHub Actions снова работают:

1. В репозитории: **Settings → Secrets and variables → Actions → Variables** — добавьте
   `STORE_IDENTITY_NAME`, `STORE_PUBLISHER`, `STORE_PUBLISHER_NAME` (значения из шага 2).
   Теперь каждый тег `v*` собирает `.msix` (его можно скачать в разделе Actions → Artifacts).
2. Чтобы GitHub сам отправлял версию в Store, нужен доступ к API Partner Center
   (Partner Center → **Account settings → User management → Microsoft Entra applications**).
   Добавьте переменную `STORE_PRODUCT_ID` (Store ID приложения, вида `9N…`) и секреты
   `STORE_TENANT_ID`, `STORE_SELLER_ID`, `STORE_CLIENT_ID`, `STORE_CLIENT_SECRET`.
   Этот шаг необязательный — можно и дальше загружать `.msix` руками.

## Что отличается в версии из Store

- Проверка обновлений через GitHub выключена — обновляет Store.
- Настройки и данные лежат там же, где обычно (Windows перенаправляет их в папку пакета).
