from flask import Flask
from flask_socketio import SocketIO

import config
from game.loader import load_all
from server.routes import routes_bp
from server.events import register_events
from server.debug_events import register_debug_events

app = Flask(__name__)
app.config["SECRET_KEY"] = config.SECRET_KEY

socketio = SocketIO(app, async_mode="gevent", cors_allowed_origins="*")

load_all()
app.register_blueprint(routes_bp)
register_events(socketio)
register_debug_events(socketio)  # always on; set DEBUG_DISABLED=true on prod to skip
# (production guard: wrap in `if not os.environ.get("DEBUG_DISABLED"):` when needed)

if __name__ == "__main__":
    socketio.run(app, debug=config.DEBUG, host="0.0.0.0", port=5000)
