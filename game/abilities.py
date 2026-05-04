ABILITY_REGISTRY = {}


def register(ability_id):
    def decorator(fn):
        ABILITY_REGISTRY[ability_id] = fn
        return fn
    return decorator


@register("atk_bonus")
def atk_bonus(player, params, context):
    return params.get("bonus", 0)


@register("steal_on_win")
def steal_on_win(player, params, context):
    loser = context.get("loser")
    if loser and loser["pokemon"]:
        stolen = loser["pokemon"].pop(0)
        player["pokemon"].append(stolen)
        return f"ขโมย {stolen['name']} มาได้!"
    return None


@register("research_anywhere")
def research_anywhere(player, params, context):
    return True


@register("extra_item_slots")
def extra_item_slots(player, params, context):
    return params.get("limit", 6)
