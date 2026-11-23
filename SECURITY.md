# Zabezpečení Vinylor Hubu

## Jak je aplikace chráněná
| Vrstva | Ochrana |
|---|---|
| Přihlášení | E-mail + heslo **a** 6místný kód z ověřovací aplikace (2FA, TOTP). Bez 2FA nejde přečíst ani řádek dat — vynucuje to přímo databáze (RLS vyžaduje `aal2`). |
| Účty | Registrace je vypnutá v Supabase **a** zablokovaná triggerem v databázi. Účty zakládá jen správce (Edge Function `hub-admin`, ověřuje roli i 2FA; databáze pustí jen e-mail s krátkodobou pozvánkou v tabulce `hub_invites`). |
| Hesla | Min. 12 znaků, písmena + číslice, ne jméno/e-mail/běžná slova. Dočasná hesla od správce mají 18 znaků a musí se hned změnit. |
| Relace | Na běžném zařízení končí zavřením prohlížeče, na „důvěryhodném“ zůstává. Po 2 h nečinnosti automatické odhlášení. „Odhlásit ze všech zařízení“ pro sebe i (správce) pro ostatní. |
| Ztracený telefon | Správce udělá **Reset 2FA** → uživatel se odhlásí všude a při dalším přihlášení si 2FA nastaví znovu. |
| Prohlížeč | Content-Security-Policy (spustí se jen vlastní skripty, připojení jen na Supabase a ARES), knihovny jsou přímo v repozitáři (`vendor/`), ochrana proti vložení do cizí stránky (`guard.js`), žádný referrer. |
| Přehled | Bezpečnostní deník (Můj účet → správce): přihlášení, 2FA, změny hesel, zakládání a blokace účtů. |
| Tajné klíče | V repozitáři ani v prohlížeči nejsou žádné tajné klíče. `config.js` obsahuje jen veřejný (publishable) klíč — data chrání RLS. |

## Shoptet API (napojeno od v0.8.0)
- API token Shoptetu je **jen** v Supabase → Edge Functions → **Secrets** (`SHOPTET_API_TOKEN`).
- Nikdy do tabulky, do `config.js`, do GitHubu ani do prohlížeče.
- Volat ho bude jen Edge Function, která ověří přihlášení s 2FA a roli a každé volání zapíše do bezpečnostního deníku.

## Checklist nasazení (jednorázově)
1. **GitHub účet**: zapni 2FA (Settings → Password and authentication). Kdo ovládne GitHub, může změnit kód aplikace.
2. **GitHub Pages**: Settings → Pages → zaškrtni **Enforce HTTPS**.
3. **Supabase účet**: zapni 2FA (Account → Security). Je to klíč od celé databáze.
4. **Supabase → Authentication**:
   - Sign In / Providers → *Allow new users to sign up* = **vypnuto** (už je).
   - Providers → Email → *Minimum password length* = **12**, *Password requirements* = **letters and digits**.
   - Multi-Factor → **TOTP zapnuto** (výchozí stav).
   - (placený tarif) *Leaked password protection* a *Session timeouts*.
5. Smaž soubor `PRVNI-HESLA-ONLINE.txt` z plochy — hesla v něm už neplatí, ale nemají se nikde válet.
6. Do GitHubu nahrávej **jen obsah složky `online`** (nikdy `lokalni-verze`, `.env` ani soubory s hesly).

### Naskladnění do Shoptetu — pojistky
- Volá se jen přes funkci `hub-shoptet` (přihlášení + 2FA + aktivní účet); každé naskladnění zapíše záznam do bezpečnostního deníku.
- Posílá se jen **přírůstek** (`amountChange`), nikdy absolutní přepsání skladu.
- Každá položka se před odesláním zamkne v tabulce `shoptet_stock_log` (jedna řádka = jedna položka příjemky), takže se nikdy nepošle dvakrát. Při výpadku spojení zámek zůstává a před opakováním je nutné zkontrolovat stav ve Shoptetu.
- Položky označené jako naskladněné (včetně importu z Excelu) se neposílají.

### Překlopení nabídky do objednávky — pojistky (v0.9.0)
- Volá se přes `hub-shoptet` (přihlášení + 2FA); do bezpečnostního deníku se zapisuje číslo nabídky, objednávky a obě částky.
- Funkce si nabídku načte sama z databáze (z prohlížeče nepřijímá ceny ani položky), takže ceny nejdou podvrhnout.
- Jedna nabídka = nejvýš jedna objednávka: před odesláním se zamkne v tabulce `shoptet_order_log`.
- Před odesláním se zkontroluje zákazník, položky a adresa; srozumitelné chyby se vrátí uživateli.
- E-mail zákazníkovi se z objednávky standardně neodesílá (zapíná se v dialogu).
