# PokéBoard — Claude Code Prompt

## ภาพรวมโปรเจค

สร้างเกมกระดานออนไลน์ชื่อ **PokéBoard** บน Flask + Flask-SocketIO รองรับผู้เล่น 2–4 คน พร้อมกันแบบ Real-time โดยอิงกติกาบอร์ดเกม Pokémon แบบ Custom ของ OverBoot

---

## Stack และ Dependencies

```
Flask
Flask-SocketIO
eventlet
```

**Frontend:** Vanilla JS + Socket.IO client (CDN) ไม่ใช้ framework ใดๆ

---

## โครงสร้างโปรเจค

```
pokeboard/
├── app.py                  # Entry point: สร้าง Flask app + SocketIO, โหลด config
├── config.py               # SECRET_KEY, DEBUG, MAX_PLAYERS, STARTING_MONEY
├── requirements.txt        # flask, flask-socketio, eventlet
│
├── data/                   # ← จุดขยายหลัก แก้ JSON เพิ่มข้อมูลใหม่ได้ทันที
│   ├── pokemon.json        # รายการโปเกมอนทั้งหมด
│   ├── events.json         # การ์ด Event ทั้งหมด
│   ├── classes.json        # อาชีพทั้งหมด + ability_id
│   ├── gyms.json           # ข้อมูลยิมผู้นำทั้งหมด
│   └── board.json          # layout ช่อง 28 ช่อง (tile type + metadata)
│
├── game/
│   ├── loader.py           # โหลด JSON ทุกไฟล์ใน data/ ตอน startup → dict
│   ├── state.py            # สร้าง/จัดการ game state (rooms dict in-memory)
│   ├── engine.py           # turn flow, tile actions, catch, research, end game
│   ├── battle.py           # คำนวณ ATK + dice + bonus → ตัดสินแพ้ชนะ
│   └── abilities.py        # registry: ability_id → function (Plugin Pattern)
│
├── server/
│   ├── routes.py           # HTTP: GET /  POST /api/create_room  POST /api/join
│   └── events.py           # SocketIO: on roll, on action, on fight, on research
│
├── templates/
│   └── index.html          # Single Page — Jinja2 render ครั้งเดียว ที่เหลือ JS
│
└── static/
    ├── js/
    │   ├── socket.js       # เชื่อมต่อ SocketIO, รับ game_update → re-render
    │   ├── board.js        # วาด/อัปเดตกระดาน 28 ช่อง + ตัวหมาก
    │   └── ui.js           # จัดการ modal, log panel, player card
    └── css/
        └── style.css       # Theme สี Pokémon (แดง/เหลือง/ขาว)
```

---

## โครงสร้าง JSON (data/)

### `pokemon.json`
```json
[
  {
    "id": "pikachu",
    "name": "Pikachu",
    "type": "Electric",
    "atk": 3,
    "catch_rate": 3,
    "research_value": 8
  }
]
```
> เพิ่มโปเกมอนใหม่ = เพิ่ม object ในอาร์เรย์นี้ ไม่ต้องแตะ Python

### `events.json`
```json
[
  {
    "id": "lucky_coin",
    "text": "พบเหรียญโบราณ! ได้รับเงิน",
    "money_delta": 8,
    "skip_turns": 0,
    "teleport": null
  },
  {
    "id": "storm",
    "text": "พายุพัดมา! หยุด 1 เทิร์น",
    "money_delta": 0,
    "skip_turns": 1,
    "teleport": null
  }
]
```
> `teleport` ใส่ tile_id เพื่อย้ายตำแหน่ง หรือ null

### `classes.json`
```json
[
  {
    "id": "trainer",
    "name": "เทรนเนอร์",
    "ability_id": "atk_bonus",
    "ability_params": { "bonus": 2 },
    "ability_desc": "ATK+2 ในการต่อสู้ทุกครั้ง",
    "item_limit": 4,
    "starter_items": ["poke_ball", "poke_ball"]
  },
  {
    "id": "rocket",
    "name": "แก๊งร็อกเก็ต",
    "ability_id": "steal_on_win",
    "ability_params": {},
    "ability_desc": "ขโมยโปเกมอน 1 ตัวเมื่อชนะ PvP",
    "item_limit": 4,
    "starter_items": ["poke_ball", "great_ball"]
  },
  {
    "id": "scientist",
    "name": "นักวิทยาศาสตร์",
    "ability_id": "research_anywhere",
    "ability_params": {},
    "ability_desc": "ส่งวิจัยได้ทุกเทิร์น ไม่ต้องจอด",
    "item_limit": 4,
    "starter_items": ["poke_ball", "poke_ball"]
  },
  {
    "id": "collector",
    "name": "นักสะสม",
    "ability_id": "extra_item_slots",
    "ability_params": { "limit": 6 },
    "ability_desc": "ถือไอเทมได้สูงสุด 6 ใบ",
    "item_limit": 6,
    "starter_items": ["poke_ball", "poke_ball", "great_ball"]
  }
]
```
> เพิ่มอาชีพใหม่ = เพิ่ม object + เขียน function ใน `abilities.py`

### `gyms.json`
```json
[
  { "id": "brock",   "name": "Brock",     "badge": "Boulder Badge", "atk": 4,  "reward": 10 },
  { "id": "misty",   "name": "Misty",     "badge": "Cascade Badge", "atk": 6,  "reward": 14 },
  { "id": "surge",   "name": "Lt. Surge", "badge": "Thunder Badge", "atk": 8,  "reward": 18 },
  { "id": "erika",   "name": "Erika",     "badge": "Rainbow Badge", "atk": 10, "reward": 22 },
  { "id": "giovanni","name": "Giovanni",  "badge": "Earth Badge",   "atk": 20, "reward": 50 }
]
```

### `board.json`
```json
[
  { "id": 0,  "type": "start",  "label": "Start",    "meta": { "pass_go_bonus": 6 } },
  { "id": 1,  "type": "wild",   "label": "Wild",     "meta": {} },
  { "id": 5,  "type": "gym",    "label": "Gym 1",    "meta": { "gym_id": "brock" } },
  { "id": 8,  "type": "center", "label": "Pokemon Center", "meta": {} },
  { "id": 3,  "type": "event",  "label": "?",        "meta": {} },
  { "id": 7,  "type": "rocket", "label": "Rocket",   "meta": { "grunt_atk_range": [3, 8] } }
]
```
> เพิ่ม tile type ใหม่ = เพิ่ม type ในนี้ แล้วเพิ่ม handler ใน `engine.py`

---

## Game State (in-memory)

```python
# state.py

rooms = {}  # room_id -> GameRoom

class GameRoom:
    phase: str          # "lobby" | "playing" | "ended"
    players: dict       # pid -> PlayerState
    turn_order: list    # [pid, ...]
    current_turn: int   # index ใน turn_order
    log: list           # [{time, msg}, ...] max 60 items
    pending: dict       # action รอผู้เล่นตัดสินใจ

class PlayerState:
    name: str
    class_id: str
    position: int       # 0–27
    money: int
    pokemon: list       # [{id, name, atk, research_value, ...}]
    fainted: list       # โปเกมอนที่ faint รอฟื้นที่ Center
    badges: list        # badge ที่ได้จากยิม
    items: list         # ["poke_ball", "great_ball", ...]
    skip_turns: int     # > 0 = ข้ามเทิร์น
```

---

## Plugin Pattern — abilities.py

```python
# abilities.py

ABILITY_REGISTRY = {}

def register(ability_id):
    def decorator(fn):
        ABILITY_REGISTRY[ability_id] = fn
        return fn
    return decorator

@register("atk_bonus")
def atk_bonus(player, params, context):
    return params.get("bonus", 0)   # คืน ATK bonus เพิ่มเติม

@register("steal_on_win")
def steal_on_win(player, params, context):
    # context["loser"] = PlayerState ของฝ่ายแพ้
    loser = context.get("loser")
    if loser and loser["pokemon"]:
        stolen = loser["pokemon"].pop(0)
        player["pokemon"].append(stolen)
        return f"ขโมย {stolen['name']} มาได้!"
    return None

@register("research_anywhere")
def research_anywhere(player, params, context):
    # คืน True = อนุญาตให้ส่งวิจัยได้แม้ไม่ได้จอดช่อง research
    return True

@register("extra_item_slots")
def extra_item_slots(player, params, context):
    return params.get("limit", 6)
```

> เพิ่ม ability ใหม่ = เพิ่ม `@register("id_ใหม่")` function เดียว

---

## SocketIO Events

### Client → Server
| Event | Payload | คำอธิบาย |
|-------|---------|-----------|
| `roll` | `{room_id, pid}` | ทอยเต๋า เดินตัวหมาก |
| `action` | `{room_id, pid, action, data}` | ตัดสินใจหลังตกช่อง (catch/skip/fight) |
| `research` | `{room_id, pid, pokemon_ids}` | ส่งโปเกมอนเข้าวิจัย |
| `end_game` | `{room_id}` | สิ้นสุดเกม (host เท่านั้น) |

### Server → Client (Broadcast to room)
| Event | Payload | คำอธิบาย |
|-------|---------|-----------|
| `game_update` | `{phase, players, turn_order, current_turn, log, board}` | state เต็มทุกครั้งที่มีการเปลี่ยนแปลง |
| `action_required` | `{type, data, pid}` | แจ้งผู้เล่นว่าต้องตัดสินใจ |
| `battle_result` | `{winner_pid, loser_pid, rolls, ability_msg}` | ผลการต่อสู้ |
| `game_over` | `{ranking: [{pid, name, money}]}` | จบเกม + อันดับ |

---

## Turn Flow (engine.py)

```
1. ตรวจสอบ skip_turns → ถ้า > 0 ลด 1 แล้ว advance_turn()
2. ผู้เล่นทอยเต๋า 1d6
3. เดิน position = (position + dice) % 28
4. ถ้าผ่านช่อง 0 (start) → money += pass_go_bonus
5. ดูประเภทช่องที่ตก:
   - wild   → สุ่มโปเกมอนจาก pool, emit action_required(type=wild)
   - gym    → โหลด gym data, emit action_required(type=gym)
   - rocket → สุ่ม grunt ATK, emit action_required(type=rocket)
   - event  → สุ่ม event card, apply ทันที, advance_turn()
   - center → ย้าย fainted → pokemon, advance_turn()
   - start  → advance_turn()
6. broadcast game_update ทุกครั้ง
```

---

## Battle System (battle.py)

```python
def resolve_battle(attacker, defender_atk, ability_fn=None):
    """
    attacker: PlayerState
    defender_atk: int (gym/grunt/player ATK)
    ability_fn: function จาก abilities.py หรือ None
    """
    p_atk = sum(p["atk"] for p in attacker["pokemon"])
    p_atk += ability_fn(attacker, ...) if ability_fn else 0
    p_dice = random.randint(1, 6)
    p_total = p_atk + p_dice

    e_dice = random.randint(1, 6)
    e_total = defender_atk + e_dice

    won = p_total >= e_total
    if not won and attacker["pokemon"]:
        fainted = attacker["pokemon"].pop(0)
        attacker["fainted"].append(fainted)

    return {
        "won": won,
        "p_total": p_total,
        "e_total": e_total,
        "p_dice": p_dice,
        "e_dice": e_dice,
        "fainted": fainted if not won else None,
    }
```

---

## End Game (Liquidation)

```
1. phase = "ended"
2. ทุกคน: money += sum(p["research_value"] for p in pokemon + fainted)
3. เรียง ranking ตาม money DESC
4. emit game_over({ranking})
```

---

## HTTP Routes (routes.py)

| Method | Path | คำอธิบาย |
|--------|------|-----------|
| GET | `/` | render index.html |
| POST | `/api/create_room` | สร้างห้อง → `{room_id}` |
| POST | `/api/join` | เข้าร่วม → `{pid, room_id}` |
| POST | `/api/start` | เริ่มเกม (ต้อง >= 2 คน) |
| GET | `/api/state/<room_id>` | ดึง state (fallback polling) |

---

## UI Requirements (index.html + JS)

- **Lobby screen:** กรอกชื่อ, เลือกอาชีพ (แสดง ability desc), ใส่ room_id หรือสร้างใหม่
- **Board view:** วงกลม 28 ช่อง, ตัวหมากสีต่างกันต่อผู้เล่น, highlight ช่องปัจจุบัน
- **Action modal:** popup เมื่อ `action_required` — แสดงข้อมูลโปเกมอน/ยิม + ปุ่มตัดสินใจ
- **Player panel:** แสดงเงิน, จำนวนโปเกมอน, badge, ไอเทม ของทุกคน
- **Log panel:** 20 บรรทัดล่าสุด (scroll ได้)
- **เทิร์นปัจจุบัน:** highlight ชื่อผู้เล่นที่ต้องเดิน

---

## สิ่งที่ห้ามทำ (Constraints)

- ห้าม hardcode ข้อมูลโปเกมอน/event/class/gym ใน Python — ต้องโหลดจาก JSON เสมอ
- ห้าม logic เกมอยู่ใน `server/events.py` — ต้องเรียกผ่าน `engine.py` เท่านั้น
- ห้ามใช้ Database — state เก็บใน RAM (dict) เพียงพอสำหรับ Demo
- ห้ามใช้ JS framework (React/Vue) — Vanilla JS เท่านั้น

---

## วิธีเพิ่มของใหม่ในอนาคต

| ต้องการเพิ่ม | ไฟล์ที่ต้องแก้ |
|-------------|----------------|
| โปเกมอนใหม่ | `data/pokemon.json` เท่านั้น |
| Event card ใหม่ | `data/events.json` เท่านั้น |
| อาชีพใหม่ | `data/classes.json` + function ใน `game/abilities.py` |
| ยิมใหม่ | `data/gyms.json` + เพิ่ม tile ใน `data/board.json` |
| Tile type ใหม่ | `data/board.json` + handler ใน `game/engine.py` |
| SocketIO event ใหม่ | `server/events.py` เท่านั้น |