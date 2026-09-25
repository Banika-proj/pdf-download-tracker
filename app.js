/* ══════════════════════════════════════════════════════════════
   THE DESK — PDF Download Tracker
   Backend: Cloudflare Pages Functions + D1 (see /functions/api).
   Sync model: fetch-on-load + fetch-after-every-write (instant for the
   person acting) + background poll every 8s (picks up others' changes).
   ══════════════════════════════════════════════════════════════ */

const API = '/api';
const STATE = { publications: [], logs: [], notes: [] };

/* ---- low-level API helpers ---- */
async function apiGet(path) {
  const res = await fetch(API + '/' + path);
  if (!res.ok) throw new Error('GET ' + path + ' failed (' + res.status + ')');
  return res.json();
}
async function apiSend(method, path, body) {
  const res = await fetch(API + '/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const t = await res.text(); throw new Error(method + ' ' + path + ' failed (' + res.status + '): ' + t); }
  return res.json();
}

async function apiFetchState() {
  const data = await apiGet('state');
  STATE.publications = data.publications;
  STATE.logs = data.logs;
  STATE.notes = data.notes;
}
async function refreshFromServer() {
  await apiFetchState();
  refreshAll();
}
function refreshAll() { renderRail(); renderPage(); updateProgress(); }

function safe(fn, fallback) { try { return fn(); } catch(e) { console.error(e); return fallback; } }

/* ---- DB façade (reads from in-memory cache kept fresh by the sync model above) ---- */
const DB = {
  getPublications() { return STATE.publications; },
  getLogs() { return STATE.logs; },
  getNotes() { return STATE.notes; },
};

function setConnBadge(live) {
  const el = document.getElementById('conn-badge');
  if (!el) return;
  el.className = 'conn-wrap ' + (live ? 'conn-live' : 'conn-off');
  el.innerHTML = `<span class="conn-dot"></span>${live ? 'Live — synced' : 'Reconnecting…'}`;
}

/* ══════════════════════════════════════════════════════════════
   WHO'S WORKING (lightweight name gate — no password, per device)
   ══════════════════════════════════════════════════════════════ */
function getMe() { const s = localStorage.getItem('desk_me'); return s ? JSON.parse(s) : null; }
function setMe(name, role) { localStorage.setItem('desk_me', JSON.stringify({name, role})); }
function initials(name) { return (name||'?').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

function renderGate() {
  document.getElementById('gate').innerHTML = `
    <div class="gate-card">
      <div class="mark">🗞️</div>
      <h2>Who's working today?</h2>
      <p class="sub">Just so entries show who logged them. No password needed — we can add real accounts later.</p>
      <label class="flabel">Your name</label>
      <input id="gate-name" class="field" style="margin-bottom:0.9rem;" placeholder="e.g. Priya Shah">
      <label class="flabel">Role</label>
      <div class="gate-row">
        <div class="gate-role active" id="gate-role-vendor" onclick="setGateRole('vendor')">Vendor</div>
        <div class="gate-role" id="gate-role-owner" onclick="setGateRole('owner')">Owner</div>
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="submitGate()">Continue</button>
    </div>`;
  window._gateRole = 'vendor';
  document.getElementById('gate-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitGate(); });
  setTimeout(() => document.getElementById('gate-name')?.focus(), 50);
}
function setGateRole(r) {
  window._gateRole = r;
  document.getElementById('gate-role-vendor').classList.toggle('active', r==='vendor');
  document.getElementById('gate-role-owner').classList.toggle('active', r==='owner');
}
function submitGate() {
  const name = document.getElementById('gate-name').value.trim();
  if (!name) { document.getElementById('gate-name').focus(); return; }
  setMe(name, window._gateRole || 'vendor');
  document.getElementById('gate').style.display = 'none';
  bootApp();
}
function switchUser() {
  localStorage.removeItem('desk_me');
  document.getElementById('gate').style.display = 'flex';
  renderGate();
}

/* ══════════════════════════════════════════════════════════════
   DATE HELPERS
   ══════════════════════════════════════════════════════════════ */
function todayStr() { return fmtDate(new Date()); }
function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeekMon(d) { const r = new Date(d); const dow = (d.getDay()+6)%7; r.setDate(d.getDate()-dow); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth()+1, 0); }
function datesInRange(startS, endS) { const dates = []; let cur = parseDate(startS); const end = parseDate(endS); while (cur <= end) { dates.push(fmtDate(cur)); cur = addDays(cur, 1); } return dates; }
function fmtDisplay(dateStr) { return parseDate(dateStr).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'}); }
function fmtShort(dateStr) { return parseDate(dateStr).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}); }

/* ══════════════════════════════════════════════════════════════
   SCHEDULING (core logic — unchanged, previously tested)
   ══════════════════════════════════════════════════════════════ */
const DAY_MAP = {sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
const NATURAL_FREQS = new Set(['monthly','bi-monthly','quarterly','annual']);
const FREQ_ORDER = ['daily','weekly','fortnightly','monthly','bi-monthly','quarterly','annual'];

function isDueOnDate(freq, expectedDay, dateStr) {
  const d = parseDate(dateStr);
  const dow = d.getDay(), dom = d.getDate(), month = d.getMonth();
  switch(freq) {
    case 'daily': return dow >= 1 && dow <= 5;
    case 'weekly': { if (!expectedDay) return dow === 1; const ed = DAY_MAP[expectedDay.trim().toLowerCase()]; return dow === (ed === undefined ? 1 : ed); }
    case 'fortnightly': {
      if (expectedDay && expectedDay.includes('1st and 15th')) return dom === 1 || dom === 15;
      if (expectedDay && expectedDay.includes('15th & 30th')) return dom === 15 || dom === 30;
      if (!expectedDay) return dow === 5;
      const ed = DAY_MAP[expectedDay.trim().toLowerCase()]; return dow === (ed === undefined ? 5 : ed);
    }
    case 'monthly': return dom === 1;
    case 'bi-monthly': return dom === 1 && month % 2 === 0;
    case 'quarterly': return dom === 1 && [0,3,6,9].includes(month);
    case 'annual': return dom === 1 && month === 0;
    default: return false;
  }
}
function getNaturalPeriod(freq, dueDateStr) {
  const d = parseDate(dueDateStr);
  switch(freq) {
    case 'daily': return {start:dueDateStr, end:dueDateStr};
    case 'weekly': { const s = startOfWeekMon(d); return {start:fmtDate(s), end:fmtDate(addDays(s,6))}; }
    case 'fortnightly': {
      const dom = d.getDate();
      if (dom <= 15) return {start:fmtDate(startOfMonth(d)), end:fmtDate(new Date(d.getFullYear(),d.getMonth(),15))};
      return {start:fmtDate(new Date(d.getFullYear(),d.getMonth(),16)), end:fmtDate(endOfMonth(d))};
    }
    case 'monthly': return {start:fmtDate(startOfMonth(d)), end:fmtDate(endOfMonth(d))};
    case 'bi-monthly': { const pm = d.getMonth()%2===0 ? d.getMonth() : d.getMonth()-1; return {start:fmtDate(new Date(d.getFullYear(),pm,1)), end:fmtDate(endOfMonth(new Date(d.getFullYear(),pm+1,1)))}; }
    case 'quarterly': { const qm = Math.floor(d.getMonth()/3)*3; return {start:fmtDate(new Date(d.getFullYear(),qm,1)), end:fmtDate(endOfMonth(new Date(d.getFullYear(),qm+2,1)))}; }
    case 'annual': return {start:`${d.getFullYear()}-01-01`, end:`${d.getFullYear()}-12-31`};
    default: return {start:dueDateStr, end:dueDateStr};
  }
}
function getDueDateInCurrentPeriod(freq, expectedDay, todayDateStr) {
  const period = getNaturalPeriod(freq, todayDateStr);
  for (const d of datesInRange(period.start, todayDateStr)) if (isDueOnDate(freq, expectedDay, d)) return d;
  return null;
}

/* ══════════════════════════════════════════════════════════════
   LOG + NOTE HELPERS (cache reads; API writes)
   ══════════════════════════════════════════════════════════════ */
function getLogsForPubInPeriod(pubId, start, end) { return STATE.logs.filter(l => l.publicationId === pubId && l.logDate >= start && l.logDate <= end); }

async function upsertLog(pubId, logDate, downloaded, timeDownloaded, reasonWhenNo) {
  const me = getMe();
  await apiSend('POST', 'logs', {
    publicationId: pubId, logDate, downloaded,
    timeDownloaded: timeDownloaded || null,
    reasonWhenNo: reasonWhenNo || null,
    createdAt: new Date().toISOString(),
    createdBy: me ? me.name : 'Unknown',
  });
  await refreshFromServer();
}
async function deleteLog(pubId, logDate) {
  await apiSend('DELETE', 'logs', { publicationId: pubId, logDate });
  await refreshFromServer();
}
function nowTime() { const n = new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; }
function getNotesForEntry(pubId, entryDate) { return STATE.notes.filter(n => n.publicationId===pubId && n.entryDate===entryDate).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')); }
async function addNote(pubId, entryDate, comment) {
  const me = getMe();
  await apiSend('POST', 'notes', { publicationId: pubId, entryDate, noteDate: todayStr(), comment, createdAt: new Date().toISOString(), createdBy: me ? me.name : 'Unknown' });
  await refreshFromServer();
}
async function deleteNoteRec(id) { await apiSend('DELETE', 'notes/' + id); await refreshFromServer(); }
function getMostRecentNote(pubId, entryDate) { const n = getNotesForEntry(pubId, entryDate); return n.length ? n[0] : null; }

/* ══════════════════════════════════════════════════════════════
   CHECKLIST BUILD
   ══════════════════════════════════════════════════════════════ */
function buildChecklist(dateStr) {
  const pubs = DB.getPublications().filter(p => p.isActive && !p.deletedAt);
  const items = [];
  for (const pub of pubs) {
    const freq = pub.frequency;
    if (NATURAL_FREQS.has(freq)) {
      const dueDateInPeriod = getDueDateInCurrentPeriod(freq, pub.expectedDay, dateStr);
      if (!dueDateInPeriod) continue;
      const period = getNaturalPeriod(freq, dueDateInPeriod);
      const periodLogs = getLogsForPubInPeriod(pub.id, period.start, period.end);
      if (periodLogs.find(l => l.downloaded === 'Y')) continue;
      const log = periodLogs.sort((a,b)=>b.logDate.localeCompare(a.logDate))[0] || null;
      items.push({pub, logDate: dateStr, dueDateInPeriod, log});
    } else {
      if (!isDueOnDate(freq, pub.expectedDay, dateStr)) continue;
      const log = STATE.logs.find(l => l.publicationId===pub.id && l.logDate===dateStr) || null;
      items.push({pub, logDate: dateStr, dueDateInPeriod: null, log});
    }
  }
  items.sort((a,b) => { const fd = FREQ_ORDER.indexOf(a.pub.frequency)-FREQ_ORDER.indexOf(b.pub.frequency); return fd!==0 ? fd : a.pub.name.localeCompare(b.pub.name); });
  return items;
}

/* ══════════════════════════════════════════════════════════════
   SHARED UI BITS
   ══════════════════════════════════════════════════════════════ */
function esc(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function pillHtml(freq) { return `<span class="pill pill-${freq}">${freq}</span>`; }
function statusHtml(log, overdue) {
  if (!log) return overdue ? `<span class="status status-o">Overdue</span>` : `<span class="status status-p">Pending</span>`;
  if (log.downloaded === 'Y') return `<span class="status status-y">Downloaded${log.timeDownloaded?' · '+log.timeDownloaded:''}</span>`;
  if (log.downloaded === 'W') return `<span class="status status-w">Awaiting</span>`;
  return `<span class="status status-n">Not downloaded</span>`;
}
function statCard(label, value, colorVar) { return `<div class="panel stat"><p class="l">${label}</p><p class="v" style="color:var(${colorVar});">${value}</p></div>`; }
function credCell(password, uid) {
  if (!password) return `<span class="muted">—</span>`;
  const dots = '•'.repeat(Math.min(password.length, 8));
  return `<span id="${uid}" data-pwd="${esc(password)}" data-vis="0" style="display:inline-flex;align-items:center;gap:0.3rem;">
    <span class="pwd-text mono" style="font-size:0.75rem;color:var(--ink-soft);">${dots}</span>
    <button class="icon-btn" onclick="togglePwd('${uid}')" title="Show / hide">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </span>`;
}
function togglePwd(id) {
  const el = document.getElementById(id); if (!el) return;
  el.dataset.vis = el.dataset.vis === '1' ? '0' : '1';
  const pwd = el.dataset.pwd || '';
  el.querySelector('.pwd-text').textContent = el.dataset.vis === '1' ? pwd : '•'.repeat(Math.min(pwd.length,8));
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
function linkHtml(link) {
  if (!link) return `<span class="muted">—</span>`;
  return link.startsWith('http')
    ? `<a href="${esc(link)}" target="_blank" rel="noopener" style="color:var(--accent-ink);font-size:0.78rem;text-decoration:none;">Open ↗</a>`
    : `<span class="muted" style="font-size:0.78rem;">${esc(link)}</span>`;
}

/* ══════════════════════════════════════════════════════════════
   RAIL / PROGRESS
   ══════════════════════════════════════════════════════════════ */
const NAV_ITEMS = [
  {id:'checklist', label:"Today's Checklist", icon:`<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`},
  {id:'timeliness', label:'Timeliness Report', icon:`<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>`},
  {id:'publications', label:'Publications', icon:`<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.25v13m0-13C10.83 5.48 9.25 5 7.5 5S4.17 5.48 3 6.25v13C4.17 18.48 5.75 18 7.5 18s3.33.48 4.5 1.25m0-13c1.17-.77 2.75-1.25 4.5-1.25s4.33.48 4.5 1.25v13c-1.17-.77-2.75-1.25-4.5-1.25s-3.33.48-4.5 1.25"/>`},
  {id:'logs', label:'Download Logs', icon:`<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>`},
];
function renderRail() {
  const today = todayStr();
  const dueToday = safe(()=>buildChecklist(today).length, 0);
  document.getElementById('rail-nav').innerHTML = NAV_ITEMS.map(n => `
    <div class="rail-link ${currentPage===n.id?'active':''}" onclick="navigate('${n.id}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${n.icon}</svg>
      ${n.label}
      ${n.id==='checklist' && dueToday>0 ? `<span class="count">${dueToday}</span>` : ''}
    </div>`).join('');
  const me = getMe();
  const whoEl = document.getElementById('who-chip');
  if (whoEl && me) whoEl.innerHTML = `<span class="who-avatar">${initials(me.name)}</span>${esc(me.name)} · ${me.role}`;
}
function updateProgress() {
  const today = todayStr();
  const pubs = DB.getPublications().filter(p => p.isActive && !p.deletedAt);
  let totalDue=0, downloaded=0;
  for (const p of pubs) {
    if (NATURAL_FREQS.has(p.frequency)) {
      const dd = getDueDateInCurrentPeriod(p.frequency, p.expectedDay, today);
      if (!dd) continue;
      totalDue++;
      const per = getNaturalPeriod(p.frequency, dd);
      if (getLogsForPubInPeriod(p.id, per.start, per.end).some(l=>l.downloaded==='Y')) downloaded++;
    } else {
      if (!isDueOnDate(p.frequency, p.expectedDay, today)) continue;
      totalDue++;
      if (STATE.logs.find(l=>l.publicationId===p.id && l.logDate===today && l.downloaded==='Y')) downloaded++;
    }
  }
  const pct = totalDue>0 ? Math.round(downloaded/totalDue*100) : 0;
  const pEl = document.getElementById('foot-progress'); if (pEl) pEl.textContent = `${downloaded} / ${totalDue}`;
  const bEl = document.getElementById('foot-bar'); if (bEl) bEl.style.width = pct+'%';
}

/* ══════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════ */
let currentPage = 'checklist';
function navigate(page) {
  currentPage = page;
  document.getElementById('rail').classList.remove('open');
  renderRail(); renderPage(); updateProgress();
  window.scrollTo(0,0);
}
function renderPage() {
  const el = document.getElementById('page');
  if (!el) return;
  el.className = 'page-enter';
  switch(currentPage) {
    case 'checklist': el.innerHTML = renderChecklist(); break;
    case 'timeliness': el.innerHTML = renderTimeliness(); bindTimeliness(); break;
    case 'publications': el.innerHTML = renderPublications(); break;
    case 'logs': el.innerHTML = renderLogs(); break;
  }
}

/* ══════════════════════════════════════════════════════════════
   PAGE: CHECKLIST
   ══════════════════════════════════════════════════════════════ */
const NO_REASONS = ['Publisher/Website issue','Subscription expired','No new edition','Missed','WAD down','Arrived late in mailbox','Published late on website','Other'];
let _checklistDate = '';
let _checklistView = 'due';
function getChecklistDate() { return _checklistDate || todayStr(); }
function checklistNavDate(delta) { const next = addDays(parseDate(getChecklistDate()), delta); if (fmtDate(next) > todayStr()) return; _checklistDate = fmtDate(next); renderPage(); }
function checklistSetDate(val) { if (val > todayStr()) return; _checklistDate = val; renderPage(); }
function setChecklistView(v) { _checklistView = v; renderPage(); }

function renderChecklist() {
  const viewDate = getChecklistDate();
  const today = todayStr();
  const isToday = viewDate === today;
  const items = buildChecklist(viewDate);

  const dueItems = items.filter(i => !i.dueDateInPeriod || i.dueDateInPeriod === viewDate || i.log?.downloaded === 'W');
  const overdueItems = items.filter(i => i.dueDateInPeriod && i.dueDateInPeriod !== viewDate && i.log?.downloaded !== 'W');

  const countDoneNatural = DB.getPublications().filter(p => p.isActive && !p.deletedAt && NATURAL_FREQS.has(p.frequency) && (() => {
    const dd = getDueDateInCurrentPeriod(p.frequency, p.expectedDay, viewDate);
    if (!dd) return false;
    const per = getNaturalPeriod(p.frequency, dd);
    return getLogsForPubInPeriod(p.id, per.start, per.end).some(l => l.downloaded==='Y');
  })()).length;

  const downloaded = dueItems.filter(i=>i.log?.downloaded==='Y').length + countDoneNatural;
  const total = dueItems.length + countDoneNatural;
  const missed = dueItems.filter(i=>i.log?.downloaded==='N').length;
  const pending = dueItems.filter(i=>!i.log).length;
  const awaiting = dueItems.filter(i=>i.log?.downloaded==='W').length;

  const pendingDailyIds = isToday ? dueItems.filter(i=>i.pub.frequency==='daily' && !i.log).map(i=>i.pub.id) : [];

  let list, emptyLabel;
  if (_checklistView === 'overdue') { list = overdueItems; emptyLabel = 'Nothing overdue — the current period is clear.'; }
  else if (_checklistView === 'all') { list = [...dueItems, ...overdueItems]; emptyLabel = 'No active publications match this date.'; }
  else { list = dueItems; emptyLabel = 'No publications expected on this date.'; }

  const rows = list.map(item => renderChecklistRow(item, viewDate, overdueItems.includes(item))).join('');

  return `
  <div class="hd">
    <div><h1>Today's Checklist</h1><p class="sub">${isToday ? "Managing downloads for today" : 'Viewing'} — ${fmtDisplay(viewDate)}</p></div>
    <div style="display:flex;align-items:center;gap:0.45rem;">
      <button class="btn btn-outline btn-sm" onclick="checklistNavDate(-1)">‹</button>
      <input type="date" class="field" style="width:auto;padding:0.4rem 0.6rem;" value="${viewDate}" max="${today}" onchange="checklistSetDate(this.value)">
      <button class="btn btn-outline btn-sm" onclick="checklistNavDate(1)" ${isToday?'disabled':''}>›</button>
      ${!isToday ? `<button class="btn btn-outline btn-sm" onclick="_checklistDate='';renderPage()">Today</button>` : ''}
    </div>
  </div>
  ${!isToday ? `<div class="banner banner-amber" style="margin-bottom:1rem;">Viewing a past date — marks you save here log against <strong>${fmtDisplay(viewDate)}</strong>.</div>` : ''}
  ${pendingDailyIds.length ? `<div class="banner banner-accent" style="margin-bottom:1rem;">
      <span><strong>${pendingDailyIds.length}</strong> daily publication${pendingDailyIds.length!==1?'s':''} still pending today</span>
      <button class="btn btn-accent btn-sm" onclick="markAllDaily()">Mark all daily as downloaded</button>
    </div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.85rem;margin-bottom:1.4rem;">
    ${statCard('Expected', total, '--ink')}${statCard('Downloaded', downloaded, '--accent')}${statCard('Pending', pending+awaiting, '--amber')}${statCard('Missed', missed, '--red')}
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.9rem;">
    <div class="seg">
      <button class="${_checklistView==='due'?'active':''}" onclick="setChecklistView('due')">Due (${dueItems.length})</button>
      <button class="${_checklistView==='overdue'?'active':''}" onclick="setChecklistView('overdue')">Overdue (${overdueItems.length})</button>
      <button class="${_checklistView==='all'?'active':''}" onclick="setChecklistView('all')">All active</button>
    </div>
  </div>
  <div class="panel twrap">
    <table>
      <thead><tr><th class="th">Publication</th><th class="th">Frequency</th><th class="th">Expected</th><th class="th">Status</th><th class="th">Link</th><th class="th">Credentials</th><th class="th">Notes</th><th class="th" style="text-align:right;">Action</th></tr></thead>
      <tbody>${rows || `<tr><td class="td empty" colspan="8">${emptyLabel}</td></tr>`}</tbody>
    </table>
  </div>`;
}
function renderChecklistRow(item, viewDate, isOverdue) {
  const {pub, log, dueDateInPeriod} = item;
  const entryDate = dueDateInPeriod || viewDate;
  const isMissed = log?.downloaded==='N', isDownloaded = log?.downloaded==='Y', isAwaiting = log?.downloaded==='W', isPending = !log;

  let actions = '';
  if (isPending) {
    actions = `<button class="btn btn-accent btn-sm" onclick="markLog(${pub.id},'Y','${viewDate}',null)">Mark yes</button>
      <button class="btn btn-danger btn-sm" onclick="openReasonModal(${pub.id},'${viewDate}','${jsEsc(pub.name)}')">Mark no</button>
      ${isOverdue ? `<button class="btn btn-outline btn-sm" onclick="markLog(${pub.id},'W','${viewDate}',null)">Awaiting</button>` : ''}`;
  } else if (isMissed) {
    actions = `<button class="btn btn-accent btn-sm" onclick="markLog(${pub.id},'Y','${viewDate}',null)">Arrived late ✓</button>
      <button class="btn btn-ghost btn-sm" onclick="openReasonModal(${pub.id},'${viewDate}','${jsEsc(pub.name)}')">Edit reason</button>`;
  } else if (isDownloaded) {
    actions = `<button class="btn btn-ghost btn-sm" onclick="undoLog(${pub.id},'${viewDate}')">Undo</button>`;
  } else if (isAwaiting) {
    actions = `<button class="btn btn-accent btn-sm" onclick="markLog(${pub.id},'Y','${viewDate}',null)">Mark arrived</button>
      <button class="btn btn-ghost btn-sm" onclick="undoLog(${pub.id},'${viewDate}')">Undo</button>`;
  }

  const expected = dueDateInPeriod
    ? `<span style="font-size:0.78rem;color:${isOverdue?'var(--red)':'var(--ink-soft)'};">${fmtShort(dueDateInPeriod)}${isOverdue?' ⏰':''}</span>`
    : `<span style="font-size:0.78rem;color:var(--ink-soft);">${fmtShort(viewDate)}</span>`;

  const recentNote = getMostRecentNote(pub.id, entryDate);
  const notesCount = getNotesForEntry(pub.id, entryDate).length;
  const notesCell = recentNote
    ? `<button onclick="openNotesModal(${pub.id},'${entryDate}','${jsEsc(pub.name)}')" style="all:unset;cursor:pointer;font-size:0.78rem;color:var(--ink-soft);max-width:11rem;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(recentNote.comment)}${notesCount>1?` <span class="muted">(+${notesCount-1})</span>`:''}</button>`
    : `<button onclick="openNotesModal(${pub.id},'${entryDate}','${jsEsc(pub.name)}')" style="all:unset;cursor:pointer;font-size:0.78rem;color:var(--ink-faint);">+ Add</button>`;

  const byLine = log && log.createdBy ? `<div class="entry-by">by ${esc(log.createdBy)}</div>` : '';

  return `<tr>
    <td class="td"><div style="font-weight:500;">${esc(pub.name)}</div></td>
    <td class="td">${pillHtml(pub.frequency)}</td>
    <td class="td">${expected}</td>
    <td class="td">${statusHtml(log, isOverdue)}${byLine}</td>
    <td class="td">${linkHtml(pub.link)}</td>
    <td class="td">${pub.login ? `<div style="font-size:0.75rem;color:var(--ink-soft);margin-bottom:0.15rem;">${esc(pub.login)}</div>` : ''}${credCell(pub.password, 'pwd-cl-'+pub.id+'-'+entryDate)}</td>
    <td class="td">${notesCell}</td>
    <td class="td" style="text-align:right;"><div style="display:flex;justify-content:flex-end;gap:0.3rem;flex-wrap:wrap;">${actions}</div></td>
  </tr>`;
}
function jsEsc(s) { return esc(s).replace(/'/g, "\\'"); }
async function markAllDaily() {
  const viewDate = getChecklistDate();
  const items = buildChecklist(viewDate).filter(i => i.pub.frequency==='daily' && !i.log);
  const time = nowTime();
  const me = getMe();
  await Promise.all(items.map(item => apiSend('POST', 'logs', {
    publicationId: item.pub.id, logDate: viewDate, downloaded: 'Y', timeDownloaded: time,
    createdAt: new Date().toISOString(), createdBy: me ? me.name : 'Unknown',
  })));
  await refreshFromServer();
}
async function markLog(pubId, downloaded, logDate, reason) { await upsertLog(pubId, logDate, downloaded, downloaded==='Y'?nowTime():null, reason); }
async function undoLog(pubId, logDate) { await deleteLog(pubId, logDate); }

/* ---- Mark-No reason modal ---- */
function openReasonModal(pubId, logDate, pubName) {
  const opts = NO_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-hd"><h3>Mark not downloaded</h3><button class="icon-btn" onclick="closeModal()">✕</button></div>
        <div style="padding:1.1rem 1.25rem;">
          <p class="sub" style="margin:0 0 0.9rem;font-size:0.82rem;">${pubName} — ${fmtDisplay(logDate)}</p>
          <label class="flabel">Reason</label>
          <select id="reason-preset" class="field" style="margin-bottom:0.7rem;" onchange="document.getElementById('reason-custom').style.display=this.value==='Other'?'block':'none'">
            <option value="">Select a reason…</option>${opts}
          </select>
          <div id="reason-custom" style="display:none;"><label class="flabel">Details</label><input id="reason-text" class="field" placeholder="Type the reason…"></div>
        </div>
        <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitReason(${pubId},'${logDate}')">Save</button></div>
      </div>
    </div>`;
}
async function submitReason(pubId, logDate) {
  const preset = document.getElementById('reason-preset')?.value;
  const custom = document.getElementById('reason-text')?.value;
  const reason = (preset && preset !== 'Other') ? preset : (custom || 'Not available');
  await markLog(pubId, 'N', logDate, reason);
  closeModal();
}

/* ---- Notes modal ---- */
let _notesModal = null, _notesShowInput = false;
function openNotesModal(pubId, entryDate, pubName) { _notesModal = {pubId, entryDate, pubName}; _notesShowInput = false; renderNotesModal(); }
function renderNotesModal() {
  if (!_notesModal) return;
  const {pubId, entryDate, pubName} = _notesModal;
  const notes = getNotesForEntry(pubId, entryDate);
  const notesHtml = notes.length === 0 ? `<tr><td class="td empty" colspan="2">No comments yet</td></tr>`
    : notes.map(n => `<tr><td class="td"><div style="font-size:0.85rem;">${esc(n.comment)}</div><div class="muted" style="font-size:0.72rem;margin-top:0.15rem;">${esc(n.createdBy||'')} · ${fmtDisplay(n.noteDate||n.entryDate)}</div></td>
      <td class="td" style="text-align:right;"><button class="icon-btn" onclick="deleteNoteAndRefresh(${n.id})" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button></td></tr>`).join('');
  const inputHtml = _notesShowInput ? `
    <div style="padding:0.8rem 1.25rem;border-top:1px solid var(--rule);">
      <textarea id="note-textarea" class="field" rows="3" placeholder="Type your note…" style="margin-bottom:0.6rem;"></textarea>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;"><button class="btn btn-outline btn-sm" onclick="_notesShowInput=false;renderNotesModal()">Cancel</button><button class="btn btn-primary btn-sm" onclick="saveNewNote()">Save note</button></div>
    </div>` : '';
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeNotesModal()">
      <div class="modal">
        <div class="modal-hd"><div><h3>Notes</h3><p class="sub" style="font-size:0.78rem;margin:0.15rem 0 0;">${esc(pubName)} — ${fmtDisplay(entryDate)}</p></div><button class="icon-btn" onclick="closeNotesModal()">✕</button></div>
        <div style="max-height:16rem;overflow-y:auto;"><table><tbody>${notesHtml}</tbody></table></div>
        ${inputHtml}
        <div class="modal-ft" style="justify-content:space-between;"><button class="btn btn-primary btn-sm" onclick="_notesShowInput=true;renderNotesModal()">Add note</button><button class="btn btn-outline btn-sm" onclick="closeNotesModal()">Close</button></div>
      </div>
    </div>`;
  if (_notesShowInput) document.getElementById('note-textarea')?.focus();
}
async function saveNewNote() {
  const ta = document.getElementById('note-textarea'); const text = ta ? ta.value.trim() : '';
  if (!text) return;
  await addNote(_notesModal.pubId, _notesModal.entryDate, text);
  _notesShowInput = false; renderNotesModal();
}
async function deleteNoteAndRefresh(id) { if (!confirm('Delete this note?')) return; await deleteNoteRec(id); renderNotesModal(); }
function closeNotesModal() { _notesModal = null; _notesShowInput = false; document.getElementById('modal-root').innerHTML = ''; }

/* ══════════════════════════════════════════════════════════════
   PAGE: TIMELINESS
   ══════════════════════════════════════════════════════════════ */
function buildTimeliness(startS, endS, groupBy) {
  const pubs = DB.getPublications().filter(p => p.isActive && !p.deletedAt);
  const logsByPub = new Map();
  for (const l of STATE.logs) { if (!logsByPub.has(l.publicationId)) logsByPub.set(l.publicationId, []); logsByPub.get(l.publicationId).push(l); }
  const dates = datesInRange(startS, endS);
  const counted = new Set(); const map = new Map();
  const getPeriodKey = ds => groupBy==='day' ? ds : groupBy==='week' ? fmtDate(startOfWeekMon(parseDate(ds))) : ds.slice(0,7);
  for (const ds of dates) {
    for (const pub of pubs) {
      if (!isDueOnDate(pub.frequency, pub.expectedDay, ds)) continue;
      const freq = pub.frequency, pk = getPeriodKey(ds), key = `${freq}::${pk}`;
      let entry = map.get(key) || {downloaded:0, expected:0};
      const np = getNaturalPeriod(freq, ds);
      if (NATURAL_FREQS.has(freq)) {
        const dk = `${pub.id}::${np.start}::${pk}`;
        if (counted.has(dk)) { map.set(key, entry); continue; }
        counted.add(dk);
      }
      entry.expected++;
      const pubLogs = logsByPub.get(pub.id) || [];
      if (pubLogs.some(l => l.downloaded==='Y' && l.logDate>=np.start && l.logDate<=np.end)) entry.downloaded++;
      map.set(key, entry);
    }
  }
  const rows = [];
  for (const [key, val] of map.entries()) { const [freq, period] = key.split('::'); rows.push({period, frequency:freq, downloaded:val.downloaded, expected:val.expected, percentage: val.expected>0 ? Math.round(val.downloaded/val.expected*100):0}); }
  return rows.sort((a,b)=> a.period<b.period?-1:1);
}
function renderTimeliness() {
  const today = todayStr(); const monthStart = fmtDate(startOfMonth(parseDate(today)));
  return `
  <div class="hd"><div><h1>Timeliness Report</h1><p class="sub">Downloads against what was expected, by frequency</p></div></div>
  <div id="freq-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:0.7rem;margin-bottom:1.4rem;"></div>
  <div class="panel" style="padding:1.15rem;margin-bottom:1.4rem;">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.7rem;margin-bottom:1.1rem;">
      <label class="flabel" style="margin:0;">From</label><input type="date" id="t-start" class="field" style="width:auto;" value="${monthStart}" onchange="refreshTimeliness()">
      <label class="flabel" style="margin:0;">To</label><input type="date" id="t-end" class="field" style="width:auto;" value="${today}" onchange="refreshTimeliness()">
      <div class="seg" style="margin-left:auto;"><button id="gb-day" onclick="setGroupBy('day')">Day</button><button id="gb-week" class="active" onclick="setGroupBy('week')">Week</button><button id="gb-month" onclick="setGroupBy('month')">Month</button></div>
    </div>
    <canvas id="timeliness-chart" height="190"></canvas>
  </div>
  <div class="panel twrap">
    <table><thead><tr><th class="th">Period</th><th class="th">Frequency</th><th class="th" style="text-align:right;">Downloaded</th><th class="th" style="text-align:right;">Expected</th><th class="th" style="text-align:right;">Timeliness</th></tr></thead><tbody id="timeliness-tbody"></tbody></table>
  </div>`;
}
let _groupBy = 'week', timelinessChart = null;
function setGroupBy(g) { _groupBy = g; ['day','week','month'].forEach(x=>{ const b=document.getElementById('gb-'+x); if(b) b.className = x===g?'active':''; }); refreshTimeliness(); }
function bindTimeliness() {
  const today = todayStr();
  const threeMoAgo = fmtDate(new Date(parseDate(today).getFullYear(), parseDate(today).getMonth()-2, 1));
  const rows = buildTimeliness(threeMoAgo, today, 'month');
  const freqMap = new Map();
  for (const r of rows) { const cur = freqMap.get(r.frequency) || {downloaded:0,expected:0}; cur.downloaded+=r.downloaded; cur.expected+=r.expected; freqMap.set(r.frequency, cur); }
  const activePubs = DB.getPublications().filter(p=>p.isActive && !p.deletedAt);
  const activeFreqs = new Set(activePubs.map(p=>p.frequency));
  const html = FREQ_ORDER.filter(f => f!=='annual' && activeFreqs.has(f)).map(f => {
    const d = freqMap.get(f);
    if (!d || d.expected===0) return `<div class="panel stat"><div style="margin-bottom:0.4rem;">${pillHtml(f)}</div><div class="v" style="font-size:1.3rem;color:var(--ink-faint);">N/A</div><div class="muted" style="font-size:0.72rem;">Not due this window</div></div>`;
    const pct = Math.round(d.downloaded/d.expected*100);
    const cv = pct>=90?'--accent':pct>=70?'--amber':'--red';
    return `<div class="panel stat"><div style="margin-bottom:0.4rem;">${pillHtml(f)}</div><div class="v" style="font-size:1.3rem;color:var(${cv});">${pct}%</div><div class="muted" style="font-size:0.72rem;">${d.downloaded}/${d.expected}</div></div>`;
  }).join('');
  const el = document.getElementById('freq-cards'); if (el) el.innerHTML = html;
  refreshTimeliness();
}
function refreshTimeliness() {
  const startS = document.getElementById('t-start')?.value, endS = document.getElementById('t-end')?.value;
  if (!startS || !endS) return;
  const rows = buildTimeliness(startS, endS, _groupBy);
  const periodSet = [...new Set(rows.map(r=>r.period))].sort();
  const totals = periodSet.map(p => { const pr = rows.filter(r=>r.period===p); return {dl: pr.reduce((s,r)=>s+r.downloaded,0), ex: pr.reduce((s,r)=>s+r.expected,0)}; });
  const ctx = document.getElementById('timeliness-chart')?.getContext('2d');
  if (ctx && typeof Chart !== 'undefined') {
    if (timelinessChart) timelinessChart.destroy();
    const inkSoft = getComputedStyle(document.body).getPropertyValue('--ink-soft').trim();
    timelinessChart = new Chart(ctx, { type:'bar', data:{ labels:periodSet, datasets:[
      {label:'Expected', data: totals.map(x=>x.ex), backgroundColor:'rgba(138,147,163,0.35)', borderRadius:3},
      {label:'Downloaded', data: totals.map(x=>x.dl), backgroundColor:'#0F6B5C', borderRadius:3},
    ]}, options:{ responsive:true, plugins:{legend:{position:'bottom', labels:{color:inkSoft}}}, scales:{ x:{ticks:{color:inkSoft}}, y:{beginAtZero:true, ticks:{color:inkSoft}} } } });
  }
  const tbody = document.getElementById('timeliness-tbody'); if (!tbody) return;
  if (!rows.length) { tbody.innerHTML = `<tr><td class="td empty" colspan="5">No data for this period.</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => { const cv = r.percentage>=90?'--accent':r.percentage>=70?'--amber':'--red';
    return `<tr><td class="td mono" style="font-size:0.78rem;">${r.period}</td><td class="td">${pillHtml(r.frequency)}</td><td class="td" style="text-align:right;font-weight:500;">${r.downloaded}</td><td class="td" style="text-align:right;color:var(--ink-soft);">${r.expected}</td><td class="td" style="text-align:right;font-weight:700;color:var(${cv});">${r.percentage}%</td></tr>`; }).join('');
}

/* ══════════════════════════════════════════════════════════════
   PAGE: PUBLICATIONS
   ══════════════════════════════════════════════════════════════ */
let _pubFilter='all', _pubSearch='', _pubTab='active';
function setPubTab(t){_pubTab=t;renderPage();}
function setPubFilter(f){_pubFilter=f;renderPage();}
function setPubSearch(v){_pubSearch=v; document.getElementById('page').innerHTML = renderPublications(); const inp=document.querySelector('.pub-search'); if(inp){inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);} }

function renderPublications() {
  const allPubs = DB.getPublications();
  const activePubs = allPubs.filter(p=>!p.deletedAt);
  const archivedPubs = allPubs.filter(p=>!!p.deletedAt);
  const freqCounts = {}; activePubs.forEach(p=>freqCounts[p.frequency]=(freqCounts[p.frequency]||0)+1);
  const freqs = FREQ_ORDER.filter(f=>f!=='annual');

  const tabs = `<div class="seg" style="margin-bottom:1rem;">
    <button class="${_pubTab==='active'?'active':''}" onclick="setPubTab('active')">Active (${activePubs.length})</button>
    <button class="${_pubTab==='archived'?'active':''}" onclick="setPubTab('archived')">Archived${archivedPubs.length?` (${archivedPubs.length})`:''}</button>
  </div>`;
  const header = `<div class="hd"><div><h1>Publications</h1><p class="sub">Manage tracked titles, schedules and access details</p></div><button class="btn btn-primary" onclick="openPubModal(null)">+ Add publication</button></div>`;

  if (_pubTab === 'archived') {
    const q = _pubSearch.toLowerCase();
    const filtered = archivedPubs.filter(p=>!q || p.name.toLowerCase().includes(q));
    const rows = filtered.map(pub => {
      const on = pub.deletedAt ? new Date(pub.deletedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '—';
      return `<tr><td class="td"><div style="font-weight:500;">${esc(pub.name)}</div></td><td class="td">${pillHtml(pub.frequency)}</td><td class="td" style="color:var(--ink-soft);font-size:0.82rem;">${on}</td>
        <td class="td" style="text-align:right;"><button class="btn btn-outline btn-sm" onclick="restorePub(${pub.id})">Restore</button> <button class="btn btn-danger btn-sm" onclick="permanentDeletePub(${pub.id})">Delete forever</button></td></tr>`;
    }).join('');
    return `${header}${tabs}
      <div class="banner banner-amber" style="margin-bottom:1rem;">Archived titles aren't tracked on the checklist. Restore to bring one back, or delete forever to remove it and its history permanently.</div>
      <div class="panel twrap">
        <div style="padding:0.8rem 1.1rem;border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:0.7rem;"><input class="field pub-search" style="max-width:18rem;" placeholder="Search archived…" value="${esc(_pubSearch)}" oninput="setPubSearch(this.value)"><span class="muted" style="font-size:0.82rem;margin-left:auto;">${filtered.length} archived</span></div>
        <table><thead><tr><th class="th">Name</th><th class="th">Frequency</th><th class="th">Archived on</th><th class="th" style="text-align:right;">Actions</th></tr></thead><tbody>${rows || `<tr><td class="td empty" colspan="4">No archived publications.</td></tr>`}</tbody></table>
      </div>`;
  }

  let filtered = activePubs.filter(p => (_pubFilter==='all' || p.frequency===_pubFilter) && (!_pubSearch || p.name.toLowerCase().includes(_pubSearch.toLowerCase())));
  const chips = `<button class="pill" style="cursor:pointer;border:1px solid var(--rule-strong);${_pubFilter==='all'?'background:var(--ink);color:var(--paper-raised);':'background:var(--paper-raised);color:var(--ink-soft);'}" onclick="setPubFilter('all')">All (${activePubs.length})</button>
    ${freqs.map(f => freqCounts[f] ? `<button class="pill pill-${f}" style="cursor:pointer;${_pubFilter===f?'outline:2px solid var(--ink);outline-offset:1px;':''}" onclick="setPubFilter('${f}')">${f} (${freqCounts[f]})</button>` : '').join('')}`;

  const rows = filtered.map(pub => `<tr style="${!pub.isActive?'opacity:0.5;':''}">
    <td class="td"><div style="font-weight:500;">${esc(pub.name)}</div>${pub.login?`<div class="muted" style="font-size:0.74rem;">${esc(pub.login)}</div>`:''}</td>
    <td class="td">${pillHtml(pub.frequency)}</td>
    <td class="td muted" style="font-size:0.78rem;">${pub.expectedDay||'—'}</td>
    <td class="td">${linkHtml(pub.link)}</td>
    <td class="td">${credCell(pub.password, 'pwd-pub-'+pub.id)}</td>
    <td class="td">${pub.isActive ? `<span class="status status-y">Active</span>` : `<span class="status status-p">Inactive</span>`}</td>
    <td class="td" style="text-align:right;">
      <button class="icon-btn" onclick="openPubModal(${pub.id})" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828z"/></svg></button>
      <button class="icon-btn" onclick="archivePub(${pub.id})" title="Archive" style="margin-left:0.3rem;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8h14M5 8a2 2 0 01-2-2V5a1 1 0 011-1h16a1 1 0 011 1v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/></svg></button>
    </td></tr>`).join('');

  return `${header}${tabs}
    <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:1rem;">${chips}</div>
    <div class="panel twrap">
      <div style="padding:0.8rem 1.1rem;border-bottom:1px solid var(--rule);display:flex;align-items:center;gap:0.7rem;"><input class="field pub-search" style="max-width:18rem;" placeholder="Search publications…" value="${esc(_pubSearch)}" oninput="setPubSearch(this.value)"><span class="muted" style="font-size:0.82rem;margin-left:auto;">${filtered.length} shown</span></div>
      <table><thead><tr><th class="th">Name</th><th class="th">Frequency</th><th class="th">Expected day</th><th class="th">Link</th><th class="th">Credentials</th><th class="th">Status</th><th class="th" style="text-align:right;">Actions</th></tr></thead><tbody>${rows || `<tr><td class="td empty" colspan="7">No publications match your filters.</td></tr>`}</tbody></table>
    </div>`;
}
function openPubModal(pubId) {
  const pub = pubId ? DB.getPublications().find(p=>p.id===pubId) : null;
  const p = pub || {name:'',link:'',frequency:'weekly',expectedDay:'',login:'',password:'',isActive:true};
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal modal-wide">
        <div class="modal-hd"><h3>${pub ? 'Edit publication' : 'Add publication'}</h3><button class="icon-btn" onclick="closeModal()">✕</button></div>
        <div style="padding:1.1rem 1.25rem;display:grid;grid-template-columns:1fr 1fr;gap:0.9rem;">
          <div style="grid-column:1/-1;"><label class="flabel">Name</label><input id="pf-name" class="field" value="${esc(p.name)}"></div>
          <div style="grid-column:1/-1;"><label class="flabel">Link / delivery note</label><input id="pf-link" class="field" value="${esc(p.link||'')}" placeholder="https://… or how it arrives"></div>
          <div><label class="flabel">Frequency</label><select id="pf-freq" class="field">${FREQ_ORDER.filter(f=>f!=='annual').map(f=>`<option value="${f}" ${p.frequency===f?'selected':''}>${f}</option>`).join('')}</select></div>
          <div><label class="flabel">Expected day / note</label><input id="pf-day" class="field" value="${esc(p.expectedDay||'')}" placeholder="e.g. Monday"></div>
          <div><label class="flabel">Login</label><input id="pf-login" class="field" value="${esc(p.login||'')}"></div>
          <div><label class="flabel">Password</label><input id="pf-pwd" class="field" value="${esc(p.password||'')}"></div>
          <div style="grid-column:1/-1;display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" id="pf-active" ${p.isActive?'checked':''} style="width:auto;"><label for="pf-active" style="font-size:0.85rem;">Active (tracked on the checklist)</label></div>
        </div>
        <div class="modal-ft"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePub(${pubId||'null'})">Save</button></div>
      </div>
    </div>`;
}
async function savePub(pubId) {
  const name = document.getElementById('pf-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const data = {
    name,
    link: document.getElementById('pf-link').value.trim() || null,
    frequency: document.getElementById('pf-freq').value,
    expectedDay: document.getElementById('pf-day').value.trim() || null,
    login: document.getElementById('pf-login').value.trim() || null,
    password: document.getElementById('pf-pwd').value.trim() || null,
    isActive: document.getElementById('pf-active').checked,
  };
  if (pubId) await apiSend('PATCH', 'publications/' + pubId, data);
  else await apiSend('POST', 'publications', data);
  closeModal();
  await refreshFromServer();
}
async function archivePub(pubId) { await apiSend('PATCH', 'publications/' + pubId, {deletedAt: new Date().toISOString()}); _pubTab='archived'; await refreshFromServer(); }
async function restorePub(pubId) { await apiSend('PATCH', 'publications/' + pubId, {deletedAt: null}); await refreshFromServer(); }
async function permanentDeletePub(pubId) {
  if (!confirm('Permanently delete this publication and all its logs? This cannot be undone.')) return;
  await apiSend('DELETE', 'publications/' + pubId);
  await refreshFromServer();
}

/* ══════════════════════════════════════════════════════════════
   PAGE: LOGS
   ══════════════════════════════════════════════════════════════ */
let _logStart='', _logEnd='', _logPubId='all', _logStatus='all';
function renderLogs() {
  const today = todayStr();
  if (!_logStart) _logStart = fmtDate(addDays(parseDate(today), -6));
  if (!_logEnd) _logEnd = today;
  const pubs = DB.getPublications(); const pubMap = new Map(pubs.map(p=>[p.id,p]));
  let logs = STATE.logs.filter(l => l.logDate>=_logStart && l.logDate<=_logEnd);
  if (_logPubId!=='all') logs = logs.filter(l=>String(l.publicationId)===String(_logPubId));
  if (_logStatus!=='all') logs = logs.filter(l=>l.downloaded===_logStatus);
  logs.sort((a,b)=> b.logDate.localeCompare(a.logDate) || (b.createdAt||'').localeCompare(a.createdAt||''));
  const pubOptions = pubs.filter(p=>!p.deletedAt).map(p=>`<option value="${p.id}" ${String(_logPubId)===String(p.id)?'selected':''}>${esc(p.name)}</option>`).join('');

  const rows = logs.map(log => { const pub = pubMap.get(log.publicationId);
    const badge = log.downloaded==='Y' ? `<span class="status status-y">Downloaded</span>` : log.downloaded==='W' ? `<span class="status status-w">Awaiting</span>` : `<span class="status status-n">Not downloaded</span>`;
    return `<tr><td class="td mono" style="font-size:0.78rem;">${log.logDate}</td>
      <td class="td" style="font-weight:500;max-width:16rem;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(pub?.name || '—')}</div></td>
      <td class="td">${pub ? pillHtml(pub.frequency) : '—'}</td><td class="td">${badge}</td>
      <td class="td muted" style="font-size:0.78rem;">${esc(log.createdBy||'—')}</td>
      <td class="td muted" style="font-size:0.78rem;">${log.timeDownloaded||'—'}</td>
      <td class="td muted" style="font-size:0.78rem;max-width:12rem;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(log.reasonWhenNo||'')||'—'}</div></td></tr>`;
  }).join('');

  return `
  <div class="hd"><div><h1>Download Logs</h1><p class="sub">Full history of download entries</p></div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
      <button class="btn btn-outline" onclick="exportFullReportCSV()">⬇ Full report CSV</button>
      <button class="btn btn-outline" onclick="exportLoggedCSV()">⬇ Logged entries CSV</button>
    </div>
  </div>
  <div class="panel" style="padding:0.9rem 1.1rem;margin-bottom:1rem;">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem;">
      <label class="flabel" style="margin:0;">From</label><input type="date" class="field" style="width:auto;" value="${_logStart}" onchange="_logStart=this.value;renderPage()">
      <label class="flabel" style="margin:0;">To</label><input type="date" class="field" style="width:auto;" value="${_logEnd}" onchange="_logEnd=this.value;renderPage()">
      <select class="field" style="width:auto;" onchange="_logPubId=this.value;renderPage()"><option value="all">All publications</option>${pubOptions}</select>
      <select class="field" style="width:auto;" onchange="_logStatus=this.value;renderPage()">
        <option value="all" ${_logStatus==='all'?'selected':''}>All status</option>
        <option value="Y" ${_logStatus==='Y'?'selected':''}>Downloaded</option>
        <option value="N" ${_logStatus==='N'?'selected':''}>Not downloaded</option>
        <option value="W" ${_logStatus==='W'?'selected':''}>Awaiting</option>
      </select>
      <span class="muted" style="font-size:0.82rem;margin-left:auto;">${logs.length} entr${logs.length!==1?'ies':'y'}</span>
    </div>
  </div>
  <div class="panel twrap">
    <table><thead><tr><th class="th">Date</th><th class="th">Publication</th><th class="th">Frequency</th><th class="th">Status</th><th class="th">Logged by</th><th class="th">Time</th><th class="th">Reason</th></tr></thead>
    <tbody>${rows || `<tr><td class="td empty" colspan="7">No log entries found.</td></tr>`}</tbody></table>
  </div>`;
}
function exportLoggedCSV() {
  const pubs = DB.getPublications(); const pubMap = new Map(pubs.map(p=>[p.id,p]));
  let logs = STATE.logs.filter(l=>l.logDate>=_logStart && l.logDate<=_logEnd);
  if (_logPubId!=='all') logs = logs.filter(l=>String(l.publicationId)===String(_logPubId));
  if (_logStatus!=='all') logs = logs.filter(l=>l.downloaded===_logStatus);
  if (!logs.length) { alert('No logs to export.'); return; }
  const rows = [['Date','Publication','Frequency','Status','Logged By','Time Downloaded','Reason'], ...logs.map(l => { const pub = pubMap.get(l.publicationId);
    const status = l.downloaded==='Y'?'Downloaded':l.downloaded==='W'?'Awaiting':'Not Downloaded';
    return [l.logDate, pub?.name||'', pub?.frequency||'', status, l.createdBy||'', l.timeDownloaded||'', l.reasonWhenNo||'']; })];
  downloadCSV(rows, `download-logs_${_logStart}_to_${_logEnd}.csv`);
}
function exportFullReportCSV() {
  const allPubs = DB.getPublications().filter(p=>p.isActive && !p.deletedAt);
  if (!_logStart || !_logEnd) { alert('Please set a date range first.'); return; }
  const dates = datesInRange(_logStart, _logEnd);
  const reportRows = [['Date','Publication','Frequency','Expected Day','Status','Time Downloaded','Reason']];
  const seenNatural = new Set();
  for (const ds of dates) {
    for (const pub of allPubs) {
      const freq = pub.frequency; let dueDate = null;
      if (NATURAL_FREQS.has(freq)) {
        const dd = getDueDateInCurrentPeriod(freq, pub.expectedDay, ds); if (!dd) continue;
        const key = `${pub.id}::${dd}`; if (seenNatural.has(key)) continue; seenNatural.add(key); dueDate = dd;
      } else { if (!isDueOnDate(freq, pub.expectedDay, ds)) continue; dueDate = ds; }
      const period = getNaturalPeriod(freq, dueDate);
      const periodLogs = getLogsForPubInPeriod(pub.id, period.start, period.end);
      const yLog = periodLogs.find(l=>l.downloaded==='Y'), nLog = periodLogs.find(l=>l.downloaded==='N'), wLog = periodLogs.find(l=>l.downloaded==='W');
      let status='Pending', time='', reason='';
      if (yLog) { status='Downloaded'; time=yLog.timeDownloaded||''; } else if (nLog) { status='Not Downloaded'; reason=nLog.reasonWhenNo||''; } else if (wLog) { status='Awaiting'; }
      reportRows.push([dueDate, pub.name, freq, pub.expectedDay||'', status, time, reason]);
    }
  }
  if (reportRows.length<=1) { alert('No data to export.'); return; }
  downloadCSV(reportRows, `full-report_${_logStart}_to_${_logEnd}.csv`);
}
function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

/* ══════════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════════ */
let _pollTimer = null;
async function pollServer() {
  const modalOpen = document.getElementById('modal-root').innerHTML.trim() !== '';
  try {
    await apiFetchState();
    setConnBadge(true);
    if (!modalOpen) refreshAll();
  } catch (e) { console.error(e); setConnBadge(false); }
}
async function bootApp() {
  document.getElementById('who-chip-wrap').style.display = 'flex';
  try {
    await apiSend('POST', 'seed');
    await apiFetchState();
    setConnBadge(true);
  } catch (e) {
    console.error(e);
    document.getElementById('app-root').innerHTML = `<div style="max-width:32rem;margin:4rem auto;padding:1.5rem;font-family:sans-serif;">
      <h2 style="font-family:Georgia,serif;">Can't reach the server</h2>
      <p>${esc(e.message)}</p>
      <p>Check that this site is deployed on Cloudflare Pages with a D1 database bound as <code>DB</code>. See <code>SETUP.md</code>.</p></div>`;
    return;
  }
  navigate('checklist');
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(pollServer, 8000);
}

window.addEventListener('DOMContentLoaded', () => {
  const me = getMe();
  if (me) { document.getElementById('gate').style.display = 'none'; bootApp(); }
  else { renderGate(); }
});
