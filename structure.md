# PokéBoard — Project Structure

## ภาพรวม

Single-page multiplayer board game สร้างด้วย Flask + Flask-SocketIO (backend) และ Vanilla JS (frontend) ไม่มี frontend framework ใดๆ

```
pokeboard/
├── app.py                  ← entry point
├── config.py               ← ค่าคงที่
├── server/
│   ├── routes.py           ← HTTP endpoints
│   ├── events.py           ← Socket.IO handlers
│   └── debug_events.py     ← debug commands (DEBUG=true เท่านั้น)
├── game/
│   ├── loader.py           ← โหลด JSON data
│   ├── state.py            ← จัดการ room/player state
│   ├── engine.py           ← game logic หลัก
│   ├── battle.py           ← คำนวณ HP / ผลการต่อสู้
│   └── abilities.py        ← special ability แต่ละ class
├── static/
│   ├── css/style.css       ← styling + animations ทั้งหมด
│   └── js/
│       ├── ui.js           ← render UI / modals / animations
│       ├── board.js        ← render กระดาน + เคลื่อนที่ token
│       └── socket.js       ← socket events + game flow client-side
├── templates/
│   └── index.html          ← SPA shell (Jinja2)
└── data/
    ├── pokemon.json
    ├── classes.json
    ├── board.json
    ├── gyms.json
    └── events.json
```

---

## Backend

### `app.py` — Entry Point

- สร้าง Flask app + SocketIO (eventlet async mode)
- เรียก `loader.load_all()` โหลด JSON ทั้งหมดก่อน serve
- Register blueprint `routes_bp` และ socket handlers
- Register `debug_events` เฉพาะเมื่อ `config.DEBUG == True`

**Import:** `config`, `game.loader`, `server.routes`, `server.events`, `server.debug_events`

---

### `config.py` — Configuration

ค่าคงที่ทั้งหมด อ่านจาก environment variable ได้

| ตัวแปร | ค่า default |
|---|---|
| `SECRET_KEY` | `"pokeboard-dev-secret-key"` |
| `DEBUG` | `True` |
| `MAX_PLAYERS` | `4` |
| `STARTING_MONEY` | `20` |

**Import:** ไม่มี

---

### `server/routes.py` — HTTP Routes

| Route | Method | หน้าที่ |
|---|---|---|
| `/` | GET | render `index.html` พร้อม `CLASSES_DATA` |
| `/api/create_room` | POST | สร้างห้องใหม่ คืน `room_id`, `pid` |
| `/api/join` | POST | เข้าร่วมห้อง ตรวจสอบ MAX_PLAYERS |
| `/api/start` | POST | host เริ่มเกม, shuffle turn order, แจก starter |
| `/api/board` | GET | คืน board tile layout สำหรับ frontend |
| `/api/state/<room_id>` | GET | dump game state (debug) |

ตอน start จะเรียก `battle.init_pokemon_hp()` ให้ starter pokemon ทุกตัว

**Import:** `game.battle`, `game.loader`, `game.state`, `uuid`, `random`

---

### `server/events.py` — Socket.IO Handlers

| Event (รับ) | หน้าที่ |
|---|---|
| `join_room` | เข้า Socket.IO room (สำหรับ broadcast) |
| `roll` | เรียก `engine.roll_and_move()` |
| `action` | เรียก `engine.handle_action()` |
| `research` | เรียก `engine.handle_research()` |
| `set_class` | เปลี่ยน class ใน lobby |
| `end_game` | เรียก `engine.end_game()` |

**Import:** `game.engine`, `game.loader`, `game.state`

---

### `server/debug_events.py` — Debug Commands

ลงทะเบียนเฉพาะ `DEBUG=True` เท่านั้น

| Event | หน้าที่ |
|---|---|
| `debug_give_money` | เพิ่มเงิน |
| `debug_give_pokemon` | เพิ่มโปเกมอน (ระบุ id หรือ random) |
| `debug_give_item` | เพิ่ม item |
| `debug_teleport` | ย้ายตำแหน่ง |
| `debug_set_turn` | เซ็ตเทิร์น |
| `debug_trigger_tile` | trigger tile ที่ยืนอยู่ |
| `debug_clear_pending` | ล้าง pending + advance turn |
| `debug_faint_all` | faint โปเกมอนทุกตัว |
| `debug_revive_all` | ฟื้นโปเกมอนทุกตัว |
| `debug_force_fight` | บังคับ pvp ระหว่างผู้เล่น 2 คน |
| `debug_state` | dump state ทั้งห้อง |

**Import:** `game.battle`, `game.engine`, `game.loader`, `game.state`

---

## Game Logic

### `game/loader.py` — Data Loader (Singleton)

โหลด JSON ครั้งเดียวตอน `load_all()` เก็บใน `_data` dict

```python
loader.get("pokemon")    # list[dict]
loader.get("board_map")  # dict[int, tile]
loader.get("gym_map")    # dict[str, gym]
loader.get("class_map")  # dict[str, class]
loader.get("events")     # list[dict]
```

**Import:** `json`, `os`

---

### `game/state.py` — Room State

จัดการ room ทั้งหมดเก็บใน `_rooms` dict (in-memory)

**Room structure:**
```python
{
  "phase":        "lobby" | "playing" | "ended",
  "host":         pid,
  "players":      { pid: player_dict },
  "turn_order":   [pid, ...],
  "current_turn": int,
  "log":          [{"msg": str, "ts": float}, ...],  # max 60 entries
  "pending":      { "type": str, "pid": str, "data": dict }
}
```

**Player structure:**
```python
{
  "name": str, "class_id": str, "money": int,
  "position": int, "skip_turns": int,
  "pokemon": [pokemon_dict], "fainted": [pokemon_dict],
  "items": [str], "badges": [str]
}
```

**Functions:** `create_room`, `join_room`, `get_room`, `current_pid`, `advance_turn`, `add_log`

**Import:** `config`, `game.loader`

---

### `game/battle.py` — Battle Mechanics

| Function | หน้าที่ |
|---|---|
| `pokemon_max_hp(atk)` | คืน `HP_BASE + atk * HP_PER_ATK` (= `6 + atk*3`) |
| `init_pokemon_hp(pk)` | เซ็ต `hp`, `max_hp` ให้ pokemon dict |
| `restore_hp(pk)` | คืน HP เต็ม (ใช้ที่ Center) |
| `resolve_battle(...)` | คำนวณ 1 round: dice + atk, ตัดสิน win/loss, damage, faint |

**Import:** `random`

---

### `game/abilities.py` — Class Abilities

Registry pattern สำหรับ ability แต่ละ class

| ability_id | class | หน้าที่ |
|---|---|---|
| `atk_bonus` | Trainer | +2 ATK ในการต่อสู้ |
| `steal_on_win` | Rocket | ขโมยโปเกมอนเมื่อชนะ PvP |
| `research_anywhere` | Scientist | วิจัยได้ทุกที่ ไม่ต้องอยู่ Center |
| `extra_item_slots` | Collector | เก็บ item ได้ 6 ช่องแทน 4 |

**Import:** ไม่มี

---

### `game/engine.py` — Game Engine (หลัก)

**Entry functions (เรียกจาก server/events.py):**

| Function | เรียกเมื่อ |
|---|---|
| `roll_and_move(room, pid, socketio, room_id)` | event `roll` |
| `handle_action(room, pid, action, data, ...)` | event `action` |
| `handle_research(room, pid, pokemon_ids, ...)` | event `research` |
| `end_game(room, socketio, room_id)` | event `end_game` |

**Tile flow:**
```
roll_and_move()
  └─ _handle_tile()          ← ตรวจว่ามีผู้เล่นอื่นบนช่องไหม
       └─ _process_tile()    ← route ตาม tile type
            ├─ wild_*        → pending: "wild"            → emit action_required
            ├─ gym           → pending: "gym"             → emit action_required
            ├─ rocket        → pending: "rocket"          → emit action_required
            ├─ event         → pending: "event_display"   → emit event_card
            └─ center        → heal all pokemon, advance turn
```

**Action flow (pending types):**
```
handle_action()
  ├─ battle_ongoing   → _handle_battle_round_roll() / _handle_battle_surrender()
  ├─ wild             → catch / skip
  ├─ gym / rocket     → fight → pending: "battle_ongoing" + emit battle_start
  ├─ tile_with_pvp    → fight_player → _start_pvp_battle()
  ├─ pvp_defender_selecting → _handle_pvp_defender_select() → pending: "battle_ongoing"
  └─ event_display    → event_continue → advance turn
```

**Battle flow (multi-round):**
```
pending: "battle_ongoing"
  ├─ PvP:  รอทั้ง 2 คน roll → _resolve_pvp_round()
  │         ผู้ชนะ round โจมตี → HP ลด → ถ้า HP≤0 = faint = battle over
  └─ NPC:  player roll + auto NPC roll → _resolve_npc_round()
            player ชนะ = NPC defeated (1 round win)
            player แพ้ = HP ลด → ถ้า HP≤0 = faint = battle over
```

**Socket emissions จาก engine:**

| Event | เมื่อไหร่ |
|---|---|
| `game_update` | หลังทุก state change |
| `action_required` | ต้องการ input จากผู้เล่น |
| `battle_start` | เริ่มต่อสู้ |
| `battle_rolling` | ก่อน resolve round |
| `battle_round_result` | ผลแต่ละ round |
| `event_card` | ผู้เล่นลงช่อง event |
| `catch_result` | ผลการจับโปเกมอน |
| `game_over` | เกมจบ |

**Import:** `game.loader`, `game.state`, `game.battle`, `game.abilities.ABILITY_REGISTRY`

---

## Frontend

### `templates/index.html` — SPA Shell

Screen เดียว toggle ด้วย `showScreen()` ใน ui.js

| Element | Screen |
|---|---|
| `#lobby` | ฟอร์มสร้าง/เข้าห้อง |
| `#waiting` | ห้องรอ + class picker |
| `#game` | กระดาน + right panel |
| `#modal-overlay` | modal actions ทั่วไป |
| `#dice-overlay` | animation ลูกเต๋า |
| `#battle-overlay` | หน้าต่อสู้ |
| `#event-card-overlay` | การ์ด event |
| `#gameover-overlay` | ranking สุดท้าย |

**Data injection (Jinja2):**
- `window.CLASSES_DATA` — classes.json ผ่าน server
- `window.BOARD_DATA` — fetch `/api/board` ตอน init

**Script load order:** `ui.js` → `board.js` → `socket.js`

---

### `static/js/ui.js` — UI Layer

ไม่มี socket.emit โดยตรง — รับ data มาจาก socket.js แล้ว render

**Render functions:**

| Function | หน้าที่ |
|---|---|
| `showScreen(id)` | toggle lobby/waiting/game |
| `renderWaiting(players, isHost)` | waiting room + class selector |
| `renderPlayers(players, turnOrder, currentTurn)` | player cards ใน game |
| `renderLog(logs)` | log panel |
| `renderActionPanel(phase, pending, players)` | action buttons ตาม pending type |

**Modal functions:**

| Function | trigger เมื่อ |
|---|---|
| `showModal(title, body, buttons)` | generic modal |
| `showPokemonSelectModal(pokemon, cb, enemy)` | เลือกโปเกมอนสู้ |
| `showPlayerPokemonModal(player)` | ดูรายละเอียดโปเกมอน |
| `showResearchModal()` | เลือกโปเกมอนวิจัย |
| `showEventCard(playerName, ev, isOwner)` | การ์ด event ทุกคนเห็น |
| `showGameOver(ranking)` | จบเกม |

**Battle screen:**

| Function | หน้าที่ |
|---|---|
| `showBattleScreen(data)` | เปิดหน้าต่อสู้ + วาง sprite/HP |
| `updateBattleAfterRound(data)` | update HP bar + battle log |
| `closeBattleScreen()` | ปิดหน้าต่อสู้ |
| `triggerHitAnim(data)` | flash + shake sprite ที่โดนดาเมจ |

**Dice animations:**

| Function | หน้าที่ |
|---|---|
| `showDiceRolling(title, sub)` | ลูกเต๋าเดี่ยว (turn roll) |
| `settleDice(value, label)` | หยุดลูกเต๋า |
| `showBattleDice(p, e)` | ลูกเต๋าคู่ (battle) |
| `settleBattleDice(...)` | หยุดลูกเต๋าคู่ + แสดง win/lose |

**Sprite helpers:**

| Function | หน้าที่ |
|---|---|
| `pokeSpriteUrl(id, animated, back)` | URL จาก PokeAPI GitHub |
| `pokeImgTag(id, animated, cls, back)` | `<img>` tag |
| `_hpBarHtml(hp, maxHp, battle)` | HP bar HTML (battle mode = dark bg) |

**Depends on (global scope):** `SESSION`, `doAction()`, `doResearch()` จาก socket.js

---

### `static/js/board.js` — Board Renderer

วาด 40 tile บน 11×11 CSS grid (perimeter layout)

| Function | หน้าที่ |
|---|---|
| `initBoard(boardData)` | สร้าง DOM tile ครั้งแรก |
| `updateBoard(players, turnOrder, currentTurn)` | วาง token แต่ละผู้เล่น |
| `animateMoveToken(pid, from, to, color, name, cb)` | เดิน token ทีละ tile (185ms/step) |
| `getTileGridPos(tileId)` | tile id → `{row, col}` บน grid |
| `initPrevPositions(players)` | เก็บตำแหน่งก่อนหน้า (ใช้ detect movement) |

**Tile layout:**
- 0–10: แถวบน (→)
- 11–19: คอลัมน์ขวา (↓)
- 20–30: แถวล่าง (←)
- 31–39: คอลัมน์ซ้าย (↑)

**Import/depends:** ไม่มี (DOM only)

---

### `static/js/socket.js` — Client Socket Layer

Main controller ของ frontend — เชื่อม socket events เข้ากับ ui.js/board.js

**Socket events (รับ):**

| Event | action |
|---|---|
| `game_update` | update `_gameState`, render board/players/actions, animate token |
| `action_required` | เรียก `_showActionModal()` (เฉพาะ pid ตรงกับตัวเอง) |
| `dice_rolling` | `showDiceRolling()` |
| `battle_rolling` | `showBattleDice()` |
| `battle_start` | `showBattleScreen()` |
| `battle_round_result` | settle dice → `triggerHitAnim()` → update HP / ปิดหน้าต่อสู้ |
| `event_card` | `showEventCard()`, track `_eventCardOwnerPid` |
| `catch_result` | settle dice พร้อม label ผล |
| `game_over` | `showGameOver()` |

**Game actions (ส่ง):**

| Function | emit |
|---|---|
| `doRoll()` | `roll` |
| `doAction(action, data)` | `action` |
| `doBattleRoll()` | `action` → `battle_roll_round` |
| `doBattleSurrender()` | `action` → `battle_surrender` |
| `doResearch(ids)` | `research` |
| `doEndGame()` | `end_game` |
| `setClassInRoom()` | `set_class` |

**Debug console API (`window.debug`):**

| Command | หน้าที่ |
|---|---|
| `debug.money(n)` | เพิ่มเงิน n |
| `debug.pokemon(id)` | เพิ่มโปเกมอน |
| `debug.ball(n)` / `debug.gball(n)` | เพิ่ม poke/great ball |
| `debug.item(name)` | เพิ่ม item |
| `debug.tp(pos)` | teleport ไปช่อง pos |
| `debug.turn()` | เซ็ตเทิร์นเป็นตัวเอง |
| `debug.tile()` | trigger tile ที่ยืนอยู่ |
| `debug.clear()` | ล้าง pending |
| `debug.faint()` / `debug.revive()` | faint/ฟื้น pokemon |
| `debug.fight(opp, myPid)` | force pvp (opp = pid/name/index) |
| `debug.state()` | console.table game state |
| `debug.players()` | console.table ผู้เล่น |

**Dice timing:** `DICE_MIN_MS = 2000` ms — รอให้ animation เล่นครบก่อน settle

---

## Data Files

### `data/pokemon.json`
```json
{ "id": "pikachu", "name": "Pikachu", "type": "Electric",
  "atk": 5, "catch_rate": 4, "research_value": 8, "sprite_id": 25 }
```
~150 ตัว, atk 0–9 กำหนด zone และ damage

### `data/classes.json`
4 class: Trainer, Rocket, Scientist, Collector — แต่ละตัวมี `ability_id`, `starter_pokemon`, `starter_items`

### `data/board.json`
40 tile — type, label, meta (gym_id / grunt_atk_range / pass_go_bonus)

### `data/gyms.json`
7 ยิม — Brock→Giovanni, atk 4→20, badge, reward, pokemon_sprite_id

### `data/events.json`
~20 event — text (ภาษาไทย), money_delta, skip_turns, teleport

---

## Socket.IO Event Flow (สรุป)

```
Client                          Server
  │                               │
  ├─── POST /api/create_room ────►│ สร้าง room, คืน pid/room_id
  ├─── emit join_room ───────────►│ เข้า Socket.IO room
  │◄── emit game_update ──────────┤ broadcast state
  │                               │
  │  [เมื่อถึงเทิร์น]              │
  ├─── emit roll ────────────────►│ roll_and_move()
  │◄── emit dice_rolling ─────────┤ แจ้งทุกคน
  │◄── emit game_update ──────────┤ token เคลื่อนที่
  │◄── emit action_required ──────┤ (เฉพาะ pid นั้น)
  │                               │
  ├─── emit action {fight} ──────►│ handle_action()
  │◄── emit battle_start ─────────┤ เปิดหน้าต่อสู้
  │◄── emit battle_rolling ───────┤ ลูกเต๋าหมุน
  │◄── emit battle_round_result ──┤ ผลแต่ละ round
  │  (วนซ้ำจนจบ)                  │
  │                               │
  ├─── emit action {event_continue}►│
  │◄── emit game_update ──────────┤ advance turn
```
