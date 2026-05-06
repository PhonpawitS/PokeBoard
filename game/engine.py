import random
from game import loader, state, battle

ROCKET_POKEMON = [
    {"name": "Drowzee",  "sprite_id": 96},
    {"name": "Koffing",  "sprite_id": 109},
    {"name": "Ekans",    "sprite_id": 23},
    {"name": "Zubat",    "sprite_id": 41},
    {"name": "Rattata",  "sprite_id": 19},
    {"name": "Meowth",   "sprite_id": 52},
    {"name": "Grimer",   "sprite_id": 88},
    {"name": "Rhyhorn",  "sprite_id": 111},
]


# ── Turn-start item pool ──────────────────────────────────────────
_TURN_ITEM_POOL = [
    ("poke_ball",   40),
    ("great_ball",  20),
    ("potion",      20),
    ("x_attack",    10),
    ("speed_boots",  7),
    ("escape_rope",  3),
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
    "potion": 5, "rare_candy": 10,
    "speed_boots": 6, "x_attack": 6, "escape_rope": 4,
}

_ITEM_NAMES = {
    "poke_ball": "Poké Ball", "great_ball": "Great Ball", "ultra_ball": "Ultra Ball",
    "potion": "Potion", "rare_candy": "Rare Candy",
    "speed_boots": "Speed Boots", "x_attack": "X Attack", "escape_rope": "Escape Rope",
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

    if item_id in ("potion", "medicine"):
        pokemon_id = data.get("pokemon_id")
        pk = _find_pokemon(player["pokemon"], pokemon_id)
        if pk:
            player["items"].remove(item_id)
            battle.restore_hp(pk)
            state.add_log(room, f"💊 {player['name']} ใช้ Potion → {pk['name']} HP {pk['hp']}/{pk['max_hp']}")

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
            if item not in player["items"]:
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
                }
            else:
                grunt_atk = pending["data"]["grunt_atk"]
                grunt_pokemon = pending["data"].get("grunt_pokemon", {})
                enemy_info = {
                    "name": "Rocket Grunt",
                    "pokemon_name": grunt_pokemon.get("name", "Grunt Pokemon"),
                    "sprite_id": grunt_pokemon.get("sprite_id"),
                    "atk": grunt_atk,
                }

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
                "defender": enemy_info,
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
    # Don't let same player roll twice in one round
    if pid in d["round_rolls"]:
        return

    dice = random.randint(1, 6)
    d["round_rolls"][pid] = dice

    original_type = d["original_type"]

    if original_type == "pvp":
        pid_atk = d["pid_atk"]
        pid_def = d["pid_def"]
        # Notify room someone rolled (shows waiting state)
        socketio.emit("dice_rolling", {"pid": pid, "name": player["name"]}, room=room_id)
        _broadcast(socketio, room_id, room)
        # Wait for both to roll
        if pid_atk not in d["round_rolls"] or pid_def not in d["round_rolls"]:
            return
        atk_dice = d["round_rolls"][pid_atk]
        def_dice = d["round_rolls"][pid_def]
        _resolve_pvp_round(room, pending, atk_dice, def_dice, socketio, room_id)
    else:
        # NPC: auto-roll enemy, resolve immediately
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

    p_atk_val = (atk_pk["atk"] if atk_pk else 0) + attacker.pop("battle_atk_boost", 0)
    e_atk_val = (def_pk["atk"] if def_pk else 0) + defender.pop("battle_atk_boost", 0)

    atk_total = atk_dice + p_atk_val
    def_total = def_dice + e_atk_val
    attacker_wins_round = atk_total >= def_total

    damage_msg = ""
    faint_who = None
    battle_over = False
    winner_pid = None
    loser_pid = None

    if attacker_wins_round:
        if def_pk and p_atk_val > 0:
            cur = def_pk.get("hp", def_pk.get("max_hp", battle.HP_BASE))
            def_pk["hp"] = max(0, cur - p_atk_val)
            damage_msg = f"🗡 {def_pk['name']} -{p_atk_val} HP → {def_pk['hp']}/{def_pk.get('max_hp', '?')}"
            if def_pk["hp"] <= 0:
                defender["pokemon"] = [p for p in defender["pokemon"] if p.get("id") != def_pk["id"]]
                defender["fainted"].append(def_pk)
                faint_who = def_pk["name"]
                battle_over = True
                winner_pid = pid_atk
                loser_pid = pid_def
    else:
        if atk_pk and e_atk_val > 0:
            cur = atk_pk.get("hp", atk_pk.get("max_hp", battle.HP_BASE))
            atk_pk["hp"] = max(0, cur - e_atk_val)
            damage_msg = f"🗡 {atk_pk['name']} -{e_atk_val} HP → {atk_pk['hp']}/{atk_pk.get('max_hp', '?')}"
            if atk_pk["hp"] <= 0:
                attacker["pokemon"] = [p for p in attacker["pokemon"] if p.get("id") != atk_pk["id"]]
                attacker["fainted"].append(atk_pk)
                faint_who = atk_pk["name"]
                battle_over = True
                winner_pid = pid_def
                loser_pid = pid_atk

    round_log = (f"⚔️ Round PvP: {attacker['name']} [{atk_total}🎲{atk_dice}] "
                 f"vs {defender['name']} [{def_total}🎲{def_dice}]")
    if damage_msg:
        round_log += f" — {damage_msg}"
    if faint_who:
        round_log += f" 💀 {faint_who} faint!"
    state.add_log(room, round_log)

    socketio.emit("battle_rolling", {
        "attacker_name": attacker["name"],
        "defender_name": defender["name"],
    }, room=room_id)

    event_data = {
        "pid_atk": pid_atk, "pid_def": pid_def,
        "atk_dice": atk_dice, "def_dice": def_dice,
        "atk_total": atk_total, "def_total": def_total,
        "attacker_wins_round": attacker_wins_round,
        "atk_pk_hp": atk_pk.get("hp") if atk_pk else None,
        "atk_pk_max_hp": atk_pk.get("max_hp") if atk_pk else None,
        "def_pk_hp": def_pk.get("hp") if def_pk else None,
        "def_pk_max_hp": def_pk.get("max_hp") if def_pk else None,
        "damage_msg": damage_msg,
        "faint_who": faint_who,
        "battle_over": battle_over,
        "winner_pid": winner_pid,
        "loser_pid": loser_pid,
    }

    if battle_over:
        winner = room["players"][winner_pid]
        loser = room["players"][loser_pid]
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

    # Apply class ability bonus
    cls = loader.get("class_map").get(attacker.get("class_id", ""), {})
    ability_id = cls.get("ability_id")
    if ability_id == "atk_bonus":
        p_atk_val += cls.get("ability_params", {}).get("bonus", 0)
    # bare_hands_atk: blackbelt fights with ATK N when no pokemon
    if ability_id == "bare_hands_atk" and not atk_pk:
        p_atk_val = cls.get("ability_params", {}).get("atk", 4)

    # Apply X Attack boost (consumed on first round)
    p_atk_val += attacker.pop("battle_atk_boost", 0)

    p_total = p_dice + p_atk_val
    e_total = e_dice + e_atk_val
    player_wins_round = p_total >= e_total

    round_status = "ชนะ" if player_wins_round else "แพ้"
    round_log = (f"⚔️ {attacker['name']} ({pk_name}) {round_status}! "
                 f"(ผู้เล่น {p_total} 🎲{p_dice} vs ศัตรู {e_total} 🎲{e_dice})")

    battle_over = False
    player_won_battle = None
    faint_who = None
    damage_msg = ""

    if player_wins_round:
        battle_over = True
        player_won_battle = True
        damage_msg = "✅ ชนะ!"

        if original_type == "gym":
            gym_data = d["gym_data"]
            gym = gym_data["gym"]
            already = gym_data.get("already_beaten", False)
            badge = gym["badge"] if not already else None
            reward = gym["reward"] if not already else gym["reward"] // 2
            # double_gym_reward: gambler doubles first-win reward
            if not already and ability_id == "double_gym_reward":
                reward *= 2
            if badge and badge not in attacker["badges"]:
                attacker["badges"].append(badge)
                attacker["money"] += reward
                round_log += f" 🏅 ได้ {badge}! +{reward}"
            elif reward > 0:
                attacker["money"] += reward
                round_log += f" +{reward} เงิน"
        elif original_type == "rocket":
            stolen = random.randint(3, 8)
            # rocket_bounty: officer gets extra money
            if ability_id == "rocket_bounty":
                stolen += cls.get("ability_params", {}).get("bonus", 0)
            attacker["money"] += stolen
            round_log += f" ปล้นได้ {stolen} เงิน!"
    else:
        if atk_pk:
            cur = atk_pk.get("hp", atk_pk.get("max_hp", battle.HP_BASE))
            atk_pk["hp"] = max(0, cur - e_atk_val)
            damage_msg = f"🗡 {pk_name} -{e_atk_val} HP → {atk_pk['hp']}/{atk_pk.get('max_hp', '?')}"
            round_log += f" — {damage_msg}"
            if atk_pk["hp"] <= 0:
                attacker["pokemon"] = [p for p in attacker["pokemon"] if p.get("id") != atk_pk["id"]]
                attacker["fainted"].append(atk_pk)
                faint_who = pk_name
                round_log += f" 💀 faint!"
                damage_msg = f"💀 {pk_name} faint!"
                battle_over = True
                player_won_battle = False

    state.add_log(room, round_log)

    socketio.emit("battle_rolling", {
        "attacker_name": attacker["name"],
        "defender_name": enemy_info["name"],
    }, room=room_id)

    event_data = {
        "pid_atk": pid_atk, "pid_def": None,
        "atk_dice": p_dice, "def_dice": e_dice,
        "atk_total": p_total, "def_total": e_total,
        "attacker_wins_round": player_wins_round,
        "atk_pk_hp": atk_pk.get("hp") if atk_pk else None,
        "atk_pk_max_hp": atk_pk.get("max_hp") if atk_pk else None,
        "def_pk_hp": None, "def_pk_max_hp": None,
        "damage_msg": damage_msg,
        "faint_who": faint_who,
        "battle_over": battle_over,
        "winner_pid": pid_atk if player_won_battle else None,
        "loser_pid": None if player_won_battle else pid_atk,
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
