import json
import os

_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
_data = {}


def load_all():
    for name in ("pokemon", "events", "classes", "gyms", "board", "items"):
        path = os.path.join(_DATA_DIR, f"{name}.json")
        with open(path, encoding="utf-8") as f:
            _data[name] = json.load(f)

    evo_path = os.path.join(_DATA_DIR, "evolutions.json")
    with open(evo_path, encoding="utf-8") as f:
        _data["evo_map"] = json.load(f)

    _data["board_map"]   = {tile["id"]: tile for tile in _data["board"]}
    _data["gym_map"]     = {g["id"]: g for g in _data["gyms"]}
    _data["class_map"]   = {c["id"]: c for c in _data["classes"]}
    _data["pokemon_map"] = {p["id"]: p for p in _data["pokemon"]}
    _data["item_map"]    = {i["id"]: i for i in _data["items"]}


def get(name):
    return _data[name]
