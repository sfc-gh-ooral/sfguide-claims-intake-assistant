// Checks text/background token pairs from docs/DESIGN.md against WCAG AA (4.5:1), both themes.
// Tinted pills are text in color C on a 12% mix of C over the surface.
const L = (hex) => { const c = hex.match(/\w\w/g).map((h) => parseInt(h, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (c, bg, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(c.slice(1 + i, 3 + i), 16) * t + parseInt(bg.slice(1 + i, 3 + i), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
const T = {
  light: { canvas: '#F1F4F5', surface: '#FFFFFF', 'surface-2': '#F6F8F8', ink: '#0F1E1B', 'ink-2': '#4B5D59', link: '#136B5C', fast: '#13795B', std: '#3D5A99', cx: '#975406', siu: '#B4235A', sample: '#6A4BB8' },
  dark: { canvas: '#0A1512', surface: '#10201C', 'surface-2': '#152A25', ink: '#E4EEEB', 'ink-2': '#9DB4AE', link: '#4FC2A9', fast: '#4CC79A', std: '#8EA8E8', cx: '#F0A94B', siu: '#F17BA6', sample: '#B9A4F2' },
};
let fail = 0;
for (const [name, t] of Object.entries(T)) {
  const checks = [];
  for (const fg of ['ink', 'ink-2', 'link']) for (const bg of ['canvas', 'surface', 'surface-2']) checks.push([`${fg} on ${bg}`, t[fg], t[bg]]);
  for (const c of ['fast', 'std', 'cx', 'siu', 'sample', 'link']) checks.push([`${c} pill`, t[c], mix(t[c], t.surface, 0.12)]);
  checks.push(['marker-ink pill', name === 'light' ? '#6B5200' : '#FFF4CC', mix('#FFD84D', t.surface, 0.38)]);
  checks.push(['text on marker', '#2E2400', '#FFD84D'], ['white on spruce-2 button', name === 'light' ? '#FFFFFF' : '#06231D', t.link], ['spine text', '#A9C6BE', '#0E3B34']);
  for (const [label, fg, bg] of checks) { const r = ratio(fg, bg); if (r < 4.5) fail++; console.log(`${name.padEnd(5)} ${label.padEnd(28)} ${r.toFixed(2)} ${r >= 4.5 ? 'AA' : 'FAIL'}`); }
}
process.exit(fail ? 1 : 0);
