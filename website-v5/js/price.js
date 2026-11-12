/* BLADES — the Premium price in the visitor's currency. /api/price (a Cloudflare Pages Function on this site) answers
   from the country Cloudflare sees the request come from; nothing is stored and no cookie is set. Until it answers,
   or if it can't tell, the page shows the price in euro. */
(() => {
  const MAX = { SEK: '69 kr' };
  if (!document.querySelector('[data-price], [data-price-free], [data-price-max]') || !window.fetch) return;
  fetch('/api/price', { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      if (!p || !p.price) return;
      document.querySelectorAll('[data-price]').forEach((el) => { el.textContent = p.price; });
      document.querySelectorAll('[data-price-free]').forEach((el) => { el.textContent = p.free; });
      // Blades Max: the price is known for these currencies so far; elsewhere the card points to the App Store.
      const max = MAX[p.currency];
      if (max && p.local) {
        document.querySelectorAll('[data-price-max]').forEach((el) => { el.textContent = max; el.classList.add('is-price'); });
        document.querySelectorAll('[data-price-max-per]').forEach((el) => { el.hidden = false; });
      }
      if (p.local) document.querySelectorAll('[data-price-note]').forEach((el) => { el.textContent = el.dataset.priceNote; });
    })
    .catch(() => {});
})();
