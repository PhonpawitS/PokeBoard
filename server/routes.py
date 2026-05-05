import random
import uuid

from flask import Blueprint, jsonify, render_template, request

from game import battle, loader, state

routes_bp = Blueprint("routes", __name__)


@routes_bp.route("/")
def index():
    classes = loader.get("classes")
    items = loader.get("items")
    return render_template("index.html", classes=classes, items=items)


@routes_bp.route("/api/create_room", methods=["POST"])
def create_room():
    data = request.get_json() or {}
    name = (data.get("name") or "Player").strip()[:20]
    class_id = data.get("class_id", "trainer")
    pid = str(uuid.uuid4())[:8]
    room_id = state.create_room(pid, name, class_id)
    return jsonify({"room_id": room_id, "pid": pid})


@routes_bp.route("/api/join", methods=["POST"])
def join():
    data = request.get_json() or {}
    name = (data.get("name") or "Player").strip()[:20]
    class_id = data.get("class_id", "trainer")
    room_id = (data.get("room_id") or "").strip().upper()
    pid = str(uuid.uuid4())[:8]
    ok, msg = state.join_room(room_id, pid, name, class_id)
    if not ok:
        return jsonify({"error": msg}), 400
    return jsonify({"room_id": room_id, "pid": pid})


@routes_bp.route("/api/start", methods=["POST"])
def start_game():
    data = request.get_json() or {}
    room_id = (data.get("room_id") or "").strip().upper()
    pid = data.get("pid")
    room = state.get_room(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    if room["host"] != pid:
        return jsonify({"error": "Only host can start"}), 403
    if len(room["players"]) < 2:
        return jsonify({"error": "Need at least 2 players"}), 400
    if room["phase"] != "lobby":
        return jsonify({"error": "Already started"}), 400
    order = list(room["players"].keys())
    random.shuffle(order)
    room["turn_order"] = order
    room["phase"] = "playing"

    # Give each player their starter pokemon based on chosen class
    pokemon_map = {p["id"]: p for p in loader.get("pokemon")}
    for player in room["players"].values():
        cls = loader.get("class_map").get(player["class_id"], {})
        starter_ids = cls.get("starter_pokemon", [])
        starters = [dict(pokemon_map[sid]) for sid in starter_ids if sid in pokemon_map]
        for pk in starters:
            battle.init_pokemon_hp(pk)
        player["pokemon"] = starters

    return jsonify({"ok": True})


@routes_bp.route("/api/board")
def get_board():
    return jsonify(loader.get("board"))


@routes_bp.route("/api/state/<room_id>")
def get_state(room_id):
    room = state.get_room(room_id.upper())
    if not room:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "phase": room["phase"],
        "players": room["players"],
        "turn_order": room["turn_order"],
        "current_turn": room["current_turn"],
        "log": room["log"][-20:],
        "pending": room.get("pending", {}),
    })
