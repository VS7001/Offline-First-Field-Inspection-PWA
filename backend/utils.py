from functools import wraps
from flask import request, jsonify
import jwt

from config import Config
from models import User


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization")

        if not auth:
            return jsonify({"message": "Token missing"}), 401

        parts = auth.split(" ")

        if len(parts) != 2 or parts[0] != "Bearer":
            return jsonify({"message": "Invalid token format"}), 401

        token = parts[1]

        try:
            data = jwt.decode(token, Config.SECRET_KEY, algorithms=["HS256"])
            current_user = User.query.get(data["user_id"])
        except:
            return jsonify({"message": "Invalid or expired token"}), 401

        return f(current_user, *args, **kwargs)

    return decorated

def role_required(role):
    def wrapper(f):
        @wraps(f)
        def decorated(current_user, *args, **kwargs):
            if current_user.role != role:
                return jsonify({"message": "Access denied"}), 403
            return f(current_user, *args, **kwargs)
        return decorated
    return wrapper
