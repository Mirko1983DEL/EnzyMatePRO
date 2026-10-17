// Echte API: spricht mit dem Node-Server. (Die Demo-Version ersetzt dieses Modul durch lokalen Speicher.)
let token = '';
try { token = localStorage.getItem('enzymateProToken') || ''; } catch {}

function askToken() {
  return new Promise((resolve) => {
    const dlg = document.getElementById('tokenDlg'); dlg.showModal();
    document.getElementById('tokenForm').onsubmit = () => {
      token = document.getElementById('tokenInput').value;
      try { localStorage.setItem('enzymateProToken', token); } catch {}
      resolve();
    };
  });
}

const fail = (message, status) => Object.assign(new Error(message), { status });

export async function api(path, method = 'GET', body) {
  let res;
  try { res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', 'x-access-token': token }, body: body && JSON.stringify(body) }); }
  catch { throw fail('Keine Verbindung zum Server. Bitte Netz prüfen. Deine Eingaben bleiben erhalten.', 0); }
  if (res.status === 401) { await askToken(); return api(path, method, body); }
  let data = null;
  try { data = await res.json(); } catch { /* Antwort war kein JSON */ }
  if (!res.ok) {
    throw fail(data?.error || (res.status >= 500 ? `Der Server hat gerade ein Problem (Fehler ${res.status}). Bitte später noch einmal versuchen.` : `Das hat nicht geklappt (Fehler ${res.status}).`), res.status);
  }
  if (data === null) throw fail('Die Antwort des Servers war nicht lesbar. Bitte später noch einmal versuchen.', res.status);
  return data;
}
