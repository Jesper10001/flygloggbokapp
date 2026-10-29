/* BLADES — the Premium price in the visitor's currency. /api/price (a Cloudflare Pages Function on this site) answers
   from the country Cloudflare sees the request come from; nothing is stored and no cookie is set. Until it answers,
   or if it can't tell, the page shows the price in euro. */
(() => {
  if (!document.querySelector('[data-price], [data-price-free]') || !window.fetch) return;
  fetch('/api/price', { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p || !p.price) return;
      document.querySelectorAll('[data-price]').forEach((el) => { el.textContent = p.price; });
      document.querySelectorAll('[data-price-free]').forEach((el) => { el.textContent = p.free; });
      if (p.local) document.querySelectorAll('[data-price-note]').forEach((el) => { el.textContent = el.dataset.priceNote; });
    })
    .catch(() => {});
})();
