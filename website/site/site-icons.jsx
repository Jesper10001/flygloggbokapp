// Inline SVG icons for the site
window.SiteIcon = ({ name, size = 24, color = 'currentColor', stroke = 1.5 }) => {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle' };
  const p = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'helicopter':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M2 7h20M12 7v3M7 10h10l-1 5H8z"/><path d="M12 15v4M9 19h6"/><circle cx="18.5" cy="10" r="1"/></g></svg>;
    case 'plane':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M21 12l-9 3-3 6-2-1 1-5-7-3 1-2 8 1 4-5a2 2 0 113 3l-5 4 9 1z"/></g></svg>;
    case 'drone':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h8M8 18h8M6 8v8M18 8v8M9 9h6v6H9z"/></g></svg>;
    case 'hems':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></g></svg>;
    case 'school':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c0 1 2 2 5 2s5-1 5-2v-5"/></g></svg>;
    case 'operator':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 14h2M8 17h6"/></g></svg>;
    case 'arrow-right':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M5 12h14M13 6l6 6-6 6"/></g></svg>;
    case 'apple':
      return <svg viewBox="0 0 24 24" style={s} fill={color}><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>;
    case 'check':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M5 12l5 5 9-11"/></g></svg>;
    case 'sparkle':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></g></svg>;
    case 'play':
      return <svg viewBox="0 0 24 24" style={s} fill={color}><path d="M8 5v14l11-7z"/></svg>;
    case 'camera':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/></g></svg>;
    case 'doc':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6M9 9h2"/></g></svg>;
    case 'shield':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/></g></svg>;
    case 'pulse':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M3 12h4l2-7 4 14 2-7h6"/></g></svg>;
    case 'lock':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></g></svg>;
    case 'layers':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/></g></svg>;
    case 'menu':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><path d="M4 7h16M4 12h16M4 17h16"/></g></svg>;
    case 'globe':
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></g></svg>;
    default:
      return <svg viewBox="0 0 24 24" style={s}><g {...p}><circle cx="12" cy="12" r="8"/></g></svg>;
  }
};

// Map feature item index to icon name (in order of strings.features.items)
window.FEATURE_ICONS = ['camera', 'doc', 'shield', 'pulse', 'lock', 'layers'];
