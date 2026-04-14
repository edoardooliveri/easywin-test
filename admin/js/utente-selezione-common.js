// utente-selezione-common.js — Shared logic for selezione pages
// Called by wrapper pages: initSelezionePagina({ scope, label, returnUrl })

function initSelezionePagina({ scope, label, returnUrl }) {
  const params = new URLSearchParams(location.search);
  const USERNAME = params.get('username');
  const API = '/api/admin';

  function tok() { return localStorage.getItem('easywin_token') || localStorage.getItem('auth_token') || localStorage.getItem('token'); }
  if (!tok()) { location.href = '/index.html'; return; }
  function authHeaders() { const t = tok(); return t ? { 'Authorization': 'Bearer ' + t } : {}; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const app = document.getElementById('app');
  if (!USERNAME) { app.innerHTML = '<div style="padding:60px;text-align:center;color:#dc2626;font-family:Comfortaa">Username mancante</div>'; return; }

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}html,body{margin:0;padding:0;font-family:'Comfortaa',cursive;background:#f5f7fa;color:#1E2D3D}
    .bp-top{background:linear-gradient(135deg,#1E2D3D,#2c3e50);color:#fff;padding:14px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);position:sticky;top:0;z-index:50;flex-wrap:wrap}
    .bp-top h1{font-size:16px;margin:0;font-weight:700;flex:1;min-width:200px}
    .bp-btn{background:rgba(255,255,255,0.12);color:#fff;border:1px solid rgba(255,255,255,0.2);padding:8px 14px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .bp-btn:hover{background:rgba(255,255,255,0.22)}.bp-btn.green{background:#10b981;border-color:#10b981}
    .bp-wrap{max-width:1200px;margin:24px auto;padding:0 24px 60px}
    .bp-card{background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
    .bp-card h2{margin:0 0 14px;font-size:14px;color:#FF8C00;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #fef3e2;padding-bottom:10px;display:flex;align-items:center;gap:10px}
    .bp-toast{position:fixed;bottom:24px;right:24px;background:#1E2D3D;color:#fff;padding:14px 20px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.2);font-size:13px;font-weight:600;display:none;z-index:100;max-width:360px}
    .bp-toast.ok{background:#10b981}.bp-toast.err{background:#dc2626}
    .abtn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;font-family:inherit;font-size:11px;font-weight:700;border:none;cursor:pointer;color:#fff;margin:4px}
    .abtn:hover{opacity:0.85}.abtn.orange{background:#FF8C00}.abtn.blue{background:#2196F3}.abtn.green{background:#4CAF50}.abtn.gray{background:#607D8B}
    .soa-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px}
    .soa-row:hover{background:#fef3e2}
    .soa-row label{flex:1;font-weight:600;cursor:pointer}
    .soa-row input[type=checkbox]{width:18px;height:18px;accent-color:#FF8C00}
    .reg-grid{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
    .reg-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#f1f5f9;border:1px solid #d4dbe5;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer}
    .reg-chip.sel{background:#fef3e2;border-color:#FF8C00;color:#FF8C00}
    .reg-chip input{width:14px;height:14px;accent-color:#FF8C00}
  `;
  document.head.appendChild(style);

  const REGIONI = ['Abruzzo','Basilicata','Calabria','Campania','Emilia-Romagna','Friuli Venezia Giulia','Lazio','Liguria','Lombardia','Marche','Molise','Piemonte','Puglia','Sardegna','Sicilia','Toscana','Trentino-Alto Adige','Umbria','Valle d\'Aosta','Veneto'];

  let SEL = { regioni: [], province: [], soa_lavori: [], soa_servizi: [] };

  function toast(msg, kind) {
    let t = document.getElementById('bp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'bp-toast'; t.className = 'bp-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'bp-toast ' + (kind || ''); t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 4000);
  }

  async function load() {
    app.innerHTML = `
      <div class="bp-top">
        <a class="bp-btn" href="${esc(returnUrl)}?username=${esc(USERNAME)}&mode=view"><i class="fas fa-arrow-left"></i> Torna utente</a>
        <h1>${esc(label)} — ${esc(USERNAME)}</h1>
        <button class="bp-btn green" id="save-btn"><i class="fas fa-save"></i> Salva Selezione</button>
      </div>
      <div class="bp-wrap" id="sel-content"><div style="text-align:center;padding:60px;color:#94a3b8"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:#FF8C00"></i></div></div>
    `;

    try {
      const res = await fetch(API + '/utenti/' + encodeURIComponent(USERNAME) + '/selezione/' + scope, { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      SEL = await res.json();
      render();
    } catch (e) {
      document.getElementById('sel-content').innerHTML = '<div class="bp-card" style="color:#dc2626">Errore: ' + esc(e.message) + '</div>';
    }

    document.getElementById('save-btn').addEventListener('click', save);
  }

  function render() {
    const selRegioni = new Set(SEL.regioni || []);
    let h = '';

    // Regioni
    h += '<div class="bp-card"><h2><i class="fas fa-map"></i> Regioni</h2>';
    h += '<div style="margin-bottom:8px"><button class="abtn green" onclick="document.querySelectorAll(\'.reg-cb\').forEach(c=>{c.checked=true;c.dispatchEvent(new Event(\'change\'))})">Tutte</button>';
    h += '<button class="abtn gray" onclick="document.querySelectorAll(\'.reg-cb\').forEach(c=>{c.checked=false;c.dispatchEvent(new Event(\'change\'))})">Nessuna</button></div>';
    h += '<div class="reg-grid">';
    REGIONI.forEach(r => {
      const checked = selRegioni.has(r) ? 'checked' : '';
      h += '<label class="reg-chip ' + (selRegioni.has(r) ? 'sel' : '') + '"><input type="checkbox" class="reg-cb" value="' + esc(r) + '" ' + checked + '>' + esc(r) + '</label>';
    });
    h += '</div></div>';

    // Copy buttons
    const otherScopes = ['bandi', 'esiti', 'newsletter_bandi', 'newsletter_esiti'].filter(s => s !== scope);
    h += '<div class="bp-card"><h2><i class="fas fa-copy"></i> Copia su altra sezione</h2>';
    otherScopes.forEach(s => {
      const lbl = s.replace('_', ' ');
      h += '<button class="abtn blue" data-copy-to="' + s + '"><i class="fas fa-copy"></i> Copia su ' + esc(lbl) + '</button>';
    });
    h += '</div>';

    // SOA Lavori
    h += renderSoaSection('Categorie Lavori (SOA)', SEL.soa_lavori || [], 'lavori');

    // SOA Servizi
    h += renderSoaSection('Categorie Servizi', SEL.soa_servizi || [], 'servizi');

    document.getElementById('sel-content').innerHTML = h;

    // Events
    document.querySelectorAll('.reg-cb').forEach(cb => {
      cb.addEventListener('change', function() {
        this.closest('.reg-chip').classList.toggle('sel', this.checked);
      });
    });
    document.querySelectorAll('[data-copy-to]').forEach(btn => {
      btn.addEventListener('click', async function() {
        const to = this.dataset.copyTo;
        if (!confirm('Copiare la selezione corrente su "' + to + '"?')) return;
        try {
          const res = await fetch(API + '/utenti/' + encodeURIComponent(USERNAME) + '/selezione/copia', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ from: scope, to })
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          toast('Copiato su ' + to, 'ok');
        } catch (e) { toast('Errore: ' + e.message, 'err'); }
      });
    });
  }

  function renderSoaSection(title, items, tipo) {
    let h = '<div class="bp-card"><h2><i class="fas fa-hard-hat"></i> ' + esc(title) + '</h2>';
    h += '<div style="margin-bottom:8px"><button class="abtn green" onclick="document.querySelectorAll(\'.' + tipo + '-cb\').forEach(c=>c.checked=true)">Tutte</button>';
    h += '<button class="abtn gray" onclick="document.querySelectorAll(\'.' + tipo + '-cb\').forEach(c=>c.checked=false)">Nessuna</button></div>';

    if (!items.length) {
      // Generate standard SOA codes
      const codes = tipo === 'lavori'
        ? ['OG1','OG2','OG3','OG4','OG5','OG6','OG7','OG8','OG9','OG10','OG11','OG12','OG13','OS1','OS2-A','OS2-B','OS3','OS4','OS5','OS6','OS7','OS8','OS9','OS10','OS11','OS12-A','OS12-B','OS13','OS14','OS15','OS16','OS17','OS18-A','OS18-B','OS19','OS20-A','OS20-B','OS21','OS22','OS23','OS24','OS25','OS26','OS27','OS28','OS29','OS30','OS31','OS32','OS33','OS34','OS35']
        : ['IA01','IA02','IA03','IA04','IB01','IB02','IB03','IB04','IB05','IB06','IB07','IB08','IB09','IB10','IB11'];
      items = codes.map(c => ({ id: c, codice: c, selezionato: false, regioni: [], province: [] }));
    }

    items.forEach(item => {
      h += '<div class="soa-row"><input type="checkbox" class="' + tipo + '-cb" data-tipo="' + tipo + '" data-id="' + esc(item.id || item.codice) + '" ' + (item.selezionato ? 'checked' : '') + '>';
      h += '<label>' + esc(item.codice || item.id) + (item.descrizione ? ' — ' + esc(item.descrizione) : '') + '</label></div>';
    });
    h += '</div>';
    return h;
  }

  async function save() {
    // Collect regioni
    const regioni = [];
    document.querySelectorAll('.reg-cb:checked').forEach(cb => regioni.push(cb.value));

    // Collect SOA
    const collectSoa = (tipo) => {
      const items = [];
      document.querySelectorAll('.' + tipo + '-cb').forEach(cb => {
        items.push({ id: cb.dataset.id, codice: cb.dataset.id, selezionato: cb.checked, regioni: [], province: [] });
      });
      return items;
    };

    const body = {
      regioni,
      province: SEL.province || [],
      soa_lavori: collectSoa('lavori'),
      soa_servizi: collectSoa('servizi'),
    };

    try {
      const res = await fetch(API + '/utenti/' + encodeURIComponent(USERNAME) + '/selezione/' + scope, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      toast('Selezione salvata!', 'ok');
    } catch (e) { toast('Errore: ' + e.message, 'err'); }
  }

  load();
}
