from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime
from extensions import db
from models import User
from config import Config
from utils import token_required, role_required

auth_bp = Blueprint("auth", __name__)


# ================= REGISTER =================
@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json()

    # ---------------------------
    # REQUIRED FIELDS
    # ---------------------------
    required_fields = ["username", "password", "role"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"message": f"{field} is required"}), 400

    # ---------------------------
    # VALID ROLE
    # ---------------------------
    if data.get("role") not in ["inspector", "admin"]:
        return jsonify({"message": "Invalid role"}), 400

    # ---------------------------
    # UNIQUE USERNAME
    # ---------------------------
    if User.query.filter_by(username=data["username"]).first():
        return jsonify({"message": "User already exists"}), 400

    # ---------------------------
    # PASSWORD COMPLEXITY CHECK
    # ---------------------------
    password = data.get("password")

    if len(password) < 8:
        return jsonify({"message": "Password must be at least 8 characters"}), 400
    if not any(c.isupper() for c in password):
        return jsonify({"message": "Password must contain at least 1 uppercase letter"}), 400
    if not any(c.islower() for c in password):
        return jsonify({"message": "Password must contain at least 1 lowercase letter"}), 400
    if not any(c.isdigit() for c in password):
        return jsonify({"message": "Password must contain at least 1 number"}), 400

    # ---------------------------
    # CREATE USER
    # ---------------------------
    user = User(
        username=data["username"],
        password=generate_password_hash(password),
        role=data["role"],

        department=data.get("department"),
        designation=data.get("designation"),
        office_division=data.get("office_division"),
        contact_number=data.get("contact_number"),
        device_id=data.get("device_id")
    )

    db.session.add(user)
    db.session.commit()

    return jsonify({"message": "Registered successfully"}), 201

# ================= LOGIN =================
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()

    user = User.query.filter_by(username=data.get("username")).first()

    if not user or not check_password_hash(user.password, data.get("password")):
        return jsonify({"message": "Invalid credentials"}), 401

    token = jwt.encode(
        {
            "user_id": user.id,
            "role": user.role,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=8)
        },
        Config.SECRET_KEY,
        algorithm="HS256"
    )

    return jsonify({
        "token": token,
        "role": user.role
    })


# ================= TEST PROTECTED ROUTES =================
@auth_bp.route("/inspector-only", methods=["GET"])
@token_required
@role_required("inspector")
def inspector_only(current_user):
    return jsonify({"message": f"Welcome Inspector {current_user.username}"})


@auth_bp.route("/admin-only", methods=["GET"])
@token_required
@role_required("admin")
def admin_only(current_user):
    return jsonify({"message": f"Welcome Admin {current_user.username}"})

# ================= ADMIN VERIFY PASSWORD =================
@auth_bp.route("/verify-admin", methods=["POST"])
@token_required
@role_required("admin")
def verify_admin(current_user):

    data = request.get_json()
    password = data.get("password")

    if not check_password_hash(current_user.password, password):
        return jsonify({"message": "Incorrect password"}), 401

    return jsonify({"message": "Verified successfully"}), 200

@auth_bp.route("/inspector-info", methods=["GET"])
@token_required
@role_required("inspector")
def inspector_info(current_user):
    return jsonify({
        "username": current_user.username,
        "department": current_user.department,
        "designation": current_user.designation,
        "office_division": current_user.office_division,
        "contact_number": current_user.contact_number,
        "device_id": current_user.device_id
    })

@auth_bp.route("/my-profile", methods=["GET"])
@token_required
def my_profile(current_user):
    return jsonify({
        "username": current_user.username,
        "department": current_user.department,
        "designation": current_user.designation,
        "office_division": current_user.office_division,
        "contact_number": current_user.contact_number,
        "device_id": current_user.device_id
    })

@auth_bp.route("/update-profile", methods=["PUT"])
@token_required
def update_profile(current_user):
    data = request.get_json()

    current_user.department = data.get("department")
    current_user.designation = data.get("designation")
    current_user.office_division = data.get("office_division")
    current_user.contact_number = data.get("contact_number")
    current_user.device_id = data.get("device_id")

    db.session.commit()

    return jsonify({"message": "Profile updated successfully"})