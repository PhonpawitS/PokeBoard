// ── Socket setup ────────────────────────────────────────────────
const socket = io();
window._gameState = null;
window._diceAnimStartTime = 0;

window.addEventListener("beforeunload", (e) => {
  if (SESSION.roomId && window._gameState?.phase === "playing") {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ── API helpers ──────────────────────────────────────────────────
async function apiFetch(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Lobby actions ────────────────────────────────────────────────
async function createRoom() {
  const name = document.getElementById("inp-name").value.trim();
  if (!name) { showLobbyMsg("กรุณากรอกชื่อ"); return; }

  const data = await apiFetch("/api/create_room", { name });
  if (data.error) { showLobbyMsg(data.error); return; }

  SESSION.pid = data.pid;
  SESSION.roomId = data.room_id;
  SESSION.isHost = true;

  socket.emit("join_room", { room_id: SESSION.roomId });
  showScreen("waiting");
  document.getElementById("disp-room-id").textContent = SESSION.roomId;
  document.getElementById("gc-room-id").textContent = SESSION.roomId;
}

async function joinRoom() {
  const name = document.getElementById("inp-name").value.trim();
  const room_id = document.getElementById("inp-room").value.trim().toUpperCase();
  if (!name) { showLobbyMsg("กรุณากรอกชื่อ"); return; }
  if (!room_id) { showLobbyMsg("กรุณากรอก Room ID"); return; }

  const data = await apiFetch("/api/join", { name, room_id });
  if (data.error) { showLobbyMsg(data.error); return; }

  SESSION.pid = data.pid;
  SESSION.roomId = data.room_id;
  SESSION.isHost = false;

  socket.emit("join_room", { room_id: SESSION.roomId });
  showScreen("waiting");
  document.getElementById("disp-room-id").textContent = SESSION.roomId;
  document.getElementById("gc-room-id").textContent = SESSION.roomId;
}

async function startGame() {
  const data = await apiFetch("/api/start", { room_id: SESSION.roomId, pid: SESSION.pid });
  if (data.error) { alert(data.error); return; }
  socket.emit("join_room", { room_id: SESSION.roomId });
}

// ── Game actions ─────────────────────────────────────────────────
let _prevLogTotal = 0;

function _myName() {
  return window._gameState?.players?.[SESSION.pid]?.name || "ผู้เล่น";
}

function doRoll() {
  socket.emit("roll", { room_id: SESSION.roomId, pid: SESSION.pid });
}

function doAction(action, data) {
  if (action === "catch") {
    showDiceRolling("🎯 จับโปเกมอน", `${_myName()} กำลังทอย...`);
    window._diceAnimStartTime = Date.now();
  }
  socket.emit("action", { room_id: SESSION.roomId, pid: SESSION.pid, action, data });
}

function doBattleRoll() {
  const btn = document.getElementById("btn-battle-roll");
  if (btn) btn.disabled = true;
  const status = document.getElementById("battle-status");
  if (status) status.textContent = "กำลังทอย... รอผลลัพธ์";
  doAction("battle_roll_round", {});
}

function doBattleSurrender() {
  if (!confirm("ยอมแพ้และจบการต่อสู้?")) return;
  closeBattleScreen();
  doAction("battle_surrender", {});
}

function startFightFlow() {
  const state = window._gameState;
  if (!state) return;
  const player = state.players[SESSION.pid];
  const pending = state.pending || {};
  const ptype = pending.type;

  const pokemon = player.pokemon || [];

  let enemyLabel = "ศัตรู";
  if (ptype === "gym") enemyLabel = pending.data?.gym?.name || "ยิม";
  else if (ptype === "rocket") enemyLabel = "Rocket Grunt";

  if (pokemon.length === 0) {
    doAction("fight", { pokemon_id: null });
    return;
  }

  showPokemonSelectModal(pokemon, (selectedId) => {
    doAction("fight", { pokemon_id: selectedId });
  }, enemyLabel);
}

function startPvPFightFlow(opponentName) {
  const state = window._gameState;
  if (!state) return;
  const player = state.players[SESSION.pid];
  const pokemon = player.pokemon || [];

  if (pokemon.length === 0) {
    doAction("fight_player", { pokemon_id: null });
    return;
  }

  showPokemonSelectModal(pokemon, (selectedId) => {
    doAction("fight_player", { pokemon_id: selectedId });
  }, opponentName);
}

function startDefenderPvPSelectFlow(attackerName) {
  const state = window._gameState;
  if (!state) return;
  const player = state.players[SESSION.pid];
  const pokemon = player.pokemon || [];

  if (pokemon.length === 0) {
    doAction("pvp_pokemon_select", { pokemon_id: null });
    return;
  }

  showPokemonSelectModal(pokemon, (selectedId) => {
    doAction("pvp_pokemon_select", { pokemon_id: selectedId });
  }, attackerName);
}

function setClassInRoom() {
  const sel = document.getElementById("wr-class-select");
  if (!sel) return;
  socket.emit("set_class", { room_id: SESSION.roomId, pid: SESSION.pid, class_id: sel.value });
}

function doResearch(pokemon_ids) {
  socket.emit("research", { room_id: SESSION.roomId, pid: SESSION.pid, pokemon_ids });
}

function doEndGame() {
  if (!confirm("จบเกมและคำนวณคะแนน?")) return;
  socket.emit("end_game", { room_id: SESSION.roomId, pid: SESSION.pid });
}

// ── Dice timing ──────────────────────────────────────────────────
window._tokenAnimating = false;
window._pendingModal   = null;

const DICE_MIN_MS = 2000;

function _settleAfterMinSpin(val, label) {
  if (!_diceRolling) return settleDice(val, label);
  const elapsed = window._diceAnimStartTime ? (Date.now() - window._diceAnimStartTime) : 0;
  const wait = Math.max(0, DICE_MIN_MS - elapsed);
  return new Promise(resolve => {
    setTimeout(() => settleDice(val, label).then(resolve), wait);
  });
}

function _settleAfterMinSpinBattle(pDice, eDice, pTotal, eTotal, attackerWon, extraMsg) {
  if (!_diceRolling) return settleBattleDice(pDice, eDice, pTotal, eTotal, attackerWon, extraMsg);
  const elapsed = window._diceAnimStartTime ? (Date.now() - window._diceAnimStartTime) : 0;
  const wait = Math.max(0, DICE_MIN_MS - elapsed);
  return new Promise(resolve => {
    setTimeout(() => settleBattleDice(pDice, eDice, pTotal, eTotal, attackerWon, extraMsg).then(resolve), wait);
  });
}

// ── Dice rolling events (server-synced) ─────────────────────────
socket.on("dice_rolling", (data) => {
  const name = data.name || "ผู้เล่น";
  const isMe = data.pid === SESSION.pid;
  showDiceRolling(
    isMe ? "🎲 ทอยเต๋า" : `🎲 ${name} กำลังทอย`,
    `${name} กำลังทอย...`
  );
  window._diceAnimStartTime = Date.now();
});

socket.on("battle_rolling", (data) => {
  showBattleDice(data.attacker_name || "ผู้เล่น", data.defender_name || "ศัตรู");
  window._diceAnimStartTime = Date.now();
});

// ── Battle screen events ─────────────────────────────────────────
let _battleAttackerPid = null;
let _battleDefenderPid = null;
let _eventCardOwnerPid = null;

socket.on("battle_start", (data) => {
  _battleAttackerPid = data.attacker_pid;
  _battleDefenderPid = data.defender_pid || null;
  showBattleScreen(data);
});

socket.on("battle_round_result", (data) => {
  const isAtk = _battleAttackerPid === SESSION.pid;
  const isDef = _battleDefenderPid === SESSION.pid;
  // Orient dice display from my perspective
  const myDice   = isAtk ? data.atk_dice  : isDef ? data.def_dice  : data.atk_dice;
  const enmDice  = isAtk ? data.def_dice  : isDef ? data.atk_dice  : data.def_dice;
  const myTotal  = isAtk ? data.atk_total : isDef ? data.def_total : data.atk_total;
  const enmTotal = isAtk ? data.def_total : isDef ? data.atk_total : data.def_total;
  const iWon     = isAtk ? data.attacker_wins_round : isDef ? !data.attacker_wins_round : data.attacker_wins_round;

  _settleAfterMinSpinBattle(myDice, enmDice, myTotal, enmTotal, iWon, data.damage_msg || "")
    .then(() => {
      triggerHitAnim(data);
      if (data.battle_over) {
        setTimeout(closeBattleScreen, 900);
      } else {
        updateBattleAfterRound(data);
      }
    });
});

socket.on("event_card", (data) => {
  _eventCardOwnerPid = data.pid;
  showEventCard(data.player_name, data.event, data.pid === SESSION.pid);
});

// ── Game update ──────────────────────────────────────────────────
socket.on("game_update", async (state) => {
  window._gameState = state;

  // Dismiss event card once event_display pending clears
  if (_eventCardOwnerPid !== null &&
      (!state.pending || state.pending.type !== "event_display")) {
    closeEventCard();
    _eventCardOwnerPid = null;
  }

  // Dismiss wild watch modal once wild pending clears
  if (_watchingWild && (!state.pending || state.pending.type !== "wild")) {
    _watchingWild = false;
    closeModal();
  }

  if (state.phase === "lobby") {
    renderWaiting(state.players, SESSION.isHost);
    return;
  }

  if (state.phase === "playing" || state.phase === "ended") {
    // Pre-detect movement and block premature modals BEFORE any await
    const earlyMovedPid = Object.keys(state.players).find(pid =>
      window._prevPositions?.[pid] !== undefined &&
      window._prevPositions[pid] !== state.players[pid].position
    ) || null;
    if (earlyMovedPid) window._tokenAnimating = true;

    const firstTime = document.getElementById("game").classList.contains("hidden");
    if (firstTime) {
      showScreen("game");
      document.getElementById("gc-room-id").textContent = SESSION.roomId;
      if (!window.BOARD_DATA) {
        const res = await fetch("/api/board");
        window.BOARD_DATA = await res.json();
      }
      initBoard(window.BOARD_DATA);
      initPrevPositions(state.players);
    }

    // ── settle dice (turn roll only) ──
    const log = state.log || [];
    const logTotal = state.log_total ?? log.length;
    let diceSettlePromise = Promise.resolve();
    if (_diceRolling && logTotal > _prevLogTotal) {
      const newCount = logTotal - _prevLogTotal;
      for (const entry of log.slice(-newCount)) {
        const m = entry.msg.match(/ทอยได้ (\d)/);
        if (m) { diceSettlePromise = _settleAfterMinSpin(parseInt(m[1])); break; }
        if (entry.msg.includes("ข้ามเทิร์น")) { _hideDice(); break; }
      }
    }
    _prevLogTotal = logTotal;

    const movedPid = earlyMovedPid;

    renderLog(state.log);
    renderPlayers(state.players, state.turn_order, state.current_turn);
    _updateCenterPanel(state);

    if (movedPid) {
      const from  = window._prevPositions[movedPid];
      const to    = state.players[movedPid].position;
      const color = getPidColor(movedPid);
      const name  = state.players[movedPid].name;

      diceSettlePromise.then(() => {
        animateMoveToken(movedPid, from, to, color, name, () => {
          Object.entries(state.players).forEach(([pid, p]) => {
            window._prevPositions[pid] = p.position;
          });
          updateBoard(state.players, state.turn_order, state.current_turn);
          renderActionPanel(state.phase, state.pending, state.players);
          window._tokenAnimating = false;

          if (window._pendingModal) {
            const d = window._pendingModal;
            window._pendingModal = null;
            _showActionModal(d);
          }
          if (_pendingWildWatch) {
            const d = _pendingWildWatch;
            _pendingWildWatch = null;
            showWildWatchModal(d.player_name, d.pokemon);
          }
        });
      });

    } else {
      Object.entries(state.players).forEach(([pid, p]) => {
        window._prevPositions[pid] = p.position;
      });
      updateBoard(state.players, state.turn_order, state.current_turn);
      renderActionPanel(state.phase, state.pending, state.players);
    }
  }
});

function _updateCenterPanel(state) {
  const order = state.turn_order || [];
  const activePid = order.length ? order[state.current_turn % order.length] : null;
  const name = activePid && state.players[activePid] ? state.players[activePid].name : "—";
  const el = document.getElementById("gc-turn-player");
  if (el) el.textContent = name;
}

socket.on("action_required", (data) => {
  if (data.pid !== SESSION.pid) return;
  if (window._tokenAnimating) {
    window._pendingModal = data;
    return;
  }
  _showActionModal(data);
});

function _showActionModal(data) {
  const t = data.type;
  const d = data.data || {};

  if (t === "wild") {
    const pk = d.pokemon || {};
    const myPl = window._gameState?.players?.[SESSION.pid];
    const hasPB = hasItem("poke_ball", myPl);
    const hasGB = hasItem("great_ball", myPl);
    const hasUB = hasItem("ultra_ball", myPl);
    showModal(`🌿 พบ ${pk.name}!`, `
      <div class="pk-sprite-wrap">${pokeImgTag(pk.sprite_id, true, "pk-sprite-lg")}</div>
      <div class="modal-stat"><span>Type</span><span>${pk.type}</span></div>
      <div class="modal-stat"><span>ATK</span><span>${pk.atk}</span></div>
      <div class="modal-stat"><span>Catch Rate</span><span>${pk.catch_rate}</span></div>
      <div class="modal-stat"><span>Research Value</span><span>${pk.research_value} เงิน</span></div>
    `, [
      ...(hasPB ? [{ text: "✅ จับ (Poké Ball)", cls: "btn-success", fn: () => doAction("catch", { item: "poke_ball" }) }] : []),
      ...(hasGB ? [{ text: "⭐ Great Ball",       cls: "btn-info",    fn: () => doAction("catch", { item: "great_ball" }) }] : []),
      ...(hasUB ? [{ text: "🟡 Ultra Ball +4",    cls: "btn-warning", fn: () => doAction("catch", { item: "ultra_ball" }) }] : []),
      ...(!hasPB && !hasGB && !hasUB ? [{ text: "❌ ไม่มีบอล", cls: "btn-secondary" }] : []),
      { text: "🏃 หนี", cls: "btn-secondary", fn: () => doAction("skip", {}) },
    ]);

  } else if (t === "gym") {
    const gym = d.gym || {};
    const beaten = d.already_beaten ? " (ชนะแล้ว)" : "";
    showModal(`🏟 ยิม ${gym.name}${beaten}`, `
      <div class="modal-stat"><span>Badge</span><span>${gym.badge}</span></div>
      <div class="modal-stat"><span>ATK ศัตรู</span><span>${gym.atk}</span></div>
      <div class="modal-stat"><span>รางวัล</span><span>${d.already_beaten ? gym.reward / 2 : gym.reward} เงิน</span></div>
    `, [
      { text: "⚔️ เลือก Pokémon สู้!", cls: "btn-danger", fn: () => startFightFlow() },
      { text: "🏃 ผ่าน", cls: "btn-secondary", fn: () => doAction("skip", {}) },
    ]);

  } else if (t === "rocket") {
    showModal("🚀 โจมตีจาก Rocket Grunt!", `
      <div class="modal-stat"><span>ATK Grunt</span><span>${d.grunt_atk}</span></div>
      <p style="margin-top:8px;font-size:.85rem;color:#666;">ชนะ = ได้เงินปล้น! แพ้ = โปเกมอน faint</p>
    `, [
      { text: "⚔️ เลือก Pokémon สู้!", cls: "btn-danger", fn: () => startFightFlow() },
      { text: "🏃 หนี", cls: "btn-secondary", fn: () => doAction("skip", {}) },
    ]);

  } else if (t === "tile_with_pvp") {
    const tileLabel = (d.tile || {}).label || "??";
    showModal(`⚔️ พบผู้เล่น ${d.opponent_name}!`, `
      <p>คุณลงช่องเดียวกับ <strong>${d.opponent_name}</strong>!</p>
      <p style="margin-top:8px;font-size:.85rem;color:#666;">ต้องการสู้หรือใช้แอคชั่นของช่อง (${tileLabel})?</p>
    `, [
      { text: `⚔️ สู้กับ ${d.opponent_name}!`, cls: "btn-danger", fn: () => startPvPFightFlow(d.opponent_name) },
      { text: `🎯 ใช้ช่อง (${tileLabel})`, cls: "btn-secondary", fn: () => doAction("use_tile", {}) },
    ]);

  } else if (t === "pvp_select") {
    showModal(`⚔️ ${d.attacker_name} ท้าสู้คุณ!`, `
      <p><strong>${d.attacker_name}</strong> ท้าสู้! เลือก Pokémon เพื่อรับมือ</p>
    `, [
      { text: "⚔️ เลือก Pokémon สู้!", cls: "btn-danger", fn: () => startDefenderPvPSelectFlow(d.attacker_name) },
      { text: "🏃 หนี", cls: "btn-secondary", fn: () => doAction("pvp_pokemon_select", { pokemon_id: null }) },
    ]);

  } else if (t === "pass_go") {
    const hasPkmn = (window._gameState?.players?.[SESSION.pid]?.pokemon || []).length > 0;
    showModal(`🏁 ผ่าน Start! +${d.bonus || 6} เงิน`, `
      <p>หยุดที่ช่อง Start — วิจัยโปเกมอนได้ก่อนเดินต่อ</p>
    `, [
      ...(hasPkmn ? [{ text: "🔬 วิจัย", cls: "btn-info", fn: () => showResearchModal() }] : []),
      { text: "ต่อไป →", cls: "btn-primary", fn: () => doAction("continue", {}) },
    ]);

  } else if (t === "center_shop") {
    showCenterShop();
  }
}

let _watchingWild = false;
let _pendingWildWatch = null;

socket.on("wild_encounter", (data) => {
  if (data.pid === SESSION.pid) return; // catcher gets action_required with buttons
  _watchingWild = true;
  if (window._tokenAnimating) {
    _pendingWildWatch = data; // show after board animation finishes
  } else {
    showWildWatchModal(data.player_name, data.pokemon);
  }
});

socket.on("pokemon_evolved", (data) => {
  showEvolutionAnim(data.player_name, data.old_name, data.old_sprite_id, data.new_name, data.new_sprite_id);
});

socket.on("catch_rolling", (data) => {
  if (data.pid === SESSION.pid) return; // catcher already animating via doAction
  showDiceRolling(`🎯 ${data.player_name} จับโปเกมอน`, `กำลังทอยจับ ${data.pokemon_name}...`);
  window._diceAnimStartTime = Date.now();
});

socket.on("catch_result", (data) => {
  const isMe = data.pid === SESSION.pid;
  const bonus = data.bonus > 0 ? `+${data.bonus}` : "";
  const label = isMe
    ? (data.success
        ? `✅ ${data.dice}${bonus} = ${data.total} ≥ ${data.catch_rate}`
        : `❌ ${data.dice}${bonus} = ${data.total} < ${data.catch_rate}`)
    : (data.success
        ? `✅ จับ ${data.pokemon_name} สำเร็จ!`
        : `❌ จับ ${data.pokemon_name} ไม่สำเร็จ`);
  _settleAfterMinSpin(data.dice, label);
});

socket.on("game_over", (data) => {
  showGameOver(data.ranking || []);
});

// ── Debug helpers (browser console) ─────────────────────────────
// Usage: debug.money(200)  /  debug.pokemon("charizard")  /  debug.tp(5)
window.debug = {
  _r: () => ({ room_id: SESSION.roomId, pid: SESSION.pid }),
  money:  (n=50)  => socket.emit("debug_give_money",   { ...window.debug._r(), amount: n }),
  pokemon:(id)    => socket.emit("debug_give_pokemon",  { ...window.debug._r(), pokemon_id: id }),
  item:   (it="great_ball") => socket.emit("debug_give_item", { ...window.debug._r(), item: it }),
  ball:   (n=1)   => { for(let i=0;i<n;i++) socket.emit("debug_give_item", { ...window.debug._r(), item: "poke_ball" }); },
  gball:  (n=1)   => { for(let i=0;i<n;i++) socket.emit("debug_give_item", { ...window.debug._r(), item: "great_ball" }); },
  tp:     (pos)   => socket.emit("debug_teleport",      { ...window.debug._r(), position: pos }),
  turn:   ()      => socket.emit("debug_set_turn",      { ...window.debug._r() }),
  tile:   ()      => socket.emit("debug_trigger_tile",  { ...window.debug._r() }),
  clear:  ()      => socket.emit("debug_clear_pending", { ...window.debug._r() }),
  faint:  ()      => socket.emit("debug_faint_all",     { ...window.debug._r() }),
  revive: ()      => socket.emit("debug_revive_all",    { ...window.debug._r() }),
  state:  ()      => {
    socket.emit("debug_state", { room_id: SESSION.roomId });
    socket.once("debug_state_dump", d => console.table(d.players) || console.log("pending:", d.pending));
  },
  // fight(opp) — force battle between me and opponent
  // opp can be: pid string, player name (case-insensitive), or numeric index (0 = first other player)
  // fight(opp, myPid) — specify attacker explicitly
  fight: (opp=0, myPid) => socket.emit("debug_force_fight", {
    room_id: SESSION.roomId,
    pid1: myPid || SESSION.pid,
    pid2: opp,
  }),
  // list all players with pid, name, pokemon count
  players: () => {
    const st = window._gameState;
    if (!st) return console.log("No game state loaded");
    const rows = Object.entries(st.players).map(([pid, p], i) => ({
      index: i, pid, name: p.name, class: p.class_id,
      pokemon: (p.pokemon || []).map(pk => `${pk.name}(${pk.hp}/${pk.max_hp}HP)`).join(", ") || "—",
      money: p.money,
    }));
    console.table(rows);
  },
};
