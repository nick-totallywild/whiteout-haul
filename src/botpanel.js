// botpanel.js — an in-game editor so players can attach an automation strategy
// without opening DevTools. Paste a strategy body, hit Run; it's compiled and
// registered with WhiteoutBot.setStrategy. The body runs every game tick with
// `s` (state snapshot) and `bot` (the WhiteoutBot API) in scope.

const CODE_KEY = 'whiteout-bot-code';
const RUN_KEY = 'whiteout-bot-running'; // remember if a strategy was active across reloads

// The library: one complete reference strategy (defend + grow) plus the
// SINGLE-PURPOSE building blocks it's made of. Study the full one to see how the
// pieces fit, then tune the reserve/priorities — that's where the leaderboard is won.
const EXAMPLES = {
  'Full strategy (defend + grow)': `// ===== FULL STRATEGY =====================================================
// Runs every tick (your always-on cron).  s = live state,  bot = WhiteoutBot.
// Order matters: defend first (keep money flowing), then grow with the surplus.

// 1) DEFEND -----------------------------------------------------------------
// Avalanche incoming or still on the lane -> defend the convoy (buried trucks
// are a huge loss). 'escape' lets the trucks nearest the tunnel run clear while
// the rest wait safely — fewer dents than a blanket freeze. Auto-releases when
// it's clear. (Swap 'escape' for 'all' to just freeze the whole convoy.)
bot.holdTrucks(s.avalancheDanger, 'escape');

// Bears smashed the fence -> REPAIR now so the lane reopens. Do the emergency
// before anything else this tick.
if (s.fenceBroken && s.cash >= s.repairCost) {
  bot.repairFence();
  return;
}

// 2) SAFETY RESERVE ---------------------------------------------------------
// Keep enough cash that a surprise repair + a few seconds of upkeep can't
// bankrupt us. It scales with costs, so it grows as the operation grows.
const reserve = s.repairCost + s.burnPerSec * 25;
if (s.cash <= reserve) return;            // not safe to spend yet — wait
const spendable = s.cash - reserve;

// 3) GROW -------------------------------------------------------------------
// Buy the best affordable upgrade out of the surplus. Priority favours
// throughput (bays/trucks), then per-load value, then defenses. This order is
// the heart of your strategy — tune it.
const priority = ['bay', 'truck', 'capacity', 'speed', 'tower', 'fence'];
for (const k of priority) {
  if (s.affordable[k] && s.costs[k] <= spendable) {
    bot.buy(k);
    break;                                // one measured purchase per tick
  }
}`,

  'Avalanche emergency': `// Building block: hold the convoy whenever snow is incoming or on the lane.
// On its own this never grows your operation — bolt it onto a buy routine.
bot.holdTrucks(s.avalancheDanger);`,

  'Avalanche escape (smart)': `// Building block: smarter avalanche defense. Trucks close enough to the tunnel
// FLOOR IT and clear the lane (no loss, and they still deliver); the rest wait
// just clear of the snow. s.avalancheEscape = { run, hold, trap, inZone } shows
// the triage live; s.avalancheLethalIn is the seconds-to-impact countdown.
bot.holdTrucks(s.avalancheDanger, 'escape');`,

  'Fence repair': `// Building block: patch the perimeter the moment bears smash through, so the
// trucks roll again. (While breached, bears block the lane -> no income.)
if (s.fenceBroken && s.cash >= s.repairCost) bot.repairFence();`,

  'Auto-expand (cheapest)': `// Building block: greedily buy the cheapest available upgrade. Fast growth, but
// it ignores every hazard — pair it with the defenses or you'll get wrecked.
const k = s.upgrades.filter(u => s.affordable[u]).sort((a,b)=>s.costs[a]-s.costs[b])[0];
if (k) bot.buy(k);`,

  'Keep a cash reserve': `// Building block: only expand once you're comfortably in the black, so an
// avalanche hit or a repair bill can't bankrupt you. Tune the reserve size.
const reserve = s.repairCost + s.burnPerSec * 25;
if (s.cash > reserve) {
  const k = s.upgrades
    .filter(u => s.affordable[u] && s.costs[u] <= s.cash - reserve)
    .sort((a,b)=>s.costs[a]-s.costs[b])[0];
  if (k) bot.buy(k);
}`,
};

const DEFAULT_CODE = EXAMPLES['Full strategy (defend + grow)'];

export function createBotPanel() {
  const toggle = el('button', 'bot-toggle');
  toggle.textContent = '🤖 Bot';
  document.body.appendChild(toggle);

  const panel = el('div', 'bot-panel');
  const exOptions = Object.keys(EXAMPLES)
    .map((k) => `<option value="${k}">${k}</option>`)
    .join('');
  panel.innerHTML = `
    <div class="bot-head"><span class="bot-head-l">Bot strategy <span class="bot-run-badge">○ stopped</span></span><button class="bot-close" title="close">×</button></div>
    <div class="bot-ex-row">
      <span class="bot-ex-label">📚 Examples</span>
      <select class="bot-examples"><option value="">load a building block…</option>${exOptions}</select>
    </div>
    <textarea class="bot-code" spellcheck="false"></textarea>
    <div class="bot-row">
      <button class="bot-run">▶ Run</button>
      <button class="bot-stop">■ Stop</button>
      <span class="bot-status"></span>
    </div>
    <div class="bot-hint">Vars: <code>s</code> (state) &amp; <code>bot</code>. <code>s.avalancheDanger</code>, <code>s.avalancheEscape</code>, <code>s.fenceBroken</code>, <code>s.netPerSec</code>. Calls: <code>bot.buy('bay')</code>, <code>bot.repairFence()</code>, <code>bot.holdTrucks(true,'escape')</code>. Examples are building blocks — combine &amp; tune your own.</div>`;
  document.body.appendChild(panel);

  const code = panel.querySelector('.bot-code');
  const status = panel.querySelector('.bot-status');
  const examples = panel.querySelector('.bot-examples');
  const badge = panel.querySelector('.bot-run-badge');
  code.value = localStorage.getItem(CODE_KEY) || DEFAULT_CODE;

  const setStatus = (msg, cls) => {
    status.textContent = msg;
    status.className = 'bot-status' + (cls ? ' ' + cls : '');
  };

  // Compile + start whatever is in the editor. Returns true on success.
  function runStrategy() {
    const bot = window.WhiteoutBot;
    if (!bot) { setStatus('bot not ready', 'err'); return false; }
    let fn;
    try {
      fn = new Function('s', 'bot', code.value); // compile the strategy body
    } catch (e) {
      setStatus('Syntax error: ' + e.message, 'err');
      return false;
    }
    // wrap so runtime errors surface in the panel instead of only the console
    bot.setStrategy((state) => {
      try {
        fn(state, bot);
      } catch (e) {
        setStatus('Error: ' + e.message, 'err');
      }
    });
    localStorage.setItem(CODE_KEY, code.value);
    localStorage.setItem(RUN_KEY, '1'); // keep running across reloads (it's a cron)
    refreshRunning();
    return true;
  }

  // Live "running" indicator — reads the bot's actual state so it stays accurate
  // even with the panel closed (a green dot also shows on the 🤖 Bot button).
  function refreshRunning() {
    const b = window.WhiteoutBot;
    const running = !!(b && b.isRunning && b.isRunning());
    badge.textContent = running ? '● running' : '○ stopped';
    badge.classList.toggle('on', running);
    toggle.classList.toggle('running', running);
  }

  // Selecting an example loads it AND starts it immediately (so picking e.g.
  // "Fence repair" is running right away). Edit the code + Run to customise.
  examples.addEventListener('change', () => {
    const v = examples.value;
    if (EXAMPLES[v]) {
      code.value = EXAMPLES[v];
      if (runStrategy()) setStatus('running "' + v + '" ●', 'ok');
    }
    examples.value = '';
  });

  let open = false;
  const setOpen = (v) => {
    open = v;
    panel.style.display = v ? 'block' : 'none';
    toggle.classList.toggle('active', v);
  };
  setOpen(false);
  toggle.addEventListener('click', () => setOpen(!open));
  panel.querySelector('.bot-close').addEventListener('click', () => setOpen(false));

  panel.querySelector('.bot-run').addEventListener('click', () => {
    if (runStrategy()) setStatus('running ●', 'ok');
  });

  panel.querySelector('.bot-stop').addEventListener('click', () => {
    window.WhiteoutBot?.clearStrategy();
    localStorage.removeItem(RUN_KEY); // stay stopped across reloads
    setStatus('stopped');
    refreshRunning();
  });

  // Resume the last-running strategy on load, so the cron survives a refresh.
  if (localStorage.getItem(RUN_KEY) === '1') {
    if (runStrategy()) setStatus('resumed ●', 'ok');
  }

  refreshRunning();
  setInterval(refreshRunning, 700); // keep the badge/dot in sync with the bot
}

function el(tag, cls) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
