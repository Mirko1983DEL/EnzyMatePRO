// Snack-Kompass: Oberfläche (Auswahl auf der Startseite, Ergebnis im Pop-up). Wiederverwendbar: alles Nötige kommt über `deps`.
import { SNACK_WISHES, SNACK_MOODS, SNACK_HUNGER, cleanSnackRequest, snackProfile, fallbackAdvice } from './snack.js';

export function initSnackCompass({ $, el, call, state, askChoice, toast, guard, adopt, openManual, eatenToday }) {
  const CONSENT = 'enzymateProSnackConsent';
  const consented = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
  const options = (obj, first) => [el('option', { value: '', textContent: first }), ...Object.entries(obj).map(([v, t]) => el('option', { value: v, textContent: t }))];
  $('snackMood').replaceChildren(...options(SNACK_MOODS, 'Stimmung'));
  $('snackHunger').replaceChildren(...options(SNACK_HUNGER, 'Hunger'));
  $('snackWishes').replaceChildren(...SNACK_WISHES.map((w) => el('button', { className: 'btn quiet wish', type: 'button', textContent: w.label, onclick: guard(() => run({ wishId: w.id })) })));
  $('snackForm').addEventListener('submit', guard(async (e) => { e.preventDefault(); await run({ wishId: 'custom', text: $('snackText').value }); }));
  $('snackClose').onclick = () => $('snackDlg').close();
  $('snackJump').onclick = () => $('snack').scrollIntoView({ behavior: 'smooth', block: 'start' });

  async function run(input) {
    const req = { ...input, mood: $('snackMood').value, hunger: $('snackHunger').value };
    try { cleanSnackRequest(req); } catch (e) { toast(e.message); return; }
    const profile = snackProfile(state.patient);
    const fixed = (notice) => show({ source: 'fallback', notice, options: fallbackAdvice(input.wishId, profile) });
    if (!state.ai) return fixed('Die KI ist nicht eingerichtet. Hier sind feste Hinweise.');
    if (!consented()) {
      if ((await askChoice('snackAiDlg')) !== 'ok') return fixed('Ohne KI-Einwilligung gibt es feste Hinweise.');
      try { localStorage.setItem(CONSENT, '1'); } catch { /* nur für diese Sitzung */ }
    }
    let result;
    try { result = await call('/snack-advice', 'POST', { ...req, eaten: await eatenToday() }); }
    catch (e) { return fixed(e.status === 0 || navigator.onLine === false ? 'Keine Verbindung (offline?). Hier sind feste Hinweise.' : 'Die KI-Beratung hat gerade nicht geklappt. Hier sind feste Hinweise.'); }
    show(result);
  }

  function card(o, source) {
    const c = el('section', { className: 'snack-opt' }, el('h4', { textContent: `${o.key} · ${o.title}` }), el('p', { textContent: o.text }));
    if (o.items?.length) {
      c.append(el('p', { className: 'muted small', textContent: `Vorschlag: ${o.items.map((i) => `${i.name} (${Math.round(i.grams)} g)`).join(', ')} – Nährwerte geschätzt.` }),
        el('button', { className: 'btn quiet', type: 'button', textContent: 'In Mahlzeit übernehmen', onclick: () => { adopt(o.items); $('snackDlg').close(); toast('Übernommen – Menge und Fett bitte prüfen'); } }));
    } else if (source === 'fallback' && o.key !== 'C') {
      c.append(el('button', { className: 'btn quiet', type: 'button', textContent: 'Manuell eintragen', onclick: () => { $('snackDlg').close(); openManual(); } }));
    }
    return c;
  }
  function show({ options: opts, notice, source }) {
    $('snackNotice').textContent = notice || ''; $('snackNotice').hidden = !notice;
    $('snackOpts').replaceChildren(...opts.map((o) => card(o, source)));
    $('snackDlg').showModal();
  }
}
