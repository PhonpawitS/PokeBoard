import os

SECRET_KEY = os.environ.get("SECRET_KEY", "pokeboard-dev-secret-key")
DEBUG = os.environ.get("DEBUG", "true").lower() == "true"
MAX_PLAYERS = 4
STARTING_MONEY = 20
