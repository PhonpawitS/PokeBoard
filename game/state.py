import time
import uuid
import config

rooms = {}


def create_room(pid, name, class_id):
    room_id = str(uuid.uuid4())[:6].upper()
    rooms[room_id] = {
        "phase": "lobby",
        "host": pid,
        "players": {pid: _new_player(name, class_id)},
        "turn_order": [],
        "current_turn": 0,
        "log": [],
        "pending": {},
    }
    return room_id


def join_room(room_id, pid, name, class_id):
    room = rooms.get(room_id)
    if not room:
        return False, "Room not found"
    if room["phase"] != "lobby":
        return False, "Game already started"
    if len(room["players"]) >= config.MAX_PLAYERS:
        return False, "Room is full"
    room["players"][pid] = _new_player(name, class_id)
    return True, "OK"


def _new_player(name, class_id):
    from game.loader import get
    cls = get("class_map").get(class_id) or get("classes")[0]
    return {
        "name": name,
        "class_id": class_id,
        "position": 0,
        "money": config.STARTING_MONEY,
        "pokemon": [],
        "fainted": [],
        "badges": [],
        "items": ["poke_ball"] * 6 + list(cls.get("starter_items", [])),
        "skip_turns": 0,
    }


def add_log(room, msg):
    room["log"].append({"time": int(time.time()), "msg": msg})
    if len(room["log"]) > 60:
        room["log"] = room["log"][-60:]


def get_room(room_id):
    return rooms.get(room_id)


def current_pid(room):
    order = room["turn_order"]
    if not order:
        return None
    return order[room["current_turn"] % len(order)]


def advance_turn(room):
    room["current_turn"] = (room["current_turn"] + 1) % len(room["turn_order"])
    room["pending"] = {}
