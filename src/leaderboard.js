// leaderboard.js — nickname + email registration and an online leaderboard
// panel. Talks to the backend (server/leaderboard-server.mjs) over REST. Email
// is captured for identity (validated server-side: format + disposable-block +
// DNS MX check) and is never shown on the board. Falls back to "offline" if the
// backend isn't running.

import { LEADERBOARD } from './config.js';

const NICK_KEY = 'whiteout-nick';
const EMAIL_KEY = 'whiteout-email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatMoney(n) {
  n = Math.floor(n);
  if (n < 1000) return '$' + n;
  const units = ['k', 'M', 'B', 'T'];
  let v = n;
  let u = -1;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return '$' + v.toFixed(1) + units[u];
}

/**
 * @param {object} economy - exposes getScore()
 * @returns {{ tick: (dt:number)=>void }}
 */
export function createLeaderboard(economy) {
  let nick = localStorage.getItem(NICK_KEY) || '';
  let email = localStorage.getItem(EMAIL_KEY) || '';
  let submitTimer = 0;
  let online = true;

  // --- leaderboard panel (top-left) ---
  const panel = el('div', 'lb-panel');
  panel.innerHTML = `<div class="lb-title">🏆 Leaderboard</div><div class="lb-sub">Total earned</div><ol class="lb-list"></ol><div class="lb-status"></div>`;
  document.body.appendChild(panel);
  const listEl = panel.querySelector('.lb-list');
  const statusEl = panel.querySelector('.lb-status');

  // --- registration modal (nickname + email) ---
  const modal = el('div', 'lb-modal');
  modal.innerHTML = `
    <div class="lb-card">
      <h2>Whiteout Haul</h2>
      <p class="lb-tag">Mine gold &amp; silver in the frozen north — outlast the bears, the blizzards and the avalanches.</p>
      <p>Register to compete on the leaderboard.</p>
      <input class="lb-input lb-nick" maxlength="16" placeholder="nickname" />
      <input class="lb-input lb-email" type="email" maxlength="60" placeholder="email" />
      <div class="lb-error"></div>
      <button class="lb-go">Start hauling</button>
    </div>`;
  document.body.appendChild(modal);
  const nickInput = modal.querySelector('.lb-nick');
  const emailInput = modal.querySelector('.lb-email');
  const errorEl = modal.querySelector('.lb-error');
  const goBtn = modal.querySelector('.lb-go');

  if (nick) nickInput.value = nick;
  if (email) emailInput.value = email;

  const showError = (m) => {
    errorEl.textContent = m || '';
  };

  async function register() {
    const n = nickInput.value.trim().slice(0, 16);
    const em = emailInput.value.trim().toLowerCase();
    if (!n) return (showError('Enter a nickname'), nickInput.focus());
    if (!EMAIL_RE.test(em)) return (showError('Enter a valid email'), emailInput.focus());

    showError('');
    goBtn.disabled = true;
    nick = n;
    email = em;
    const res = await submitScore();
    goBtn.disabled = false;
    if (res.ok) {
      localStorage.setItem(NICK_KEY, nick);
      localStorage.setItem(EMAIL_KEY, email);
      modal.style.display = 'none';
    } else {
      showError(res.error || 'Could not register — is the leaderboard server running?');
      nick = '';
      email = '';
    }
  }
  goBtn.addEventListener('click', register);
  emailInput.addEventListener('keydown', (e) => e.key === 'Enter' && register());

  // Show the modal unless we already have BOTH a nickname and an email.
  if (nick && email) {
    modal.style.display = 'none';
  } else {
    (nick ? emailInput : nickInput).focus();
  }

  // --- networking ---
  function render(scores) {
    listEl.innerHTML = '';
    for (const s of scores) {
      const li = document.createElement('li');
      if (s.name === nick) li.className = 'lb-me';
      li.innerHTML = `<span class="lb-name">${escapeHtml(s.name)}</span><span class="lb-score">${formatMoney(s.score)}</span>`;
      listEl.appendChild(li);
    }
    statusEl.textContent = online ? '' : 'offline — start the leaderboard server';
  }

  async function fetchTop() {
    try {
      const r = await fetch(`${LEADERBOARD.apiBase}/api/scores`);
      const data = await r.json();
      online = true;
      render(data.scores || []);
    } catch {
      online = false;
      render([]);
    }
  }

  async function submitScore() {
    if (!nick || !email) return { ok: false };
    try {
      const r = await fetch(`${LEADERBOARD.apiBase}/api/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nick, email, score: economy.getScore() }),
      });
      const data = await r.json();
      online = true;
      if (!r.ok) return { ok: false, error: data.error };
      render(data.scores || []);
      return { ok: true };
    } catch {
      online = false;
      render([]);
      return { ok: false, error: 'leaderboard offline' };
    }
  }

  fetchTop();

  function tick(dt) {
    submitTimer += dt;
    if (submitTimer >= LEADERBOARD.submitEvery) {
      submitTimer = 0;
      if (nick && email) submitScore();
      else fetchTop();
    }
  }

  return { tick };
}

function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
