# Vydání nové verze

Při každé změně, která jde na GitHub:
1. **`version.js`**: zvyš `APP_VERSION`, uprav `APP_BUILD` (datum) a přidej záznam nahoru do `CHANGELOG`.
2. **`index.html`**: stejné číslo dej do `?v=…` u `app.css`, `calc.js` a `app.js` (kvůli mezipaměti prohlížeče).
3. Nahraj **celý obsah složky `online`** na GitHub (Add file → Upload files → Commit).
4. Do 10 minut (nebo při návratu do okna) se u všech otevřených uživatelů objeví hláška „Je dostupná nová verze → Obnovit“.

**Číslování:** `0.x.0` = beta (nové aplikace a větší změny zvyšují druhé číslo), `0.x.y` = drobné opravy.
Kanál: `beta` (ladí se), `rc` (kandidát na ostrou), prázdný = ostrá verze. `1.0.0` vyjde, až bude napojený Shoptet a vše ověřené.

Verzi uvidí každý v levém menu (klik = seznam změn). Do bezpečnostního deníku se při přihlášení zapisuje, na jaké verzi kdo běží.
