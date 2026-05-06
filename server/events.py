from flask_socketio import join_room

from game import engine, loader, state


def register_events(socketio):

    @socketio.on("join_room")
    def on_join(data):
        room_id = (data.get("room_id") or "").upper()
        join_room(room_id)
        room = state.get_room(room_id)
        if room:
            socketio.emit("game_update", _serialize(room), room=room_id)

    @socketio.on("roll")
    def on_roll(data):
        room_id = (data.get("room_id") or "").upper()
        pid = data.get("pid")
        room = state.get_room(room_id)
        if room:
            player = room["players"].get(pid, {})
            socketio.emit("dice_rolling", {
                "pid": pid,
                "name": player.get("name", ""),
            }, room=room_id)
            engine.roll_and_move(room, pid, socketio, room_id)

    @socketio.on("action")
    def on_action(data):
        room_id = (data.get("room_id") or "").upper()
        pid = data.get("pid")
        action = data.get("action")
        action_data = data.get("data") or {}
        room = state.get_room(room_id)
        if room:
            engine.handle_action(room, pid, action, action_data, socketio, room_id)

    @socketio.on("research")
    def on_research(data):
        room_id = (data.get("room_id") or "").upper()
        pid = data.get("pid")
        pokemon_ids = data.get("pokemon_ids") or []
        room = state.get_room(room_id)
        if room:
            engine.handle_research(room, pid, pokemon_ids, socketio, room_id)

    @socketio.on("set_class")
    def on_set_class(data):
        room_id = (data.get("room_id") or "").upper()
        pid = data.get("pid")
        class_id = data.get("class_id", "trainer")
        room = state.get_room(room_id)
        if not room or room["phase"] != "lobby":
            return
        player = room["players"].get(pid)
        if not player:
            return
        cls = loader.get("class_map").get(class_id)
        if not cls:
            return
        player["class_id"] = class_id
        player["items"] = ["poke_ball"] * 6 + list(cls.get("starter_items", []))
        player["trainer_sprite"] = cls.get("trainer_sprite", "")
        socketio.emit("game_update", _serialize(room), room=room_id)

    @socketio.on("end_game")
    def on_end_game(data):
        room_id = (data.get("room_id") or "").upper()
        pid = data.get("pid")
        room = state.get_room(room_id)
        if room and room.get("host") == pid:
            engine.end_game(room, socketio, room_id)


def _serialize(room):
    return {
        "phase": room["phase"],
        "players": room["players"],
        "turn_order": room["turn_order"],
        "current_turn": room["current_turn"],
        "log": room["log"][-20:],
        "log_total": len(room["log"]),
        "pending": room.get("pending", {}),
    }
