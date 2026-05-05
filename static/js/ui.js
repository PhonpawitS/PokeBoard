// ── Session state ──────────────────────────────────────────────
window.SESSION = { pid: null, roomId: null, isHost: false };

const PLAYER_COLORS = ["#e53935", "#1565c0", "#2e7d32", "#f57f17"];
const CLASS_DESC = {};
(window.CLASSES_DATA || []).forEach(c => { CLASS_DESC[c.id] = c.ability_desc; });

// ── Item helpers ────────────────────────────────────────────────
const _ITEM_ICON_FB = {
  poke_ball: "🎾", great_ball: "⭐", ultra_ball: "🟡",
  potion: "💊", medicine: "💊", rare_candy: "🍬",
  speed_boots: "👟", x_attack: "⚡", escape_rope: "🪢",
};
function getItemData(itemId) {
  return (window.ITEMS_DATA || []).find(i => i.id === itemId)
    || { id: itemId, name: itemId, icon: _ITEM_ICON_FB[itemId] || "📦", type: "catch", desc: "" };
}
function isUsableItem(itemId) {
  const t = getItemData(itemId).type;
  return t && t !== "catch";
}
function itemSpriteUrl(spriteSlug) {
  if (!spriteSlug) return null;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${spriteSlug}.png`;
}

function itemImgOrIcon(itemId, size = 24) {
  const d = getItemData(itemId);
  const url = itemSpriteUrl(d.sprite_slug);
  if (url) {
    return `<img src="${url}" width="${size}" height="${size}" style="image-rendering:pixelated;vertical-align:middle;" onerror="this.replaceWith(document.createTextNode('${d.icon}'))" alt="${d.name}">`;
  }
  return d.icon;
}

function getItemDisplayHtml(items) {
  if (!items || !items.length) return "";
  const counts = {};
  items.forEach(i => { counts[i] = (counts[i] || 0) + 1; });
  const parts = Object.entries(counts).map(([id, n]) =>
    `<span style="white-space:nowrap;">${itemImgOrIcon(id, 18)}${n > 1 ? `×${n}` : ""}</span>`
  );
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;">${parts.join("")}</div>`;
}

const _BALL_IDS = ["poke_ball", "great_ball", "ultra_ball"];
function getBallDisplayHtml(items) {
  if (!items || !items.length) return "";
  const counts = {};
  let otherCount = 0;
  items.forEach(i => {
    if (_BALL_IDS.includes(i)) counts[i] = (counts[i] || 0) + 1;
    else otherCount++;
  });
  const parts = Object.entries(counts).map(([id, n]) =>
    `<span style="white-space:nowrap;">${itemImgOrIcon(id, 16)}${n > 1 ? `×${n}` : ""}</span>`
  );
  if (otherCount > 0) parts.push(`<span style="font-size:.65rem;color:#999">+${otherCount}🎒</span>`);
  if (!parts.length) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;margin-top:3px;">${parts.join("")}</div>`;
}

// ── Lobby helpers ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const roomInput = document.getElementById("inp-room");
  if (roomInput) roomInput.addEventListener("input", e => {
    e.target.value = e.target.value.toUpperCase();
  });
});

function showLobbyMsg(msg, isError = true) {
  const el = document.getElementById("lobby-msg");
  el.style.color = isError ? "#c00" : "#2e7d32";
  el.textContent = msg;
}

// ── Screen transitions ──────────────────────────────────────────
function showScreen(id) {
  ["lobby", "waiting", "game"].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle("hidden", s !== id);
  });
}

// ── Waiting room ────────────────────────────────────────────────
function renderWaiting(players, isHost) {
  document.getElementById("disp-room-id").textContent = SESSION.roomId;

  // Class selector for current player
  const myPlayer = players[SESSION.pid];
  const myClassId = myPlayer ? myPlayer.class_id : "trainer";
  const classes = window.CLASSES_DATA || [];
  const myClassData = classes.find(c => c.id === myClassId);
  const classOptionsHtml = classes.map(c =>
    `<option value="${c.id}"${c.id === myClassId ? " selected" : ""}>${c.name}</option>`
  ).join("");
  const classPicker = document.getElementById("wr-class-picker");
  if (classPicker) {
    classPicker.innerHTML = `
      <label style="font-size:.85rem;font-weight:600;">อาชีพของคุณ</label>
      <select id="wr-class-select" style="width:100%;margin:4px 0 2px;padding:6px;border-radius:6px;border:1px solid #ddd;" onchange="setClassInRoom()">${classOptionsHtml}</select>
      <div style="font-size:.78rem;color:#555;" id="wr-ability-hint">${myClassData ? myClassData.ability_desc : "—"}</div>
    `;
    document.getElementById("wr-class-select").addEventListener("change", () => {
      const sel = document.getElementById("wr-class-select");
      const cls = classes.find(c => c.id === sel.value);
      const hint = document.getElementById("wr-ability-hint");
      if (hint && cls) hint.textContent = cls.ability_desc;
    });
  }

  const wrap = document.getElementById("waiting-players");
  wrap.innerHTML = "";
  Object.values(players).forEach((p, i) => {
    const div = document.createElement("div");
    div.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee;";
    div.innerHTML = `
      <span style="width:14px;height:14px;border-radius:50%;background:${PLAYER_COLORS[i % 4]};display:inline-block;"></span>
      <span style="font-weight:600;">${p.name}</span>
      <span style="color:#888;font-size:.8rem;">${getClassName(p.class_id)}</span>
    `;
    wrap.appendChild(div);
  });

  const startWrap = document.getElementById("start-btn-wrap");
  const hint = document.getElementById("waiting-hint");
  if (isHost) {
    startWrap.classList.toggle("hidden", Object.keys(players).length < 2);
    hint.textContent = Object.keys(players).length < 2 ? "รอผู้เล่นอย่างน้อย 2 คน..." : "";
  } else {
    startWrap.classList.add("hidden");
    hint.textContent = "รอ host เริ่มเกม...";
  }
}

function getClassName(id) {
  const c = (window.CLASSES_DATA || []).find(x => x.id === id);
  return c ? c.name : id;
}

// ── Player color ────────────────────────────────────────────────
window.pidColorMap = {};
function getPidColor(pid) {
  if (!window.pidColorMap[pid]) {
    const idx = Object.keys(window.pidColorMap).length % PLAYER_COLORS.length;
    window.pidColorMap[pid] = PLAYER_COLORS[idx];
  }
  return window.pidColorMap[pid];
}

// ── Player cards ─────────────────────────────────────────────────
function renderPlayers(players, turnOrder, currentTurn) {
  const wrap = document.getElementById("players-wrap");
  wrap.innerHTML = "";

  // Assign colors in turn order
  (turnOrder || Object.keys(players)).forEach(pid => getPidColor(pid));

  const activePid = turnOrder ? turnOrder[currentTurn % turnOrder.length] : null;

  Object.entries(players).forEach(([pid, p]) => {
    const card = document.createElement("div");
    card.className = "player-card" +
      (pid === activePid ? " active-turn" : "") +
      (pid === SESSION.pid ? " my-card" : "");

    const pokemonList = (p.pokemon || []).map(pk => pk.name).join(", ") || "ไม่มี";
    const faintedCount = (p.fainted || []).length;
    const totalAtk = (p.pokemon || []).reduce((s, pk) => s + pk.atk, 0);
    const badgesHtml = (p.badges || []).map(b => `<span class="badge-chip">🏅${b}</span>`).join("") || "<span style='color:#aaa'>—</span>";
    const pokeCount = (p.pokemon || []).length;
    const faintedSuffix = faintedCount > 0 ? ` <span style="color:#e53935">(faint:${faintedCount})</span>` : "";
    const ballHtml = getBallDisplayHtml(p.items || []);

    card.innerHTML = `
      <div class="pc-header">
        <div class="pc-token" style="background:${getPidColor(pid)};"></div>
        <div>
          <div class="pc-name">${p.name} ${pid === SESSION.pid ? "<span style='color:#c00;font-size:.7rem'>(คุณ)</span>" : ""}</div>
          <div class="pc-class">${getClassName(p.class_id)}</div>
        </div>
      </div>
      <div class="pc-stats">
        <div class="pc-stat"><span class="pc-stat-val">💰${p.money}</span><span class="pc-stat-lbl">เงิน</span></div>
        <div class="pc-stat"><span class="pc-stat-val">⚔️${totalAtk}</span><span class="pc-stat-lbl">ATK</span></div>
        <div class="pc-stat"><span class="pc-stat-val">🎯${pokeCount}</span><span class="pc-stat-lbl">โปเกมอน</span></div>
        <div class="pc-stat"><span class="pc-stat-val">📍${p.position}</span><span class="pc-stat-lbl">ช่อง</span></div>
      </div>
      <div class="pc-badges">${badgesHtml}</div>
      ${ballHtml}
      <div class="pc-pokemon pc-pokemon-link" style="margin-top:4px;" title="คลิกดูรายละเอียด">${pokemonList}${faintedSuffix} 📋</div>
    `;
    card.querySelector(".pc-pokemon-link").addEventListener("click", () => {
      showPlayerPokemonModal(p);
    });
    wrap.appendChild(card);
  });
}

// ── Action panel ─────────────────────────────────────────────────
function renderActionPanel(phase, pending, players) {
  const title = document.getElementById("action-title");
  const btns = document.getElementById("action-btns");
  btns.innerHTML = "";

  const rollBtn = document.getElementById("btn-roll");
  const endBtn = document.getElementById("btn-end-game");

  if (phase !== "playing") {
    title.textContent = phase === "ended" ? "เกมจบแล้ว" : "รอเริ่มเกม";
    rollBtn && rollBtn.classList.add("hidden");
    return;
  }

  const isMyTurn = pending && pending.pid === SESSION.pid;
  const noAction = !pending || !pending.type;
  const iAmActive = noAction &&
    window._gameState?.turn_order &&
    window._gameState.turn_order[window._gameState.current_turn % window._gameState.turn_order.length] === SESSION.pid;

  // Roll button
  if (rollBtn) rollBtn.classList.toggle("hidden", !iAmActive);
  if (endBtn)  endBtn.classList.toggle("hidden", !SESSION.isHost);

  if (noAction) {
    if (iAmActive) {
      title.textContent = "🎲 เทิร์นของคุณ!";
      const usable = (players[SESSION.pid]?.items || []).filter(isUsableItem);
      if (usable.length > 0)
        _addBtn(btns, "🎒 ใช้ไอเทม", "btn-secondary btn-sm", showUseItemModal);
    } else {
      title.textContent = "รอผู้เล่น...";
    }
    return;
  }

  if (pending.type === "event_display") {
    title.textContent = SESSION.pid === pending.pid
      ? "🃏 อีเว้นท์ — กด ต่อไป ในการ์ด"
      : `🃏 รอ ${players[pending.pid]?.name || "?"} กดต่อไป...`;
    return;
  }

  if (pending.type === "battle_ongoing") {
    const d = pending.data || {};
    const amInBattle = SESSION.pid === d.pid_atk || SESSION.pid === d.pid_def;
    title.textContent = amInBattle ? "⚔️ กำลังต่อสู้ — ดูหน้าต่อสู้!" : `⚔️ ${players[d.pid_atk]?.name || "?"} กำลังต่อสู้...`;
    return;
  }

  if (pending.type === "pvp_defender_selecting") {
    if (isMyTurn) {
      const attackerName = (pending.data || {}).attacker_name || "ผู้เล่น";
      title.textContent = `⚔️ ${attackerName} ท้าสู้! เลือก Pokémon`;
      _addBtn(btns, "⚔️ เลือก Pokémon สู้!", "btn-danger btn-sm", () => startDefenderPvPSelectFlow(attackerName));
      _addBtn(btns, "🏃 หนี", "btn-secondary btn-sm", () => doAction("pvp_pokemon_select", { pokemon_id: null }));
    } else {
      title.textContent = `⚔️ รอ ${players[pending.pid]?.name || "?"} เลือก Pokémon...`;
    }
    return;
  }

  if (!isMyTurn) {
    title.textContent = `รอ ${players[pending.pid]?.name || "?"} ตัดสินใจ...`;
    return;
  }

  const t = pending.type;
  const data = pending.data || {};

  if (t === "wild") {
    const pk = data.pokemon || {};
    const myPl = players[SESSION.pid];
    const hasPB = hasItem("poke_ball", myPl);
    const hasGB = hasItem("great_ball", myPl);
    const hasUB = hasItem("ultra_ball", myPl);
    title.textContent = `🌿 พบ ${pk.name}! (ATK ${pk.atk})`;
    if (hasPB)
      _addBtn(btns, "✅ จับ (Poké Ball)", "btn-success btn-sm", () => doAction("catch", { item: "poke_ball" }));
    if (hasGB)
      _addBtn(btns, "⭐ จับ (Great Ball)", "btn-info btn-sm", () => doAction("catch", { item: "great_ball" }));
    if (hasUB)
      _addBtn(btns, "🟡 จับ (Ultra Ball)", "btn-warning btn-sm", () => doAction("catch", { item: "ultra_ball" }));
    if (!hasPB && !hasGB && !hasUB) {
      const noBall = document.createElement("span");
      noBall.textContent = "❌ ไม่มีบอล!";
      noBall.style.cssText = "font-size:.78rem;color:#e53935;font-weight:700;padding:4px 0;";
      btns.appendChild(noBall);
    }
    _addBtn(btns, "🏃 หนี", "btn-secondary btn-sm", () => doAction("skip", {}));

  } else if (t === "gym") {
    const gym = data.gym || {};
    title.textContent = `🏟 ยิม ${gym.name} (ATK ${gym.atk})`;
    _addBtn(btns, "⚔️ เลือก Pokémon สู้!", "btn-danger btn-sm", () => startFightFlow());
    _addBtn(btns, "🏃 ผ่าน", "btn-secondary btn-sm", () => doAction("skip", {}));

  } else if (t === "rocket") {
    title.textContent = `🚀 Rocket Grunt (ATK ${data.grunt_atk})`;
    _addBtn(btns, "⚔️ เลือก Pokémon สู้!", "btn-danger btn-sm", () => startFightFlow());
    _addBtn(btns, "🏃 หนี", "btn-secondary btn-sm", () => doAction("skip", {}));

  } else if (t === "tile_with_pvp") {
    const tileLabel = (data.tile || {}).label || "??";
    title.textContent = `⚔️ พบ ${data.opponent_name}! — สู้หรือใช้ช่อง?`;
    _addBtn(btns, `⚔️ สู้กับ ${data.opponent_name}!`, "btn-danger btn-sm", () => startPvPFightFlow(data.opponent_name));
    _addBtn(btns, `🎯 ใช้ช่อง (${tileLabel})`, "btn-secondary btn-sm", () => doAction("use_tile", {}));

  } else if (t === "pass_go") {
    title.textContent = `🏁 หยุด Start! +${data.bonus || 6} เงิน — วิจัยก่อนไหม?`;
    _addBtn(btns, "ต่อไป →", "btn-primary btn-sm", () => doAction("continue", {}));

  } else if (t === "center_shop") {
    title.textContent = "💊 HP เต็มแล้ว! แวะร้านค้าได้";
    _addBtn(btns, "🛒 เข้าร้าน", "btn-info btn-sm", showCenterShop);
    _addBtn(btns, "ออก →", "btn-primary btn-sm", () => doAction("shop_done", {}));
  }

  // Research button (always show for your turn)
  if (players[SESSION.pid] && (players[SESSION.pid].pokemon || []).length > 0) {
    _addBtn(btns, "🔬 วิจัย", "btn-info btn-sm", showResearchModal);
  }

  // Use Item button (show when current player has usable items, outside battle)
  const myPendingOk = !pending.type || pending.pid === SESSION.pid;
  const notInBattle = pending.type !== "battle_ongoing" && pending.type !== "pvp_defender_selecting";
  if (myPendingOk && notInBattle && players[SESSION.pid]) {
    const usable = (players[SESSION.pid].items || []).filter(isUsableItem);
    if (usable.length > 0) {
      _addBtn(btns, "🎒 ใช้ไอเทม", "btn-secondary btn-sm", showUseItemModal);
    }
  }
}

function hasItem(item, player) {
  return player && (player.items || []).includes(item);
}

function _addBtn(container, text, cls, fn) {
  const b = document.createElement("button");
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.onclick = fn;
  container.appendChild(b);
}

// ── Log panel ────────────────────────────────────────────────────
function renderLog(logs) {
  const panel = document.getElementById("log-panel");
  const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 30;
  panel.innerHTML = (logs || []).map(l => `<div class="log-entry">${l.msg}</div>`).join("");
  if (atBottom) panel.scrollTop = panel.scrollHeight;
}

// ── Modal ────────────────────────────────────────────────────────
function showModal(title, bodyHtml, buttons) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  const btnContainer = document.getElementById("modal-btns");
  btnContainer.innerHTML = "";
  (buttons || []).forEach(({ text, cls, fn }) => {
    const b = document.createElement("button");
    b.className = `btn ${cls || "btn-secondary"} btn-sm`;
    b.textContent = text;
    b.onclick = () => { closeModal(); fn && fn(); };
    btnContainer.appendChild(b);
  });
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

// ── Research modal ───────────────────────────────────────────────
function showResearchModal() {
  const player = window._gameState && window._gameState.players && window._gameState.players[SESSION.pid];
  if (!player) return;
  const pokemon = player.pokemon || [];
  if (!pokemon.length) return;

  const checkboxes = pokemon.map((p, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <input type="checkbox" value="${p.id}" data-idx="${i}" style="width:16px;height:16px;">
      <span>${p.name} (ATK ${p.atk}${p.hp != null ? `, HP ${p.hp}/${p.max_hp}` : ""}, วิจัย ${p.research_value} เงิน)</span>
    </label>
  `).join("");

  showModal("🔬 เลือกโปเกมอนที่จะวิจัย",
    `<div>${checkboxes}</div>`,
    [
      { text: "ส่งวิจัย", cls: "btn-success", fn: () => {
        const ids = [...document.querySelectorAll("#modal-body input[type=checkbox]:checked")]
          .map(cb => cb.value);
        if (ids.length) doResearch(ids);
      }},
      { text: "ยกเลิก", cls: "btn-secondary" }
    ]
  );
}

// ── Pokemon sprite helpers ───────────────────────────────────────
function pokeSpriteUrl(spriteId, animated, back = false) {
  if (!spriteId) return null;
  if (animated) {
    const dir = back ? "back/" : "";
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${dir}${spriteId}.gif`;
  }
  const dir = back ? "back/" : "";
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dir}${spriteId}.png`;
}

function pokeImgTag(spriteId, animated, cls, back = false) {
  const url = pokeSpriteUrl(spriteId, animated, back);
  if (!url) return "";
  return `<img class="${cls || "pk-sprite"}" src="${url}" onerror="this.style.display='none'" alt="">`;
}

// ── Player pokemon detail modal ──────────────────────────────────
function showPlayerPokemonModal(player) {
  const alive = (player.pokemon || []);
  const fainted = (player.fainted || []);
  const allPkmn = [
    ...alive.map(p => ({ ...p, fainted: false })),
    ...fainted.map(p => ({ ...p, fainted: true })),
  ];

  if (!allPkmn.length) {
    showModal(`🎒 ${player.name} — โปเกมอน`, `<p style="color:#888">ยังไม่มีโปเกมอน</p>`, [
      { text: "ปิด", cls: "btn-secondary" },
    ]);
    return;
  }

  const rows = allPkmn.map(pk => `
    <div class="pk-detail-row${pk.fainted ? " pk-fainted" : ""}">
      ${pokeImgTag(pk.sprite_id, false, "pk-detail-sprite")}
      <div class="pk-detail-info">
        <div class="pk-detail-name">${pk.name}${pk.fainted ? " <span style='color:#e53935;font-size:.7rem'>(faint)</span>" : ""}</div>
        <div class="pk-detail-stats">Type: ${pk.type} · ATK: ${pk.atk} · Research: ${pk.research_value}💰</div>
        ${pk.fainted ? "" : _hpBarHtml(pk.hp, pk.max_hp)}
      </div>
    </div>
  `).join("");

  showModal(
    `🎒 ${player.name} — โปเกมอน (${alive.length} ตัว)`,
    `<div class="pk-detail-list">${rows}</div>`,
    [{ text: "ปิด", cls: "btn-secondary" }]
  );
}

// ── Dice animation ───────────────────────────────────────────────
let _diceRolling = false;
const _diceTimers = [];

function _clearTimers() {
  _diceTimers.forEach(clearTimeout);
  _diceTimers.length = 0;
}

function _cycleFace(elId, delay) {
  if (!_diceRolling) return;
  const el = document.getElementById(elId);
  if (el) el.textContent = String(Math.ceil(Math.random() * 6));
  _diceTimers.push(setTimeout(() => _cycleFace(elId, Math.min(delay * 1.09, 230)), delay));
}

// single die — turn roll
function showDiceRolling(title, subtitle) {
  _diceRolling = true;
  _clearTimers();
  const overlay = document.getElementById("dice-overlay");
  overlay.innerHTML = `
    <div class="dice-card">
      <div class="dice-title">${title}</div>
      <div class="dice-face rolling" id="dface-main">1</div>
      <div class="dice-label" id="dlabel">${subtitle}</div>
    </div>`;
  overlay.classList.remove("hidden", "fade-out");
  _cycleFace("dface-main", 55);
  _diceTimers.push(setTimeout(() => { if (_diceRolling) _hideDice(); }, 4000));
}

function settleDice(value, extraLabel) {
  if (!_diceRolling) return Promise.resolve();
  _diceRolling = false;
  _clearTimers();
  const face = document.getElementById("dface-main");
  const label = document.getElementById("dlabel");
  if (face) { face.textContent = String(value); face.className = "dice-face settling"; }
  if (label) label.textContent = extraLabel || `ได้ ${value}!`;
  return new Promise(resolve => {
    setTimeout(() => { _hideDice(); setTimeout(resolve, 240); }, 1100);
  });
}

// double die — battle
function showBattleDice(playerName, enemyLabel) {
  _diceRolling = true;
  _clearTimers();
  const overlay = document.getElementById("dice-overlay");
  overlay.innerHTML = `
    <div class="dice-card">
      <div class="dice-title">⚔️ การต่อสู้</div>
      <div class="battle-dice-row">
        <div class="battle-dice-col">
          <div class="dice-face rolling" id="dface-player">1</div>
          <span class="battle-name">${playerName}</span>
        </div>
        <div class="vs-badge">VS</div>
        <div class="battle-dice-col">
          <div class="dice-face rolling enemy" id="dface-enemy">1</div>
          <span class="battle-name">${enemyLabel || "ศัตรู"}</span>
        </div>
      </div>
      <div class="dice-label" id="dlabel">กำลังต่อสู้...</div>
    </div>`;
  overlay.classList.remove("hidden", "fade-out");
  _cycleFace("dface-player", 55);
  _cycleFace("dface-enemy", 65);
  _diceTimers.push(setTimeout(() => { if (_diceRolling) _hideDice(); }, 5000));
}

function settleBattleDice(pDice, eDice, pTotal, eTotal, won, extraMsg) {
  if (!_diceRolling) return Promise.resolve();
  _diceRolling = false;
  _clearTimers();
  const pFace = document.getElementById("dface-player");
  const eFace = document.getElementById("dface-enemy");
  const label = document.getElementById("dlabel");
  if (pFace) { pFace.textContent = String(pDice); pFace.className = `dice-face settling${won ? " win" : " lose"}`; }
  if (eFace) { eFace.textContent = String(eDice); eFace.className = `dice-face enemy settling${won ? " lose" : " win"}`; }
  if (label) {
    const base = won ? `🎉 ชนะ! (${pTotal} vs ${eTotal})` : `💀 แพ้... (${pTotal} vs ${eTotal})`;
    label.innerHTML = extraMsg ? `${base}<br><span style="font-size:.85em">${extraMsg}</span>` : base;
    label.style.color = won ? "#2e7d32" : "#c62828";
  }
  return new Promise(resolve => {
    setTimeout(() => { _hideDice(); setTimeout(resolve, 240); }, 1900);
  });
}

// ── Pokemon selection modal ──────────────────────────────────────
function _hpBarHtml(hp, maxHp, battle = false) {
  if (hp == null || !maxHp) return "";
  const pct = Math.max(0, Math.round(hp / maxHp * 100));
  const color = pct > 50 ? "#4caf50" : pct > 25 ? "#ff9800" : "#f44336";
  if (battle) {
    return `
      <div style="margin:8px 4px 2px;">
        <div style="width:100%;height:12px;background:rgba(0,0,0,0.5);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:6px;transition:width 0.4s ease;box-shadow:0 0 6px ${color}88;"></div>
        </div>
        <div style="font-size:.72rem;color:#cde;text-align:center;margin-top:3px;">${hp} / ${maxHp} HP</div>
      </div>`;
  }
  return `
    <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
      <div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:.7rem;color:#555;white-space:nowrap;">${hp}/${maxHp}</span>
    </div>`;
}

function showPokemonSelectModal(pokemon, onSelect, enemyLabel) {
  const rows = pokemon.map(pk => `
    <div class="pk-select-row" onclick="window._pkSelectFn('${pk.id}')">
      ${pokeImgTag(pk.sprite_id, false, "pk-detail-sprite")}
      <div class="pk-detail-info">
        <div class="pk-detail-name">${pk.name}</div>
        <div class="pk-detail-stats">Type: ${pk.type} · ATK: ${pk.atk}</div>
        ${_hpBarHtml(pk.hp, pk.max_hp)}
      </div>
    </div>
  `).join("");

  window._pkSelectFn = (id) => { closeModal(); onSelect(id); };

  showModal(
    `⚔️ เลือก Pokémon สู้กับ ${enemyLabel}`,
    `<div class="pk-detail-list">${rows}</div>`,
    [{ text: "ยกเลิก", cls: "btn-secondary" }]
  );
}

// ── Battle screen ────────────────────────────────────────────────
// flip=true = defender (front sprite), flip=false = attacker (back sprite)
function _battleSideHtml(pk, ownerName, flip) {
  const hpId = flip ? "battle-def-hp" : "battle-atk-hp";
  const img = pokeImgTag(pk.sprite_id, true, "battle-sprite", !flip);
  return `
    <div class="battle-sprite-wrap">${img}</div>
    <div class="battle-pkmn-name">${pk.name || pk.pokemon_name || "ไม่มีโปเกมอน"}</div>
    <div class="battle-pkmn-owner">${ownerName || ""}</div>
    <div class="battle-pkmn-atk">ATK: ${pk.atk ?? 0}</div>
    <div id="${hpId}">${_hpBarHtml(pk.hp, pk.max_hp, true)}</div>
  `;
}

function showBattleScreen(data) {
  const myPid = window.SESSION?.pid;
  const isParticipant = data.attacker_pid === myPid || data.defender_pid === myPid;
  const atkPk = data.attacker_pokemon || {};
  const def = data.defender || {};

  document.getElementById("battle-attacker").innerHTML = _battleSideHtml(atkPk, data.attacker_name, false);
  document.getElementById("battle-defender").innerHTML = _battleSideHtml(
    { sprite_id: def.sprite_id, name: def.pokemon_name || def.name, atk: def.atk, hp: def.hp, max_hp: def.max_hp },
    def.name, true
  );

  const logEl = document.getElementById("battle-log");
  if (logEl) logEl.innerHTML = "";

  const rollBtn = document.getElementById("btn-battle-roll");
  if (rollBtn) {
    rollBtn.classList.toggle("hidden", !isParticipant);
    rollBtn.disabled = false;
  }

  const surrenderBtn = document.getElementById("btn-battle-surrender");
  if (surrenderBtn) surrenderBtn.classList.toggle("hidden", !isParticipant);

  const statusEl = document.getElementById("battle-status");
  if (statusEl) {
    statusEl.textContent = isParticipant ? "กด ทอยเต๋า! เพื่อเริ่มต่อสู้" : `${data.attacker_name} กำลังต่อสู้...`;
  }

  document.getElementById("battle-overlay").classList.remove("hidden");
}

function updateBattleAfterRound(data) {
  // Update HP bars in place
  if (data.atk_pk_hp != null) {
    const el = document.getElementById("battle-atk-hp");
    if (el) el.innerHTML = _hpBarHtml(data.atk_pk_hp, data.atk_pk_max_hp, true);
  }
  if (data.def_pk_hp != null) {
    const el = document.getElementById("battle-def-hp");
    if (el) el.innerHTML = _hpBarHtml(data.def_pk_hp, data.def_pk_max_hp, true);
  }

  // Append round result to battle log
  const logEl = document.getElementById("battle-log");
  if (logEl && data.damage_msg) {
    const entry = document.createElement("div");
    entry.className = "battle-log-entry";
    entry.textContent = data.damage_msg;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Re-enable Roll button for next round
  const rollBtn = document.getElementById("btn-battle-roll");
  if (rollBtn && !rollBtn.classList.contains("hidden")) {
    rollBtn.disabled = false;
  }
  const statusEl = document.getElementById("battle-status");
  if (statusEl) statusEl.textContent = "กด ทอยเต๋า! เพื่อสู้ต่อ";
}

function closeBattleScreen() {
  document.getElementById("battle-overlay").classList.add("hidden");
}

function triggerHitAnim(data) {
  if (!data.damage_msg || data.damage_msg.includes("ยอมแพ้")) return;
  const side = data.attacker_wins_round ? "battle-defender" : "battle-attacker";
  const img = document.querySelector(`#${side} .battle-sprite`);
  if (!img) return;
  img.classList.remove("taking-hit");
  void img.offsetWidth; // force reflow to restart animation
  img.classList.add("taking-hit");
}

function _hideDice() {
  _diceRolling = false;
  _clearTimers();
  window._diceAnimStartTime = 0;
  const overlay = document.getElementById("dice-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  overlay.classList.add("fade-out");
  setTimeout(() => overlay.classList.add("hidden"), 240);
}

// ── Wild encounter notif (for non-catcher spectators) ────────────
let _wildNotifTimer = null;

function showWildNotif(playerName, pk) {
  if (_wildNotifTimer) { clearTimeout(_wildNotifTimer); _wildNotifTimer = null; }
  const spriteUrl = pokeSpriteUrl(pk.sprite_id, false);
  const imgHtml = spriteUrl
    ? `<img class="wild-notif-sprite" src="${spriteUrl}" onerror="this.style.display='none'" alt="">`
    : `<span style="font-size:2rem">🌿</span>`;
  const el = document.getElementById("wild-notif");
  el.innerHTML = `
    <div class="wild-notif-box">
      ${imgHtml}
      <div class="wild-notif-info">
        <div class="wild-notif-who">🌿 ${playerName} พบ</div>
        <div class="wild-notif-name">${pk.name}</div>
        <div class="wild-notif-atk">ATK ${pk.atk} · Catch ${pk.catch_rate}</div>
      </div>
    </div>`;
  el.classList.remove("hidden");
  _wildNotifTimer = setTimeout(closeWildNotif, 12000);
}

function closeWildNotif() {
  if (_wildNotifTimer) { clearTimeout(_wildNotifTimer); _wildNotifTimer = null; }
  document.getElementById("wild-notif")?.classList.add("hidden");
}

// ── Evolution animation (visible to all) ─────────────────────────
let _evoTimer = null;

function showEvolutionAnim(playerName, oldName, oldSpriteId, newName, newSpriteId) {
  if (_evoTimer) { clearTimeout(_evoTimer); _evoTimer = null; }
  const overlay = document.getElementById("evo-overlay");
  if (!overlay) return;

  const oldImg = oldSpriteId
    ? `<img src="${pokeSpriteUrl(oldSpriteId, false)}" onerror="this.style.opacity=0" alt="${oldName}">`
    : `<span style="font-size:3.5rem;line-height:80px;">✨</span>`;
  const newImg = newSpriteId
    ? `<img src="${pokeSpriteUrl(newSpriteId, false)}" onerror="this.style.opacity=0" alt="${newName}">`
    : `<span style="font-size:3.5rem;line-height:80px;">⭐</span>`;

  overlay.innerHTML = `
    <div class="evo-card">
      <div class="evo-header">✨ วิวัฒนาการ! ✨</div>
      <div class="evo-player">${playerName}</div>
      <div class="evo-sprites">
        <div class="evo-sprite-old">${oldImg}</div>
        <div class="evo-arrow">→</div>
        <div class="evo-sprite-new">${newImg}</div>
      </div>
      <div class="evo-names">
        <span class="evo-old-name">${oldName}</span>
        <span style="color:#ffe066;margin:0 10px">→</span>
        <span class="evo-new-name">${newName}</span>
      </div>
    </div>`;
  overlay.classList.remove("hidden");
  _evoTimer = setTimeout(() => {
    overlay.classList.add("hidden");
    _evoTimer = null;
  }, 5000);
}

// ── Wild watch modal (for non-catcher observers) ─────────────────
function showWildWatchModal(playerName, pk) {
  const spriteHtml = pk.sprite_id
    ? `<div class="pk-sprite-wrap" style="text-align:center;margin-bottom:8px;">${pokeImgTag(pk.sprite_id, true, "pk-sprite-lg")}</div>`
    : "";
  showModal(
    `🌿 ${playerName} พบ ${pk.name}!`,
    `${spriteHtml}
     <div class="modal-stat"><span>Type</span><span>${pk.type || "?"}</span></div>
     <div class="modal-stat"><span>ATK</span><span>${pk.atk ?? "?"}</span></div>
     <div class="modal-stat"><span>Catch Rate</span><span>${pk.catch_rate ?? "?"}</span></div>
     <div class="modal-stat"><span>Research Value</span><span>${pk.research_value ?? "?"} เงิน</span></div>
     <div style="text-align:center;margin-top:10px;font-size:.82rem;color:#888;">รอ ${playerName} ตัดสินใจ...</div>`,
    []
  );
}

// ── Event card ───────────────────────────────────────────────────
let _eventCardTimer = null;

function showEventCard(playerName, ev, isOwner) {
  if (_eventCardTimer) { clearTimeout(_eventCardTimer); _eventCardTimer = null; }

  const effects = [];
  if (ev.money_delta) effects.push(ev.money_delta > 0 ? `💰 +${ev.money_delta} เงิน` : `💸 ${ev.money_delta} เงิน`);
  if (ev.skip_turns) effects.push(`⏭ ข้ามเทิร์น ${ev.skip_turns} รอบ`);
  if (ev.teleport != null) effects.push(`🚀 ย้ายไปช่อง ${ev.teleport}`);
  const effectHtml = effects.length
    ? `<div class="ec-effects">${effects.map(e => `<span class="ec-chip">${e}</span>`).join("")}</div>`
    : "";

  const btnsHtml = isOwner
    ? `<button class="btn btn-primary" style="margin-top:16px;width:100%;font-size:1rem;" onclick="closeEventCard(); doAction('event_continue', {});">ต่อไป →</button>`
    : `<div class="ec-waiting">รอ ${playerName} กดต่อไป...</div>`;

  const overlay = document.getElementById("event-card-overlay");
  overlay.innerHTML = `
    <div class="event-card-box">
      <div class="ec-badge">🃏 อีเว้นท์</div>
      <div class="ec-player">${playerName}</div>
      <div class="ec-text">${ev.text || ""}</div>
      ${effectHtml}
      ${btnsHtml}
    </div>
  `;
  overlay.classList.remove("hidden");

  if (!isOwner) {
    _eventCardTimer = setTimeout(closeEventCard, 8000);
  }
}

function closeEventCard() {
  if (_eventCardTimer) { clearTimeout(_eventCardTimer); _eventCardTimer = null; }
  const overlay = document.getElementById("event-card-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// ── Center Shop ──────────────────────────────────────────────────
const _SHOP_ITEMS = [
  { id: "poke_ball",   name: "Poké Ball",   price: 2,  icon: "🎾", desc: "บอลจับโปเกมอน" },
  { id: "great_ball",  name: "Great Ball",  price: 5,  icon: "⭐", desc: "+2 catch rate" },
  { id: "ultra_ball",  name: "Ultra Ball",  price: 8,  icon: "🟡", desc: "+4 catch rate" },
  { id: "potion",      name: "Potion",      price: 5,  icon: "💊", desc: "ฟื้น HP (เก็บในกระเป๋า)" },
  { id: "rare_candy",  name: "Rare Candy",  price: 10, icon: "🍬", desc: "+1 ATK ทันที (เลือกโปเกมอน)" },
  { id: "speed_boots", name: "Speed Boots", price: 6,  icon: "👟", desc: "+1 ช่องเดิน (เก็บในกระเป๋า)" },
  { id: "x_attack",    name: "X Attack",    price: 6,  icon: "⚡", desc: "+3 ATK ต่อสู้ครั้งนี้ (เก็บในกระเป๋า)" },
  { id: "escape_rope", name: "Escape Rope", price: 4,  icon: "🪢", desc: "วาร์ปไป Center ใกล้สุด (เก็บในกระเป๋า)" },
];

function showCenterShop() {
  const player = window._gameState?.players?.[SESSION.pid];
  if (!player) return;
  const money = player.money;
  const cards = _SHOP_ITEMS.map(item => {
    const ok = money >= item.price;
    const imgHtml = itemImgOrIcon(item.id, 36);
    const buyBtn = ok
      ? `<button class="btn btn-success btn-sm" style="width:100%;font-size:.72rem;padding:3px 0;" onclick="buyShopItem('${item.id}')">ซื้อ</button>`
      : `<span class="shop-card-price-na">💰${item.price}</span>`;
    return `
      <div class="shop-card${ok ? "" : " shop-disabled"}">
        <div class="shop-card-icon">${imgHtml}</div>
        <div class="shop-card-name">${item.name}</div>
        <div class="shop-card-desc">${item.desc}</div>
        ${ok ? `<div class="shop-card-price">💰${item.price}</div>` : ""}
        ${buyBtn}
      </div>`;
  }).join("");

  showModal("🏪 ร้านค้า Pokémon Center",
    `<div class="shop-money">
       <span>กระเป๋าเงิน</span>
       <strong>💰 ${money}</strong>
     </div>
     <div class="shop-grid">${cards}</div>`,
    [{ text: "ออกจากร้าน →", cls: "btn-primary", fn: () => doAction("shop_done", {}) }]
  );
}

function buyShopItem(itemId) {
  closeModal();
  if (itemId === "rare_candy") {
    const pokemon = window._gameState?.players?.[SESSION.pid]?.pokemon || [];
    if (!pokemon.length) return;
    showPokemonSelectModal(pokemon, (selectedId) => {
      doAction("shop_buy", { item: itemId, pokemon_id: selectedId });
    }, "+1 ATK");
  } else {
    doAction("shop_buy", { item: itemId });
    setTimeout(showCenterShop, 250);
  }
}

// ── Use Item flow ────────────────────────────────────────────────
function showUseItemModal() {
  const player = window._gameState?.players?.[SESSION.pid];
  if (!player) return;
  const items = player.items || [];
  const usableIds = items.filter(isUsableItem);
  if (!usableIds.length) {
    showModal("🎒 ไอเทม", "<p style='color:#888'>ไม่มีไอเทมที่ใช้ได้</p>", [{ text: "ปิด", cls: "btn-secondary" }]);
    return;
  }

  const counts = {};
  usableIds.forEach(i => { counts[i] = (counts[i] || 0) + 1; });

  const rows = Object.entries(counts).map(([id, n]) => {
    const d = getItemData(id);
    return `
      <div class="shop-row" style="cursor:pointer;" onclick="window._useItemFn('${id}')">
        <span class="shop-icon">${itemImgOrIcon(id, 28)}</span>
        <div class="shop-info">
          <div class="shop-name">${d.name}${n > 1 ? ` ×${n}` : ""}</div>
          <div class="shop-desc">${d.desc}</div>
        </div>
      </div>`;
  }).join("");

  window._useItemFn = (itemId) => { closeModal(); _executeUseItem(itemId); };

  showModal("🎒 ใช้ไอเทม",
    `<div class="shop-list">${rows}</div>`,
    [{ text: "ยกเลิก", cls: "btn-secondary" }]
  );
}

function _executeUseItem(itemId) {
  const d = getItemData(itemId);
  if (d.type === "use_hp" || d.type === "use_atk") {
    const pokemon = window._gameState?.players?.[SESSION.pid]?.pokemon || [];
    if (!pokemon.length) { doAction("use_item", { item: itemId }); return; }
    const label = d.type === "use_hp" ? "ฟื้น HP" : "+1 ATK (อาจวิวัฒนาการ!)";
    showPokemonSelectModal(pokemon, (selectedId) => {
      doAction("use_item", { item: itemId, pokemon_id: selectedId });
    }, label);
  } else {
    doAction("use_item", { item: itemId });
  }
}

// ── Game Over ────────────────────────────────────────────────────
function showGameOver(ranking) {
  const list = document.getElementById("ranking-list");
  list.innerHTML = ranking.map((r, i) => `
    <li class="rank-${i + 1}">
      <span>${["🥇","🥈","🥉","4️⃣"][i] || (i+1)+"."} ${r.name}</span>
      <span>💰 ${r.money}</span>
    </li>
  `).join("");
  document.getElementById("gameover-overlay").classList.remove("hidden");
}
