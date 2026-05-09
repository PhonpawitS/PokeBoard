// Board layout: 40 tiles around an 11×11 grid perimeter
// tile 0-10:  top row    (col 1-11, row 1)
// tile 11-19: right col  (col 11, row 2-10)
// tile 20-30: bottom row (col 11-1, row 11)
// tile 31-39: left col   (col 1, row 10-2)

const _PB = '<span class="pokeball-icon"></span>';
const TILE_ICONS = {
  start:       "🏁",
  wild:        _PB,
  wild_green:  _PB,
  wild_blue:   _PB,
  wild_purple: _PB,
  wild_red:    _PB,
  gym:         "🏟",
  event:       "❓",
  rocket:      "🚀",
  center:      "💊",
};

function getTileGridPos(id) {
  if (id >= 0  && id <= 10) return { row: 1,       col: id + 1  };
  if (id >= 11 && id <= 19) return { row: id - 9,  col: 11      };
  if (id >= 20 && id <= 30) return { row: 11,       col: 31 - id };
  if (id >= 31 && id <= 39) return { row: 41 - id,  col: 1       };
  return { row: 1, col: 1 };
}

let _boardTiles = null;
window._prevPositions = {};
window._boardPlayers  = {};

// ── Board pan / zoom ─────────────────────────────────────────────
let _pan   = { x: 0, y: 0 };
let _scale = 1.5;
let _drag  = null;

function _applyPan() {
  const grid = document.getElementById("board-grid");
  if (!grid) return;
  grid.style.transform = `translateX(${_pan.x}px) translateY(${_pan.y}px) rotateX(52deg) rotateZ(-45deg) scale(${_scale})`;
}

function initBoardPan() {
  const wrap = document.querySelector(".board-wrap");
  if (!wrap || wrap._panInited) return;
  wrap._panInited = true;

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    _drag = { sx: e.clientX - _pan.x, sy: e.clientY - _pan.y };
    wrap.classList.add("panning");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!_drag) return;
    _pan.x = e.clientX - _drag.sx;
    _pan.y = e.clientY - _drag.sy;
    _applyPan();
  });

  window.addEventListener("mouseup", () => {
    _drag = null;
    wrap.classList.remove("panning");
  });

  wrap.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    _drag = { sx: t.clientX - _pan.x, sy: t.clientY - _pan.y };
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("touchmove", (e) => {
    if (!_drag) return;
    const t = e.touches[0];
    _pan.x = t.clientX - _drag.sx;
    _pan.y = t.clientY - _drag.sy;
    _applyPan();
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("touchend", () => { _drag = null; });

  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    _scale = Math.max(0.6, Math.min(3.0, _scale + delta));
    _applyPan();
  }, { passive: false });

  wrap.addEventListener("dblclick", () => {
    _pan = { x: 0, y: 0 };
    _scale = 1.5;
    _applyPan();
  });
}

function initBoard(boardData) {
  _boardTiles = boardData;
  const grid = document.getElementById("board-grid");
  [...grid.querySelectorAll(".tile")].forEach(el => el.remove());

  boardData.forEach(tile => {
    const pos = getTileGridPos(tile.id);
    const el = document.createElement("div");
    el.className = `tile tile-${tile.type}`;
    el.id = `tile-${tile.id}`;
    el.style.gridRow = pos.row;
    el.style.gridColumn = pos.col;
    el.innerHTML = `
      <span class="tile-num">${tile.id}</span>
      <span class="tile-icon">${TILE_ICONS[tile.type] || "⬜"}</span>
      <span class="tile-label">${tile.label}</span>
      <div class="tokens" id="tokens-${tile.id}"></div>
    `;
    grid.appendChild(el);
  });

  initBoardPan();
}

function initPrevPositions(players) {
  Object.entries(players).forEach(([pid, p]) => {
    window._prevPositions[pid] = p.position;
  });
}

function updateBoard(players, turnOrder, currentTurn) {
  if (!_boardTiles) return;
  window._boardPlayers = players;

  _boardTiles.forEach(t => {
    const el = document.getElementById(`tokens-${t.id}`);
    if (el) el.innerHTML = "";
  });
  document.querySelectorAll(".tile.current-tile").forEach(el => el.classList.remove("current-tile"));

  const activePid = turnOrder && turnOrder.length > 0
    ? turnOrder[currentTurn % turnOrder.length] : null;

  Object.entries(players).forEach(([pid, p]) => {
    _placeToken(pid, p.position, getPidColor(pid), p.name, false);
    if (pid === activePid) {
      const tileEl = document.getElementById(`tile-${p.position}`);
      if (tileEl) tileEl.classList.add("current-tile");
    }
  });
}

// ── token helpers ────────────────────────────────────────────────
function _placeToken(pid, pos, color, name, withAnim) {
  const container = document.getElementById(`tokens-${pos}`);
  if (!container) return;
  const tok = document.createElement("div");
  tok.className = "token" + (withAnim ? " token-pop" : "");
  tok.style.background = color;
  tok.title = name;
  tok.dataset.pid = pid;

  const trainerSlug = window._boardPlayers?.[pid]?.trainer_sprite;
  if (trainerSlug) {
    const img = document.createElement("img");
    img.src = `https://play.pokemonshowdown.com/sprites/trainers/${trainerSlug}.png`;
    img.alt = name[0].toUpperCase();
    img.onerror = () => { img.remove(); tok.textContent = name[0].toUpperCase(); };
    tok.appendChild(img);
  } else {
    tok.textContent = name[0].toUpperCase();
  }

  container.appendChild(tok);

  if (withAnim) {
    const tile = document.getElementById(`tile-${pos}`);
    if (tile) {
      tile.classList.add("tile-stepping");
      setTimeout(() => tile.classList.remove("tile-stepping"), 260);
    }
  }
}

function _removeToken(pid, pos) {
  const container = document.getElementById(`tokens-${pos}`);
  if (!container) return;
  const tok = container.querySelector(`[data-pid="${pid}"]`);
  if (tok) tok.remove();
}

// ── step-by-step movement animation ─────────────────────────────
const STEP_MS = 185;

function animateMoveToken(pid, fromPos, toPos, color, name, callback) {
  const path = [];
  let cur = fromPos;
  while (cur !== toPos) {
    cur = (cur + 1) % 40;
    path.push(cur);
  }

  if (path.length === 0) { callback(); return; }

  _removeToken(pid, fromPos);

  let i = 0;
  function step() {
    if (i > 0) _removeToken(pid, path[i - 1]);
    _placeToken(pid, path[i], color, name, true);
    i++;
    if (i < path.length) {
      setTimeout(step, STEP_MS);
    } else {
      setTimeout(callback, 180);
    }
  }
  step();
}
