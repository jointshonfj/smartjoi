# Vinylor Hub

Interní automatizační aplikace Vinylor.cz. Běží na **GitHub Pages**, data jsou v **Supabase**
(projekt „vinylor-pickapp“, tabulky `hub_*`, `offers`, `offer_*`).

Moduly: **Nabídky**, **Naskladnění**, **Návštěvnost**, **Nástěnka**. Zabezpečení: viz [SECURITY.md](SECURITY.md) (2FA povinné).

**Modul 01 – Nabídky:** nabídky z produktů e-shopu → PDF ve stylu Gaviko Group,
stavy (Koncept, Odeslána, Odložena, Překlopena do Shoptetu, Zamítnuta), interní komentáře.

```
index.html, app.js, app.css, calc.js, pdf.js, guard.js, config.js, img/, vendor/   ← web (GitHub Pages)
supabase/schema.sql, supabase/security.sql                   ← databáze + zabezpečení (RLS, 2FA)
supabase/cron.sql                                            ← načítání produktů každou hodinu
supabase/functions/hub-products-sync/index.ts                ← stahování CSV produktů ze Shoptetu
supabase/functions/hub-admin/index.ts                        ← správa uživatelů (jen správce)
```

## Uživatelé
- Přihlášení: e-mail + heslo + kód z ověřovací aplikace (2FA). První heslo je dočasné, aplikace si vynutí změnu a nastavení 2FA.
- Správce (Filip) v **Můj účet** přidává uživatele, generuje nová hesla, resetuje 2FA, odhlašuje ze všech zařízení a umí přístup zablokovat.

## Jak to funguje
- Produkty: Edge Function stáhne CSV export ze Shoptetu každou hodinu (nebo tlačítkem v Nastavení).
- Ceny v e-shopu jsou s DPH, v PDF bez DPH zaokrouhlené na 0,10 Kč (jako Pohoda) — lze změnit v Nastavení.
- PDF se vytváří přímo v prohlížeči (pdfmake), funguje i na telefonu.
- Nabídky se ukládají automaticky; když dva lidé upraví stejnou nabídku, druhý dostane upozornění.
