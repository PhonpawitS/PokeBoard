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

  // Class selector — dropdown with sprite preview
  const myPlayer = players[SESSION.pid];
  const myClassId = myPlayer ? myPlayer.class_id : "trainer";
  const classes = window.CLASSES_DATA || [];
  const myClassData = classes.find(c => c.id === myClassId);
  const classPicker = document.getElementById("wr-class-picker");
  if (classPicker) {
    const optionsHtml = classes.map(c =>
      `<option value="${c.id}"${c.id === myClassId ? " selected" : ""}>${c.name}</option>`
    ).join("");
    const spriteUrl = myClassData
      ? `https://play.pokemonshowdown.com/sprites/trainers/${myClassData.trainer_sprite}.png`
      : "";
    classPicker.innerHTML = `
      <label style="font-size:.85rem;font-weight:700;display:block;margin-bottom:8px;">เลือกอาชีพ</label>
      <div class="wr-class-row">
        <img id="wr-class-sprite" src="${spriteUrl}" width="80" height="80"
             style="image-rendering:pixelated;object-fit:contain;flex-shrink:0;"
             onerror="this.style.opacity:.25">
        <div class="wr-class-info">
          <select id="wr-class-select" class="wr-class-dropdown" onchange="selectClass(this.value)">
            ${optionsHtml}
          </select>
          <div class="wr-ability-hint" id="wr-ability-hint">${myClassData ? myClassData.ability_desc : "—"}</div>
        </div>
      </div>
    `;
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

function selectClass(classId) {
  const cls = (window.CLASSES_DATA || []).find(c => c.id === classId);
  if (!cls) return;
  const sprite = document.getElementById("wr-class-sprite");
  if (sprite) {
    sprite.style.opacity = "";
    sprite.src = `https://play.pokemonshowdown.com/sprites/trainers/${cls.trainer_sprite}.png`;
  }
  const hint = document.getElementById("wr-ability-hint");
  if (hint) hint.textContent = cls.ability_desc;
  const sel = document.getElementById("wr-class-select");
  if (sel) sel.value = classId;
  setClassInRoom(classId);
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
const _CORNERS = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'];

function renderPlayers(players, turnOrder, currentTurn) {
  const wrap = document.getElementById("players-wrap");
  wrap.innerHTML = "";

  const order = turnOrder || Object.keys(players);
  order.forEach(pid => getPidColor(pid));
  const activePid = order.length ? order[currentTurn % order.length] : null;

  order.forEach((pid, i) => {
    const p = players[pid];
    if (!p) return;

    const corner = _CORNERS[i % 4];
    const card = document.createElement("div");
    card.className = `player-card ${corner}` +
      (pid === activePid ? " active-turn" : "") +
      (pid === SESSION.pid ? " my-card" : "");

    const pokeCount    = (p.pokemon || []).length;
    const fainted      = (p.fainted || []).length;
    const items        = p.items || [];
    const ballCount    = items.filter(it =>  _BALL_IDS.includes(it)).length;
    const nonBallCount = items.filter(it => !_BALL_IDS.includes(it)).length;

    const cls = (window.CLASSES_DATA || []).find(c => c.id === p.class_id);
    const limit = cls ? (cls.item_limit || 4) : 4;
    let slotsHtml = '<div class="pc-slots">';
    for (let j = 0; j < limit; j++) {
      if (items[j]) {
        slotsHtml += `<div class="pc-slot pc-slot-filled" title="${getItemData(items[j]).name}">${itemImgOrIcon(items[j], 24)}</div>`;
      } else {
        slotsHtml += `<div class="pc-slot pc-slot-empty"></div>`;
      }
    }
    slotsHtml += '</div>';

    const trainerSlug = p.trainer_sprite || cls?.trainer_sprite || "";
    const pokemonNames = (p.pokemon || []).map(pk => pk.name).join(", ") || "ไม่มี";
    const isMe     = pid === SESSION.pid;
    const isActive = pid === activePid;

    card.innerHTML = `
      <div class="pc-portrait">
        ${trainerImgTag(trainerSlug, 94)}
        <button class="pc-info-btn" title="ดูความสามารถ" onclick="showPlayerAbilityInfo('${pid}')">ⓘ</button>
        <div class="pc-portrait-overlay">
          <span class="pc-name">${p.name}${isMe ? '<span class="pc-you-tag">(คุณ)</span>' : ''}</span>
          ${isActive ? '<span class="pc-active-badge">▶</span>' : ''}
        </div>
      </div>
      <div class="pc-stats-row">
        <span class="pc-stat pc-stat-money">💰${p.money}</span>
        <span class="pc-stat pc-stat-poke">🔴${pokeCount}</span>
        <span class="pc-stat pc-stat-ball">${itemImgOrIcon("poke_ball", 16)}×${ballCount}</span>
        <span class="pc-stat pc-stat-item">🎒${nonBallCount}</span>
        <span class="pc-stat pc-stat-faint">⚫${fainted}</span>
      </div>
      ${slotsHtml}
      <div class="pc-pokemon pc-pokemon-link">📋 ${pokemonNames}</div>
    `;
    card.querySelector(".pc-pokemon-link").addEventListener("click", () => showPlayerPokemonModal(p));
    wrap.appendChild(card);
  });
}

// ── Action panel ─────────────────────────────────────────────────
function renderActionPanel(phase, pending, players) {
  const title = document.getElementById("action-title");
  const btns = document.getElementById("action-btns");
  btns.innerHTML = "";

  // ── Pokemon HUD (active player's lead pokemon) ──
  const _st = window._gameState;
  const _activePid = _st?.turn_order?.length
    ? _st.turn_order[_st.current_turn % _st.turn_order.length] : null;
  const _activePl = _activePid && players[_activePid];
  const _leadPk   = _activePl?.pokemon?.[0];
  const hudEl = document.getElementById("action-pokemon-info");
  if (hudEl) {
    if (_leadPk) {
      const _url = pokeSpriteUrl(_leadPk.sprite_id, true);
      hudEl.innerHTML = `
        <img class="api-sprite" src="${_url}" onerror="this.style.opacity=0" alt="">
        <div class="api-info">
          <div class="api-name">${_leadPk.name}</div>
          <div class="api-atk">พลังโจมตี ${_leadPk.atk}</div>
          <div class="api-hp">HP ${_leadPk.hp ?? _leadPk.max_hp} / ${_leadPk.max_hp}</div>
        </div>`;
      hudEl.style.display = "flex";
    } else if (_activePl) {
      hudEl.innerHTML = `<span style="font-size:.6rem;color:#404050;padding:0 10px;width:100%;text-align:center;">ไม่มีโปเกมอน</span>`;
      hudEl.style.display = "flex";
    } else {
      hudEl.style.display = "none";
    }
  }

  const rollBtn    = document.getElementById("btn-roll");
  const bagBtn     = document.getElementById("btn-bag");
  const abilityBtn = document.getElementById("btn-ability");
  const sideBtns   = document.getElementById("side-btns");
  const endBtn     = document.getElementById("btn-end-game");

  if (phase !== "playing") {
    title.textContent = phase === "ended" ? "เกมจบแล้ว" : "รอเริ่มเกม";
    rollBtn  && rollBtn.classList.add("hidden");
    sideBtns && sideBtns.classList.add("hidden");
    return;
  }
  sideBtns && sideBtns.classList.remove("hidden");

  const isMyTurn = pending && pending.pid === SESSION.pid;
  const noAction = !pending || !pending.type;
  const iAmActive = noAction &&
    window._gameState?.turn_order &&
    window._gameState.turn_order[window._gameState.current_turn % window._gameState.turn_order.length] === SESSION.pid;

  // Roll button (in side panel)
  if (rollBtn) rollBtn.classList.toggle("hidden", !iAmActive);
  if (endBtn)  endBtn.classList.toggle("hidden", !SESSION.isHost);

  // Bag + ability buttons — hide during battle
  const inBattle = pending?.type === "battle_ongoing" || pending?.type === "pvp_defender_selecting";
  if (bagBtn)     bagBtn.classList.toggle("hidden",     inBattle || !players[SESSION.pid]);
  if (abilityBtn) abilityBtn.classList.toggle("hidden", inBattle || !players[SESSION.pid]);

  if (noAction) {
    if (iAmActive) {
      title.textContent = "🎲 เทิร์นของคุณ!";
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

  } else if (t === "turn_start_item") {
    if (isMyTurn) {
      const items = data.items || [];
      if (items.length > 0) {
        const names = items.map(id => getItemData(id).name).join(", ");
        title.textContent = `🎁 ได้รับ: ${names}`;
      } else {
        title.textContent = "💊 ฟื้น HP แล้ว";
      }
      _addBtn(btns, "ตกลง →", "btn-primary btn-sm", () => doAction("continue", {}));
    } else {
      const name = players[pending.pid]?.name || "?";
      title.textContent = `🎁 ${name} กำลังรับไอเทม...`;
    }
    return;

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

// ── Trainer sprite helpers ───────────────────────────────────────
function trainerSpriteUrl(slug) {
  if (!slug) return null;
  return `https://play.pokemonshowdown.com/sprites/trainers/${slug}.png`;
}

function trainerImgTag(slug, size = 48) {
  const url = trainerSpriteUrl(slug);
  if (!url) return "";
  return `<img src="${url}" height="${size}" style="image-rendering:pixelated;object-fit:contain;" onerror="this.style.display='none'" alt="">`;
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

// ── Battle screen (Gen 3 style) ──────────────────────────────────
function _updateBaHpBar(fillId, hp, maxHp) {
  const fill = document.getElementById(fillId);
  if (!fill) return;
  const pct = maxHp > 0 ? Math.max(0, Math.round((hp / maxHp) * 100)) : 0;
  fill.style.width = pct + "%";
  fill.className = "ba-hp-fill" + (pct > 50 ? "" : pct > 20 ? " yellow" : " red");
}

function showBattleScreen(data) {
  const myPid = window.SESSION?.pid;
  const isParticipant = data.attacker_pid === myPid || data.defender_pid === myPid;
  const atkPk = data.attacker_pokemon || {};
  const def   = data.defender || {};

  // Enemy HP box
  document.getElementById("ba-enemy-name").textContent = (def.pokemon_name || def.name || "???").toUpperCase();
  document.getElementById("ba-enemy-atk").textContent  = `ATK ${def.atk ?? "?"}`;
  _updateBaHpBar("ba-enemy-hp-fill", def.hp ?? def.max_hp, def.max_hp);

  // Player HP box
  document.getElementById("ba-player-name").textContent = (atkPk.name || "???").toUpperCase();
  document.getElementById("ba-player-atk").textContent  = `ATK ${atkPk.atk ?? "?"}`;
  _updateBaHpBar("ba-player-hp-fill", atkPk.hp, atkPk.max_hp);
  const hpNumEl = document.getElementById("ba-player-hp-num");
  if (hpNumEl) hpNumEl.textContent = `${atkPk.hp ?? "?"} / ${atkPk.max_hp ?? "?"}`;

  // Sprites: attacker = back sprite (player POV), defender = front sprite (enemy)
  document.getElementById("battle-attacker").innerHTML = pokeImgTag(atkPk.sprite_id, true, "battle-sprite", true);
  document.getElementById("battle-defender").innerHTML = pokeImgTag(def.sprite_id,   true, "battle-sprite", false);

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
    statusEl.textContent = isParticipant
      ? "กด FIGHT เพื่อเริ่มต่อสู้"
      : `${data.attacker_name} กำลังต่อสู้...`;
  }

  document.getElementById("battle-overlay").classList.remove("hidden");
}

function updateBattleAfterRound(data) {
  const statusEl = document.getElementById("battle-status");
  const rollBtn  = document.getElementById("btn-battle-roll");

  if (data.tie) {
    if (statusEl) statusEl.textContent = "เสมอ! ทอยใหม่...";
    if (rollBtn && !rollBtn.classList.contains("hidden")) rollBtn.disabled = false;
    return;
  }

  if (data.atk_pk_hp != null) {
    _updateBaHpBar("ba-player-hp-fill", data.atk_pk_hp, data.atk_pk_max_hp);
    const numEl = document.getElementById("ba-player-hp-num");
    if (numEl) numEl.textContent = `${data.atk_pk_hp} / ${data.atk_pk_max_hp ?? "?"}`;
  }
  if (data.def_pk_hp != null) {
    _updateBaHpBar("ba-enemy-hp-fill", data.def_pk_hp, data.def_pk_max_hp);
  }

  const logEl = document.getElementById("battle-log");
  if (logEl && data.damage_msg) {
    const entry = document.createElement("div");
    entry.className = "ba-log-entry";
    entry.textContent = data.damage_msg;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  if (rollBtn && !rollBtn.classList.contains("hidden")) rollBtn.disabled = false;
  if (statusEl) statusEl.textContent = "กด FIGHT เพื่อสู้ต่อ";
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
  { id: "poke_ball",    name: "Poké Ball",    price: 2,  icon: "🎾", desc: "บอลจับโปเกมอน" },
  { id: "great_ball",   name: "Great Ball",   price: 5,  icon: "⭐", desc: "+2 catch rate" },
  { id: "ultra_ball",   name: "Ultra Ball",   price: 8,  icon: "🟡", desc: "+4 catch rate" },
  { id: "potion",       name: "Potion",       price: 5,  icon: "💊", desc: "ฟื้น HP โปเกมอน 1 ตัว" },
  { id: "super_potion", name: "Super Potion", price: 8,  icon: "💙", desc: "ฟื้น HP โปเกมอน 1 ตัว (ซื้อที่ร้าน)" },
  { id: "revive",       name: "Revive",       price: 12, icon: "💫", desc: "ฟื้นโปเกมอนที่แพ้ (HP ครึ่งหนึ่ง)" },
  { id: "rare_candy",   name: "Rare Candy",   price: 10, icon: "🍬", desc: "+1 ATK (เลือกโปเกมอน)" },
  { id: "moon_stone",   name: "Moon Stone",   price: 15, icon: "🌙", desc: "วิวัฒนาการทันที (ไม่ต้องการ ATK)" },
  { id: "elixir",       name: "Elixir",       price: 10, icon: "🫙", desc: "ฟื้น HP ทุกตัว +5" },
  { id: "dire_hit",     name: "Dire Hit",     price: 8,  icon: "🎯", desc: "+5 ATK ต่อสู้ครั้งนี้" },
  { id: "x_attack",     name: "X Attack",     price: 6,  icon: "⚡", desc: "+3 ATK ต่อสู้ครั้งนี้" },
  { id: "x_defend",     name: "X Defend",     price: 6,  icon: "🛡", desc: "ลดดาเมจ -2 ต่อสู้ครั้งนี้" },
  { id: "guard_spec",   name: "Guard Spec.",  price: 7,  icon: "🔰", desc: "โปเกมอนไม่ Faint ใน 1 การต่อสู้" },
  { id: "speed_boots",  name: "Speed Boots",  price: 6,  icon: "👟", desc: "+1 ช่องเดิน" },
  { id: "escape_rope",  name: "Escape Rope",  price: 4,  icon: "🪢", desc: "วาร์ปไป Center ใกล้สุด" },
];

function showCenterShop() {
  const player = window._gameState?.players?.[SESSION.pid];
  if (!player) return;
  const money = player.money;

  const _BALLS  = _SHOP_ITEMS.filter(i => ["poke_ball","great_ball","ultra_ball"].includes(i.id));
  const _OTHERS = _SHOP_ITEMS.filter(i => !["poke_ball","great_ball","ultra_ball"].includes(i.id));

  function _card(item, big) {
    const ok = money >= item.price;
    const sz = big ? 52 : 40;
    const imgHtml = itemImgOrIcon(item.id, sz);
    const buyBtn = ok
      ? `<button class="btn btn-success btn-sm" style="width:100%;font-size:.7rem;padding:3px 0;margin-top:4px;" onclick="buyShopItem('${item.id}')">ซื้อ 💰${item.price}</button>`
      : `<div style="font-size:.68rem;color:#e57373;font-weight:700;margin-top:4px;">💰${item.price} (ไม่พอ)</div>`;
    return `
      <div class="shop-card${ok ? "" : " shop-disabled"}" style="${big ? "min-width:90px;" : ""}">
        <div class="shop-card-icon" style="width:${big?64:48}px;height:${big?64:48}px;">${imgHtml}</div>
        <div class="shop-card-name" style="font-size:${big?".78":".7"}rem;">${item.name}</div>
        <div class="shop-card-desc">${item.desc}</div>
        ${buyBtn}
      </div>`;
  }

  const ballsHtml  = `<div class="shop-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px;">${_BALLS.map(i => _card(i,true)).join("")}</div>`;
  const othersHtml = `<div class="shop-grid" style="grid-template-columns:repeat(${Math.min(_OTHERS.length,3)},1fr);">${_OTHERS.map(i => _card(i,false)).join("")}</div>`;

  const dividerHtml = `<div style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin:4px 0 6px;border-top:1px solid #eee;padding-top:8px;">ไอเทม</div>`;

  showModal("🏪 ร้านค้า Pokémon Center",
    `<div class="shop-money">
       <span>กระเป๋าเงิน</span>
       <strong>💰 ${money}</strong>
     </div>
     <div style="font-size:.72rem;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">ลูกบอล</div>
     ${ballsHtml}${dividerHtml}${othersHtml}`,
    [{ text: "ออกจากร้าน →", cls: "btn-primary", fn: () => doAction("shop_done", {}) }]
  );
}

function buyShopItem(itemId) {
  closeModal();
  doAction("shop_buy", { item: itemId });
  setTimeout(showCenterShop, 250);
}

// ── Use Item flow ────────────────────────────────────────────────
function showUseItemModal() {
  const player = window._gameState?.players?.[SESSION.pid];
  if (!player) return;
  const items = player.items || [];
  if (!items.length) {
    showModal("🎒 กระเป๋า", "<p style='text-align:center;color:#888;padding:16px 0;'>กระเป๋าว่างเปล่า<br><span style='font-size:.75em;'>ไม่มีไอเทม</span></p>", [{ text: "ปิด", cls: "btn-secondary" }]);
    return;
  }
  const usableIds = items.filter(isUsableItem);
  if (!usableIds.length) {
    showModal("🎒 กระเป๋า", "<p style='text-align:center;color:#888;padding:16px 0;'>ไม่มีไอเทมที่ใช้ได้<br><span style='font-size:.75em;'>(ลูกบอลใช้ได้ตอนพบโปเกมอน)</span></p>", [{ text: "ปิด", cls: "btn-secondary" }]);
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

  showModal("🎒 กระเป๋า",
    `<div class="shop-list">${rows}</div>`,
    [{ text: "ยกเลิก", cls: "btn-secondary" }]
  );
}

function _executeUseItem(itemId) {
  const d = getItemData(itemId);
  if (d.type === "use_hp" || d.type === "use_atk" || d.type === "use_evolve") {
    const pokemon = window._gameState?.players?.[SESSION.pid]?.pokemon || [];
    if (!pokemon.length) { showModal("ไม่มีโปเกมอน", "<p>ไม่มีโปเกมอนในทีม</p>", [{ text: "ปิด", cls: "btn-secondary" }]); return; }
    const label = d.type === "use_hp" ? "ฟื้น HP"
                : d.type === "use_evolve" ? "วิวัฒนาการ!"
                : "+1 ATK (อาจวิวัฒนาการ!)";
    showPokemonSelectModal(pokemon, (selectedId) => {
      doAction("use_item", { item: itemId, pokemon_id: selectedId });
    }, label);
  } else if (d.type === "use_revive") {
    const fainted = window._gameState?.players?.[SESSION.pid]?.fainted || [];
    if (!fainted.length) {
      showModal("🎒 Revive", "<p style='text-align:center;padding:12px 0;color:#888;'>ไม่มีโปเกมอนที่แพ้</p>", [{ text: "ปิด", cls: "btn-secondary" }]);
      return;
    }
    showPokemonSelectModal(fainted, (selectedId) => {
      doAction("use_item", { item: itemId, pokemon_id: selectedId });
    }, "ฟื้นจากแพ้ (HP ครึ่งหนึ่ง)");
  } else {
    doAction("use_item", { item: itemId });
  }
}

// ── Class Ability ────────────────────────────────────────────────

function _getMyAbility() {
  const player = window._gameState?.players?.[SESSION.pid];
  if (!player) return null;
  const cls = (window.CLASSES_DATA || []).find(c => c.id === player.class_id);
  if (!cls?.ability_active) return null;
  return { ...cls.ability_active, charges: player.ability_charges ?? 0, cls };
}

function _getPlayerAbility(pid) {
  const player = window._gameState?.players?.[pid];
  if (!player) return null;
  const cls = (window.CLASSES_DATA || []).find(c => c.id === player.class_id);
  return { cls, player, ability: cls?.ability_active || null, charges: player.ability_charges ?? 0 };
}

function showPlayerAbilityInfo(pid) {
  const info = _getPlayerAbility(pid);
  if (!info) return;
  const { cls, player, ability, charges } = info;
  const isMe = pid === SESSION.pid;
  const chargesHtml = ability
    ? `<div class="modal-stat"><span>ความสามารถพิเศษ (Active)</span><span>${ability.name}</span></div>
       <div class="modal-stat"><span>คำอธิบาย</span><span style="font-size:.75rem;color:#c8e0ff;">${ability.desc}</span></div>
       <div class="modal-stat"><span>Charges เหลือ</span><span style="color:${charges>0?'#f8d030':'#888'}">${charges} / ${ability.charges}</span></div>`
    : `<div style="color:#888;font-size:.75rem;padding:4px 0;">ไม่มี Active Ability</div>`;
  showModal(
    `${player.name} — ${cls?.name || "?"}`,
    `<div class="modal-stat"><span>Passive</span><span style="font-size:.72rem;color:#a0c8ff;">${cls?.ability_desc || "—"}</span></div>
     ${chargesHtml}`,
    [{ text: isMe ? "ใช้ Ability →" : "ปิด", cls: isMe ? "btn-warning" : "btn-secondary",
       fn: isMe ? () => { showAbilityModal(); } : null }]
  );
}

function showAbilityModal() {
  const ab = _getMyAbility();
  const player = window._gameState?.players?.[SESSION.pid];
  if (!ab || !player) return;

  if (ab.charges <= 0) {
    showModal("⚡ ความสามารถ", `<p style="text-align:center;color:#888;padding:12px 0;">ใช้ ${ab.name} หมดแล้ว!</p>`, [{ text: "ปิด", cls: "btn-secondary" }]);
    return;
  }

  const bodyHtml = `
    <div style="text-align:center;font-size:1.4rem;margin-bottom:8px;">${ab.name}</div>
    <div style="text-align:center;color:#a0c8ff;font-size:.78rem;margin-bottom:14px;">${ab.desc}</div>
    <div class="modal-stat"><span>Charges เหลือ</span><span style="color:var(--yellow)">${ab.charges} ครั้ง</span></div>`;

  if (ab.needs_pokemon) {
    const pokemon = player.pokemon || [];
    if (!pokemon.length) {
      showModal("⚡ " + ab.name, bodyHtml + `<p style="color:#888;margin-top:10px;">ไม่มีโปเกมอนในทีม</p>`, [{ text: "ปิด", cls: "btn-secondary" }]);
      return;
    }
    showModal("⚡ " + ab.name, bodyHtml, [
      { text: "เลือกโปเกมอน →", cls: "btn-warning", fn: () => {
        showPokemonSelectModal(pokemon, (pkId) => {
          doAction("use_class_ability", { pokemon_id: pkId });
        }, ab.name);
      }},
      { text: "ยกเลิก", cls: "btn-secondary" },
    ]);
  } else if (ab.needs_target) {
    const others = Object.entries(window._gameState?.players || {})
      .filter(([pid]) => pid !== SESSION.pid)
      .map(([pid, p]) => `<div class="pk-select-row" onclick="window._abilityTargetFn('${pid}');closeModal();">
        <div style="flex:1;font-size:.82rem;font-weight:700;">${p.name}</div>
        <div style="font-size:.7rem;color:#888;">💰${p.money} 🔴${(p.pokemon||[]).length}</div>
      </div>`).join("");
    showModal("⚡ " + ab.name,
      bodyHtml + `<div style="margin-top:10px;font-size:.75rem;color:#888;margin-bottom:6px;">เลือกผู้เล่นเป้าหมาย:</div>
      <div class="pk-detail-list">${others || "<p style='color:#888;'>ไม่มีผู้เล่นอื่น</p>"}</div>`,
      [{ text: "ยกเลิก", cls: "btn-secondary" }]
    );
    window._abilityTargetFn = (targetPid) => {
      doAction("use_class_ability", { target_pid: targetPid });
    };
  } else {
    showModal("⚡ " + ab.name, bodyHtml, [
      { text: "ใช้เลย!", cls: "btn-warning", fn: () => { doAction("use_class_ability", {}); } },
      { text: "ยกเลิก", cls: "btn-secondary" },
    ]);
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
