/*
 * Interactive Needs-you cards: Approve, Decline, option buttons, a reply box, and a mic.
 * Answers go to POST /api/inbox (behind the site gate). Statuses come back from GET /api/inbox.
 *
 * Mic: Web Speech API (SpeechRecognition / webkitSpeechRecognition) with a live interim transcript
 * in the editable textarea. Where it is missing (iOS Safari and the Home Screen app), the mic focuses
 * the textarea and asks Naresh to tap the keyboard's dictation mic instead.
 */

const state = {
  items: new Map(), // card id -> latest inbox item
  drafts: new Map(), // card id -> unsent text
  choices: new Map(), // card id -> selected choice
  pending: new Set(),
  errors: new Map(),
  loaded: false
};
let root = null;
let active = null; // { recognition, card }

const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const standalone = typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const micSupported = Boolean(SpeechRecognition) && !standalone;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function slug(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '-');
}

function optionsOf(item) {
  const list = Array.isArray(item?.options) ? item.options : [];
  return list.map((option) => (typeof option === 'string' ? { value: option, label: option } : { value: String(option?.id ?? option?.value ?? option?.label ?? ''), label: String(option?.label ?? option?.id ?? '') }))
    .filter((option) => option.value && option.label)
    .slice(0, 8);
}

function botOf(item) {
  return item.bot || item.owner || 'the bot';
}

/** Markup for one card's controls. app.js puts this inside each Needs-you article. */
export function cardActions(item) {
  if (!item?.id) return '';
  const id = slug(item.id);
  const title = esc(item.title || 'this item');
  const choices = [
    { value: 'approve', label: 'Approve', cls: 'approve' },
    { value: 'decline', label: 'Decline', cls: 'decline' },
    ...optionsOf(item).map((option) => ({ ...option, cls: 'option' }))
  ];
  return `<div class="inbox-card" data-card="${esc(item.id)}" data-bot="${esc(botOf(item))}">
    <p class="inbox-status" role="status" aria-live="polite"></p>
    <form class="inbox-form" novalidate>
      <div class="inbox-choices" role="group" aria-label="Answer for ${title}">
        ${choices.map((choice) => `<button type="button" class="inbox-choice ${choice.cls}" data-choice="${esc(choice.value)}" aria-pressed="false">${esc(choice.label)}</button>`).join('')}
      </div>
      <label class="sr" for="reply-${id}">Reply to ${esc(botOf(item))} about ${title}</label>
      <div class="inbox-reply">
        <textarea id="reply-${id}" class="inbox-text" rows="2" maxlength="2000" placeholder="Reply, or tap the mic" aria-describedby="hint-${id}"></textarea>
        <button type="button" class="inbox-mic" aria-label="Dictate a reply" aria-pressed="false" title="Dictate">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>
        </button>
      </div>
      <p id="hint-${id}" class="inbox-hint" aria-live="polite"></p>
      <button type="submit" class="inbox-submit">Submit</button>
    </form>
  </div>`;
}

function statusText(entry, bot) {
  if (!entry) return '';
  if (entry.status === 'done') return `Done by ${entry.bot || bot}`;
  if (entry.status === 'picked_up') return `Picked up by ${entry.bot || bot}`;
  return `Answered, waiting on ${entry.bot || bot}`;
}

function paintCard(el) {
  const card = el.dataset.card;
  const bot = el.dataset.bot;
  const entry = state.items.get(card);
  const status = el.querySelector('.inbox-status');
  const form = el.querySelector('.inbox-form');
  const text = el.querySelector('.inbox-text');
  const hint = el.querySelector('.inbox-hint');
  const submit = el.querySelector('.inbox-submit');
  el.dataset.state = entry?.status || 'open';
  if (entry) {
    const answer = [entry.choice ? entry.choice[0].toUpperCase() + entry.choice.slice(1) : '', entry.text].filter(Boolean).join(' · ');
    status.innerHTML = `<span class="chip status ${entry.status === 'done' ? 'done' : entry.status === 'picked_up' ? 'working' : 'queued'}">${esc(statusText(entry, bot))}</span>`
      + (answer ? `<span class="inbox-answer">You: ${esc(answer)}</span>` : '')
      + (entry.result_note ? `<span class="inbox-note">${esc(entry.result_note)}</span>` : '');
    form.hidden = true;
  } else {
    status.textContent = '';
    form.hidden = false;
  }
  if (document.activeElement !== text && text.value !== (state.drafts.get(card) || '')) text.value = state.drafts.get(card) || '';
  const chosen = state.choices.get(card) || '';
  el.querySelectorAll('.inbox-choice').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.choice === chosen)));
  const busy = state.pending.has(card);
  submit.disabled = busy;
  submit.textContent = busy ? 'Sending…' : 'Submit';
  if (state.errors.has(card)) hint.textContent = state.errors.get(card);
  const mic = el.querySelector('.inbox-mic');
  const recording = active?.card === card;
  mic.setAttribute('aria-pressed', String(recording));
  mic.setAttribute('aria-label', recording ? 'Stop dictation' : 'Dictate a reply');
  mic.classList.toggle('recording', recording);
}

/** Re-apply statuses and drafts after app.js re-renders the list. */
export function decorateNeeds() {
  root?.querySelectorAll('.inbox-card').forEach(paintCard);
}

async function load() {
  try {
    const res = await fetch('/api/inbox', { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return;
    const body = await res.json();
    for (const item of body.items || []) {
      const prior = state.items.get(item.card);
      if (!prior || prior.created_at <= item.created_at) state.items.set(item.card, item);
    }
    state.loaded = true;
    decorateNeeds();
  } catch { /* offline: cards stay answerable */ }
}

function cardEl(node) {
  return node?.closest?.('.inbox-card');
}

function stopMic() {
  if (!active) return;
  const { recognition } = active;
  active = null;
  try { recognition.stop(); } catch { /* already stopped */ }
  decorateNeeds();
}

function startMic(el) {
  const card = el.dataset.card;
  const text = el.querySelector('.inbox-text');
  const hint = el.querySelector('.inbox-hint');
  state.errors.delete(card);
  if (!micSupported) {
    text.focus();
    hint.textContent = 'Tap the mic on your keyboard to dictate, then edit and Submit.';
    return;
  }
  if (active) {
    const same = active.card === card;
    stopMic();
    if (same) return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  const base = text.value ? `${text.value.replace(/\s+$/, '')} ` : '';
  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk;
      else interim += chunk;
    }
    text.value = (base + finalText + interim).slice(0, 2000);
    state.drafts.set(card, text.value);
  };
  recognition.onerror = (event) => {
    hint.textContent = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Microphone access is off. Allow it in the browser, or use the keyboard dictation mic.'
      : 'Dictation stopped. You can edit the text or try again.';
  };
  recognition.onend = () => {
    if (active?.recognition === recognition) active = null;
    state.drafts.set(card, text.value);
    decorateNeeds();
    if (!hint.textContent) hint.textContent = 'Check the text, then Submit.';
  };
  active = { recognition, card };
  hint.textContent = 'Listening… tap the mic again to stop.';
  try {
    recognition.start();
  } catch {
    active = null;
    text.focus();
    hint.textContent = 'Dictation is not available. Tap the mic on your keyboard instead.';
  }
  decorateNeeds();
}

async function submit(el) {
  const card = el.dataset.card;
  const bot = el.dataset.bot;
  if (state.pending.has(card)) return;
  if (active?.card === card) stopMic();
  const text = el.querySelector('.inbox-text').value.trim();
  const choice = state.choices.get(card) || null;
  const hint = el.querySelector('.inbox-hint');
  if (!text && !choice) {
    hint.textContent = 'Pick Approve, Decline, or an option, or write a reply.';
    return;
  }
  state.errors.delete(card);
  hint.textContent = '';
  // Show the answer right away; roll back if the save fails.
  const optimistic = { id: 'pending', card, bot, text, choice, created_at: new Date().toISOString(), status: 'new', result_note: '' };
  const prior = state.items.get(card);
  state.items.set(card, optimistic);
  state.pending.add(card);
  decorateNeeds();
  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ card, bot, text, choice })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.item) throw new Error(body.message || 'Could not save. Try again.');
    state.items.set(card, body.item);
    state.drafts.delete(card);
    state.choices.delete(card);
  } catch (error) {
    if (prior) state.items.set(card, prior); else state.items.delete(card);
    state.errors.set(card, error.message || 'Could not save. Try again.');
  } finally {
    state.pending.delete(card);
    decorateNeeds();
    const fresh = root?.querySelector(`.inbox-card[data-card="${CSS.escape(card)}"]`);
    if (fresh && state.errors.has(card)) fresh.querySelector('.inbox-text')?.focus();
  }
}

export function initInbox(container) {
  root = container;
  if (!root) return;
  root.addEventListener('click', (event) => {
    const el = cardEl(event.target);
    if (!el) return;
    const choice = event.target.closest('.inbox-choice');
    if (choice) {
      const card = el.dataset.card;
      const value = choice.dataset.choice;
      state.choices.set(card, state.choices.get(card) === value ? '' : value);
      state.errors.delete(card);
      el.querySelector('.inbox-hint').textContent = '';
      paintCard(el);
      return;
    }
    if (event.target.closest('.inbox-mic')) startMic(el);
  });
  root.addEventListener('input', (event) => {
    const el = cardEl(event.target);
    if (el && event.target.classList.contains('inbox-text')) state.drafts.set(el.dataset.card, event.target.value);
  });
  root.addEventListener('submit', (event) => {
    const el = cardEl(event.target);
    if (!el) return;
    event.preventDefault();
    submit(el);
  });
  load();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
}
