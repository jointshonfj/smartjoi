# SmartJoi

Interní aplikace Jointshon | FJ. Běží na **GitHub Pages**, data jsou v **Supabase**.

**Aplikace 01 – OrderJoi (objednávky od dodavatelů):** načítá objednávky ze Shoptetu ve stavu
„Potřeba objednat“, ukáže, co a u koho objednat, a připraví e-mail dodavateli v angličtině.

**Aplikace 03 – StockJoi:** sklad — více skladů, kategorie, skladové položky, naskladnění / vyskladnění / přesuny / inventura, historie pohybů a upozornění pod minimem.

**Aplikace 04 – DocházkoBot:** docházka 9 zaměstnanců. Do záložky zaměstnance se nahrají PDF z docházkového systému
(úprava záznamů + měsíční výkaz), aplikace spočítá zaokrouhlení, oběd, přesčasy, svátky a vytvoří Excel
„Evidence pracovní doby“ pro účetní (jeden list na zaměstnance).

**Aplikace 05 – StockUpdate 1.0:** po týdnech (každé pondělí) s historií — sklad dodavatele z PDF (teď Gunreben G2 Terrassen-Lagerliste, WPC prkna) + CSV export produktů ze Shoptetu → CSV pro import skladu do Shoptetu (sklad dodavatele mínus rezerva, výchozí 30 %). Párování: `partNumber` = kód artiklu, délka varianty = řádek „Länge“.

**Aplikace 06 – ReportJoi:** měsíční HTML reporty Vinylor.cz / Vinylor.sk (Supabase Storage, bucket `reports`, tabulka `reports`). Každý report má odkaz `#/reporty/cz/RRRR-MM`, zobrazuje se v izolovaném rámu (sandbox).

**Aplikace 07 – AutoPark 🚗:** evidence vozidel (tabulky `vehicles`, `vehicle_events`). Hlídá STK, dálniční známku, pojištění a olej (poslední „platí do“ za druh), termíny zapisuje do kalendáře SmartJoi (ref `auto:<vozidlo>:<druh>`). Ostatní servis (filtry, rozvody, brzdy, geometrie, pneu…) je historie.

**SmartJoiAI** (✦ vpravo dole): asistent na Google Gemini, umí pracovat se všemi aplikacemi; změny provede až po schválení.
Pamatuje si pravidla (Docházka → Přehled → „Co si SmartJoiAI pamatuje“).

**Aplikace 02 – EmailJoi:** často posílané e-maily (komu, kopie, předmět, text) připravené ke kopírování.
Co se mění, se píše do `{složených závorek}` a před kopírováním se jen doplní; `{datum}` se doplní samo.

```
index.html, app.js, app.css, config.js   ← web (GitHub Pages)
dochazka-core.js, dochazka-xlsx.js       ← DocházkoBot (výpočet + Excel)
stockupdate-core.js                      ← StockUpdate (čtení PDF dodavatele, CSV pro Shoptet)
supabase/schema.sql                      ← databáze
supabase/cron.sql                        ← automatické načítání každých 15 min
supabase/functions/shoptet-sync/index.ts ← stahování CSV ze Shoptetu
supabase/functions/assistant/            ← SmartJoiAI (klíč GEMINI_API_KEY v Edge Functions → Secrets)
```

---

## Stav nastavení

**Hotovo v Supabase (projekt „SmartJoi“):** databáze, zabezpečení, funkce `shoptet-sync`,
plánovač (každých 15 min), odkaz na CSV export a `config.js`.

### Zbývá udělat
1. **Uživatel:** Supabase → Authentication → Users → **Add user → Create new user** →
   e-mail + heslo, zaškrtni **Auto Confirm User**.
   Pak Authentication → Sign In / Providers → vypni **Allow new users to sign up**.
2. **Shoptet – export objednávek:** do šablony CSV exportu přidej sloupce **položek objednávky**
   (kód, název, množství, jednotka, typ položky). Teď export obsahuje jen hlavičky objednávek.
3. **Shoptet – stav „Potřeba objednat“:** vytvoř ho a nastavuj ho zaplaceným objednávkám,
   u kterých je potřeba objednat zboží. Případně v aplikaci v Nastavení vyber jiný stav.
4. **GitHub Pages:** nahraj obsah této složky do nového repozitáře →
   Settings → Pages → Deploy from a branch → `main` / root.
   Web poběží na `https://<tvuj-github>.github.io/<repozitar>/`.

**V telefonu:** v Safari otevři adresu → Sdílet → **Přidat na plochu**.

---

## Jak to funguje
1. **Objednávky** — každých 15 min se načtou objednávky ve stavu „Potřeba objednat“. V detailu objednávky
   zaškrtáváš, co objednáváš a u koho (odškrtnuté = neobjednává se), a píšeš poznámky.
2. **Připravit e-mail** — pro každého dodavatele v objednávce vznikne e-mail v angličtině (MPN, EN názvy).
3. **Odesláno** → AUF čeká na číslo od dodavatele.
4. **AUF** — vyplníš AUF číslo a částku v EUR, přiložíš dokumenty (potvrzení, proforma…).
5. **Svozy** — potvrzené AUFy zařadíš do svozu s datem; vidíš počet AUFů a součet v EUR.
   Termín se sám zapíše do **kalendáře SmartJoi**.
6. **Kalendář** (úvodní stránka) — jednou přidáš odkaz do Google Kalendáře („Z adresy URL“)
   a všechny termíny ze všech aplikací SmartJoi se tam zobrazují samy.

**Ruční objednávka** — když objednávka nepřišla přes Shoptet: Objednávky → „＋ Ruční objednávka“
(číslo / reference, zákazník, datum, poznámka, položky). Dál se s ní pracuje stejně (e-mail, AUF, svoz);
synchronizace se Shoptetem ji nemění. Dokud u ní není odeslaný e-mail, jde smazat.

Když objednávka ve Shoptetu změní stav, v SmartJoi zůstane i s rozpracovanými AUFy, dokud ji nearchivuješ.
