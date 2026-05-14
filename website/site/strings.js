// i18n strings — EN + SV
window.SITE_STRINGS = {
  en: {
    nav: { features: 'Features', roles: 'For who', pricing: 'Pricing', changelog: 'Updates', download: 'Download' },
    hero: {
      eyebrow: 'BLADES · Joint Logbook',
      title_a: 'Stop logging on paper.',
      title_b: 'Start flying the future.',
      sub: 'Anchor-validated OCR, EASA-grade PDF export, and real currency tracking — built by a pilot, for pilots, operators, and drone teams.',
      cta_primary: 'Download on the App Store',
      cta_secondary: 'See how it works',
      preview_caption: 'App preview · screenshot coming soon',
      stats: [
        { v: 'EASA', k: 'CPL/ATPL requirement tracking' },
        { v: '14-day', k: 'rolling load index, not generic stress' },
        { v: '3', k: 'CV-grade PDF layouts' }
      ]
    },
    roles: {
      eyebrow: 'Built for every cockpit',
      title: 'One app, every role.',
      sub: 'Whether you fly Robinsons over the archipelago or run a drone fleet for a film crew — Blades fits the way you actually work.',
      items: [
        { icon: 'helicopter', title: 'Helicopter pilots', desc: 'PIC, PICUS, dual, NVG, hoist, sling — with R22/R44/R66 type tracking.' },
        { icon: 'plane', title: 'Fixed-wing pilots', desc: 'VFR, IFR, mixed Y/Z, multi-engine, instructor time, IPC validity.' },
        { icon: 'drone', title: 'Drone operators', desc: 'Open A1/A2/A3 and Specific category, mission logs, fleet & battery cycles.' },
        { icon: 'hems', title: 'HEMS & rescue crews', desc: 'Crew chief, swimmer, hoist, mission type, callouts.' },
        { icon: 'school', title: 'Flight schools', desc: 'Student logs, instructor sign-off, EASA conversion paths.' },
        { icon: 'operator', title: 'Operators & airlines', desc: 'Pilot CV export, currency tracking, audit-ready PDFs.' }
      ]
    },
    how: {
      eyebrow: 'How it works',
      title: 'From paper to portfolio.',
      steps: [
        { n: '01', title: 'Photograph your logbook', desc: 'Snap a page — even handwritten, even with ditto marks. Anchor-validated OCR does the rest.' },
        { n: '02', title: 'Review and sign off', desc: 'Confidence-scored rows. Fast-track the certain ones, fix the flagged ones in seconds — time math is checked for you.' },
        { n: '03', title: 'Export and share', desc: 'Three professional PDF layouts. Send to operators, regulators, or keep for yourself — Operator-ID baked in.' }
      ]
    },
    features: {
      eyebrow: 'What you get',
      title: 'Built for the way pilots actually work.',
      items: [
        {
          tag: 'Flight Load',
          title: '14-day rolling load.',
          desc: 'Calibrated to your own annual baseline — not a one-size-fits-all stress number. Excludes December so the holiday dip does not skew it.',
          visual: 'load'
        },
        {
          tag: 'EASA · Premium',
          title: 'CPL/ATPL requirements.',
          desc: 'Track FCL.510 and FCL.515 hours live: PIC, IFR, night, cross-country. See exactly how far you have left.',
          visual: 'easa'
        },
        {
          tag: 'Anchor OCR',
          title: 'Reads your handwriting.',
          desc: 'Anchor-validated OCR resolves ditto marks, validates time math (off-block / on-block / total), and flags anything uncertain with a confidence score.',
          visual: 'ocr'
        },
        {
          tag: 'Certificates',
          title: 'Never miss a renewal.',
          desc: 'Class ratings, medicals, IPC, NVG currency, language proficiency — with expiry alerts before they bite.',
          visual: 'certs'
        },
        {
          tag: 'Mixed flights',
          title: 'VFR, IFR, Y, Z — handled.',
          desc: 'Mixed-rule flights, PICUS, DUAL, Safety Pilot. Night flights split out for NVG currency without you doing the math.',
          visual: 'rules'
        },
        {
          tag: 'Drone fleet',
          title: 'Battery cycles, auto-counted.',
          desc: 'Every drone flight increments the battery cycle counter. Operator-ID stamped on every PDF export.',
          visual: 'battery'
        }
      ]
    },
    cockpit: {
      eyebrow: 'In the cockpit',
      title: 'Designed for the gap between flights.',
      sub: 'Quick capture. Fast review. No menus to fight. Here are the details that come from logging this stuff myself.',
      items: [
        { h: 'Mixed-rule flights', p: 'Log a Y or Z flight in one row. VFR/IFR splits compute automatically against your route.' },
        { h: 'Multi-pilot roles', p: 'PIC, PICUS, DUAL, Safety Pilot, Instructor — with the right hours flowing to the right currency bucket.' },
        { h: 'Night & NVG', p: 'Civil twilight is computed from departure ICAO. Missing NVG hours? A guided fix-flow walks you through it.' },
        { h: 'Best week, longest XC', p: 'Career milestones surface automatically — useful when you forgot what you flew last June.' },
        { h: 'Battery cycles', p: 'Per-airframe counter that ticks up on every drone flight. No more "is it 142 or 143?".' },
        { h: 'Offline-first', p: 'Stored locally on your device. No account. No cloud scraping. Export anytime, in CSV or PDF.' }
      ]
    },
    screenshots: {
      eyebrow: 'Screens',
      title: 'Designed to be glanced at.',
      sub: 'Optimised for the moments between flights — quick capture, fast review, no menus to fight.',
      placeholder: 'Screenshot coming soon'
    },
    testimonials: {
      eyebrow: 'Early voices',
      title: 'What pilots are saying.',
      items: [
        { quote: 'Scanned 14 years of paper logs in an afternoon. The OCR caught a totals mistake I made in 2019.', author: 'Erik L.', role: 'Helicopter pilot · 4 200 h' },
        { quote: 'The PDF export is the cleanest pilot CV I have seen. My operator asked which template I used.', author: 'Hanna B.', role: 'CPL(A) · IFR · 2 100 h' },
        { quote: 'Finally a logbook that does not pretend drones do not exist. Open A2 and Specific in one place.', author: 'Marcus T.', role: 'Drone operator · A1/A2/A3' }
      ]
    },
    changelog: {
      eyebrow: 'Updates',
      title: 'What is new.',
      cta: 'See all releases',
      items: [
        { v: '1.4', date: 'May 2026', tag: 'New', title: 'Pilot CV export — 3 PDF layouts', desc: 'EASA, Modern, Editorial. Pick the layout that fits the application.' },
        { v: '1.3', date: 'Apr 2026', tag: 'Improved', title: 'OCR Wizard — review one row at a time', desc: 'Confidence-scored rows, fast-track the certain ones, panable image preview.' },
        { v: '1.2', date: 'Mar 2026', tag: 'New', title: 'Flight Load index', desc: '14-day rolling workload, calibrated to your own baseline.' },
        { v: '1.1', date: 'Feb 2026', tag: 'New', title: 'Drone mode', desc: 'Open A1/A2/A3 and Specific, with category-aware logging and battery cycle tracking.' }
      ]
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'Two plans. No surprises.',
      sub: 'A free tier to get you started. Premium or MAX unlocks the rest.',
      free: { name: 'Free', price: '0', period: 'forever', features: ['200 manual flights', 'CSV import & export', '1 free AI scan to try', 'Certificate tracking', 'Offline-first, no account'] },
      premium: { name: 'Premium', price: '49', period: 'per month', currency: 'kr', badge: 'Most popular', features: ['Unlimited manual flights', '10 AI logbook scans / month', '30 flight data imports / month', '20 aircraft lookups / month', 'EASA-format PDF export', 'EASA CPL/ATPL requirement tracking', 'Full ICAO airport database'] },
      max: { name: 'MAX', price: '149', period: 'per month', currency: 'kr', badge: 'For high-volume', features: ['Everything in Premium', '50 AI logbook scans / month', '100 flight data imports / month', '60 aircraft lookups / month', '3 PDF templates (EASA, Modern, Editorial)', 'Flight share cards with runway diagrams'] }
    },
    footer: {
      tagline: 'Built by a pilot. In Sweden.',
      newsletter: 'Get build notes and early access.',
      newsletter_placeholder: 'you@example.com',
      newsletter_cta: 'Subscribe',
      copyright: '© 2026 Blades Apps',
      privacy: 'Privacy',
      terms: 'Terms',
      support: 'Support'
    }
  },
  sv: {
    nav: { features: 'Funktioner', roles: 'För vem', pricing: 'Pris', changelog: 'Uppdateringar', download: 'Ladda ner' },
    hero: {
      eyebrow: 'BLADES · Gemensam loggbok',
      title_a: 'Sluta logga på papper.',
      title_b: 'Börja flyga framtiden.',
      sub: 'Anchor-validerad OCR, EASA-värdig PDF-export och riktig currency-bevakning — byggt av en pilot, för piloter, operatörer och drönarteam.',
      cta_primary: 'Ladda ner i App Store',
      cta_secondary: 'Se hur det fungerar',
      preview_caption: 'Förhandsvisning · skärmbild kommer snart',
      stats: [
        { v: 'EASA', k: 'CPL/ATPL-kravspårning' },
        { v: '14-dagars', k: 'rullande Flight Load — inte generisk stress' },
        { v: '3', k: 'CV-värdiga PDF-layouter' }
      ]
    },
    roles: {
      eyebrow: 'Byggd för varje cockpit',
      title: 'En app, alla roller.',
      sub: 'Oavsett om du flyger Robinson över skärgården eller kör en drönarflotta åt en filmproduktion — Blades passar ditt arbetssätt.',
      items: [
        { icon: 'helicopter', title: 'Helikopterpiloter', desc: 'PIC, PICUS, dual, NVG, vinsch, last — med R22/R44/R66-typspårning.' },
        { icon: 'plane', title: 'Fixed-wing-piloter', desc: 'VFR, IFR, mixad Y/Z, multi-engine, instruktörstid, IPC-giltighet.' },
        { icon: 'drone', title: 'Drönaroperatörer', desc: 'Open A1/A2/A3 och Specific, uppdragsloggar, flotta & batteri-cykler.' },
        { icon: 'hems', title: 'HEMS & räddning', desc: 'Crew chief, simmare, vinsch, uppdragstyp, larm.' },
        { icon: 'school', title: 'Flygskolor', desc: 'Elev-loggar, instruktörssignering, EASA-konvertering.' },
        { icon: 'operator', title: 'Operatörer & flygbolag', desc: 'Pilot-CV-export, currency, granskningsklar PDF.' }
      ]
    },
    how: {
      eyebrow: 'Så funkar det',
      title: 'Från papper till portfolio.',
      steps: [
        { n: '01', title: 'Fotografera loggboken', desc: 'Knäpp en sida — även handskriven, även med ditto-markeringar. Anchor-validerad OCR löser resten.' },
        { n: '02', title: 'Granska och signera', desc: 'Konfidens-poängsatta rader. Snabbgodkänn de säkra, fixa de flaggade på sekunder — tidsmatten kontrolleras åt dig.' },
        { n: '03', title: 'Exportera och dela', desc: 'Tre professionella PDF-layouter. Skicka till operatörer, myndigheter, eller behåll själv — Operator-ID inbakat.' }
      ]
    },
    features: {
      eyebrow: 'Vad du får',
      title: 'Byggd för hur piloter faktiskt jobbar.',
      items: [
        {
          tag: 'Flight Load',
          title: '14-dagars rullande belastning.',
          desc: 'Kalibrerad mot din egen årsbaseline — inte en generisk stresssiffra. Exkluderar december så semesterdippen inte skevar den.',
          visual: 'load'
        },
        {
          tag: 'EASA · Premium',
          title: 'CPL/ATPL-krav.',
          desc: 'Spåra FCL.510- och FCL.515-timmar i realtid: PIC, IFR, natt, cross-country. Se exakt hur långt kvar du har.',
          visual: 'easa'
        },
        {
          tag: 'Anchor OCR',
          title: 'Läser din handstil.',
          desc: 'Anchor-validerad OCR löser ditto-markeringar, kontrollerar tidsmatte (off-block / on-block / total) och flaggar osäkert med konfidenspoäng.',
          visual: 'ocr'
        },
        {
          tag: 'Certifikat',
          title: 'Missa aldrig en förnyelse.',
          desc: 'Klass-ratings, medical, IPC, NVG-currency, språkprov — med larm innan det smäller.',
          visual: 'certs'
        },
        {
          tag: 'Mixade flygningar',
          title: 'VFR, IFR, Y, Z — hanterat.',
          desc: 'Mixade regler, PICUS, DUAL, Safety Pilot. Nattflygningar splittas för NVG-currency utan att du räknar.',
          visual: 'rules'
        },
        {
          tag: 'Drönarflotta',
          title: 'Batteri-cykler, auto-räknade.',
          desc: 'Varje drönarflygning ökar batteri-cykel-räknaren. Operator-ID stämplat på varje PDF.',
          visual: 'battery'
        }
      ]
    },
    cockpit: {
      eyebrow: 'I cockpit',
      title: 'Designad för pausen mellan flygningar.',
      sub: 'Snabb fångst. Snabb granskning. Inga menyer att slåss med. Detaljerna kommer från att jag loggar det här själv.',
      items: [
        { h: 'Mixade regelflygningar', p: 'Logga en Y- eller Z-flygning på en rad. VFR/IFR-splittning räknas automatiskt mot din rutt.' },
        { h: 'Multi-pilot-roller', p: 'PIC, PICUS, DUAL, Safety Pilot, Instruktör — med rätt timmar i rätt currency-hink.' },
        { h: 'Natt & NVG', p: 'Civil twilight beräknas från avgångs-ICAO. Saknade NVG-timmar? En guidad fix-flow tar dig igenom.' },
        { h: 'Bästa vecka, längsta XC', p: 'Karriär-milstolpar dyker upp automatiskt — användbart när du glömt vad du flög i juni.' },
        { h: 'Batteri-cykler', p: 'Per-luftfartygs-räknare som tickar på varje drönarflygning. Slut på "är det 142 eller 143?".' },
        { h: 'Offline-first', p: 'Lokalt på enheten. Inget konto. Ingen molnskrapning. Exportera när som helst, i CSV eller PDF.' }
      ]
    },
    screenshots: {
      eyebrow: 'Skärmar',
      title: 'Designad att skummas.',
      sub: 'Optimerad för stunden mellan flygningar — snabb fångst, snabb granskning, inga menyer att slåss med.',
      placeholder: 'Skärmbild kommer snart'
    },
    testimonials: {
      eyebrow: 'Tidiga röster',
      title: 'Vad piloter säger.',
      items: [
        { quote: 'Scannade 14 års pappersloggar på en eftermiddag. OCR:n hittade ett totalfel jag gjort 2019.', author: 'Erik L.', role: 'Helikopterpilot · 4 200 h' },
        { quote: 'PDF-exporten är det renaste pilot-CV jag sett. Min operatör frågade vilken mall jag använt.', author: 'Hanna B.', role: 'CPL(A) · IFR · 2 100 h' },
        { quote: 'Äntligen en loggbok som inte låtsas att drönare inte finns. Open A2 och Specific på samma ställe.', author: 'Marcus T.', role: 'Drönaroperatör · A1/A2/A3' }
      ]
    },
    changelog: {
      eyebrow: 'Uppdateringar',
      title: 'Vad som är nytt.',
      cta: 'Se alla releaser',
      items: [
        { v: '1.4', date: 'Maj 2026', tag: 'Nytt', title: 'Pilot-CV export — 3 PDF-layouter', desc: 'EASA, Modern, Editorial. Välj den layout som matchar ansökan.' },
        { v: '1.3', date: 'Apr 2026', tag: 'Förbättrat', title: 'OCR-wizard — granska en rad i taget', desc: 'Konfidenspoäng, snabbgodkänn säkra rader, panorerbar bild.' },
        { v: '1.2', date: 'Mar 2026', tag: 'Nytt', title: 'Flight Load-index', desc: '14-dagars rullande belastning, kalibrerad mot din egen baseline.' },
        { v: '1.1', date: 'Feb 2026', tag: 'Nytt', title: 'Drönarläge', desc: 'Open A1/A2/A3 och Specific, med kategori-medveten loggning och batteri-cykler.' }
      ]
    },
    pricing: {
      eyebrow: 'Pris',
      title: 'Två planer. Inga överraskningar.',
      sub: 'En gratisnivå för att komma igång. Premium eller MAX låser upp resten.',
      free: { name: 'Gratis', price: '0', period: 'för alltid', features: ['200 manuella flygningar', 'CSV-import & export', '1 gratis AI-scan', 'Certifikatbevakning', 'Offline-first, inget konto'] },
      premium: { name: 'Premium', price: '49', period: 'per månad', currency: 'kr', badge: 'Populärast', features: ['Obegränsade manuella flygningar', '10 AI-loggboksscans / månad', '30 flight data imports / månad', '20 flygplansuppslag / månad', 'EASA-format PDF-export', 'EASA CPL/ATPL-kravspårning', 'Global ICAO flygplatsdatabas'] },
      max: { name: 'MAX', price: '149', period: 'per månad', currency: 'kr', badge: 'För högvolym', features: ['Allt i Premium', '50 AI-loggboksscans / månad', '100 flight data imports / månad', '60 flygplansuppslag / månad', '3 PDF-mallar (EASA, Modern, Editorial)', 'Delningskort med bandiagram'] }
    },
    footer: {
      tagline: 'Byggd av en pilot. I Sverige.',
      newsletter: 'Få bygg-noteringar och tidig access.',
      newsletter_placeholder: 'du@exempel.se',
      newsletter_cta: 'Prenumerera',
      copyright: '© 2026 Blades Apps',
      privacy: 'Integritet',
      terms: 'Villkor',
      support: 'Support'
    }
  }
};
