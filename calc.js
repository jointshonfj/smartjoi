// Výpočty cen nabídky — sdílené serverem (PDF) i prohlížečem (editor), ať čísla vždy sedí.
(function (root) {
  'use strict';
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

  // Jednotková cena bez DPH z ceny s DPH (ceny v Shoptet feedu jsou s DPH).
  // step 0.1 = jako Pohoda (429 Kč s DPH -> 354,60 bez DPH), step 0.01 = přesně na haléře.
  function unitNet(priceVat, vatRate, step) {
    const net = r2(Number(priceVat || 0) / (1 + Number(vatRate || 0) / 100));
    const s = Number(step) || 0.01;
    return r2(Math.round(net / s + 1e-9) * s);
  }

  function line(item, step) {
    const qty = Number(item.qty || 0);
    const vat = Number(item.vatRate ?? 21);
    const disc = Number(item.discount || 0);
    const jc = unitNet(item.priceVat, vat, step);
    const net = r2(qty * jc * (1 - disc / 100));
    const tax = r2(net * vat / 100);
    return { unitNet: jc, net, tax, total: r2(net + tax) };
  }

  function totals(offer, step) {
    let net = 0, tax = 0;
    const lines = (offer.items || []).map(it => {
      const l = line(it, step);
      net += l.net; tax += l.tax;
      return l;
    });
    net = r2(net); tax = r2(tax);
    return { lines, net, tax, total: r2(net + tax) };
  }

  const fmt = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = n => fmt.format(Number(n || 0)).replace(/ /g, ' ');
  const qtyFmt = n => String(Number(n || 0)).replace('.', ',');

  const api = { r2, unitNet, line, totals, money, qtyFmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
