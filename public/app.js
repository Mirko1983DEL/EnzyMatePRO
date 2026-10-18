import { totals, dose, fatExact, truncated, unitsPerKg, rangeFor, elapsedDays, summarize, recommendedUnits } from './calc.js';
import { ISSUE_TEXT } from './estimate.js';
import { scanImage } from './scan.js';
import { api } from './api.js';
import { buildReport, toCsv, toText, barChartSvg } from './report.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: d });
const state = { patient: null, settings: { capsuleSize: 25000 }, sizes: [10000, 25000, 35000], ai: false, items: [], caps: 0, capsTouched: false, editIndex: -1,
  page: 'home', day: startOfDay(new Date()), mode: 'day', custom: null, view: null };

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }
// Ladeanzeige (drehende Kapsel): erscheint erst, wenn eine Anfrage länger als 250 ms dauert (kein Flackern bei schnellen Antworten).
let pending = 0, loaderTimer;
const loaderEl = () => $('loader');
function loaderStart() { if (pending++ === 0) loaderTimer = setTimeout(() => { try { loaderEl().showPopover(); } catch { loaderEl().setAttribute('open', ''); } }, 250); }
function loaderStop() { if (--pending > 0) return; pending = 0; clearTimeout(loaderTimer); try { loaderEl().hidePopover(); } catch { loaderEl().removeAttribute('open'); } }
const call = async (...a) => { loaderStart(); try { return await api(...a); } finally { loaderStop(); } };
const guard = (fn) => async (...a) => {
  try { await fn(...a); }
  catch (e) {
    // Technische Browserfehler nie roh anzeigen; eigene, verständliche Meldungen (deutsch) werden gezeigt.
    if (e instanceof TypeError || e instanceof SyntaxError || e instanceof RangeError) { console.error(e); toast('Etwas ist schiefgelaufen. Bitte noch einmal versuchen.'); }
    else toast(e.message || 'Etwas ist schiefgelaufen. Bitte noch einmal versuchen.');
  }
};
const chevron = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<path d="M10 6l6 6-6 6"/>'; return s; };

// ---- Pop-ups ----
document.querySelectorAll('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
const openDlg = (id) => $(id).showModal();
function askChoice(id, setup) { // Dialog mit Antwort-Buttons (returnValue)
  return new Promise((resolve) => { const dlg = $(id); setup?.(dlg); dlg.returnValue = ''; dlg.onclose = () => resolve(dlg.returnValue); dlg.showModal(); });
}
function kv(dl, rows) {
  dl.replaceChildren();
  for (const [k, v] of rows) {
    if (v === null) dl.append(el('dt', { className: 'sep', textContent: k }));
    else dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
  }
}

// ---- Seiten ----
function showPage(name) {
  state.page = name;
  for (const p of ['home', 'history', 'profile', 'report']) $('page-' + p).hidden = p !== name;
  $('sizeChip').hidden = name !== 'home';
  renderHome();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => showPage('home')));
$('menuBtn').onclick = () => openDlg('menuDlg');
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = guard(async () => {
  $('menuDlg').close();
  showPage(b.dataset.go);
  if (b.dataset.go === 'history') { state.day = startOfDay(new Date()); await renderHistory(); }
})));

// ---- Kapselgröße ----
function renderSize() {
  $('sizeLabel').textContent = 'Kreon ' + fmt(state.settings.capsuleSize);
  const opts = $('sizeOpts'); opts.replaceChildren();
  for (const s of state.sizes) {
    const b = el('button', { className: 'opt', type: 'button' }, el('span', { textContent: fmt(s) }), el('small', { textContent: 'Lipase-Einheiten' }));
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(s === state.settings.capsuleSize));
    b.onclick = guard(async () => {
      state.settings.capsuleSize = s; state.capsTouched = false; $('sizeDlg').close(); renderSize(); renderHome();
      await call('/settings', 'PUT', { capsuleSize: s });
    });
    opts.append(b);
  }
}
$('sizeChip').onclick = () => openDlg('sizeDlg');

// ---- Start / Mahlzeit ----
const current = () => {
  const t = totals(state.items), fe = fatExact(state.items); // t = gerundete Anzeigewerte, fe = exakte Fettsumme für die Dosis
  return { t, fe, d: dose({ fatGrams: fe, lipasePerGramFat: state.patient.lipasePerGramFat, capsuleSize: state.settings.capsuleSize }) };
};
const deviation = (t, d) => {
  const given = state.caps * state.settings.capsuleSize;
  if (d.ok && d.capsules > 50) return 'Mehr als 50 Kapseln lassen sich nicht speichern. Bitte Mengen und Werte prüfen.';
  if (!d.ok || t.fat <= 0) return '';
  if (given < d.units * 0.75) return 'Deutlich weniger als berechnet.';
  if (given > d.units * 1.5) return 'Deutlich mehr als berechnet.';
  return '';
};
const SRC = { ai: ['KI', ''], openfoodfacts: ['OFF', 'ok'] };
function renderHome() {
  $('hello').textContent = state.patient?.name ? `Hallo ${state.patient.name}` : 'Hallo';
  const has = state.items.length > 0;
  $('empty').hidden = has; $('meal').hidden = !has; $('dock').hidden = !has || state.page !== 'home';
  if (!has) return;
  const { t, d } = current();
  if (d.ok && !state.capsTouched) state.caps = d.capsules;
  $('capCount').textContent = d.ok ? state.caps : '–';
  $('capLabel').textContent = state.caps === 1 && d.ok ? 'Kapsel' : 'Kapseln';
  const dev = deviation(t, d);
  const btn = $('detailsBtn');
  btn.textContent = !d.ok ? 'Lipase-Faktor im Profil eintragen' : dev ? 'Details · Abweichung' : 'Details zur Berechnung';
  btn.classList.toggle('warn', !!dev);
  const ul = $('items'); ul.replaceChildren();
  state.items.forEach((it, i) => {
    const fat = (it.grams * it.per100.fat) / 100;
    const name = el('b', { textContent: it.name });
    if (SRC[it.source]) name.append(el('span', { className: 'tag ' + SRC[it.source][1], textContent: SRC[it.source][0] }));
    if (it.needsReview) name.append(el('span', { className: 'tag review', textContent: 'Bitte prüfen' }));
    const li = el('li', {}, el('span', { className: 'li-main' }, name, el('small', { textContent: `${fmt(it.grams, 0)} g · ${fmt(fat, 1)} g Fett` })), el('span', { className: 'li-end' }, chevron()));
    li.onclick = () => openItem(i);
    ul.append(li);
  });
}
$('detailsBtn').onclick = () => {
  const { t, fe, d } = current();
  if (!d.ok) { showPage('profile'); return; }
  const size = state.settings.capsuleSize, given = state.caps * size;
  kv($('detailsBody'), [
    ['Fett gesamt', fmt(fe, 3) + ' g'], ['Lipase-Faktor', fmt(state.patient.lipasePerGramFat) + ' E pro g'],
    ['Benötigt', fmt(d.units) + ' E'], ['Kapselgröße', fmt(size) + ' E'],
    ['Rechnerisch', fmt(truncated(d.exact, 2), 2) + ' Kapseln'], ['Gewählt', `${state.caps} (${fmt(given)} E)`],
    ['Nährwerte', null], ['Kalorien', fmt(t.kcal) + ' kcal'], ['Kohlenhydrate', fmt(t.carbs, 1) + ' g'], ['Eiweiß', fmt(t.protein, 1) + ' g'],
  ]);
  const w = $('detailsWarn'), dev = deviation(t, d); w.textContent = dev; w.hidden = !dev;
  openDlg('detailsDlg');
};
$('capMinus').onclick = () => { state.caps = Math.max(0, state.caps - 1); state.capsTouched = true; renderHome(); };
$('capPlus').onclick = () => { state.caps = Math.min(50, state.caps + 1); state.capsTouched = true; renderHome(); };
$('saveMeal').onclick = guard(async () => {
  const { d } = current();
  if (!d.ok) { showPage('profile'); throw new Error('Bitte zuerst den Lipase-Faktor eintragen.'); }
  const review = state.items.findIndex((i) => i.needsReview);
  if (review >= 0) { openItem(review); throw new Error('Bitte zuerst die markierten Einträge prüfen und übernehmen.'); }
  try {
    // Der Server rechnet mit dem Faktor aus dem Profil; „basedOnFactor“ meldet, mit welchem Stand diese Ansicht gerechnet hat.
    await call('/meals', 'POST', { items: state.items, capsules: state.caps, capsuleSize: state.settings.capsuleSize, basedOnFactor: state.patient.lipasePerGramFat });
  } catch (e) {
    if (e.status === 409) { const s = await call('/state'); state.patient = s.patient; state.capsTouched = false; fillProfile(); renderHome(); }
    throw e;
  }
  state.items = []; state.capsTouched = false; $('scanMsg').textContent = ''; renderHome(); toast('Gespeichert');
});

// ---- Lebensmittel eingeben / korrigieren ----
function openItem(i = -1) {
  state.editIndex = i;
  const it = state.items[i];
  $('itemForm').reset();
  const issues = it?.issues || [];
  if (it) { $('fName').value = it.name; $('fGrams').value = it.grams; $('fFat').value = issues.includes('fat_missing') ? '' : it.per100.fat; $('fKcal').value = it.per100.kcal; $('fCarbs').value = it.per100.carbs; $('fProt').value = it.per100.protein; } // fehlendes Fett bleibt leer (Pflichtfeld)
  const box = $('itemIssues'); box.hidden = !issues.length; box.replaceChildren(...issues.map((c) => el('li', { textContent: ISSUE_TEXT[c] || c })));
  $('itemTitle').textContent = it ? 'Eintrag korrigieren' : 'Lebensmittel';
  $('itemOk').textContent = it ? 'Übernehmen' : 'Hinzufügen';
  $('itemDel').hidden = !it;
  $('itemDlg').querySelector('details').open = !!it && (it.per100.kcal + it.per100.carbs + it.per100.protein > 0 || issues.some((c) => c === 'kcal_mismatch' || c === 'sum_over_100'));
  openDlg('itemDlg');
}
$('manualBtn').onclick = () => openItem(-1);
$('addBtn').onclick = () => openItem(-1);
$('itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = (id) => Number($(id).value) || 0, old = state.items[state.editIndex];
  const item = { name: $('fName').value.trim(), grams: n('fGrams'), per100: { fat: n('fFat'), kcal: n('fKcal'), carbs: n('fCarbs'), protein: n('fProt') }, source: old?.source || 'manual' };
  if (old) state.items[state.editIndex] = item; else state.items.push(item);
  state.capsTouched = false; $('itemDlg').close(); renderHome();
});
$('itemDel').onclick = () => { state.items.splice(state.editIndex, 1); state.capsTouched = false; $('itemDlg').close(); renderHome(); };

// ---- Scan (Barcode -> Open Food Facts, sonst automatisch KI) ----
const AI_OK = () => { try { return localStorage.getItem('enzymateProAiConsent') === '1'; } catch { return false; } };
async function confirmAi() {
  if (AI_OK()) return true;
  const ok = (await askChoice('aiDlg')) === 'ok';
  if (ok) try { localStorage.setItem('enzymateProAiConsent', '1'); } catch { /* nur für diese Sitzung */ }
  return ok;
}
const notify = ({ title, message }) => askChoice('failDlg', () => { $('failTitle').textContent = title; $('failMsg').textContent = message; });
$('photo').addEventListener('change', guard(async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const msg = $('scanMsg'); msg.textContent = 'Suche Barcode …';
  try {
    const r = await scanImage(file, { api: call, ai: state.ai, confirmAi, notify, status: (t) => (msg.textContent = t) });
    if (!r) { msg.textContent = ''; return; }
    if (r.retry) { msg.textContent = 'Neues Foto aufnehmen – Barcode gut sichtbar, ohne Spiegelung.'; $('photo').click(); return; }
    state.items.push(...r.items); state.capsTouched = false; renderHome();
    const flagged = r.items.filter((i) => i.needsReview).length;
    msg.textContent = flagged ? `${flagged === 1 ? '1 Eintrag ist' : flagged + ' Einträge sind'} markiert: bitte ansehen, korrigieren und übernehmen.` : (r.note || '');
  } catch (err) { msg.textContent = ''; throw err; }
}));

// ---- Verlauf & Auswertung ----
const dFmt = (d, o) => d.toLocaleDateString('de-DE', o);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const currentRange = () => (state.mode === 'custom' && state.custom ? state.custom : rangeFor(state.mode === 'custom' ? 'week' : state.mode, state.day));
function rangeLabel({ from, to }) {
  const last = new Date(to); last.setDate(last.getDate() - 1);
  if (state.mode === 'day') return dFmt(from, { weekday: 'long', day: 'numeric', month: 'long' });
  if (state.mode === 'month') return dFmt(from, { month: 'long', year: 'numeric' });
  return `${dFmt(from, { day: 'numeric', month: 'short' })} – ${dFmt(last, { day: 'numeric', month: 'short' })}`;
}
async function renderHistory() {
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
  const range = currentRange(), custom = state.mode === 'custom';
  $('dayPrev').hidden = $('dayNext').hidden = custom;
  $('dayLabel').textContent = rangeLabel(range);
  $('dayNext').disabled = range.to > new Date();
  const meals = await call(`/meals?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`);
  const days = elapsedDays(range.from, range.to), sum = summarize(meals, days), multi = days > 1;
  state.view = { range, meals, sum, days, label: rangeLabel(range) };
  $('sumCaps').textContent = fmt(sum.capsules); $('sumFat').textContent = fmt(sum.fat, 0) + ' g'; $('sumKcal').textContent = fmt(sum.kcal);
  $('histEmpty').hidden = meals.length > 0; $('summaryBtn').hidden = !meals.length;
  const ul = $('meals'); ul.replaceChildren();
  let lastDay = '';
  for (const m of meals) {
    const d = new Date(m.ts), key = iso(d);
    if (multi && key !== lastDay) { lastDay = key; ul.append(el('li', { className: 'dayhead', textContent: dFmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) })); }
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const li = el('li', {}, el('span', { className: 'li-main' }, el('b', { textContent: m.items.map((i) => i.name).join(', ') }), el('small', { textContent: `${time} · ${fmt(m.totals.fat, 1)} g Fett` })),
      el('span', { className: 'li-end', textContent: `${m.capsules} ×` }));
    li.onclick = () => openMeal(m);
    ul.append(li);
  }
}
$('summaryBtn').onclick = () => {
  const { sum, days, label } = state.view, kg = state.patient.weightKg;
  $('statsTitle').textContent = label;
  const rows = [['Kreon', null], ['Kapseln genommen', fmt(sum.capsules)], ['Einheiten genommen', fmt(sum.units) + ' E'], ['Einheiten empfohlen', fmt(sum.recommended) + ' E']];
  if (kg > 0) rows.push(['Pro kg und Tag', fmt(unitsPerKg(sum.units / days, kg)) + ' E']);
  rows.push(['Nährwerte', null], ['Kalorien', fmt(sum.kcal) + ' kcal'], ['Fett', fmt(sum.fat, 1) + ' g'], ['Kohlenhydrate', fmt(sum.carbs, 1) + ' g'], ['Eiweiß', fmt(sum.protein, 1) + ' g']);
  if (days > 1) rows.push([`Ø pro Tag (${days} Tage)`, null], ['Kalorien', fmt(sum.perDay.kcal) + ' kcal'], ['Fett', fmt(sum.perDay.fat, 1) + ' g'], ['Kapseln', fmt(sum.perDay.capsules, 1)]);
  kv($('statsBody'), rows);
  $('statsNote').textContent = `${sum.meals} ${sum.meals === 1 ? 'Mahlzeit' : 'Mahlzeiten'}. E = Lipase-Einheiten.${days > 1 ? ' Der Durchschnitt zählt alle Tage bis heute.' : ''}`;
  openDlg('statsDlg');
};
function openMeal(m) {
  const d = new Date(m.ts);
  $('mealTitle').textContent = `${dFmt(d, { weekday: 'short', day: 'numeric', month: 'long' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  $('mealItems').replaceChildren(...m.items.map((i) => el('li', {}, el('span', { className: 'li-main' }, el('b', { textContent: i.name })), el('span', { className: 'li-end', textContent: `${fmt(i.grams, 0)} g` }))));
  kv($('mealBody'), [['Kreon', null], ['Genommen', `${m.capsules} × ${fmt(m.capsuleSize)} (${fmt(m.capsules * m.capsuleSize)} E)`], ['Empfohlen', fmt(recommendedUnits(m)) + ' E'],
    ['Nährwerte', null], ['Fett', fmt(m.totals.fat, 1) + ' g'], ['Kalorien', fmt(m.totals.kcal) + ' kcal'], ['Kohlenhydrate', fmt(m.totals.carbs, 1) + ' g'], ['Eiweiß', fmt(m.totals.protein, 1) + ' g']]);
  const del = $('mealDel'); del.textContent = 'Eintrag löschen'; delete del.dataset.sure;
  del.onclick = guard(async () => {
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Wirklich löschen?'; setTimeout(() => { delete del.dataset.sure; del.textContent = 'Eintrag löschen'; }, 3000); return; }
    await call('/meals/' + m.id, 'DELETE'); $('mealDlg').close(); await renderHistory(); toast('Gelöscht');
  });
  openDlg('mealDlg');
}
function openRange() {
  const t = new Date(), f = new Date(); f.setDate(t.getDate() - 6);
  const cur = state.custom; $('rFrom').value = iso(cur ? cur.from : f);
  const last = cur ? new Date(cur.to) : t; if (cur) last.setDate(last.getDate() - 1); $('rTo').value = iso(last);
  openDlg('rangeDlg');
}
$('rangeForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const from = fromIso($('rFrom').value), to = fromIso($('rTo').value); to.setDate(to.getDate() + 1);
  if (!(to > from)) throw new Error('„Bis“ muss nach „Von“ liegen.');
  state.custom = { from, to }; state.mode = 'custom'; $('rangeDlg').close(); await renderHistory();
}));
document.querySelectorAll('#modeSeg button').forEach((b) => (b.onclick = guard(async () => {
  if (b.dataset.mode === 'custom') { openRange(); return; }
  state.mode = b.dataset.mode; await renderHistory();
})));
$('dayLabel').onclick = () => { if (state.mode === 'custom') openRange(); };
const shift = (dir) => { const r = { day: 1, week: 7 }[state.mode]; if (r) state.day.setDate(state.day.getDate() + dir * r); else state.day.setMonth(state.day.getMonth() + dir); };
$('dayPrev').onclick = guard(async () => { shift(-1); await renderHistory(); });
$('dayNext').onclick = guard(async () => { shift(1); await renderHistory(); });


// ---- Bericht für das Arztgespräch ----
async function saveFile(name, text, mime) {
  if (globalThis.enzyDownloads) { // Demo (Artifact): Speichern über die Viewer-Funktion
    const dl = await globalThis.enzyDownloads();
    try { await dl.save({ filename: name, data: text }); } catch (e) { if (e?.code === 'declined') return; throw new Error(`Speichern nicht möglich (${e?.code || 'Fehler'}).`); }
    return;
  }
  const file = new File([text], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) { // iPhone/Android: Teilen-Menü (z. B. „In Dateien sichern“)
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const stat = (value, label, wide) => el('div', { className: 'kpi' + (wide ? ' wide' : '') }, el('b', { textContent: value }), el('span', { textContent: label }));
function chartCard(title, note, svg, legend) {
  const c = el('div', { className: 'chart-card' }, el('h3', { textContent: title }), el('p', { textContent: note }));
  const box = el('div'); box.innerHTML = svg; // SVG wird in report.js nur aus Zahlen und festen Texten gebaut
  c.append(box, el('div', { className: 'legend' }, ...legend));
  return c;
}
const lg = (cls, text) => el('span', {}, el('i', { className: cls }), text);

function renderReport() {
  const v = state.view; if (!v) return;
  const p = state.patient, rep = buildReport({ meals: v.meals, range: v.range, patient: p });
  state.report = { rep, label: v.label };
  const body = $('reportBody'); body.replaceChildren();
  const who = [p.name, p.weightKg && `${fmt(p.weightKg, 1)} kg`, p.heightCm && `${fmt(p.heightCm)} cm`, p.lipasePerGramFat && `Lipase-Faktor ${fmt(p.lipasePerGramFat)} E pro g Fett`].filter(Boolean).join(' · ');
  body.append(el('div', { className: 'rhead' }, el('h2', { textContent: 'Kreon-Protokoll' }), el('p', { textContent: v.label }), el('p', { textContent: who }),
    el('p', { textContent: `Erstellt am ${new Date().toLocaleDateString('de-DE')} mit EnzyMate Pro` })),
  el('div', { className: 'rnote', textContent: 'Grundlage sind nur Mahlzeiten, die mit „Einnahme speichern“ bestätigt wurden. Nicht gespeicherte Mahlzeiten und Tage fehlen. Die Angaben stammen vom Nutzer und sind teils geschätzt.' }));
  const has = rep.total.meals > 0;
  $('rCsv').disabled = $('rCopy').disabled = !has;
  if (!has) { body.append(el('p', { className: 'muted', textContent: 'In diesem Zeitraum sind keine Mahlzeiten gespeichert.' })); return; }

  const a = rep.avg, k = [
    stat(`${rep.entryDays} von ${rep.dayCount}`, 'Tage mit gespeicherten Einträgen'), stat(fmt(rep.total.meals), 'Mahlzeiten'),
    stat(`${fmt(a.fat, 1)} g`, 'Ø Fett pro Tag'), stat(fmt(a.capsules, 1), 'Ø Kapseln pro Tag'),
    stat(`${fmt(a.unitsTaken)} E`, `Ø Lipase pro Tag genommen${rep.unitsPerKgDay ? ` (${fmt(rep.unitsPerKgDay)} E/kg)` : ''}`, true),
    stat(`${fmt(a.kcal)} kcal · ${fmt(a.carbs, 0)} g KH · ${fmt(a.protein, 0)} g Eiweiß`, 'Ø Nährwerte pro Tag', true),
  ];
  if (rep.dosePerGramFat !== null) k.push(stat(`${fmt(rep.dosePerGramFat)} E/g`, `Genommen pro g Fett${rep.factorProfile ? ` (Faktor im Profil: ${fmt(rep.factorProfile)})` : ''}`, true));
  if (rep.coverage !== null) k.push(stat(`${rep.coverage} %`, 'Genommen im Verhältnis zur Empfehlung'));
  k.push(stat(fmt(rep.noKreon), 'Mahlzeiten mit Fett ohne Kreon'), stat(`${fmt(rep.low)} / ${fmt(rep.high)}`, 'Unter 75 % / über 150 % der Empfehlung'));
  if (rep.itemCount) k.push(stat(`${rep.aiItems} von ${rep.itemCount}`, 'Einträge per KI geschätzt'));
  body.append(el('div', { className: 'kpis' }, ...k));

  body.append(el('div', { className: 'charts' },
    chartCard('Fett pro Tag', 'Gramm je Tag mit gespeicherten Mahlzeiten.', barChartSvg(rep.days, [{ key: 'fat', cls: 's1' }], { unit: 'g', title: 'Fett pro Tag in Gramm' }), [lg('l1', 'Fett'), lg('l3', 'keine Einträge')]),
    chartCard('Lipase pro Tag', 'Genommene Einheiten im Vergleich zur Rechnung aus Fett × Faktor.', barChartSvg(rep.days, [{ key: 'unitsTaken', cls: 's1' }, { key: 'unitsRec', cls: 's2' }], { unit: 'E', title: 'Lipase-Einheiten pro Tag, genommen und empfohlen' }), [lg('l1', 'genommen'), lg('l2', 'empfohlen'), lg('l3', 'keine Einträge')])));

  const table = el('table', { className: 'rtable' }, el('thead', {}, el('tr', {}, el('th', { textContent: 'Zeit' }), el('th', { textContent: 'Mahlzeit' }), el('th', { className: 'r', textContent: 'Kreon' }))));
  for (const d of rep.days.filter((x) => x.meals > 0)) {
    const tb = el('tbody', { className: 'daygroup' }); table.append(tb);
    tb.append(el('tr', { className: 'dayrow' }, el('td', { colSpan: 3, textContent: `${dFmt(d.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmt(d.fat, 1)} g Fett · ${fmt(d.capsules)} ${d.capsules === 1 ? 'Kapsel' : 'Kapseln'}` })));
    for (const m of rep.meals.filter((x) => iso(new Date(x.ts)) === d.key)) {
      const t = new Date(m.ts);
      tb.append(el('tr', {}, el('td', { textContent: t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }),
        el('td', {}, m.items.map((i) => `${i.name} (${fmt(i.grams, 0)} g${i.source === 'ai' ? ', KI' : ''})`).join(' + '), el('small', { textContent: `${fmt(m.totals.fat, 1)} g Fett · ${fmt(m.totals.kcal)} kcal · ${fmt(m.totals.carbs, 0)} g KH · ${fmt(m.totals.protein, 0)} g Eiweiß` })),
        el('td', { className: 'r' }, `${m.capsules} × ${fmt(m.capsuleSize)}`, el('small', { textContent: `${fmt(m.capsules * m.capsuleSize)} von ${fmt(recommendedUnits(m))} E` }))));
    }
  }
  body.append(el('div', {}, el('h3', { textContent: 'Mahlzeiten' }), table),
    el('div', { className: 'rfoot' },
      el('p', { textContent: 'E = Lipase-Einheiten. „Empfohlen“ ist der rechnerische Wert aus Fett × Lipase-Faktor (Faktor vom Arzt festgelegt), keine ärztliche Empfehlung.' }),
      el('p', { textContent: 'Durchschnitte beziehen sich nur auf Tage mit gespeicherten Einträgen. Die Auswahl der Kennzahlen ist nicht ärztlich abgestimmt.' })));
}
$('reportBtn').onclick = guard(async () => { renderReport(); showPage('report'); });
$('reportBack').onclick = () => showPage('history');
if (globalThis.enzyDemo) $('rPrint').hidden = true; // im Artifact-Viewer ist Drucken gesperrt
$('rPrint').onclick = () => window.print();
const reportFile = (ext) => { const { rep } = state.report, ks = rep.days; return `enzymate-pro-kreon_${ks[0].key}_${ks[ks.length - 1].key}.${ext}`; };
$('rCsv').onclick = guard(async () => { await saveFile(reportFile('csv'), toCsv(state.report.rep.meals), 'text/csv'); });
$('rCopy').onclick = guard(async () => {
  try { await navigator.clipboard.writeText(toText(state.report.rep, state.patient, state.report.label)); toast('Text kopiert'); }
  catch { throw new Error('Kopieren wird in dieser Ansicht nicht unterstützt.'); }
});

// ---- Profil ----
function fillProfile() {
  const p = state.patient;
  $('pName').value = p.name; $('pHeight').value = p.heightCm ?? ''; $('pWeight').value = p.weightKg ?? ''; $('pFactor').value = p.lipasePerGramFat ?? '';
}
$('profileForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const v = (id) => ($(id).value === '' ? null : Number($(id).value));
  state.patient = await call('/patient', 'PUT', { name: $('pName').value, heightCm: v('pHeight'), weightKg: v('pWeight'), lipasePerGramFat: v('pFactor') });
  state.capsTouched = false; showPage('home'); toast('Profil gespeichert');
}));

// ---- Start ----
guard(async () => {
  const s = await call('/state');
  Object.assign(state, { patient: s.patient, settings: s.settings, sizes: s.capsuleSizes, ai: s.ai });
  fillProfile(); renderSize(); renderHome();
  if (!s.patient.lipasePerGramFat) { $('profileTitle').textContent = 'Einrichten'; showPage('profile'); }
})();
