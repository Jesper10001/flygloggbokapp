/* BLADES — the support form (support.html). One question at a time: what it is about, where in Blades, then only the
   fields that help with that kind of message. While you write, the answers on this page that fit are shown, so a
   question that is already answered is answered at once. The message goes to our support inbox through our own
   server (api.blades-app.com/web/support) and comes back with a reference; if that fails, it is ready to send from
   your email app instead. The draft is kept in this browser until it is sent (you may leave to look up a version). */
(() => {
  const form = document.getElementById('contact');
  if (!form) return;
  const done = document.getElementById('sf-done');
  const DRAFT = 'blades-support-draft';
  const shownAt = Date.now();
  form.hidden = false;

  const AREAS = {
    problem: ['Logging a flight', 'Logbook & PDF', 'Import & export', 'ACARS & AI scan', 'Backup & iCloud', 'Drones', 'Map & airports', 'Insights & currency', 'Something else'],
    help: ['Premium & billing', 'Moving my logbook', 'My data & privacy', 'Blade-coins & promo codes', 'How something works', 'Something else'],
    idea: ['Logging a flight', 'Logbook & PDF', 'Import & export', 'ACARS & AI scan', 'Backup & iCloud', 'Drones', 'Map & airports', 'Insights & currency', 'Something else'],
  };
  // A line under the choice where it saves a message or sets the right expectation.
  const NOTES = {
    'Premium & billing': 'Purchases and refunds are handled by Apple. For a refund, <a href="https://reportaproblem.apple.com" rel="noopener">reportaproblem.apple.com</a> is the quickest way. For anything else, we are glad to help.',
    'Backup & iCloud': 'iCloud in Blades is a backup of your logbook, not a sync between devices.',
    'ACARS & AI scan': 'If a value was read wrong, tell us which one and what it should have been.',
    'Moving my logbook': 'Tell us where your flights are today, and roughly how many. We will help you bring them over.',
  };
  // Which answers on this page belong to which part of Blades (by their question), shown first for that choice.
  const AREA_FAQ = {
    'Logging a flight': ['night time', 'offline'],
    'Logbook & PDF': ['export my logbook', 'layouts'],
    'Import & export': ['bring in my existing', 'export my logbook'],
    'ACARS & AI scan': ['AI features'],
    'Backup & iCloud': ['back up or move', 'backup or a sync'],
    Drones: ['crewed aircraft and drones'],
    'Map & airports': ['offline'],
    'Premium & billing': ['manage or cancel', "What's free", 'stop Premium'],
    'Moving my logbook': ['bring in my existing', 'back up or move'],
    'My data & privacy': ['flight data stored', 'delete my data', 'Blades disappears'],
    'Blade-coins & promo codes': ["What's free", 'AI features'],
  };

  const $ = (s, el = form) => el.querySelector(s);
  const $$ = (s, el = form) => Array.from(el.querySelectorAll(s));
  const steps = { type: $('[data-step="type"]'), area: $('[data-step="area"]'), details: $('[data-step="details"]'), contact: $('[data-step="contact"]') };
  const areaBox = $('[data-areas]');
  const areaNote = $('[data-areanote]');
  const answers = $('.sf-answers');
  const answersList = $('.sf-answers-list');
  const status = $('.sf-status');
  const sendBtn = $('.sf-btn');
  const val = (name) => { const el = form.elements[name]; return el ? (el.value || '').trim() : ''; };
  const type = () => val('type');
  const area = () => val('area');

  /* ---------- The answers already on this page ---------- */
  const STOP = new Set('a an and are as at be but by can do does for from have how i if in is it its me my no not of on or our so that the their them then there this to too up us was we what when where which who why will with you your yes'.split(' '));
  const words = (t) => (t.toLowerCase().match(/[a-z0-9åäöé]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
  const faq = Array.from(document.querySelectorAll('.faq details')).map((d, i) => {
    const q = d.querySelector('summary').textContent.trim();
    const a = d.querySelector('.a');
    if (!d.id) d.id = `faq-${i + 1}`;
    return { d, q, html: a ? a.innerHTML : '', bag: new Set(words(`${q} ${q} ${a ? a.textContent : ''}`)) };
  });
  function suggest() {
    const t = type();
    if (!t || t === 'idea' || !area()) { answers.hidden = true; return; }
    const keys = AREA_FAQ[area()] || [];
    const typed = words(`${val('message')} ${val('summary')}`);
    const scored = faq.map((f) => {
      let s = keys.some((k) => f.q.toLowerCase().includes(k.toLowerCase())) ? 3 : 0;
      for (const w of new Set(typed)) if (f.bag.has(w)) s += 1;
      return { f, s };
    }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 3);
    const ids = scored.map((x) => x.f.d.id).join();
    if (answersList.dataset.ids === ids) { answers.hidden = !scored.length; return; }
    answersList.dataset.ids = ids;
    answersList.innerHTML = '';
    scored.forEach(({ f }) => {
      const item = document.createElement('details');
      item.className = 'sf-answer';
      item.innerHTML = `<summary>${f.q}</summary><div class="sf-answer-a">${f.html}</div>`;
      answersList.appendChild(item);
    });
    answers.hidden = !scored.length;
  }

  /* ---------- What is shown, for the choice made ---------- */
  function render() {
    const t = type();
    const a = area();
    steps.area.hidden = !t;
    steps.details.hidden = !t || !a;
    steps.contact.hidden = !t || !a;
    form.dataset.type = t;
    $$('.sf-type').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    // Words and placeholders that change with the kind of message
    $$('[data-text-problem]').forEach((el) => { if (t) el.textContent = el.dataset[`text${t[0].toUpperCase()}${t.slice(1)}`]; });
    $$('[data-ph-problem]').forEach((el) => { if (t) el.placeholder = el.dataset[`ph${t[0].toUpperCase()}${t.slice(1)}`]; });
    $$('[data-show]').forEach((el) => {
      const forType = el.dataset.show.split(' ').includes(t);
      const forArea = !el.dataset.areaOnly || el.dataset.areaOnly === a;
      el.hidden = !(forType && forArea);
    });
    if (a && NOTES[a]) { areaNote.innerHTML = NOTES[a]; areaNote.hidden = false; } else areaNote.hidden = true;
    suggest();
  }
  function fillAreas(keep) {
    const t = type();
    const list = AREAS[t] || [];
    areaBox.innerHTML = list.map((name, i) => `<label class="sf-chip"><input type="radio" name="area" value="${name}"${name === keep ? ' checked' : ''}${i ? '' : ' required'}><span>${name}</span></label>`).join('');
  }

  /* ---------- The draft, kept in this browser ---------- */
  const FIELDS = ['type', 'area', 'summary', 'message', 'fromApp', 'expected', 'frequency', 'impact', 'steps', 'device', 'ios', 'version', 'email', 'name'];
  const collect = () => Object.fromEntries(FIELDS.map((k) => [k, val(k)]));
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify(collect())); } catch (e) { /* not kept */ } }, 300); };
  const setRadio = (name, v) => { $$(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === v; }); };
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) { d = null; }
    if (!d || !d.type) return;
    setRadio('type', d.type);
    fillAreas(d.area);
    ['summary', 'message', 'fromApp', 'expected', 'steps', 'device', 'ios', 'version', 'email', 'name'].forEach((k) => { if (d[k] && form.elements[k]) form.elements[k].value = d[k]; });
    setRadio('frequency', d.frequency);
    setRadio('impact', d.impact);
    if (d.steps || d.device || d.ios || d.version) $('.sf-more').open = true;
  }

  /* ---------- Checking before it goes ---------- */
  const err = (name, on) => {
    const e = $(`.sf-err[data-for="${name}"]`);
    if (e) e.hidden = !on;
    const el = form.elements[name];
    if (el && el.setAttribute) el.setAttribute('aria-invalid', on ? 'true' : 'false');
  };
  function check() {
    const t = type();
    const bad = [];
    if (!t) bad.push('type');
    if (t && !area()) bad.push('area');
    if (t === 'idea' && val('summary').length < 4) bad.push('summary');
    if (t && t !== 'idea' && val('message').length < 10) bad.push('message');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val('email'))) bad.push('email');
    ['type', 'area', 'summary', 'message', 'email'].forEach((n) => err(n, bad.includes(n)));
    return bad;
  }

  /* ---------- Sending ---------- */
  const TYPE_NAME = { problem: "Something isn't working", help: 'I need a hand', idea: 'Something is missing' };
  function asText(d) {
    const lines = [`${TYPE_NAME[d.type] || ''} · ${d.area}`, ''];
    const add = (label, v) => { if (v) lines.push(`${label}: ${v}`); };
    if (d.summary) lines.push(d.summary, '');
    if (d.message) lines.push(d.message, '');
    add('Expected', d.expected); add('How often', d.frequency); add('How much it matters', d.impact); add('Moving from', d.fromApp);
    if (d.steps) lines.push('', 'Steps:', d.steps);
    add('Device', [d.device, d.ios && `iOS ${d.ios}`, d.version && `Blades ${d.version}`].filter(Boolean).join(' · '));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function fallback(d, why) {
    const subject = `${TYPE_NAME[d.type] || 'Support'} · ${d.area}`;
    let body = asText(d);
    if (body.length > 1800) body = `${body.slice(0, 1800)}…`;
    const mail = `mailto:support@blades-app.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    status.innerHTML = `${why} Your message is ready to send from your email app instead. <span class="sf-fb"><a class="sf-fb-mail" href="${mail}">Open in email app</a><button type="button" class="sf-fb-copy">Copy message</button></span>`;
    status.hidden = false;
    status.className = 'sf-status is-warn';
    const copy = status.querySelector('.sf-fb-copy');
    copy.addEventListener('click', () => {
      const text = `To: support@blades-app.com\nSubject: ${subject}\n\n${asText(d)}`;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { copy.textContent = 'Copied'; }, () => { copy.textContent = 'Select and copy the text above'; });
    });
  }
  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    status.hidden = true;
    const bad = check();
    if (bad.length) {
      const first = bad[0] === 'type' || bad[0] === 'area' ? $(`input[name="${bad[0]}"]`) : form.elements[bad[0]];
      if (first) first.focus();
      return;
    }
    const d = collect();
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
    try {
      const res = await fetch(form.dataset.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...d, website: val('website'), elapsed: Date.now() - shownAt }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        try { localStorage.removeItem(DRAFT); } catch (er) { /* nothing kept */ }
        done.querySelector('.sf-ref').textContent = out.ref;
        done.querySelector('.sf-to').textContent = d.email;
        form.hidden = true;
        done.hidden = false;
        done.focus({ preventScroll: true });
        done.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (res.status === 429) {
        status.textContent = 'You have sent a few messages in a short time. Please wait a minute and try again.';
        status.className = 'sf-status is-warn';
        status.hidden = false;
      } else if (res.status === 400 && Array.isArray(out.fields)) {
        out.fields.forEach((f) => err(f, true));
        status.textContent = 'Some of the answers need another look.';
        status.className = 'sf-status is-warn';
        status.hidden = false;
      } else fallback(d, 'We could not send it from here just now.');
    } catch (er) {
      fallback(d, 'We could not reach our server.');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send message';
    }
  });

  /* ---------- Wiring ---------- */
  form.addEventListener('change', (e) => {
    if (e.target.name === 'type') { fillAreas(''); }
    if (e.target.name === 'type' || e.target.name === 'area') {
      render();
      const next = e.target.name === 'type' ? steps.area : steps.details;
      if (!next.hidden) requestAnimationFrame(() => next.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
    if (e.target.name) err(e.target.name, false);
    save();
  });
  let suggestT = 0;
  form.addEventListener('input', (e) => {
    if (e.target.name) err(e.target.name, false);
    clearTimeout(suggestT);
    suggestT = setTimeout(suggest, 350);
    save();
  });
  done.querySelector('.sf-again').addEventListener('click', () => {
    form.reset();
    fillAreas('');
    render();
    done.hidden = true;
    form.hidden = false;
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  restore();
  render();
})();
