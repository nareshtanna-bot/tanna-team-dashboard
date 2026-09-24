const STATUS_URL = 'status.json';
const STATUS_ORDER = ['active', 'blocked', 'pending_goals', 'idle'];
const STATUS_LABELS = {
  active: 'Active',
  blocked: 'Blocked',
  idle: 'Standby',
  pending_goals: 'Pending goals'
};

let allBots = [];
let activeFilter = 'all';

function avatarInitials(name) {
  const parts = name.replace(/^Dr\.\s*/i, '').split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function avatarHue(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function renderPriorities(priorities) {
  const el = document.getElementById('priorities');
  document.getElementById('priority-count').textContent = priorities.length + ' ranked';
  el.innerHTML = priorities.map(p => `
    <article class="priority-card">
      <div class="rank" aria-label="Priority ${p.rank}">${p.rank}</div>
      <div>
        <div class="p-title">${escapeHtml(p.title)}</div>
        <div class="p-detail">${escapeHtml(p.detail)}</div>
      </div>
    </article>
  `).join('');
}

function renderFilters(bots) {
  const counts = { all: bots.length };
  bots.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
  const keys = ['all', ...STATUS_ORDER.filter(k => counts[k])];
  const el = document.getElementById('filters');
  el.innerHTML = keys.map(k => {
    const label = k === 'all' ? 'All' : STATUS_LABELS[k];
    const active = activeFilter === k ? ' active' : '';
    return `<button type="button" class="chip${active}" data-filter="${k}" aria-pressed="${activeFilter === k}">${label} · ${counts[k]}</button>`;
  }).join('');
  el.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderFilters(allBots);
      renderBots(allBots);
    });
  });
}

function renderBots(bots) {
  const filtered = activeFilter === 'all'
    ? bots
    : bots.filter(b => b.status === activeFilter);
  const sorted = [...filtered].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });
  document.getElementById('bot-count').textContent = sorted.length + ' shown';
  const el = document.getElementById('bots');
  if (!sorted.length) {
    el.innerHTML = '<div class="loading">No bots in this filter.</div>';
    return;
  }
  el.innerHTML = sorted.map(b => {
    const hue = avatarHue(b.id);
    const next = b.next
      ? `<div class="next"><div class="label">Next</div>${escapeHtml(b.next)}</div>`
      : '';
    return `
      <article class="bot-card" data-status="${escapeHtml(b.status)}">
        <div class="bot-top">
          <div class="bot-identity">
            <div class="avatar" style="background:hsl(${hue} 28% 18%);color:hsl(${hue} 70% 72%)">${avatarInitials(b.name)}</div>
            <div>
              <div class="bot-name">${escapeHtml(b.name)}</div>
              <div class="bot-role">${escapeHtml(b.role)}</div>
            </div>
          </div>
          <span class="badge ${escapeHtml(b.status)}">${STATUS_LABELS[b.status] || b.status}</span>
        </div>
        <div class="bot-body">
          <div class="label">Working on</div>
          <div class="working">${escapeHtml(b.working_on)}</div>
          ${next}
        </div>
      </article>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function load() {
  try {
    const res = await fetch(STATUS_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    document.getElementById('updated-text').textContent =
      data.updatedLabel || data.updated || '—';
    renderPriorities(data.priorities || []);
    allBots = data.bots || [];
    renderFilters(allBots);
    renderBots(allBots);
  } catch (err) {
    document.getElementById('priorities').innerHTML =
      '<div class="error">Could not load status.json</div>';
    console.error(err);
  }
}

load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
