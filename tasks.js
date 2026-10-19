import { etDay, filterView, sortTasks, todaySections, counts, PRIVATE_CATEGORIES, CATEGORIES } from './lib/tasks.js';

/*
 * Tasks tab. Slice 1: Inbox and Today (with This Evening), quick add, complete, per-view date sort.
 * Data comes from /api/tasks (one private Blob document). Nothing here is written to git.
 */

const ICONS = {
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13.5 6.3 6.2A2 2 0 0 1 8.2 5h7.6a2 2 0 0 1 1.9 1.2L20 13.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 13.5h4.2l1.3 2h5l1.3-2H20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/></g></svg>',
  evening: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z" fill="currentColor"/></svg>',
  upcoming: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  anytime: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10h7M8.5 14h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  someday: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="3.5" y="5" width="17" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  logbook: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m8.8 12.2 2.2 2.2 4.3-4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flag: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14V2.5M3.5 3h8l-1.8 3 1.8 3h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  note: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  list: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="4.5" r="1.3" fill="currentColor"/><circle cx="3.5" cy="11.5" r="1.3" fill="currentColor"/><path d="M7 4.5h6M7 11.5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  calendar: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6.8h11" stroke="currentColor" stroke-width="1.4"/></svg>',
  sort: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path class="tk-tick" d="m5.5 10.4 3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const VIEWS = [
  { id: 'inbox', label: 'Inbox', ready: true },
  { id: 'today', label: 'Today', ready: true },
  { id: 'upcoming', label: 'Upcoming', ready: false },
  { id: 'anytime', label: 'Anytime', ready: false },
  { id: 'someday', label: 'Someday', ready: false },
  { id: 'logbook', label: 'Logbook', ready: false }
];

const SORT_KEY = 'mission-tasks-sort';
const VIEW_KEY = 'mission-tasks-view';

function readSort() {
  try {
    const value = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const state = {
  tasks: [],
  meta: null,
  loaded: false,
  error: '',
  view: VIEWS.some((v) => v.id === localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'today',
  sort: readSort(),
  open: new Set(),
  leaving: new Set(),
  lastFetch: 0
};

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function today() {
  return etDay(new Date());
}

function sortFor(view) {
  return state.sort[view] === 'desc' ? 'desc' : 'asc';
}

function dayDiff(day, base) {
  const [y1, m1, d1] = day.split('-').map(Number);
  const [y2, m2, d2] = base.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

function dayLabel(day, base = today()) {
  const diff = dayDiff(day, base);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function longDate(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function toast(message) {
  const box = $('tk-toast');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  box.classList.remove('show');
  void box.offsetWidth;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.classList.remove('show'); box.hidden = true; }, 3200);
}

async function load(force = false) {
  if (!force && Date.now() - state.lastFetch < 4000) return;
  state.lastFetch = Date.now();
  try {
    const response = await fetch(`api/tasks?t=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
    state.tasks = body.tasks || [];
    state.meta = body.meta || null;
    state.error = '';
  } catch (error) {
    state.error = navigator.onLine === false
      ? 'You are offline. Tasks load from the network only, so they will appear when you are back online.'
      : error.message === 'storage_unconfigured'
        ? 'Task storage is not connected on this deployment.'
        : 'Tasks could not be loaded. Pull to refresh or try again. If it keeps failing, your sign-in may have expired: reload the app.';
  }
  state.loaded = true;
  render();
}

function metaLine(task) {
  const bits = [];
  const base = today();
  if (state.view !== 'today' && task.startDate) {
    bits.push(`<span class="tk-when">${ICONS.calendar}${esc(dayLabel(task.startDate, base))}</span>`);
  }
  if (task.notes) bits.push(`<span class="tk-ico" title="Has notes">${ICONS.note}<span class="sr">Has notes</span></span>`);
  if (task.checklist?.length) {
    const done = task.checklist.filter((item) => item.done).length;
    bits.push(`<span class="tk-ico">${ICONS.list}${done}/${task.checklist.length}</span>`);
  }
  for (const tag of task.tags || []) bits.push(`<span class="tk-tag">${esc(tag)}</span>`);
  if (task.private) {
    bits.push(`<span class="tk-private">${ICONS.lock}${esc(task.category ? task.category[0].toUpperCase() + task.category.slice(1) : 'Private')}</span>`);
  }
  if (task.deadline) {
    const diff = dayDiff(task.deadline, base);
    const tone = diff < 0 ? 'late' : diff <= 2 ? 'soon' : '';
    bits.push(`<span class="tk-due ${tone}">${ICONS.flag}${diff < 0 ? 'Overdue · ' : 'Due '}${esc(dayLabel(task.deadline, base))}</span>`);
  }
  return bits.length ? `<p class="tk-meta">${bits.join('')}</p>` : '';
}

function row(task) {
  const open = state.open.has(task.id);
  const done = task.status !== 'open';
  const leaving = state.leaving.has(task.id);
  const detail = open && (task.notes || task.checklist?.length)
    ? `<div class="tk-detail">${task.notes ? `<p class="tk-notes">${esc(task.notes)}</p>` : ''}${task.checklist?.length
      ? `<ul class="tk-checklist">${task.checklist.map((item) => `<li class="${item.done ? 'done' : ''}"><span class="tk-mini" aria-hidden="true"></span>${esc(item.title)}</li>`).join('')}</ul>` : ''}</div>`
    : '';
  return `<li class="tk-row${done ? ' is-done' : ''}${leaving ? ' is-leaving' : ''}${open ? ' is-open' : ''}" data-id="${esc(task.id)}">
    <div class="tk-row-in">
      <button type="button" class="tk-check" role="checkbox" aria-checked="${done}" data-complete="${esc(task.id)}" aria-label="Complete ${esc(task.title)}">${ICONS.check}</button>
      <div class="tk-body" data-toggle="${esc(task.id)}">
        <p class="tk-title">${esc(task.title)}</p>
        ${metaLine(task)}
        ${detail}
      </div>
    </div>
  </li>`;
}

function list(tasks, empty) {
  if (!tasks.length) return `<p class="tk-empty">${empty}</p>`;
  return `<ul class="tk-list">${tasks.map(row).join('')}</ul>`;
}

function badge() {
  const meta = state.meta;
  if (!meta) return '';
  if (meta.storage === 'memory') return '<span class="tk-badge">Local example data</span>';
  if (meta.key && meta.key !== 'tasks/tasks.json') return '<span class="tk-badge">Preview data</span>';
  return '';
}

function render() {
  const root = $('tasks-tab');
  if (!root) return;
  const base = today();
  const keep = (task) => task.status === 'open' || state.leaving.has(task.id);
  const live = state.tasks.filter(keep).map((task) => (state.leaving.has(task.id) ? { ...task, status: 'open', _done: true } : task));
  const n = counts(live, base);
  const sort = sortFor(state.view);
  const current = VIEWS.find((v) => v.id === state.view) || VIEWS[1];
  const nav = VIEWS.map((v) => `<button type="button" class="tk-nav-item${v.id === state.view ? ' active' : ''}${v.ready ? '' : ' soon'}" role="tab" aria-selected="${v.id === state.view}" data-view="${v.id}">
      <span class="tk-glyph ${v.id}">${ICONS[v.id]}</span><span class="tk-nav-label">${v.label}</span>
      <span class="tk-count">${v.ready ? (n[v.id] || '') : 'Soon'}</span></button>`).join('');

  let body;
  if (!state.loaded) body = '<p class="tk-empty">Loading tasks…</p>';
  else if (state.error) body = `<p class="tk-empty error">${esc(state.error)}</p>`;
  else if (!current.ready) {
    body = `<div class="tk-soon"><span class="tk-glyph big ${current.id}">${ICONS[current.id]}</span><h3>${current.label} is coming soon</h3><p>Slice 1 has Inbox and Today. ${current.label} arrives with the Things import.</p></div>`;
  } else if (state.view === 'today') {
    const sections = todaySections(live, sort, base);
    body = `${list(sections.day, 'Nothing left for today. Enjoy it.')}
      <h3 class="tk-section"><span class="tk-glyph evening">${ICONS.evening}</span>This Evening</h3>
      ${list(sections.evening, 'No evening tasks.')}`;
  } else {
    body = list(sortTasks(filterView(live, state.view, { today: base }), sort, state.view), 'Inbox zero. New tasks without a date land here.');
  }
  const restore = live.map((t) => (t._done ? t.id : null)).filter(Boolean);

  root.innerHTML = `<div class="tk">
    <nav class="tk-nav" role="tablist" aria-label="Task lists">${nav}</nav>
    <div class="tk-main">
      <header class="tk-head">
        <span class="tk-glyph big ${current.id}">${ICONS[current.id]}</span>
        <h2 id="tasks-heading">${current.label}</h2>
        ${current.ready ? `<button type="button" class="tk-sort${sort === 'desc' ? ' desc' : ''}" data-sort="${current.id}" aria-label="Sort by date, ${sort === 'asc' ? 'oldest' : 'newest'} first. Tap to flip.">${ICONS.sort}<span>${sort === 'asc' ? 'Oldest first' : 'Newest first'}</span></button>` : ''}
        <p class="tk-sub">${state.view === 'today' ? esc(longDate(base)) : current.ready ? 'Tasks without a date' : 'Coming soon'} ${badge()}</p>
      </header>
      <div class="tk-body-wrap">${body}</div>
    </div>
  </div>`;
  for (const id of restore) {
    const node = root.querySelector(`.tk-row[data-id="${CSS.escape(id)}"]`);
    if (node) { node.classList.add('is-done'); node.querySelector('.tk-check')?.setAttribute('aria-checked', 'true'); }
  }
}

async function complete(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || state.leaving.has(id)) return;
  state.leaving.add(id);
  const node = document.querySelector(`.tk-row[data-id="${CSS.escape(id)}"]`);
  node?.classList.add('is-done');
  node?.querySelector('.tk-check')?.setAttribute('aria-checked', 'true');
  const request = fetch(`api/tasks?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ complete: true })
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || 'failed');
    return body.task;
  });
  await new Promise((resolve) => setTimeout(resolve, reduceMotion() ? 150 : 650));
  node?.classList.add('is-leaving');
  await new Promise((resolve) => setTimeout(resolve, reduceMotion() ? 0 : 320));
  try {
    const saved = await request;
    state.tasks = state.tasks.map((t) => (t.id === id ? saved : t));
    toast('Moved to the Logbook.');
  } catch {
    toast('Could not complete that task. Try again.');
  }
  state.leaving.delete(id);
  render();
}

/* Quick add */

function sheetMarkup() {
  const cats = ['<option value="">No category</option>', ...CATEGORIES.map((c) => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}${PRIVATE_CATEGORIES.includes(c) ? ' · private' : ''}</option>`)].join('');
  return `<div class="tk-scrim" data-close></div>
  <form class="tk-sheet" id="tk-form" autocomplete="off" aria-labelledby="tk-form-title">
    <div class="tk-grab" aria-hidden="true"></div>
    <h3 id="tk-form-title" class="sr">New task</h3>
    <div class="tk-new">
      <span class="tk-check ghost" aria-hidden="true"></span>
      <input id="tk-title" name="title" class="tk-input-title" placeholder="New task" maxlength="300" required enterkeyhint="done" />
    </div>
    <textarea id="tk-notes" name="notes" class="tk-input-notes" placeholder="Notes" rows="2" maxlength="10000"></textarea>
    <fieldset class="tk-when-set">
      <legend>When</legend>
      <div class="tk-chips" role="radiogroup">
        <label><input type="radio" name="when" value="inbox" /><span>${ICONS.inbox}Inbox</span></label>
        <label><input type="radio" name="when" value="today" /><span>${ICONS.today}Today</span></label>
        <label><input type="radio" name="when" value="evening" /><span>${ICONS.evening}This Evening</span></label>
        <label><input type="radio" name="when" value="date" /><span>${ICONS.upcoming}Date</span></label>
      </div>
      <input type="date" id="tk-when-date" name="whenDate" class="tk-field" hidden aria-label="Start date" />
    </fieldset>
    <div class="tk-grid">
      <label class="tk-lab"><span>${ICONS.flag}Deadline</span><input type="date" name="deadline" class="tk-field" /></label>
      <label class="tk-lab"><span>Tags</span><input name="tags" class="tk-field" placeholder="errand, home" /></label>
      <label class="tk-lab"><span>${ICONS.lock}Category</span><select name="category" class="tk-field">${cats}</select></label>
      <label class="tk-lab tk-switch"><input type="checkbox" name="private" /><span class="tk-toggle" aria-hidden="true"></span><span>Private<small>Left out of shared views</small></span></label>
    </div>
    <div class="tk-actions">
      <button type="button" class="tk-btn ghost" data-close>Cancel</button>
      <button type="submit" class="tk-btn primary">Add task</button>
    </div>
  </form>`;
}

function openSheet() {
  const wrap = $('tk-quick');
  wrap.hidden = false;
  const form = $('tk-form');
  form.reset();
  const when = state.view === 'today' ? 'today' : 'inbox';
  form.querySelector(`input[name="when"][value="${when}"]`).checked = true;
  $('tk-when-date').hidden = true;
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    $('tk-title').focus();
  });
  document.body.classList.add('lock');
}

function closeSheet() {
  const wrap = $('tk-quick');
  wrap.classList.remove('open');
  document.body.classList.remove('lock');
  setTimeout(() => { if (!wrap.classList.contains('open')) wrap.hidden = true; }, reduceMotion() ? 0 : 260);
  $('tk-fab')?.focus();
}

async function submitSheet(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  if (!title) { $('tk-title').focus(); return; }
  let when = data.get('when') || 'inbox';
  if (when === 'date') {
    when = data.get('whenDate') || 'inbox';
  }
  const body = {
    title,
    notes: String(data.get('notes') || ''),
    when,
    deadline: data.get('deadline') || null,
    tags: String(data.get('tags') || ''),
    category: data.get('category') || null,
    private: data.get('private') === 'on'
  };
  if (navigator.onLine === false) {
    toast('You are offline. Your task is still in the form; add it when you are back online.');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'failed');
    state.tasks = [...state.tasks.filter((t) => t.id !== result.task.id), result.task];
    closeSheet();
    render();
    const node = document.querySelector(`.tk-row[data-id="${CSS.escape(result.task.id)}"]`);
    if (node) node.classList.add('is-new');
    else toast(`Added to ${{ inbox: 'Inbox', anytime: 'Anytime', someday: 'Someday' }[result.task.start] || 'Upcoming'}.`);
  } catch (error) {
    toast(`Could not add the task: ${error.message}`);
  }
  button.disabled = false;
}

/* Tab routing: #tasks shows this tab; any other hash shows the board. */

function showTab() {
  const on = location.hash === '#tasks';
  const wasOn = document.body.dataset.tab === 'tasks';
  document.body.dataset.tab = on ? 'tasks' : 'board';
  $('tasks-tab').hidden = !on;
  $('tk-fab').hidden = !on;
  document.querySelectorAll('.jump a').forEach((link) => {
    if (link.getAttribute('href') === '#tasks') link.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (on) {
    if (!wasOn) window.scrollTo(0, 0);
    load();
    render();
  } else if (wasOn && /^#[a-z-]+$/.test(location.hash)) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
}

function bind() {
  const root = $('tasks-tab');
  root.addEventListener('click', (event) => {
    const check = event.target.closest('[data-complete]');
    if (check) { complete(check.dataset.complete); return; }
    const nav = event.target.closest('[data-view]');
    if (nav) {
      state.view = nav.dataset.view;
      localStorage.setItem(VIEW_KEY, state.view);
      render();
      return;
    }
    const sort = event.target.closest('[data-sort]');
    if (sort) {
      const view = sort.dataset.sort;
      state.sort[view] = sortFor(view) === 'asc' ? 'desc' : 'asc';
      localStorage.setItem(SORT_KEY, JSON.stringify(state.sort));
      render();
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const id = toggle.dataset.toggle;
      if (state.open.has(id)) state.open.delete(id);
      else state.open.add(id);
      render();
    }
  });
  const quick = $('tk-quick');
  quick.innerHTML = sheetMarkup();
  quick.addEventListener('click', (event) => { if (event.target.closest('[data-close]')) closeSheet(); });
  quick.addEventListener('change', (event) => {
    if (event.target.name === 'when') {
      const date = $('tk-when-date');
      date.hidden = event.target.value !== 'date';
      if (!date.hidden) { date.min = today(); date.focus(); }
    }
    if (event.target.name === 'category' && PRIVATE_CATEGORIES.includes(event.target.value)) {
      quick.querySelector('input[name="private"]').checked = true;
    }
  });
  $('tk-form').addEventListener('submit', submitSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !quick.hidden) closeSheet();
  });
  $('tk-fab').addEventListener('click', openSheet);
  window.addEventListener('hashchange', showTab);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && location.hash === '#tasks') load(); });
  window.addEventListener('online', () => { if (location.hash === '#tasks') load(true); });
}

bind();
showTab();
