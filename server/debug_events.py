import random as _random

from game import battle, engine, loader, state


def register_debug_events(socketio):

    @socketio.on("debug_give_money")
    def on_give_money(data):
        room, player = _get(data)
        if not player:
            return
        amount = int(data.get("amount", 50))
        player["money"] += amount
        state.add_log(room, f"[DEBUG] 💰 +{amount} เงิน → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_give_pokemon")
    def on_give_pokemon(data):
        room, player = _get(data)
        if not player:
            return
        pokemon_map = {p["id"]: p for p in loader.get("pokemon")}
        pid_req = data.get("pokemon_id")
        pk = dict(pokemon_map[pid_req]) if pid_req in (pokemon_map or {}) else dict(_random.choice(loader.get("pokemon")))
        battle.init_pokemon_hp(pk)
        player["pokemon"].append(pk)
        state.add_log(room, f"[DEBUG] 🎁 ได้ {pk['name']} (ATK {pk['atk']}) → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_give_item")
    def on_give_item(data):
        room, player = _get(data)
        if not player:
            return
        item = data.get("item", "poke_ball")
        player["items"].append(item)
        state.add_log(room, f"[DEBUG] 🎒 ได้ {item} → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_teleport")
    def on_teleport(data):
        room, player = _get(data)
        if not player:
            return
        pos = int(data.get("position", 0)) % 40
        player["position"] = pos
        tile = loader.get("board_map").get(pos, {})
        state.add_log(room, f"[DEBUG] 🚀 ย้าย {player['name']} → ช่อง {pos} ({tile.get('label', '?')})")
        _broadcast(socketio, data, room)

    @socketio.on("debug_set_turn")
    def on_set_turn(data):
        room, player = _get(data)
        if not player:
            return
        pid = data.get("pid")
        order = room["turn_order"]
        if pid not in order:
            return
        room["current_turn"] = order.index(pid)
        room["pending"] = {}
        state.add_log(room, f"[DEBUG] ⏩ เทิร์น → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_trigger_tile")
    def on_trigger_tile(data):
        room, player = _get(data)
        if not player:
            return
        pid = data.get("pid")
        pos = player["position"]
        tile = loader.get("board_map").get(pos, {"type": "wild_green", "label": "Wild", "meta": {}})
        state.add_log(room, f"[DEBUG] ⚡ trigger tile ช่อง {pos} ({tile.get('label', '?')})")
        engine._process_tile(room, pid, player, tile, socketio, (data.get("room_id") or "").upper())

    @socketio.on("debug_clear_pending")
    def on_clear_pending(data):
        room, _ = _get(data)
        if not room:
            return
        room["pending"] = {}
        state.advance_turn(room)
        state.add_log(room, "[DEBUG] 🗑 ล้าง pending — เดินหน้าเทิร์น")
        _broadcast(socketio, data, room)

    @socketio.on("debug_faint_all")
    def on_faint_all(data):
        # faint all pokemon of a player (to test fainted flow)
        room, player = _get(data)
        if not player:
            return
        fainted = player.pop("pokemon", [])
        player["fainted"] = player.get("fainted", []) + fainted
        player["pokemon"] = []
        state.add_log(room, f"[DEBUG] 💀 faint ทั้งหมด → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_revive_all")
    def on_revive_all(data):
        room, player = _get(data)
        if not player:
            return
        player["pokemon"] = player.get("pokemon", []) + player.get("fainted", [])
        player["fainted"] = []
        state.add_log(room, f"[DEBUG] ✨ ฟื้น → {player['name']}")
        _broadcast(socketio, data, room)

    @socketio.on("debug_force_fight")
    def on_force_fight(data):
        room_id = (data.get("room_id") or "").upper()
        room = state.get_room(room_id)
        if not room:
            return

        pid1 = data.get("pid1")  # attacker
        opp  = data.get("pid2")  # opponent — pid, name, or numeric index

        # Resolve attacker
        if pid1 not in room["players"]:
            return
        player1 = room["players"][pid1]

        # Resolve defender: try pid → name → index
        pid2 = None
        if opp in room["players"]:
            pid2 = opp
        else:
            try:
                idx = int(opp)
                others = [p for p in room["players"] if p != pid1]
                if 0 <= idx < len(others):
                    pid2 = others[idx]
            except (TypeError, ValueError):
                pass
        if pid2 is None:
            # try case-insensitive name match
            for p_id, p in room["players"].items():
                if p["name"].lower() == str(opp).lower():
                    pid2 = p_id
                    break
        if pid2 is None or pid2 == pid1:
            return
        player2 = room["players"][pid2]

        # Ensure both have at least one pokemon
        pokemon_map = {p["id"]: p for p in loader.get("pokemon")}
        for pl in (player1, player2):
            if not pl["pokemon"]:
                pk = dict(pokemon_map.get("pikachu", loader.get("pokemon")[0]))
                battle.init_pokemon_hp(pk)
                pl["pokemon"].append(pk)

        # Pick pokemon with highest ATK for each
        pk1 = max(player1["pokemon"], key=lambda p: p.get("atk", 0))
        pk2 = max(player2["pokemon"], key=lambda p: p.get("atk", 0))

        room["pending"] = {
            "type": "battle_ongoing",
            "pid": pid1,
            "data": {
                "original_type": "pvp",
                "pid_atk": pid1,
                "pid_def": pid2,
                "atk_pokemon_id": pk1["id"],
                "def_pokemon_id": pk2["id"],
                "enemy_info": {
                    "name": player2["name"],
                    "pokemon_name": pk2["name"],
                    "sprite_id": pk2.get("sprite_id"),
                    "atk": pk2["atk"],
                    "hp": pk2.get("hp"),
                    "max_hp": pk2.get("max_hp"),
                    "is_pvp": True,
                },
                "gym_data": None,
                "rocket_data": None,
                "round_rolls": {},
            },
        }

        state.add_log(room, f"[DEBUG] ⚔️ Force fight: {player1['name']} ({pk1['name']}) vs {player2['name']} ({pk2['name']})")

        socketio.emit("battle_start", {
            "attacker_pid": pid1,
            "defender_pid": pid2,
            "attacker_name": player1["name"],
            "attacker_pokemon": {
                "name": pk1["name"],
                "sprite_id": pk1.get("sprite_id"),
                "atk": pk1["atk"],
                "hp": pk1.get("hp"),
                "max_hp": pk1.get("max_hp"),
            },
            "defender": {
                "name": player2["name"],
                "pokemon_name": pk2["name"],
                "sprite_id": pk2.get("sprite_id"),
                "atk": pk2["atk"],
                "hp": pk2.get("hp"),
                "max_hp": pk2.get("max_hp"),
                "is_pvp": True,
            },
        }, room=room_id)
        _broadcast(socketio, data, room)

    @socketio.on("debug_state")
    def on_debug_state(data):
        room_id = (data.get("room_id") or "").upper()
        room = state.get_room(room_id)
        if not room:
            return
        socketio.emit("debug_state_dump", {
            "pending": room.get("pending", {}),
            "current_turn": room["current_turn"],
            "turn_order": room["turn_order"],
            "players": {
                pid: {
                    "name": p["name"],
                    "money": p["money"],
                    "position": p["position"],
                    "class_id": p["class_id"],
                    "pokemon": [f"{pk['name']}(ATK{pk['atk']})" for pk in p["pokemon"]],
                    "fainted": [pk["name"] for pk in p["fainted"]],
                    "items": p["items"],
                    "badges": p["badges"],
                }
                for pid, p in room["players"].items()
            },
        })


def _get(data):
    room_id = (data.get("room_id") or "").upper()
    pid = data.get("pid")
    room = state.get_room(room_id)
    if not room:
        return None, None
    player = room["players"].get(pid)
    return room, player


def _broadcast(socketio, data, room):
    room_id = (data.get("room_id") or "").upper()
    socketio.emit("game_update", {
        "phase": room["phase"],
        "players": room["players"],
        "turn_order": room["turn_order"],
        "current_turn": room["current_turn"],
        "log": room["log"][-20:],
        "log_total": len(room["log"]),
        "pending": room.get("pending", {}),
    }, room=room_id)
