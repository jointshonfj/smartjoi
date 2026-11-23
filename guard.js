// Vinylor Hub — ochrana proti vložení do cizí stránky (clickjacking). GitHub Pages neumí poslat hlavičku X-Frame-Options.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try { window.top.location = window.self.location.href; } catch (e) { /* cizí rám: stránka zůstane skrytá */ }
}

// Režim vzhledu nastavit hned, ať stránka neprobliká (výchozí tmavý jako SmartJoi).
(function () {
  var t = 'dark';
  try { t = localStorage.getItem('vh_theme') || 'dark'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();
