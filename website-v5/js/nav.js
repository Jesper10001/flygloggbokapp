/* BLADES — the phone menu: the button left of the logo opens the site's sections and guides, download, help and
   legal. On a desktop, the bar's Guides list closes again on a click elsewhere or Escape. */
(() => {
  document.querySelectorAll('.nav-dd').forEach((dd) => {
    document.addEventListener('click', (e) => { if (dd.open && !dd.contains(e.target)) dd.open = false; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dd.open) { dd.open = false; dd.querySelector('summary').focus(); }
    });
  });

  const btn = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;

  const open = (yes, fromKeyboard = false) => {
    menu.hidden = !yes;
    document.documentElement.classList.toggle('nav-open', yes);   // the page under the menu stays put
    btn.setAttribute('aria-expanded', String(yes));
    btn.setAttribute('aria-label', yes ? 'Close menu' : 'Menu');
    // Opened from the keyboard: move focus into the menu (a tap leaves it on the button, without a ring).
    if (yes && fromKeyboard) { const first = menu.querySelector('a'); if (first) first.focus({ preventScroll: true }); }
  };
  btn.addEventListener('click', (e) => open(menu.hidden, e.detail === 0));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) open(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { open(false); btn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.nav-menu, .nav-toggle')) open(false);
  });
  // Leaving phone width closes it (the desktop bar has its own links).
  window.matchMedia('(max-width: 820px)').addEventListener('change', (m) => { if (!m.matches) open(false); });
})();
