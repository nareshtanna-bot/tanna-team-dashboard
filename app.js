import { routineHealth, withLiveSections } from './lib/sections.js';

const CATEGORIES = ['travel', 'school', 'home', 'golf', 'business', 'research'];
const STAGES = [
  ['research', 'Research'],
  ['direction', 'Direction'],
  ['building', 'Building'],
  ['parked', 'Parked']
];
const REQUEST_LABEL = {
  queued: 'Queued',
  working: 'Working',
  waiting: 'Waiting on Naresh',
  done: 'Done'
};
const BOT_LABEL = { working: 'Working', idle: 'Idle', blocked: 'Blocked' };
const RESULT_LABEL = { ok: 'Last run ok', attention: 'Needs a look', failed: 'Last run failed' };
const FONT = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const TONES = ['#1f6b4a', '#2f5d62', '#8a5a3b', '#3d5278', '#6b5b4b', '#4f6b3a'];
const DAY = 24 * 60 * 60 * 1000;

const state = {
  data: null,
  category: 'all',
  query: '',
  theme: localStorage.getItem('mission-theme') || 'auto',
  checkedAt: null
};

let charts = [];
let chartSig = '';
let lastFetch = 0;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function safeUrl(url) {
  try {
    const parsed = new URL(url, location.origin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
  } catch { /* not a url */ }
  return '';
}

function safeDoc(path) {
  if (!path || typeof path !== 'string') return '';
  const clean = path.replace(/^\.?\//, '');
  if (!/^outputs\/[a-z0-9._/-]+\.md$/i.test(clean) || clean.includes('..')) return '';
  return clean;
}

function formatET(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unknown';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('month')} ${get('day')}, ${get('year')} · ${get('hour')}:${get('minute')} ${get('dayPeriod')} ET`;
}

function etDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function ago(iso) {
  if (!iso) return 'No activity on file';
  const delta = Date.now() - Date.parse(iso);
  if (Number.isNaN(delta)) return 'No activity on file';
  if (delta < 60 * 60 * 1000) return 'Within the hour';
  const hours = Math.round(delta / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function isStale(iso) {
  if (!iso) return true;
  const t = Date.parse(iso);
  return Number.isNaN(t) || Date.now() - t > DAY;
}

function tone(id) {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) n = (n + id.charCodeAt(i) * (i + 1)) % TONES.length;
  return TONES[n];
}

function initials(name) {
  const parts = String(name || '').replace(/^Dr\.\s*/i, '').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || '?').slice(0, 2).toUpperCase();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chip(kind, label) {
  return `<span class="chip status ${escapeHtml(kind)}"><span class="dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

function ring(percent, center, label) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const amount = Math.max(0, Math.min(1, percent));
  return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${escapeHtml(label)}">
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${cssVar('--line')}" stroke-width="8"/>
    <circle cx="42" cy="42" r="${r}" fill="none" stroke="${cssVar('--pine')}" stroke-width="8"
      stroke-linecap="round" stroke-dasharray="${(c * amount).toFixed(1)} ${c.toFixed(1)}"
      transform="rotate(-90 42 42)"/>
    <text x="42" y="46" text-anchor="middle" font-size="16" font-weight="650">${escapeHtml(center)}</text>
  </svg>`;
}

function currentTheme() {
  if (state.theme === 'light' || state.theme === 'dark') return state.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode, persist = true) {
  state.theme = mode;
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  if (persist) localStorage.setItem('mission-theme', mode);
  const dark = currentTheme() === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#141614' : '#efeae2';
  const button = $('theme-toggle');
  const label = mode === 'auto' ? 'Auto' : mode === 'dark' ? 'Dark' : 'Light';
  button.textContent = `Theme · ${label}`;
  button.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
  chartSig = '';
  if (state.data) paint();
}

function checkedLabel() {
  if (!state.checkedAt) return '';
  const seconds = Math.round((Date.now() - state.checkedAt) / 1000);
  if (seconds < 15) return 'Checked just now';
  if (seconds < 90) return 'Checked 1 min ago';
  return `Checked ${Math.round(seconds / 60)} min ago`;
}

function sourceLabel(data) {
  const source = data?.meta?.source || data?.source || 'seed';
  if (source === 'blob') return 'Live';
  if (source === 'github') return 'GitHub';
  return 'Seed';
}

function applyManifest(data, manifest) {
  const requests = [...(data.requests || [])];
  const known = new Set(requests.map((item) => item.output).filter(Boolean));
  for (const item of manifest?.items || []) {
    if (!item.path || known.has(item.path) || item.status === 'queued') continue;
    requests.push({
      id: item.slug || item.path,
      title: item.title || item.slug,
      request: 'Filed under outputs/.',
      date: item.date || '',
      owner: item.owner || '',
      status: item.status || 'done',
      category: item.category || 'research',
      output: item.path
    });
    known.add(item.path);
  }
  return { ...data, requests };
}

async function loadStatus() {
  let data;
  try {
    const response = await fetch(`api/status?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch {
    const response = await fetch(`status.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('status unavailable');
    data = await response.json();
  }
  try {
    const manifest = await fetch(`outputs/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (manifest.ok) data = applyManifest(data, await manifest.json());
  } catch { /* the seed requests still render */ }
  return withLiveSections(data, {}, Date.now());
}

function requestsMatching() {
  const q = state.query.trim().toLowerCase();
  return (state.data?.requests || []).filter((item) => {
    if (state.category !== 'all' && item.category !== state.category) return false;
    if (!q) return true;
    const hay = [item.title, item.request, item.owner, item.category, item.status, REQUEST_LABEL[item.status]]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function routineBucket(item) {
  const today = etDay(new Date());
  if (item.lastRun && etDay(item.lastRun) === today) return 'today';
  return 'upcoming';
}

function isClosedStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return value === 'done' || value === 'delivered';
}

function openNeeds(data) {
  const closedIds = new Set(
    (data?.requests || []).filter((item) => item?.id && isClosedStatus(item.status)).map((item) => item.id)
  );
  return (data?.needsYou || []).filter(
    (item) => item && !isClosedStatus(item.status) && !(item.id && closedIds.has(item.id))
  );
}

function exampleNote(section) {
  if (!section || section.live === true || section.example === false) return 'Live post.';
  return 'Example data, not a real record.';
}

function dayKey(value) {
  return etDay(value);
}

function nextDays() {
  const first = dayKey(new Date());
  const [year, month, date] = first.split('-').map(Number);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const point = new Date(Date.UTC(year, month - 1, date + i, 16, 0, 0));
    days.push(dayKey(point));
  }
  return days;
}

function clock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function weekday(isoDay) {
  const [year, month, date] = isoDay.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, date, 16, 0, 0)));
}

function renderWeek() {
  const calendar = state.data?.calendar || {};
  $('week-example').textContent = exampleNote(calendar);
  const events = calendar.events || [];
  const days = nextDays();
  $('week-grid').innerHTML = days.map((day) => {
    const items = events.filter((event) => dayKey(event.start) === day);
    const body = items.length
      ? items.map((event) => `<div class="slot${event.conflict ? ' conflict' : ''}">
          <span class="meta ${escapeHtml(event.calendar || '')}">${escapeHtml(event.calendar === 'work' ? 'Work' : 'Family')}</span>
          <strong>${escapeHtml(event.title || '')}</strong>
          <span class="meta">${escapeHtml(clock(event.start))}${event.end ? `–${escapeHtml(clock(event.end))}` : ''}</span>
          ${event.conflict ? chip('waiting', 'Conflict') : ''}
          ${event.example ? '<span class="chip example">Example</span>' : ''}
        </div>`).join('')
      : '<p class="empty">Clear</p>';
    return `<article class="day"><header><h3>${escapeHtml(weekday(day))}</h3></header>${body}</article>`;
  }).join('');
}

function renderHealth() {
  const health = state.data?.health || {};
  $('health-example').textContent = exampleNote(health);
  const points = health.weight || [];
  $('weight-summary').textContent = points.length
    ? `${points[0].lb} lb on ${points[0].date} → ${points[points.length - 1].lb} lb on ${points[points.length - 1].date}${health.example !== false ? ' · Example' : ''}`
    : 'No weight points yet.';
  const habits = health.habits || [];
  $('habit-grid').innerHTML = habits.length
    ? habits.map((habit) => {
      const goal = 7;
      return `<article class="habit">
        ${ring(Math.min((habit.streak || 0) / goal, 1), String(habit.streak || 0), `${habit.name} streak ${habit.streak || 0}`)}
        <div>
          <h3>${escapeHtml(habit.name || '')}</h3>
          <p class="meta">${escapeHtml(String(habit.streak || 0))} in a row${habit.example ? ' · Example' : ''}</p>
        </div>
      </article>`;
    }).join('')
    : '<p class="empty">No habits posted.</p>';
  const visits = [...(health.appointments || [])].sort((a, b) => Date.parse(a.start || 0) - Date.parse(b.start || 0));
  $('visit-list').innerHTML = visits.length
    ? visits.map((visit) => `<article class="panel">
        <div class="row">${chip('queued', 'Visit')}${visit.example ? '<span class="chip example">Example</span>' : ''}</div>
        <h3>${escapeHtml(visit.title || 'Visit')}</h3>
        <p class="meta">${visit.start ? escapeHtml(formatET(visit.start)) : ''}</p>
      </article>`).join('')
    : '<p class="empty">No visits on the calendar.</p>';
}

function renderKids() {
  const kids = state.data?.kids || {};
  $('kids-example').textContent = exampleNote(kids);
  const schools = kids.applications || [];
  $('school-grid').innerHTML = schools.map((school) => `<article class="school">
      <div class="row">${chip('queued', school.stage || 'Open')}${school.example ? '<span class="chip example">Example</span>' : ''}</div>
      <h3>${escapeHtml(school.school || '')}</h3>
      <ul class="dates">${(school.dates || []).map((entry) => `<li><span class="meta">${escapeHtml(entry.date || '')}</span> ${escapeHtml(entry.label || '')}</li>`).join('')}</ul>
    </article>`).join('') || '<p class="empty">No applications posted.</p>';
  const activities = kids.activities || [];
  $('activity-list').innerHTML = activities.length
    ? activities.map((item) => `<article class="panel">
        <div class="row">${item.example ? '<span class="chip example">Example</span>' : ''}</div>
        <h3>${escapeHtml(item.name || '')}</h3>
        <p class="meta">${escapeHtml(item.when || '')}</p>
      </article>`).join('')
    : '<p class="empty">No lessons posted.</p>';
}

function renderHome() {
  const home = state.data?.home || {};
  $('home-example').textContent = exampleNote(home);
  const issues = home.issues || [];
  $('issue-list').innerHTML = issues.length
    ? issues.map((item) => `<article class="panel">
        <div class="row">${chip(item.status === 'waiting' ? 'waiting' : 'working', item.status === 'waiting' ? 'Waiting' : 'Open')}${item.example ? '<span class="chip example">Example</span>' : ''}</div>
        <h3>${escapeHtml(item.title || '')}</h3>
        <p class="detail">${escapeHtml(item.detail || '')}</p>
      </article>`).join('')
    : '<p class="empty">No open issues.</p>';
  const deliveries = home.deliveries || [];
  $('delivery-list').innerHTML = deliveries.length
    ? deliveries.map((item) => `<article class="panel">
        <div class="row">${chip('queued', item.kind === 'return' ? 'Return' : 'Delivery')}${item.example ? '<span class="chip example">Example</span>' : ''}</div>
        <h3>${escapeHtml(item.name || '')}</h3>
        <p class="meta">${escapeHtml(item.date || '')}</p>
      </article>`).join('')
    : '<p class="empty">Nothing in transit.</p>';
  const renewals = home.renewals || [];
  $('renewal-list').innerHTML = renewals.length
    ? renewals.map((item) => `<article class="panel">
        <div class="row">${chip('queued', 'Renewal')}${item.example ? '<span class="chip example">Example</span>' : ''}</div>
        <h3>${escapeHtml(item.name || '')}</h3>
        <p class="meta">${escapeHtml(item.date || '')}</p>
      </article>`).join('')
    : '<p class="empty">No renewal dates.</p>';
}

function renderBusiness() {
  const business = state.data?.business || {};
  $('business-example').textContent = exampleNote(business);
  const items = business.pipeline || [];
  $('pipeline').innerHTML = STAGES.map(([id, label]) => {
    const cards = items.filter((item) => item.stage === id);
    return `<section class="stage">
      <header><h3>${label}</h3><span class="meta">${cards.length}</span></header>
      ${cards.length ? cards.map((item) => `<article class="slot">
          <strong>${escapeHtml(item.name || '')}</strong>
          <span class="detail">${escapeHtml(item.detail || '')}</span>
          ${item.example ? '<span class="chip example">Example</span>' : ''}
        </article>`).join('') : '<p class="empty">Empty</p>'}
    </section>`;
  }).join('');
}

function renderNeeds() {
  const items = openNeeds(state.data);
  $('needs-ring').innerHTML = ring(Math.min(items.length / 6, 1), String(items.length), `${items.length} waiting on Naresh`);
  if (!items.length) {
    $('needs-list').innerHTML = '<p class="empty">Nothing is waiting on you.</p>';
    return;
  }
  $('needs-list').innerHTML = items.map((item) => {
    const doc = safeDoc(item.output);
    const open = doc
      ? `<button type="button" class="linkish text-btn" data-doc="${escapeHtml(doc)}">Open</button>`
      : '';
    return `<article class="need">
      <div class="row">${chip('waiting', 'Waiting on Naresh')}<span class="meta">${escapeHtml(item.bot || item.owner || '')}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="detail">${escapeHtml(item.detail || '')}</p>
      ${open}
    </article>`;
  }).join('');
}

function renderFilters() {
  const counts = { all: (state.data?.requests || []).length };
  for (const item of state.data?.requests || []) counts[item.category] = (counts[item.category] || 0) + 1;
  const keys = ['all', ...CATEGORIES];
  $('filters').innerHTML = keys.map((key) => {
    const label = key === 'all' ? 'All' : key[0].toUpperCase() + key.slice(1);
    const pressed = state.category === key;
    return `<button type="button" class="chip" role="tab" data-category="${key}" aria-pressed="${pressed}">${label} · ${counts[key] || 0}</button>`;
  }).join('');
}

function renderRequests() {
  const all = state.data?.requests || [];
  const done = all.filter((item) => item.status === 'done').length;
  $('done-ring').innerHTML = ring(all.length ? done / all.length : 0, String(done), `${done} of ${all.length} asks done`);
  const items = requestsMatching();
  if (!items.length) {
    $('request-grid').innerHTML = '<p class="empty">Nothing matches that filter.</p>';
    return;
  }
  $('request-grid').innerHTML = items.map((item) => {
    const doc = safeDoc(item.output);
    return `<button type="button" class="ask" data-request="${escapeHtml(item.id)}">
      <div class="row">${chip(item.status, REQUEST_LABEL[item.status] || item.status)}<span class="meta">${escapeHtml(item.category || '')}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="detail">${escapeHtml(item.request || '')}</p>
      <p class="meta">${escapeHtml(item.date || '')} · ${escapeHtml(item.owner || '')}${doc ? ' · Deliverable ready' : ''}</p>
    </button>`;
  }).join('');
}

function renderTrips() {
  const trips = state.data?.trips || [];
  $('trip-grid').innerHTML = trips.map((trip) => {
    const doc = safeDoc(trip.plan);
    const maps = safeUrl(trip.mapsUrl);
    const mapsBlock = maps
      ? `<a class="primary" href="${escapeHtml(maps)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`
      : `<label>URL<input readonly value="" placeholder="Not on file" aria-label="Maps URL for ${escapeHtml(trip.mapsLabel || trip.name)}"></label>`;
    return `<article class="trip">
      <p class="meta">${escapeHtml(trip.place || '')}${trip.window ? ` · ${escapeHtml(trip.window)}` : ''}</p>
      <h3>${escapeHtml(trip.name)}</h3>
      <p class="detail">${escapeHtml(trip.summary || '')}</p>
      <div class="trip-actions">
        ${doc ? `<button type="button" class="primary" data-doc="${escapeHtml(doc)}">Open plan</button>` : '<p class="meta">No plan filed yet.</p>'}
      </div>
      <div class="maps">
        <p class="meta">Maps list</p>
        <strong>${escapeHtml(trip.mapsLabel || trip.name)}</strong>
        ${mapsBlock}
      </div>
    </article>`;
  }).join('');
}

function renderBots() {
  const fresh = (state.data?.bots || []).map((bot) => ({ ...bot, stale: isStale(bot.lastActivity) }));
  const working = fresh.filter((bot) => bot.status === 'working').length;
  $('fleet-ring').innerHTML = ring(fresh.length ? working / fresh.length : 0, String(working), `${working} bots working`);
  $('bot-grid').innerHTML = fresh.map((bot) => `<article class="bot">
      <div class="bot-top">
        <div class="identity">
          <div class="monogram" style="color:${tone(bot.id)}">${escapeHtml(initials(bot.name))}</div>
          <div>
            <h3>${escapeHtml(bot.name)}</h3>
            <p class="meta">${escapeHtml(bot.role || '')}</p>
          </div>
        </div>
        <div class="row">${chip(bot.status, BOT_LABEL[bot.status] || bot.status)}${bot.stale ? '<span class="chip stale">Stale</span>' : ''}</div>
      </div>
      <p class="does">${escapeHtml(bot.does || '')}</p>
      <p class="task"><span class="who">Now. </span>${escapeHtml(bot.task || 'Nothing posted.')}</p>
      <p class="meta">${escapeHtml(ago(bot.lastActivity))} · ${bot.lastActivity ? escapeHtml(formatET(bot.lastActivity)) : 'no timestamp'}</p>
    </article>`).join('');
}

function renderRoutines() {
  const items = (state.data?.routines || []).map((item) => ({ ...item, healthFlag: item.healthFlag || routineHealth(item, Date.now()) }));
  const today = items.filter((item) => routineBucket(item) === 'today');
  const upcoming = items.filter((item) => routineBucket(item) !== 'today');
  const draw = (list) => {
    if (!list.length) return '<p class="empty">None on the board.</p>';
    return list.map((item) => `<article class="routine">
      <div class="row">
        <span class="chip result ${escapeHtml(item.lastResult || 'attention')}">${escapeHtml(RESULT_LABEL[item.lastResult] || item.lastResult || 'No result')}</span>
        ${item.healthFlag === 'failed' ? '<span class="chip flag failed">Failed</span>' : ''}
        ${item.healthFlag === 'stalled' ? '<span class="chip flag stalled">Stalled</span>' : ''}
        ${item.example ? '<span class="chip example">Example</span>' : ''}
      </div>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="meta">${escapeHtml(item.owner || '')} · ${escapeHtml(item.schedule || '')}</p>
      <p class="detail">${escapeHtml(item.detail || '')}</p>
      <p class="meta">Last run ${item.lastRun ? escapeHtml(formatET(item.lastRun)) : 'not on file'}</p>
    </article>`).join('');
  };
  $('routines-today').innerHTML = draw(today);
  $('routines-upcoming').innerHTML = draw(upcoming);
}

function renderQueue() {
  const items = state.data?.queue || [];
  if (!items.length) {
    $('queue').innerHTML = '<li>The queue is clear.</li>';
    return;
  }
  $('queue').innerHTML = items.map((item, index) => `<li><strong>${index + 1}. ${escapeHtml(item.title)}</strong><br><span class="meta">${escapeHtml(item.owner || '')}${item.after ? ` · ${escapeHtml(item.after)}` : ''}</span></li>`).join('');
}

function renderTimeline() {
  const items = state.data?.activity || [];
  if (!items.length) {
    $('timeline').innerHTML = '<li><div class="event"><p>No activity filed.</p></div></li>';
    return;
  }
  $('timeline').innerHTML = items.map((item) => {
    const doc = safeDoc(item.output);
    return `<li class="${item.example ? 'example' : ''}">
      <article class="event">
        <time datetime="${escapeHtml(item.at || '')}">${item.at ? escapeHtml(formatET(item.at)) : ''}</time>
        <div class="row"><span class="who">${escapeHtml(item.bot || '')}</span>${item.example ? '<span class="chip example">Example</span>' : chip('done', 'Done')}</div>
        <h3>${escapeHtml(item.title || '')}</h3>
        <p class="detail">${escapeHtml(item.detail || '')}</p>
        ${doc ? `<button type="button" class="text-btn" data-doc="${escapeHtml(doc)}">Open output</button>` : ''}
      </article>
    </li>`;
  }).join('');
}

function seriesBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function paintCharts() {
  if (!window.Chart || !state.data) return;
  try {
    paintChartsNow();
  } catch (error) {
    console.error(error);
  }
}

function paintChartsNow() {
  const requests = state.data.requests || [];
  const bots = state.data.bots || [];
  const activity = state.data.activity || [];
  const weight = state.data.health?.weight || [];
  const sig = JSON.stringify({
    theme: currentTheme(),
    categories: CATEGORIES.map((key) => requests.filter((item) => item.category === key).length),
    bots: ['working', 'idle', 'blocked'].map((key) => bots.filter((bot) => bot.status === key).length),
    days: activity.map((item) => etDay(item.at)),
    weight: weight.map((point) => `${point.date}:${point.lb}`)
  });
  if (sig === chartSig) return;
  chartSig = sig;
  charts.forEach((chart) => chart.destroy());
  charts = [];
  const ink = cssVar('--muted') || '#6f675e';
  const grid = cssVar('--grid') || 'rgba(0,0,0,.08)';
  const colors = [1, 2, 3, 4, 5, 6].map((n) => cssVar(`--chart-${n}`));
  Chart.defaults.font.family = FONT;
  Chart.defaults.color = ink;
  Chart.defaults.animation = matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 420 };

  const categoryCounts = CATEGORIES.map((key) => requests.filter((item) => item.category === key).length);
  $('category-summary').textContent = CATEGORIES.map((key, i) => `${key} ${categoryCounts[i]}`).join(' · ');
  charts.push(new Chart($('chart-category'), {
    type: 'bar',
    data: {
      labels: CATEGORIES.map((key) => key[0].toUpperCase() + key.slice(1)),
      datasets: [{ data: categoryCounts, backgroundColor: colors, borderRadius: 8, borderSkipped: false }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: grid } }
      }
    }
  }));

  const fleetCounts = ['working', 'idle', 'blocked'].map((key) => bots.filter((bot) => bot.status === key).length);
  $('fleet-summary').textContent = `Working ${fleetCounts[0]} · Idle ${fleetCounts[1]} · Blocked ${fleetCounts[2]} · Stale ${bots.filter((bot) => isStale(bot.lastActivity)).length}`;
  charts.push(new Chart($('chart-fleet'), {
    type: 'doughnut',
    data: {
      labels: ['Working', 'Idle', 'Blocked'],
      datasets: [{ data: fleetCounts, backgroundColor: [colors[0], colors[4], colors[1]], borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }
    }
  }));

  const byDay = seriesBy(activity, (item) => etDay(item.at));
  const days = [...byDay.keys()].sort();
  $('activity-summary').textContent = days.length
    ? days.map((day) => `${day.slice(5)} · ${byDay.get(day)}`).join('  ')
    : 'No dated activity yet.';
  const weightNode = $('chart-weight');
  if (weightNode) {
    charts.push(new Chart(weightNode, {
      type: 'line',
      data: {
        labels: weight.map((point) => point.date.slice(5)),
        datasets: [{
          data: weight.map((point) => point.lb),
          borderColor: colors[0],
          backgroundColor: colors[0],
          tension: 0.3,
          pointRadius: 3,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { precision: 0 }, grid: { color: grid } }
        }
      }
    }));
  }

  charts.push(new Chart($('chart-activity'), {
    type: 'bar',
    data: {
      labels: days.map((day) => day.slice(5)),
      datasets: [{ label: 'Entries', data: days.map((day) => byDay.get(day)), backgroundColor: colors[2], borderRadius: 8, borderSkipped: false }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: grid } }
      }
    }
  }));
}

function paint() {
  const data = state.data;
  const when = data?.updatedLabel || (data?.updated ? formatET(data.updated) : 'No timestamp');
  $('updated-text').textContent = `Updated ${when} · ${sourceLabel(data)} · ${checkedLabel()}`;
  renderNeeds();
  renderWeek();
  renderHealth();
  renderKids();
  renderHome();
  renderBusiness();
  renderFilters();
  renderRequests();
  renderTrips();
  renderBots();
  renderRoutines();
  renderQueue();
  renderTimeline();
  paintCharts();
}

async function refresh(options = {}) {
  if (!options.force && Date.now() - lastFetch < 4000) return;
  lastFetch = Date.now();
  $('updated-text').textContent = 'Refreshing…';
  try {
    state.data = await loadStatus();
    state.checkedAt = Date.now();
    chartSig = '';
    paint();
  } catch (error) {
    $('needs-list').innerHTML = '<p class="error">The board could not be loaded. Pull to refresh or tap Refresh.</p>';
    console.error(error);
  }
}

function markdownToHtml(md) {
  const escaped = String(md).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parsed = window.marked && typeof window.marked.parse === 'function'
    ? window.marked.parse(escaped, { async: false, gfm: true })
    : `<pre>${escapeHtml(md)}</pre>`;
  const box = document.createElement('div');
  box.innerHTML = parsed;
  box.querySelectorAll('script, iframe, object, style').forEach((node) => node.remove());
  box.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const doc = safeDoc(href);
    if (/^https?:\/\//i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else if (doc) {
      link.dataset.doc = doc;
      link.removeAttribute('href');
      link.setAttribute('role', 'link');
      link.tabIndex = 0;
    } else if (!href.startsWith('#')) {
      link.removeAttribute('href');
    }
  });
  box.querySelectorAll('img').forEach((img) => {
    if (!/^https?:\/\//i.test(img.getAttribute('src') || '')) img.remove();
  });
  return box.innerHTML;
}

async function openDoc(path, title) {
  const doc = safeDoc(path);
  const reader = $('reader');
  const body = $('reader-body');
  reader.hidden = false;
  document.body.classList.add('lock');
  $('reader-kicker').textContent = title || 'Deliverable';
  body.innerHTML = '<p class="loading">Opening…</p>';
  if (!doc) {
    body.innerHTML = `<h1>${escapeHtml(title || 'No file yet')}</h1><p>This ask does not have a markdown file on the board yet.</p>`;
    body.focus();
    return;
  }
  try {
    const response = await fetch(`${doc}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('missing');
    const text = await response.text();
    body.innerHTML = markdownToHtml(text);
  } catch {
    body.innerHTML = '<h1>Not on the board</h1><p>That file could not be opened.</p>';
  }
  body.focus();
}

function showRequest(id) {
  const item = (state.data?.requests || []).find((request) => request.id === id);
  if (!item) return;
  const doc = safeDoc(item.output);
  if (doc) {
    openDoc(doc, item.title);
    return;
  }
  const reader = $('reader');
  reader.hidden = false;
  document.body.classList.add('lock');
  $('reader-kicker').textContent = item.owner || 'Request';
  $('reader-body').innerHTML = `<h1>${escapeHtml(item.title)}</h1><p>${escapeHtml(item.request || '')}</p><p class="meta">${escapeHtml(item.date || '')} · ${escapeHtml(REQUEST_LABEL[item.status] || item.status)}</p><p>No deliverable file has been filed for this ask.</p>`;
  $('reader-body').focus();
}

function openRequest(id) {
  const item = (state.data?.requests || []).find((request) => request.id === id);
  if (!item) return;
  const doc = safeDoc(item.output);
  const url = new URL(location.href);
  url.hash = doc ? `doc=${encodeURIComponent(doc)}` : `ask=${encodeURIComponent(item.id)}`;
  history.pushState({ doc, ask: item.id }, '', url);
  showRequest(id);
}

function closeReader() {
  $('reader').hidden = true;
  document.body.classList.remove('lock');
}

function hashRoute() {
  const hash = location.hash.replace(/^#/, '');
  if (hash.startsWith('doc=')) {
    openDoc(decodeURIComponent(hash.slice(4)));
    return;
  }
  if (hash.startsWith('ask=')) {
    showRequest(decodeURIComponent(hash.slice(4)));
    return;
  }
  closeReader();
}

function bind() {
  $('theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(state.theme) + 1) % order.length];
    applyTheme(next);
  });
  $('refresh').addEventListener('click', () => refresh({ force: true }));
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderRequests();
  });
  $('filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    renderFilters();
    renderRequests();
  });
  document.body.addEventListener('click', (event) => {
    const doc = event.target.closest('[data-doc]');
    if (doc) {
      event.preventDefault();
      const path = doc.dataset.doc;
      const url = new URL(location.href);
      url.hash = `doc=${encodeURIComponent(path)}`;
      history.pushState({ doc: path }, '', url);
      openDoc(path, doc.textContent);
      return;
    }
    const ask = event.target.closest('[data-request]');
    if (ask) openRequest(ask.dataset.request);
  });
  $('reader-back').addEventListener('click', () => {
    if (location.hash.startsWith('#doc=') || location.hash.startsWith('#ask=')) history.back();
    else closeReader();
  });
  window.addEventListener('popstate', hashRoute);
  window.addEventListener('hashchange', hashRoute);

  let startY = 0;
  let pulling = false;
  let armed = false;
  document.addEventListener('touchstart', (event) => {
    if ($('reader').hidden && window.scrollY <= 0) {
      startY = event.touches[0].clientY;
      pulling = true;
      armed = false;
    }
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!pulling) return;
    const dy = event.touches[0].clientY - startY;
    const pull = $('pull');
    if (dy > 72) {
      pull.hidden = false;
      pull.textContent = 'Release to refresh';
      armed = true;
    } else if (dy > 24) {
      pull.hidden = false;
      pull.textContent = 'Pull to refresh';
      armed = false;
    }
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    const pull = $('pull');
    if (armed) {
      pull.textContent = 'Refreshing…';
      await refresh({ force: true });
    }
    pull.hidden = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('focus', () => refresh());
  window.addEventListener('pageshow', () => refresh());
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'auto') applyTheme('auto');
  });
}

applyTheme(state.theme, false);
bind();
refresh({ force: true }).then(hashRoute);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
