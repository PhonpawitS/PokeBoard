import random

HP_BASE = 6
HP_PER_ATK = 3


def pokemon_max_hp(atk):
    return HP_BASE + atk * HP_PER_ATK


def init_pokemon_hp(pk):
    if "max_hp" not in pk:
        pk["max_hp"] = pokemon_max_hp(pk.get("atk", 0))
    if "hp" not in pk:
        pk["hp"] = pk["max_hp"]
    return pk


def restore_hp(pk):
    pk["hp"] = pk.get("max_hp", pokemon_max_hp(pk.get("atk", 0)))
    return pk


def resolve_battle(attacker, defender_atk, selected_pokemon=None,
                   ability_fn=None, ability_params=None, context=None):
    p_atk = selected_pokemon["atk"] if selected_pokemon else 0

    if ability_fn and ability_params is not None:
        bonus = ability_fn(attacker, ability_params, context or {})
        if isinstance(bonus, int):
            p_atk += bonus

    p_dice = random.randint(1, 6)
    p_total = p_atk + p_dice

    e_dice = random.randint(1, 6)
    e_total = defender_atk + e_dice

    # Whoever rolls higher attacks first
    won = p_total >= e_total   # ties go to player (attacker)

    fainted = None
    p_hp_after = selected_pokemon.get("hp") if selected_pokemon else None
    p_max_hp = selected_pokemon.get("max_hp") if selected_pokemon else None

    if not won and selected_pokemon:
        cur_hp = selected_pokemon.get("hp", selected_pokemon.get("max_hp", HP_BASE))
        new_hp = max(0, cur_hp - defender_atk)
        selected_pokemon["hp"] = new_hp
        p_hp_after = new_hp
        if new_hp <= 0:
            for i, p in enumerate(attacker["pokemon"]):
                if p.get("id") == selected_pokemon.get("id"):
                    fainted = attacker["pokemon"].pop(i)
                    break
            else:
                if attacker["pokemon"]:
                    fainted = attacker["pokemon"].pop(0)
            if fainted:
                attacker["fainted"].append(fainted)

    return {
        "won": won,
        "p_total": p_total, "e_total": e_total,
        "p_dice": p_dice, "e_dice": e_dice,
        "p_hp_after": p_hp_after, "p_max_hp": p_max_hp,
        "fainted": fainted,
    }
