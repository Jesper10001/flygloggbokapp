/* BLADES — marks the section you are reading in the contents list. */
(() => {
  const links = Array.from(document.querySelectorAll('.doc-toc a'));
  const heads = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  if (!heads.length || !('IntersectionObserver' in window)) return;
  const mark = (id) => links.forEach((a) => a.setAttribute('aria-current', String(a.hash === `#${id}`)));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) mark(e.target.id); });
  }, { rootMargin: '-15% 0px -75% 0px' });
  heads.forEach((h) => io.observe(h));
})();
