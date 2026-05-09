import random
from game import loader, state, battle

ROCKET_POKEMON = [
    {"name": "Drowzee",  "sprite_id": 96,  "type": "Psychic"},
    {"name": "Koffing",  "sprite_id": 109, "type": "Poison"},
    {"name": "Ekans",    "sprite_id": 23,  "type": "Poison"},
    {"name": "Zubat",    "sprite_id": 41,  "type": "Poison"},
    {"name": "Rattata",  "sprite_id": 19,  "type": "Normal"},
    {"name": "Meowth",   "sprite_id": 52,  "type": "Normal"},
    {"name": "Grimer",   "sprite_id": 88,  "type": "Poison"},
    {"name": "Rhyhorn",  "sprite_id": 111, "type": "Rock"},
]


# ── Turn-start item pool ──────────────────────────────────────────
_TURN_ITEM_POOL = [
    ("poke_ball",    34),
    ("great_ball",   16),
    ("potion",       14),
    ("super_potion",  8),
    ("x_attack",      7),
    ("x_defend",      5),
    ("speed_boots",   5),
    ("dire_hit",      4),
    ("elixir",        4),
    ("guard_spec",    3),
    ("escape_rope",   3),
    ("nugget",        3),
    ("revive",        2),
    ("moon_stone",    1),
]


def _weighted_choice(pool):
    total = sum(w for _, w in pool)
    r = random.randint(1, total)
    cum = 0
    for item, w in pool:
        cum += w
        if r <= cum:
            return item
    return pool[-1][0]


def _give_turn_item(room, player):
    cls = loader.get("class_map").get(player["class_id"], {})

    # auto_restore: nurse heals pokemon at turn start
    if cls.get("ability_id") == "auto_restore":
        hp_bonus = cls.get("ability_params", {}).get("hp", 2)
        healed = []
        for pk in player["pokemon"]:
            if pk.get("hp", pk["max_hp"]) < pk["max_hp"]:
                pk["hp"] = min(pk["hp"] + hp_bonus, pk["max_hp"])
                healed.append(pk["name"])
        if healed:
            state.add_log(room, f"💊 {player['name']} ฟื้น HP+{hp_bonus}: {', '.join(healed)}")

    item_limit = cls.get("item_limit", 4)
    exclude   = cls.get("turn_item_exclude", [])
    pool      = [(it, w) for it, w in _TURN_ITEM_POOL if it not in exclude]
    num_items = 2 if cls.get("ability_id") == "extra_turn_item" else 1

    given = []
    for _ in range(num_items):
        if len(player["items"]) < item_limit and pool:
            item = _weighted_choice(pool)
            player["items"].append(item)
            given.append(item)

    if given:
        names = ", ".join(_ITEM_NAMES.get(i, i) for i in given)
        state.add_log(room, f"🎁 {player['name']} ได้รับ {names}!")


def roll_and_move(room, pid, socketio, room_id):
    if room["phase"] != "playing":
        return
    if state.current_pid(room) != pid:
        return

    player = room["players"].get(pid)
    if not player:
        return

    # skip_immune: swimmer ignores skip turns
    if player["skip_turns"] > 0:
        cls = loader.get("class_map").get(player["class_id"], {})
        if cls.get("ability_id") == "skip_immune":
            player["skip_turns"] = 0
            state.add_log(room, f"🏊 {player['name']} ไม่ถูก skip turn!")
        else:
            player["skip_turns"] -= 1
            state.add_log(room, f"⏭ {player['name']} ข้ามเทิร์น (เหลือ {player['skip_turns']})")
            state.advance_turn(room)
            _broadcast(socketio, room_id, room)
            return

    # Turn-start item distribution (once per turn, silent — roll continues immediately)
    if not room.get("_turn_item_done"):
        room["_turn_item_done"] = True
        _give_turn_item(room, player)

    dice = random.randint(1, 6)
    # high_roller / lucky_girl: roll twice, keep higher
    if player.pop("reroll_next_dice", False):
        dice2 = random.randint(1, 6)
        dice = max(dice, dice2)
    bonus_steps = player.pop("bonus_steps", 0)
    # move_bonus: hiker gets permanent +1
    cls = loader.get("class_map").get(player["class_id"], {})
    if cls.get("ability_id") == "move_bonus":
        bonus_steps += cls.get("ability_params", {}).get("bonus", 0)
    move_total = dice + bonus_steps
    old_pos = player["position"]
    new_pos = (old_pos + move_total) % 40
    move_msg = f"{dice}+{bonus_steps}={move_total}👟" if bonus_steps else str(dice)

    if new_pos < old_pos:
        bonus = loader.get("board_map")[0].get("meta", {}).get("pass_go_bonus", 6)
        player["money"] += bonus
        player["position"] = 0
        state.add_log(room, f"🎲 {player['name']} ทอยได้ {move_msg} → ผ่าน Start! +{bonus} เงิน หยุดช่อง 0")
        room["pending"] = {"type": "pass_go", "pid": pid, "data": {"bonus": bonus}}
        _broadcast(socketio, room_id, room)
        socketio.emit("action_required", {"type": "pass_go", "pid": pid, "data": {"bonus": bonus}}, room=room_id)
        return

    player["position"] = new_pos
    tile = loader.get("board_map").get(new_pos, {"type": "wild_green", "label": "Wild", "meta": {}})
    state.add_log(room, f"🎲 {player['name']} ทอยได้ {move_msg} → ช่อง {new_pos} ({tile['label']})")

    _handle_tile(room, pid, player, tile, socketio, room_id)


def _handle_tile(room, pid, player, tile, socketio, room_id):
    others_on_tile = [
        opid for opid, op in room["players"].items()
        if opid != pid and op["position"] == player["position"]
    ]

    if others_on_tile:
        opponent_pid = others_on_tile[0]
        opponent = room["players"][opponent_pid]
        if player.get("pokemon") and opponent.get("pokemon"):
            pending_data = {
                "tile": tile,
                "opponent_pid": opponent_pid,
                "opponent_name": opponent["name"],
            }
            room["pending"] = {"type": "tile_with_pvp", "pid": pid, "data": pending_data}
            _broadcast(socketio, room_id, room)
            socketio.emit("action_required", {
                "type": "tile_with_pvp", "pid": pid, "data": pending_data,
            }, room=room_id)
            return

    _process_tile(room, pid, player, tile, socketio, room_id)


ZONE_ATK_RANGE = {
    "wild_green":  (0, 2),
    "wild_blue":   (3, 5),
    "wild_purple": (6, 7),
    "wild_red":    (8, 9),
}


def _process_tile(room, pid, player, tile, socketio, room_id):
    t = tile.get("type", "wild")

    if t.startswith("wild"):
        pokemon_pool = loader.get("pokemon")
        atk_lo, atk_hi = ZONE_ATK_RANGE.get(t, (0, 9))
        zone_pool = [p for p in pokemon_pool if atk_lo <= p.get("atk", 0) <= atk_hi]
        chosen = dict(random.choice(zone_pool or pokemon_pool))
        room["pending"] = {"type": "wild", "pid": pid, "data": {"pokemon": chosen, "zone": t}}
        state.add_log(room, f"🌿 พบ {chosen['name']}! (ATK {chosen['atk']}, catch_rate {chosen['catch_rate']})")
        _broadcast(socketio, room_id, room)
        socketio.emit("wild_encounter", {
            "pid": pid,
            "player_name": player["name"],
            "pokemon": chosen,
        }, room=room_id)
        socketio.emit("action_required", {"type": "wild", "data": {"pokemon": chosen}, "pid": pid}, room=room_id)

    elif t == "gym":
        gym_id = tile.get("meta", {}).get("gym_id")
        gym = loader.get("gym_map").get(gym_id)
        if not gym:
            state.advance_turn(room)
            _broadcast(socketio, room_id, room)
            return
        already_beaten = gym["badge"] in player["badges"]
        room["pending"] = {"type": "gym", "pid": pid, "data": {"gym": gym, "already_beaten": already_beaten}}
        state.add_log(room, f"🏟 {player['name']} เจอยิม {gym['name']} (ATK {gym['atk']})")
        _broadcast(socketio, room_id, room)
        socketio.emit("action_required", {
            "type": "gym", "data": {"gym": gym, "already_beaten": already_beaten}, "pid": pid
        }, room=room_id)

    elif t == "rocket":
        lo, hi = tile.get("meta", {}).get("grunt_atk_range", [3, 8])
        grunt_atk = random.randint(lo, hi)
        grunt_pokemon = random.choice(ROCKET_POKEMON)
        room["pending"] = {"type": "rocket", "pid": pid, "data": {
            "grunt_atk": grunt_atk,
            "grunt_pokemon": grunt_pokemon,
        }}
        state.add_log(room, f"🚀 {player['name']} เจอ Rocket Grunt (ATK {grunt_atk})")
        _broadcast(socketio, room_id, room)
        socketio.emit("action_required", {"type": "rocket", "data": {
            "grunt_atk": grunt_atk, "grunt_pokemon": grunt_pokemon,
        }, "pid": pid}, room=room_id)

    elif t == "event":
        events = loader.get("events")
        ev = random.choice(events)
        if ev.get("money_delta"):
            player["money"] = max(0, player["money"] + ev["money_delta"])
        if ev.get("skip_turns"):
            player["skip_turns"] += ev["skip_turns"]
        if ev.get("teleport") is not None:
            player["position"] = ev["teleport"]
        state.add_log(room, f"🃏 {player['name']}: {ev['text']}")
        room["pending"] = {"type": "event_display", "pid": pid, "data": {"event": ev, "player_name": player["name"]}}
        _broadcast(socketio, room_id, room)
        socketio.emit("event_card", {"pid": pid, "player_name": player["name"], "event": ev}, room=room_id)

    elif t == "center":
        healed = player["fainted"][:]
        player["pokemon"].extend(healed)
        player["fainted"] = []
        for pk in player["pokemon"]:
            battle.restore_hp(pk)
        if healed:
            names = ", ".join(p["name"] for p in healed)
            state.add_log(room, f"💊 {player['name']} ฟื้น {names} (HP เต็ม!)")
        else:
            state.add_log(room, f"💊 {player['name']} แวะ Pokémon Center (HP เต็ม!)")
        room["pending"] = {"type": "center_shop", "pid": pid, "data": {}}
        _broadcast(socketio, room_id, room)
        socketio.emit("action_required", {"type": "center_shop", "pid": pid, "data": {}}, room=room_id)

    else:
        state.advance_turn(room)
        _broadcast(socketio, room_id, room)


# ── Shop ─────────────────────────────────────────────────────────

_SHOP_PRICES = {
    "poke_ball": 2, "great_ball": 5, "ultra_ball": 8,
    "potion": 5, "super_potion": 8, "revive": 12, "rare_candy": 10, "moon_stone": 15,
    "elixir": 10, "dire_hit": 8, "x_attack": 6, "x_defend": 6, "guard_spec": 7,
    "speed_boots": 6, "escape_rope": 4,
}

_ITEM_NAMES = {
    "poke_ball": "Poké Ball", "great_ball": "Great Ball", "ultra_ball": "Ultra Ball",
    "potion": "Potion", "super_potion": "Super Potion", "revive": "Revive",
    "rare_candy": "Rare Candy", "moon_stone": "Moon Stone", "elixir": "Elixir",
    "nugget": "Nugget", "dire_hit": "Dire Hit",
    "x_attack": "X Attack", "x_defend": "X Defend", "guard_spec": "Guard Spec.",
    "speed_boots": "Speed Boots", "escape_rope": "Escape Rope",
}


def _try_evolve(pk, force=False):
    evo_map = loader.get("evo_map")
    evo = evo_map.get(pk["id"])
    if not evo:
        return None
    if not force and pk["atk"] < evo["at_atk"]:
        return None
    pokemon_map = loader.get("pokemon_map")
    evolved = pokemon_map.get(evo["into"])
    if not evolved:
        return None
    pk["id"]             = evolved["id"]
    pk["name"]           = evolved["name"]
    pk["sprite_id"]      = evolved["sprite_id"]
    pk["type"]           = evolved["type"]
    pk["research_value"] = evolved["research_value"]
    pk["catch_rate"]     = evolved["catch_rate"]
    pk["max_hp"]         = battle.pokemon_max_hp(pk["atk"])
    if pk.get("hp") is not None:
        pk["hp"] = min(pk["hp"], pk["max_hp"])
    return pk["name"]


def _handle_shop_buy(room, player, data, socketio, room_id):
    item = data.get("item")
    price = _SHOP_PRICES.get(item, 0)
    if not price:
        return
    if player["money"] < price:
        state.add_log(room, f"❌ {player['name']} เงินไม่พอ! (ต้องการ {price}💰)")
        _broadcast(socketio, room_id, room)
        return
    player["money"] -= price

    if item == "rare_candy":
        player["items"].append(item)
        state.add_log(room, f"🍬 {player['name']} ซื้อ Rare Candy → เก็บในกระเป๋า")
    else:
        player["items"].append(item)
        state.add_log(room, f"🛒 {player['name']} ซื้อ {_ITEM_NAMES.get(item, item)}")
    _broadcast(socketio, room_id, room)


def _handle_use_item(room, player, data, socketio, room_id):
    item_id = data.get("item")
    if item_id not in player["items"]:
        state.add_log(room, f"❌ {player['name']} ไม่มี {_ITEM_NAMES.get(item_id, item_id)}!")
        _broadcast(socketio, room_id, room)
        return

    if item_id in ("potion", "medicine", "super_potion"):
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if pk:
            player["items"].remove(item_id)
            battle.restore_hp(pk)
            label = _ITEM_NAMES.get(item_id, item_id)
            state.add_log(room, f"💊 {player['name']} ใช้ {label} → {pk['name']} HP {pk['hp']}/{pk['max_hp']}")

    elif item_id == "revive":
        pokemon_id = data.get("pokemon_id")
        fainted = player.get("fainted", [])
        pk = _find_pokemon(fainted, pokemon_id)
        if pk:
            player["items"].remove(item_id)
            fainted.remove(pk)
            pk["hp"] = max(1, pk.get("max_hp", battle.pokemon_max_hp(pk.get("atk", 1))) // 2)
            player["pokemon"].append(pk)
            state.add_log(room, f"✨ {player['name']} ฟื้น {pk['name']} (HP {pk['hp']}/{pk['max_hp']})")

    elif item_id == "moon_stone":
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if pk:
            player["items"].remove(item_id)
            old_name = pk["name"]
            old_sprite_id = pk["sprite_id"]
            evolved_into = _try_evolve(pk, force=True)
            if evolved_into:
                state.add_log(room, f"🌙🎉 {player['name']} {old_name} → {pk['name']} วิวัฒนาการด้วย Moon Stone!")
                socketio.emit("pokemon_evolved", {
                    "player_name": player["name"],
                    "old_name": old_name,
                    "old_sprite_id": old_sprite_id,
                    "new_name": pk["name"],
                    "new_sprite_id": pk["sprite_id"],
                }, room=room_id)
            else:
                player["items"].append(item_id)
                state.add_log(room, f"🌙 {player['name']} ใช้ Moon Stone → {pk['name']} ยังวิวัฒนาการไม่ได้!")

    elif item_id == "rare_candy":
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if pk:
            player["items"].remove(item_id)
            old_name = pk["name"]
            old_sprite_id = pk["sprite_id"]
            old_atk = pk["atk"]
            pk["atk"] += 1
            pk["max_hp"] = battle.pokemon_max_hp(pk["atk"])
            evolved_into = _try_evolve(pk, force=True)
            if evolved_into:
                state.add_log(room, f"🍬🎉 {player['name']} {old_name} → {pk['name']} วิวัฒนาการ! ATK {old_atk}→{pk['atk']}")
                socketio.emit("pokemon_evolved", {
                    "player_name": player["name"],
                    "old_name": old_name,
                    "old_sprite_id": old_sprite_id,
                    "new_name": pk["name"],
                    "new_sprite_id": pk["sprite_id"],
                }, room=room_id)
            else:
                state.add_log(room, f"🍬 {player['name']} Rare Candy → {pk['name']} ATK {old_atk}→{pk['atk']}!")

    elif item_id == "speed_boots":
        player["items"].remove(item_id)
        player["bonus_steps"] = player.get("bonus_steps", 0) + 1
        state.add_log(room, f"👟 {player['name']} ใช้ Speed Boots → +1 ช่องเดินเทิร์นนี้!")

    elif item_id == "x_attack":
        player["items"].remove(item_id)
        player["battle_atk_boost"] = player.get("battle_atk_boost", 0) + 3
        state.add_log(room, f"⚡ {player['name']} ใช้ X Attack → +3 ATK ต่อสู้ครั้งนี้!")

    elif item_id == "dire_hit":
        player["items"].remove(item_id)
        player["battle_atk_boost"] = player.get("battle_atk_boost", 0) + 5
        state.add_log(room, f"🎯 {player['name']} ใช้ Dire Hit → +5 ATK ต่อสู้ครั้งนี้!")

    elif item_id == "x_defend":
        player["items"].remove(item_id)
        player["battle_def_boost"] = player.get("battle_def_boost", 0) + 2
        state.add_log(room, f"🛡 {player['name']} ใช้ X Defend → ลดดาเมจ -2 ต่อสู้ครั้งนี้!")

    elif item_id == "guard_spec":
        player["items"].remove(item_id)
        player["faint_shield"] = True
        state.add_log(room, f"🔰 {player['name']} ใช้ Guard Spec. → โปเกมอนจะไม่ Faint รอบนี้!")

    elif item_id == "nugget":
        player["items"].remove(item_id)
        player["money"] += 15
        state.add_log(room, f"💰 {player['name']} ขาย Nugget ได้ +15 เงิน!")

    elif item_id == "elixir":
        player["items"].remove(item_id)
        heal = 5
        healed = []
        for pk in player["pokemon"]:
            old_hp = pk.get("hp", pk.get("max_hp", 1))
            if old_hp < pk.get("max_hp", 1):
                pk["hp"] = min(old_hp + heal, pk["max_hp"])
                healed.append(pk["name"])
        msg = f"ฟื้น: {', '.join(healed)}" if healed else "HP เต็มแล้วทุกตัว"
        state.add_log(room, f"🫙 {player['name']} ใช้ Elixir → {msg}")

    elif item_id == "escape_rope":
        player["items"].remove(item_id)
        board_map = loader.get("board_map")
        centers = [tid for tid, t in board_map.items() if t.get("type") == "center"]
        if centers:
            current = player["position"]
            nearest = min(centers, key=lambda c: min((c - current) % 40, (current - c) % 40))
            player["position"] = nearest
            state.add_log(room, f"🪢 {player['name']} ใช้ Escape Rope → วาร์ปไปช่อง {nearest}!")

    _broadcast(socketio, room_id, room)


# ── Class ability handler ─────────────────────────────────────────

def _handle_class_ability(room, player, data, socketio, room_id):
    cls = loader.get("class_map").get(player["class_id"], {})
    active = cls.get("ability_active", {})
    ability_id = active.get("id", "")

    charges = player.get("ability_charges", 0)
    if charges <= 0:
        state.add_log(room, f"❌ {player['name']} ใช้ความสามารถหมดแล้ว!")
        _broadcast(socketio, room_id, room)
        return

    def spend():
        player["ability_charges"] = charges - 1

    if ability_id == "power_up":
        spend()
        player["battle_atk_boost"] = player.get("battle_atk_boost", 0) + 4
        state.add_log(room, f"💪 {player['name']} เพาเวอร์อัป → +4 ATK ต่อสู้ครั้งนี้!")

    elif ability_id == "black_market":
        item_limit = cls.get("item_limit", 4)
        if len(player["items"]) >= item_limit:
            state.add_log(room, f"❌ {player['name']} ถุงเต็มแล้ว!")
            _broadcast(socketio, room_id, room)
            return
        item = _weighted_choice(_TURN_ITEM_POOL)
        player["items"].append(item)
        spend()
        state.add_log(room, f"🌑 {player['name']} ซื้อจากตลาดมืด → ได้ {_ITEM_NAMES.get(item, item)}!")

    elif ability_id == "gene_boost":
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if not pk:
            return
        old_atk = pk["atk"]
        pk["atk"] += 2
        pk["max_hp"] = battle.pokemon_max_hp(pk["atk"])
        evolved_into = _try_evolve(pk, force=False)
        spend()
        if evolved_into:
            state.add_log(room, f"🧬 {player['name']} เสริมยีน → {pk['name']} วิวัฒนาการ! ATK {old_atk}→{pk['atk']}")
        else:
            state.add_log(room, f"🧬 {player['name']} เสริมยีน {pk['name']} → ATK {old_atk}→{pk['atk']}!")

    elif ability_id == "scavenge":
        item_limit = cls.get("item_limit", 4)
        if len(player["items"]) >= item_limit:
            state.add_log(room, f"❌ {player['name']} ถุงเต็มแล้ว!")
            _broadcast(socketio, room_id, room)
            return
        item = _weighted_choice(_TURN_ITEM_POOL)
        player["items"].append(item)
        spend()
        state.add_log(room, f"🔍 {player['name']} ค้นหาพบ {_ITEM_NAMES.get(item, item)}!")

    elif ability_id == "intensive_training":
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if not pk:
            return
        old_atk = pk["atk"]
        pk["atk"] += 1
        pk["max_hp"] = battle.pokemon_max_hp(pk["atk"])
        evolved_into = _try_evolve(pk, force=False)
        spend()
        if evolved_into:
            state.add_log(room, f"🏋 {player['name']} ฝึก → {pk['name']} วิวัฒนาการ! ATK {old_atk}→{pk['atk']}")
        else:
            state.add_log(room, f"🏋 {player['name']} ฝึก {pk['name']} → ATK {old_atk}→{pk['atk']}!")

    elif ability_id == "double_march":
        player["bonus_steps"] = player.get("bonus_steps", 0) + 2
        spend()
        state.add_log(room, f"🥾 {player['name']} เดินเร็ว → +2 ช่องเทิร์นนี้!")

    elif ability_id == "lucky_cast":
        item_limit = cls.get("item_limit", 4)
        if len(player["items"]) >= item_limit:
            state.add_log(room, f"❌ {player['name']} ถุงเต็มแล้ว!")
            _broadcast(socketio, room_id, room)
            return
        player["items"].append("poke_ball")
        spend()
        state.add_log(room, f"🎣 {player['name']} ทอดแห → ได้ Poké Ball!")

    elif ability_id == "fighting_spirit":
        player["battle_atk_boost"] = player.get("battle_atk_boost", 0) + 5
        spend()
        state.add_log(room, f"🥊 {player['name']} สู้เต็มกำลัง → +5 ATK ต่อสู้ครั้งนี้!")

    elif ability_id in ("high_roller", "lucky_girl"):
        player["reroll_next_dice"] = True
        spend()
        emoji = "🎲" if ability_id == "high_roller" else "🌸"
        state.add_log(room, f"{emoji} {player['name']} → ทอยเต๋า 2 ครั้ง เลือกสูงกว่าเทิร์นนี้!")

    elif ability_id == "dividend":
        poke_count = len(player["pokemon"])
        amount = 5 * poke_count
        player["money"] += amount
        spend()
        state.add_log(room, f"💰 {player['name']} รับเงินปันผล {amount} (5×{poke_count} โปเกมอน)!")

    elif ability_id == "free_catch":
        player["free_catch"] = True
        spend()
        state.add_log(room, f"🕸 {player['name']} ขว้างตาข่าย → จับครั้งต่อไปไม่ต้องใช้บอล!")

    elif ability_id == "first_aid":
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if not pk:
            return
        old_hp = pk.get("hp", pk["max_hp"])
        battle.restore_hp(pk)
        spend()
        state.add_log(room, f"💉 {player['name']} ปฐมพยาบาล {pk['name']} HP {old_hp}→{pk['hp']}/{pk['max_hp']}!")

    elif ability_id == "hatch_egg":
        max_pokemon = 6 + loader.get("class_map").get(player["class_id"], {}).get("ability_params", {}).get("bonus", 0)
        if len(player["pokemon"]) >= max_pokemon:
            state.add_log(room, f"❌ {player['name']} ทีมเต็มแล้ว!")
            _broadcast(socketio, room_id, room)
            return
        low_pk_list = [p for p in loader.get("pokemon") if p.get("atk", 0) <= 3]
        pk_tpl = dict(random.choice(low_pk_list or loader.get("pokemon")))
        battle.init_pokemon_hp(pk_tpl)
        player["pokemon"].append(pk_tpl)
        spend()
        state.add_log(room, f"🥚 {player['name']} ฟักไข่ → ได้ {pk_tpl['name']} (ATK {pk_tpl['atk']})!")

    elif ability_id == "first_responder":
        active_pk = player.get("pokemon", [])
        if not active_pk:
            state.add_log(room, f"❌ {player['name']} ไม่มีโปเกมอนในทีม!")
            _broadcast(socketio, room_id, room)
            return
        lowest = min(active_pk, key=lambda p: p.get("hp", p["max_hp"]) / p["max_hp"])
        old_hp = lowest.get("hp", lowest["max_hp"])
        battle.restore_hp(lowest)
        spend()
        state.add_log(room, f"🚨 {player['name']} ผู้ตอบสนอง → {lowest['name']} HP {old_hp}→{lowest['hp']}/{lowest['max_hp']}!")

    elif ability_id == "sprint":
        player["bonus_steps"] = player.get("bonus_steps", 0) + 3
        spend()
        state.add_log(room, f"🏊 {player['name']} สปรินต์ → +3 ช่องเทิร์นนี้!")

    _broadcast(socketio, room_id, room)


# ── Action routing ────────────────────────────────────────────────

def handle_action(room, pid, action, data, socketio, room_id):
    pending = room.get("pending", {})
    ptype = pending.get("type")
    player = room["players"].get(pid)
    if not player:
        return

    # use_item works outside battle when it's the player's active/pending turn
    if action == "use_item":
        if ptype not in ("battle_ongoing", "pvp_defender_selecting"):
            is_my_turn = (not ptype) and state.current_pid(room) == pid
            is_my_pending = bool(ptype) and pending.get("pid") == pid
            if is_my_turn or is_my_pending:
                _handle_use_item(room, player, data, socketio, room_id)
        return

    # class ability usable any time outside battle
    if action == "use_class_ability":
        if ptype not in ("battle_ongoing",):
            _handle_class_ability(room, player, data, socketio, room_id)
        return

    # battle_ongoing allows both attacker AND defender to act
    if ptype == "battle_ongoing":
        d = pending.get("data", {})
        if pid not in (d.get("pid_atk"), d.get("pid_def")):
            return
        if action == "battle_roll_round":
            _handle_battle_round_roll(room, pid, player, pending, socketio, room_id)
            return
        elif action == "battle_surrender":
            _handle_battle_surrender(room, pid, player, pending, socketio, room_id)
            return
        return

    if pending.get("pid") != pid:
        return

    if ptype == "wild":
        pokemon = pending["data"]["pokemon"]
        if action == "catch":
            item = data.get("item", "poke_ball")
            # free_catch: bug_catcher ability allows catching without consuming a ball
            if player.pop("free_catch", False):
                item = "poke_ball"  # treat as poke_ball, no inventory check
            elif item not in player["items"]:
                state.add_log(room, f"❌ {player['name']} ไม่มี {item}!")
                _broadcast(socketio, room_id, room)
                return
            socketio.emit("catch_rolling", {
                "pid": pid,
                "player_name": player["name"],
                "pokemon_name": pokemon.get("name", "?"),
            }, room=room_id)
            catch_bonus = {"poke_ball": 0, "great_ball": 2, "ultra_ball": 4}.get(item, 0)
            # catch_bonus ability (ace_trainer)
            cls = loader.get("class_map").get(player["class_id"], {})
            if cls.get("ability_id") == "catch_bonus":
                catch_bonus += cls.get("ability_params", {}).get("bonus", 0)
            dice = random.randint(1, 6)
            roll = dice + catch_bonus
            catch_rate = pokemon.get("catch_rate", 3)
            # easy_catch ability (bug_catcher)
            if cls.get("ability_id") == "easy_catch":
                catch_rate = max(1, catch_rate - cls.get("ability_params", {}).get("minus", 1))
            socketio.emit("catch_result", {
                "pid": pid,
                "player_name": player["name"],
                "pokemon_name": pokemon.get("name", "?"),
                "dice": dice,
                "bonus": catch_bonus,
                "total": roll,
                "catch_rate": catch_rate,
                "success": roll >= catch_rate,
            }, room=room_id)
            if roll >= catch_rate:
                # pokemon cap: base 6, +bonus for extra_pokemon ability (breeder)
                pokemon_cap = 6
                if cls.get("ability_id") == "extra_pokemon":
                    pokemon_cap += cls.get("ability_params", {}).get("bonus", 0)
                if len(player["pokemon"]) < pokemon_cap:
                    pk = dict(pokemon)
                    battle.init_pokemon_hp(pk)
                    player["pokemon"].append(pk)
                    if item in player["items"]:
                        player["items"].remove(item)
                    state.add_log(room, f"✅ {player['name']} จับ {pokemon['name']} สำเร็จ! (🎲{dice}+{catch_bonus}={roll} ≥ {catch_rate})")
                else:
                    state.add_log(room, f"❌ {player['name']} โปเกมอนเต็ม!")
            else:
                if item in player["items"]:
                    player["items"].remove(item)
                # ball_refund ability (fisherman)
                if cls.get("ability_id") == "ball_refund":
                    rate = cls.get("ability_params", {}).get("rate", 0.5)
                    if random.random() < rate:
                        player["items"].append(item)
                        state.add_log(room, f"🎣 {player['name']} ได้ {_ITEM_NAMES.get(item, item)} คืน!")
                state.add_log(room, f"❌ {player['name']} จับ {pokemon['name']} ไม่สำเร็จ (🎲{dice}+{catch_bonus}={roll} < {catch_rate})")

        else:
            state.add_log(room, f"🏃 {player['name']} ผ่าน {pokemon['name']}")

        state.advance_turn(room)
        _broadcast(socketio, room_id, room)

    elif ptype in ("gym", "rocket"):
        if action == "fight":
            pokemon_id = data.get("pokemon_id")
            selected = _find_pokemon(player["pokemon"], pokemon_id)

            if ptype == "gym":
                gym = pending["data"]["gym"]
                enemy_info = {
                    "name": gym["name"],
                    "pokemon_name": gym.get("pokemon_name", gym["name"]),
                    "sprite_id": gym.get("pokemon_sprite_id"),
                    "atk": gym["atk"],
                    "pokemon_type": gym.get("pokemon_type", "Normal"),
                }
            else:
                grunt_atk = pending["data"]["grunt_atk"]
                grunt_pokemon = pending["data"].get("grunt_pokemon", {})
                enemy_info = {
                    "name": "Rocket Grunt",
                    "pokemon_name": grunt_pokemon.get("name", "Grunt Pokemon"),
                    "sprite_id": grunt_pokemon.get("sprite_id"),
                    "atk": grunt_atk,
                    "pokemon_type": grunt_pokemon.get("type", "Normal"),
                }

            enemy_hp = battle.pokemon_max_hp(enemy_info["atk"])
            room["pending"] = {
                "type": "battle_ongoing",
                "pid": pid,
                "data": {
                    "original_type": ptype,
                    "pid_atk": pid,
                    "pid_def": None,
                    "atk_pokemon_id": selected["id"] if selected else None,
                    "def_pokemon_id": None,
                    "enemy_info": enemy_info,
                    "enemy_hp": enemy_hp,
                    "enemy_max_hp": enemy_hp,
                    "gym_data": pending["data"] if ptype == "gym" else None,
                    "rocket_data": pending["data"] if ptype == "rocket" else None,
                    "round_rolls": {},
                }
            }
            socketio.emit("battle_start", {
                "attacker_pid": pid,
                "defender_pid": None,
                "attacker_name": player["name"],
                "attacker_pokemon": {
                    "name": selected["name"] if selected else "ไม่มีโปเกมอน",
                    "sprite_id": selected.get("sprite_id") if selected else None,
                    "atk": selected["atk"] if selected else 0,
                    "hp": selected.get("hp") if selected else None,
                    "max_hp": selected.get("max_hp") if selected else None,
                },
                "defender": {**enemy_info, "hp": enemy_hp, "max_hp": enemy_hp},
            }, room=room_id)
            _broadcast(socketio, room_id, room)
            return

        else:
            state.add_log(room, f"🏃 {player['name']} หนีจากการต่อสู้")

    elif ptype == "tile_with_pvp":
        if action == "fight_player":
            _start_pvp_battle(room, pid, player, pending["data"], data, socketio, room_id)
            return
        elif action == "use_tile":
            tile = pending["data"]["tile"]
            _process_tile(room, pid, player, tile, socketio, room_id)
            return
        else:
            state.add_log(room, f"🏃 {player['name']} เลือกไม่สู้")

    elif ptype == "pvp_defender_selecting":
        if action == "pvp_pokemon_select":
            _handle_pvp_defender_select(room, pid, player, pending["data"], data, socketio, room_id)
            return
        else:
            state.add_log(room, f"🏃 {player['name']} หนีจาก PvP!")

    elif ptype == "turn_start_item":
        if action == "continue":
            room["pending"] = {}
            _broadcast(socketio, room_id, room)
        return  # don't advance turn — player still needs to roll

    elif ptype == "event_display":
        pass  # effects applied on tile land; just advance turn

    elif ptype == "pass_go":
        pass  # player continues from start, just advance turn

    elif ptype == "center_shop":
        if action == "shop_buy":
            _handle_shop_buy(room, player, data, socketio, room_id)
            return
        # shop_done → fall through to advance_turn

    state.advance_turn(room)
    _broadcast(socketio, room_id, room)


# ── PvP initiation ────────────────────────────────────────────────

def _start_pvp_battle(room, pid, player, pvp_data, action_data, socketio, room_id):
    opponent_pid = pvp_data["opponent_pid"]

    pokemon_id = action_data.get("pokemon_id")
    selected = _find_pokemon(player["pokemon"], pokemon_id)

    room["pending"] = {
        "type": "pvp_defender_selecting",
        "pid": opponent_pid,
        "data": {
            "attacker_pid": pid,
            "attacker_name": player["name"],
            "attacker_selected_pokemon_id": selected["id"] if selected else None,
            "attacker_pokemon": {
                "name": selected["name"] if selected else "ไม่มีโปเกมอน",
                "sprite_id": selected.get("sprite_id") if selected else None,
                "atk": selected["atk"] if selected else 0,
                "hp": selected.get("hp") if selected else None,
                "max_hp": selected.get("max_hp") if selected else None,
            },
            "opponent_pid": opponent_pid,
        },
    }
    _broadcast(socketio, room_id, room)
    socketio.emit("action_required", {
        "type": "pvp_select",
        "pid": opponent_pid,
        "data": {"attacker_name": player["name"]},
    }, room=room_id)


def _handle_pvp_defender_select(room, defender_pid, defender, pending_data, action_data, socketio, room_id):
    attacker_pid = pending_data["attacker_pid"]
    attacker = room["players"][attacker_pid]

    def_pokemon_id = action_data.get("pokemon_id")
    def_selected = _find_pokemon(defender["pokemon"], def_pokemon_id)

    atk_selected_id = pending_data["attacker_selected_pokemon_id"]

    enemy_info = {
        "name": defender["name"],
        "pokemon_name": def_selected["name"] if def_selected else "ไม่มีโปเกมอน",
        "sprite_id": def_selected.get("sprite_id") if def_selected else None,
        "atk": def_selected["atk"] if def_selected else 0,
        "hp": def_selected.get("hp") if def_selected else None,
        "max_hp": def_selected.get("max_hp") if def_selected else None,
        "is_pvp": True,
    }

    room["pending"] = {
        "type": "battle_ongoing",
        "pid": attacker_pid,
        "data": {
            "original_type": "pvp",
            "pid_atk": attacker_pid,
            "pid_def": defender_pid,
            "atk_pokemon_id": atk_selected_id,
            "def_pokemon_id": def_selected["id"] if def_selected else None,
            "enemy_info": enemy_info,
            "gym_data": None,
            "rocket_data": None,
            "round_rolls": {},
        },
    }

    socketio.emit("battle_start", {
        "attacker_pid": attacker_pid,
        "defender_pid": defender_pid,
        "attacker_name": attacker["name"],
        "attacker_pokemon": pending_data["attacker_pokemon"],
        "defender": enemy_info,
    }, room=room_id)
    _broadcast(socketio, room_id, room)


# ── Multi-round battle ────────────────────────────────────────────

def _find_pokemon(pokemon_list, pokemon_id):
    if not pokemon_id:
        return None
    for p in pokemon_list:
        if p.get("id") == pokemon_id:
            return p
    return None


def _handle_battle_round_roll(room, pid, player, pending, socketio, room_id):
    d = pending["data"]
    if pid in d["round_rolls"]:
        return

    dice = random.randint(1, 6)
    d["round_rolls"][pid] = dice

    original_type = d["original_type"]

    if original_type == "pvp":
        pid_atk = d["pid_atk"]
        pid_def = d["pid_def"]
        socketio.emit("dice_rolling", {"pid": pid, "name": player["name"]}, room=room_id)
        _broadcast(socketio, room_id, room)
        if pid_atk not in d["round_rolls"] or pid_def not in d["round_rolls"]:
            return
        atk_dice = d["round_rolls"][pid_atk]
        def_dice = d["round_rolls"][pid_def]

        # Peek at ATK values to detect a total tie (boosts not consumed yet)
        atk_player = room["players"][pid_atk]
        def_player = room["players"][pid_def]
        atk_pk = _find_pokemon(atk_player["pokemon"], d["atk_pokemon_id"])
        def_pk = _find_pokemon(def_player["pokemon"], d["def_pokemon_id"])
        p_val = (atk_pk["atk"] if atk_pk else 0) + atk_player.get("battle_atk_boost", 0)
        e_val = (def_pk["atk"] if def_pk else 0) + def_player.get("battle_atk_boost", 0)

        if atk_dice + p_val == def_dice + e_val:
            # Tie — reset and notify both to reroll
            d["round_rolls"] = {}
            socketio.emit("battle_round_result", {
                "tie": True,
                "pid_atk": pid_atk, "pid_def": pid_def,
                "atk_dice": atk_dice, "def_dice": def_dice,
                "atk_total": atk_dice + p_val, "def_total": def_dice + e_val,
                "damage_msg": "เสมอ! ทอยใหม่...",
                "battle_over": False,
                "attacker_wins_round": False,
                "atk_pk_hp": atk_pk.get("hp") if atk_pk else None,
                "atk_pk_max_hp": atk_pk.get("max_hp") if atk_pk else None,
                "def_pk_hp": def_pk.get("hp") if def_pk else None,
                "def_pk_max_hp": def_pk.get("max_hp") if def_pk else None,
                "faint_who": None, "winner_pid": None, "loser_pid": None,
            }, room=room_id)
            return

        _resolve_pvp_round(room, pending, atk_dice, def_dice, socketio, room_id)
    else:
        # NPC: player rolls, auto-roll enemy; reroll server-side on tie
        e_atk_val = d["enemy_info"]["atk"]
        atk_pk_npc = _find_pokemon(room["players"][d["pid_atk"]]["pokemon"], d["atk_pokemon_id"])
        p_atk_val_npc = (atk_pk_npc["atk"] if atk_pk_npc else 0) + room["players"][d["pid_atk"]].get("battle_atk_boost", 0)

        enemy_dice = random.randint(1, 6)
        for _ in range(5):
            if (dice + p_atk_val_npc) != (enemy_dice + e_atk_val):
                break
            enemy_dice = random.randint(1, 6)

        _resolve_npc_round(room, pending, dice, enemy_dice, socketio, room_id)


def _resolve_pvp_round(room, pending, atk_dice, def_dice, socketio, room_id):
    d = pending["data"]
    pid_atk = d["pid_atk"]
    pid_def = d["pid_def"]
    attacker = room["players"][pid_atk]
    defender = room["players"][pid_def]

    atk_pk = _find_pokemon(attacker["pokemon"], d["atk_pokemon_id"])
    def_pk = _find_pokemon(defender["pokemon"], d["def_pokemon_id"])

    p_atk_val  = (atk_pk["atk"] if atk_pk else 0) + attacker.pop("battle_atk_boost", 0)
    e_atk_val  = (def_pk["atk"] if def_pk else 0) + defender.pop("battle_atk_boost", 0)
    p_def_boost = attacker.pop("battle_def_boost", 0)
    e_def_boost = defender.pop("battle_def_boost", 0)
    p_faint_shield = attacker.pop("faint_shield", False)
    e_faint_shield = defender.pop("faint_shield", False)

    atk_total = atk_dice
    def_total = def_dice
    # Initiative decided by dice roll only; ATK only affects damage
    first_is_atk = atk_total >= def_total  # ties go to attacker

    atk_type = atk_pk.get("type", "Normal") if atk_pk else "Normal"
    def_type = def_pk.get("type", "Normal") if def_pk else "Normal"
    p_adv = battle.get_type_advantage(atk_type, def_type)
    e_adv = battle.get_type_advantage(def_type, atk_type)
    p_damage = max(1, max(1, p_atk_val + p_adv) - e_def_boost)
    e_damage = max(1, max(1, e_atk_val + e_adv) - p_def_boost)

    msgs = []
    battle_over = False
    winner_pid = None
    loser_pid = None
    faint_who = None

    def deal_to_def():
        nonlocal battle_over, winner_pid, loser_pid, faint_who
        if not def_pk:
            return
        adv = " (type adv!)" if p_adv else ""
        shield = " 🛡" if e_def_boost else ""
        cur = def_pk.get("hp", def_pk.get("max_hp", battle.HP_BASE))
        def_pk["hp"] = max(0, cur - p_damage)
        msgs.append(f"{atk_pk['name'] if atk_pk else '?'} -{p_damage}{adv}{shield}HP → {def_pk['name']} {def_pk['hp']}/{def_pk.get('max_hp', '?')}")
        if def_pk["hp"] <= 0:
            if e_faint_shield:
                def_pk["hp"] = 1
                msgs.append(f"🔰 Guard Spec! {def_pk['name']} ยืนหยัดด้วย 1 HP!")
            else:
                defender["pokemon"] = [p for p in defender["pokemon"] if p.get("id") != def_pk["id"]]
                defender["fainted"].append(def_pk)
                faint_who = def_pk["name"]
                battle_over = True
                winner_pid = pid_atk
                loser_pid = pid_def


    def deal_to_atk():
        nonlocal battle_over, winner_pid, loser_pid, faint_who
        if not atk_pk:
            return
        adv = " (type adv!)" if e_adv else ""
        shield = " 🛡" if p_def_boost else ""
        cur = atk_pk.get("hp", atk_pk.get("max_hp", battle.HP_BASE))
        atk_pk["hp"] = max(0, cur - e_damage)
        msgs.append(f"{def_pk['name'] if def_pk else '?'} -{e_damage}{adv}{shield}HP → {atk_pk['name']} {atk_pk['hp']}/{atk_pk.get('max_hp', '?')}")
        if atk_pk["hp"] <= 0:
            if p_faint_shield:
                atk_pk["hp"] = 1
                msgs.append(f"🔰 Guard Spec! {atk_pk['name']} ยืนหยัดด้วย 1 HP!")
            else:
                attacker["pokemon"] = [p for p in attacker["pokemon"] if p.get("id") != atk_pk["id"]]
                attacker["fainted"].append(atk_pk)
                faint_who = atk_pk["name"]
                battle_over = True
                winner_pid = pid_def
                loser_pid = pid_atk

    # Higher roll deals damage; loser does NOT counter-attack
    if first_is_atk:
        deal_to_def()
    else:
        deal_to_atk()

    damage_msg = " / ".join(msgs)
    round_log = (f"⚔️ PvP: {attacker['name']} [{atk_total}🎲{atk_dice}] "
                 f"vs {defender['name']} [{def_total}🎲{def_dice}]"
                 f"{' — ' + damage_msg if damage_msg else ''}"
                 f"{' 💀 ' + faint_who + ' faint!' if faint_who else ''}")
    state.add_log(room, round_log)

    socketio.emit("battle_rolling", {
        "attacker_name": attacker["name"],
        "defender_name": defender["name"],
    }, room=room_id)

    event_data = {
        "pid_atk": pid_atk, "pid_def": pid_def,
        "atk_dice": atk_dice, "def_dice": def_dice,
        "atk_total": atk_total, "def_total": def_total,
        "attacker_wins_round": first_is_atk,
        "atk_pk_hp": atk_pk.get("hp") if atk_pk else None,
        "atk_pk_max_hp": atk_pk.get("max_hp") if atk_pk else None,
        "def_pk_hp": def_pk.get("hp") if def_pk else None,
        "def_pk_max_hp": def_pk.get("max_hp") if def_pk else None,
        "damage_msg": damage_msg,
        "faint_who": faint_who,
        "battle_over": battle_over,
        "winner_pid": winner_pid,
        "loser_pid": loser_pid,
        "tie": False,
    }

    if battle_over:
        winner = room["players"][winner_pid]
        loser = room["players"][loser_pid]

        winner_cls = loader.get("class_map").get(winner.get("class_id", ""), {})
        if winner_cls.get("ability_id") == "steal_on_win" and loser["pokemon"]:
            stolen_pk = loser["pokemon"].pop(0)
            winner["pokemon"].append(stolen_pk)
            state.add_log(room, f"🚀 {winner['name']} ขโมย {stolen_pk['name']} จาก {loser['name']}!")
            event_data["stolen_pokemon"] = stolen_pk["name"]

        stolen = min(random.randint(5, 10), loser["money"])
        winner["money"] += stolen
        loser["money"] -= stolen
        event_data["money_delta"] = stolen
        state.add_log(room, f"💰 {winner['name']} ปล้น {stolen} เงิน!")
        room["pending"] = {}
        state.advance_turn(room)
    else:
        d["round_rolls"] = {}

    socketio.emit("battle_round_result", event_data, room=room_id)
    _broadcast(socketio, room_id, room)


def _resolve_npc_round(room, pending, p_dice, e_dice, socketio, room_id):
    d = pending["data"]
    pid_atk = d["pid_atk"]
    attacker = room["players"][pid_atk]
    original_type = d["original_type"]
    enemy_info = d["enemy_info"]

    atk_pk = _find_pokemon(attacker["pokemon"], d["atk_pokemon_id"])
    pk_name = atk_pk["name"] if atk_pk else "ไม่มีโปเกมอน"

    p_atk_val = atk_pk["atk"] if atk_pk else 0
    e_atk_val = enemy_info["atk"]

    cls = loader.get("class_map").get(attacker.get("class_id", ""), {})
    ability_id = cls.get("ability_id")
    if ability_id == "atk_bonus":
        p_atk_val += cls.get("ability_params", {}).get("bonus", 0)
    if ability_id == "bare_hands_atk" and not atk_pk:
        p_atk_val = cls.get("ability_params", {}).get("atk", 4)
    p_atk_val += attacker.pop("battle_atk_boost", 0)

    # Ensure enemy HP exists (fallback for legacy/debug battles)
    if "enemy_hp" not in d:
        d["enemy_hp"] = battle.pokemon_max_hp(e_atk_val)
        d["enemy_max_hp"] = d["enemy_hp"]

    # Type advantage
    player_type = atk_pk.get("type", "Normal") if atk_pk else "Normal"
    enemy_type = enemy_info.get("pokemon_type", "Normal")
    p_adv = battle.get_type_advantage(player_type, enemy_type)
    e_adv = battle.get_type_advantage(enemy_type, player_type)
    p_damage = max(1, p_atk_val + p_adv)
    e_damage = max(1, e_atk_val + e_adv)

    p_total = p_dice
    e_total = e_dice
    player_goes_first = p_total >= e_total  # dice only; ties go to player

    msgs = []
    battle_over = False
    player_won_battle = None
    faint_who = None

    def hit_enemy():
        nonlocal battle_over, player_won_battle
        adv = " (type adv!)" if p_adv else ""
        d["enemy_hp"] = max(0, d["enemy_hp"] - p_damage)
        msgs.append(f"{pk_name} -{p_damage}{adv}HP → Enemy {d['enemy_hp']}/{d['enemy_max_hp']}")
        if d["enemy_hp"] <= 0:
            battle_over = True
            player_won_battle = True

    def hit_player():
        nonlocal battle_over, player_won_battle, faint_who
        if not atk_pk:
            return
        def_boost = attacker.pop("battle_def_boost", 0)
        actual_damage = max(1, e_damage - def_boost)
        adv = " (type adv!)" if e_adv else ""
        shield = " 🛡" if def_boost else ""
        cur = atk_pk.get("hp", atk_pk.get("max_hp", battle.HP_BASE))
        atk_pk["hp"] = max(0, cur - actual_damage)
        msgs.append(f"Enemy -{actual_damage}{adv}{shield}HP → {pk_name} {atk_pk['hp']}/{atk_pk.get('max_hp', '?')}")
        if atk_pk["hp"] <= 0:
            if attacker.pop("faint_shield", False):
                atk_pk["hp"] = 1
                msgs.append(f"🔰 Guard Spec! {pk_name} ยืนหยัดด้วย 1 HP!")
            else:
                attacker["pokemon"] = [p for p in attacker["pokemon"] if p.get("id") != atk_pk["id"]]
                attacker["fainted"].append(atk_pk)
                faint_who = pk_name
                battle_over = True
                player_won_battle = False

    # Higher roll deals damage; loser does NOT counter-attack
    # Higher roll deals damage; loser does NOT counter-attack
    if player_goes_first:
        hit_enemy()
    else:
        hit_player()

    damage_msg = " / ".join(msgs)

    reward_log = ""
    if battle_over and player_won_battle:
        if original_type == "gym":
            gym_data = d["gym_data"]
            gym = gym_data["gym"]
            already = gym_data.get("already_beaten", False)
            badge = gym["badge"] if not already else None
            reward = gym["reward"] if not already else gym["reward"] // 2
            if not already and ability_id == "double_gym_reward":
                reward *= 2
            if badge and badge not in attacker["badges"]:
                attacker["badges"].append(badge)
                attacker["money"] += reward
                reward_log = f"🏅 ได้ {badge}! +{reward}"
            elif reward > 0:
                attacker["money"] += reward
                reward_log = f"+{reward} เงิน"
        elif original_type == "rocket":
            stolen = random.randint(3, 8)
            if ability_id == "rocket_bounty":
                stolen += cls.get("ability_params", {}).get("bonus", 0)
            attacker["money"] += stolen
            reward_log = f"ปล้นได้ {stolen} เงิน!"

    round_log = (f"⚔️ {attacker['name']} [{p_total}🎲{p_dice}] vs {enemy_info['name']} [{e_total}🎲{e_dice}]"
                 f"{' — ' + damage_msg if damage_msg else ''}"
                 f"{' 💀 ' + faint_who + ' faint!' if faint_who else ''}"
                 f"{' ' + reward_log if reward_log else ''}")
    state.add_log(room, round_log)

    socketio.emit("battle_rolling", {
        "attacker_name": attacker["name"],
        "defender_name": enemy_info["name"],
    }, room=room_id)

    event_data = {
        "pid_atk": pid_atk, "pid_def": None,
        "atk_dice": p_dice, "def_dice": e_dice,
        "atk_total": p_total, "def_total": e_total,
        "attacker_wins_round": player_goes_first,
        "atk_pk_hp": atk_pk.get("hp") if atk_pk else None,
        "atk_pk_max_hp": atk_pk.get("max_hp") if atk_pk else None,
        "def_pk_hp": d["enemy_hp"],
        "def_pk_max_hp": d["enemy_max_hp"],
        "damage_msg": damage_msg,
        "faint_who": faint_who,
        "battle_over": battle_over,
        "winner_pid": pid_atk if player_won_battle else None,
        "loser_pid": None if player_won_battle else pid_atk,
        "tie": False,
    }

    if battle_over:
        room["pending"] = {}
        state.advance_turn(room)
    else:
        d["round_rolls"] = {}

    socketio.emit("battle_round_result", event_data, room=room_id)
    _broadcast(socketio, room_id, room)


def _handle_battle_surrender(room, pid, player, pending, socketio, room_id):
    d = pending["data"]
    pid_atk = d["pid_atk"]
    pid_def = d.get("pid_def")
    original_type = d["original_type"]

    if original_type == "pvp":
        winner_pid = pid_def if pid == pid_atk else pid_atk
        loser_pid = pid
        winner = room["players"].get(winner_pid)
        loser = room["players"].get(loser_pid)
        stolen = 0
        if winner and loser:
            stolen = min(random.randint(5, 10), loser["money"])
            winner["money"] += stolen
            loser["money"] -= stolen
        state.add_log(room, f"🏳 {player['name']} ยอมแพ้! 💰 -{stolen} เงิน")
        socketio.emit("battle_round_result", {
            "battle_over": True,
            "winner_pid": winner_pid,
            "loser_pid": loser_pid,
            "damage_msg": f"🏳 {player['name']} ยอมแพ้!",
            "faint_who": None,
            "money_delta": stolen,
            "pid_atk": pid_atk, "pid_def": pid_def,
            "atk_dice": 0, "def_dice": 0,
            "atk_total": 0, "def_total": 0,
            "attacker_wins_round": pid != pid_atk,
        }, room=room_id)
    else:
        state.add_log(room, f"🏳 {player['name']} ยอมแพ้จาก {d['enemy_info']['name']}!")
        socketio.emit("battle_round_result", {
            "battle_over": True,
            "winner_pid": None,
            "loser_pid": pid,
            "damage_msg": f"🏳 ยอมแพ้!",
            "faint_who": None,
            "pid_atk": pid_atk, "pid_def": None,
            "atk_dice": 0, "def_dice": 0,
            "atk_total": 0, "def_total": 0,
            "attacker_wins_round": False,
        }, room=room_id)

    room["pending"] = {}
    state.advance_turn(room)
    _broadcast(socketio, room_id, room)


# ── Research & game end ───────────────────────────────────────────

def handle_research(room, pid, pokemon_ids, socketio, room_id):
    player = room["players"].get(pid)
    if not player:
        return

    cls = loader.get("class_map").get(player["class_id"], {})
    can_anywhere = cls.get("ability_id") == "research_anywhere"

    if not can_anywhere:
        tile_id = player["position"]
        tile = loader.get("board_map").get(tile_id, {})
        if tile.get("type") not in ("center",):
            state.add_log(room, f"❌ {player['name']} ต้องอยู่ที่ Pokémon Center เพื่อวิจัย")
            _broadcast(socketio, room_id, room)
            return

    total = 0
    researched = []
    for pid_id in pokemon_ids:
        for i, p in enumerate(player["pokemon"]):
            if p["id"] == pid_id:
                researched.append(player["pokemon"].pop(i))
                total += p.get("research_value", 0)
                break

    if researched:
        player["money"] += total
        names = ", ".join(p["name"] for p in researched)
        state.add_log(room, f"🔬 {player['name']} วิจัย {names} +{total} เงิน")
    _broadcast(socketio, room_id, room)


def end_game(room, socketio, room_id):
    room["phase"] = "ended"
    for player in room["players"].values():
        all_pkmn = player["pokemon"] + player["fainted"]
        player["money"] += sum(p.get("research_value", 0) for p in all_pkmn)

    ranking = sorted(
        [{"pid": pid, "name": p["name"], "money": p["money"]}
         for pid, p in room["players"].items()],
        key=lambda x: -x["money"],
    )
    state.add_log(room, "🏆 เกมจบแล้ว! คำนวณคะแนนสุดท้าย...")
    socketio.emit("game_over", {"ranking": ranking}, room=room_id)
    _broadcast(socketio, room_id, room)


def _broadcast(socketio, room_id, room):
    socketio.emit("game_update", {
        "phase": room["phase"],
        "players": room["players"],
        "turn_order": room["turn_order"],
        "current_turn": room["current_turn"],
        "log": room["log"][-20:],
        "log_total": len(room["log"]),
        "pending": room.get("pending", {}),
    }, room=room_id)
