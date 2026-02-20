import uuid
from flask import Blueprint, request, jsonify
from extensions import db
from models import User, Inspection, AuditLog
from utils import token_required, role_required
from datetime import datetime

inspection_bp = Blueprint("inspection", __name__)

# ===============================
# INSPECTOR SUBMITS INSPECTION
# ===============================
@inspection_bp.route("/submit-inspection", methods=["POST"])
@token_required
@role_required("inspector")
def submit_inspection(current_user):

    data = request.get_json()

    # ----------------------------
    # ✅ REQUIRED FIELDS (HIGH PRIORITY)
    # ----------------------------
    required_fields = [
        "inspection_type",
        "scheme_name",
        "work_order_number",
        "inspection_purpose",
        "state",
        "district",
        "site_name",
        "work_progress_percentage",
        "quality_assessment",
        "compliance_status",
        "photo",
        "latitude",
        "longitude"
    ]

    for field in required_fields:
        if not data.get(field):
            return jsonify({"message": f"{field} is required"}), 400

    # ----------------------------
    # ✅ AUTO GENERATE UNIQUE CODE
    # ----------------------------
    inspection_code = f"INS-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"

    # ----------------------------
    # ✅ DEFAULT OPTIONAL FIELDS TO "N/A"
    # ----------------------------
    def safe_value(value):
        return value if value else "N/A"

    inspection = Inspection(
        inspection_code=inspection_code,

        inspection_type=data.get("inspection_type"),
        scheme_name=data.get("scheme_name"),
        work_order_number=data.get("work_order_number"),
        inspection_purpose=data.get("inspection_purpose"),

        state=data.get("state"),
        district=data.get("district"),
        taluka=safe_value(data.get("taluka")),
        village=safe_value(data.get("village")),
        site_name=data.get("site_name"),
        landmark=safe_value(data.get("landmark")),

        latitude=str(data.get("latitude")),
        longitude=str(data.get("longitude")),
        location_accuracy=data.get("location_accuracy", "High"),
        geo_tag_verified=True,

        work_progress_percentage=int(data.get("work_progress_percentage")),
        quality_assessment=data.get("quality_assessment"),
        compliance_status=data.get("compliance_status"),
        safety_status=safe_value(data.get("safety_status")),
        material_status=safe_value(data.get("material_status")),
        labour_status=safe_value(data.get("labour_status")),
        issues_observed=safe_value(data.get("issues_observed")),

        photo=data.get("photo"),
        photo_timestamp=datetime.utcnow(),

        inspector_declaration=True,
        record_locked=True,

        inspection_start_time=datetime.utcnow(),
        inspection_end_time=datetime.utcnow(),

        inspector_id=current_user.id
    )

    db.session.add(inspection)
    db.session.commit()

    return jsonify({
        "message": "Inspection submitted successfully",
        "inspection_code": inspection_code
    }), 201


# ===============================
# INSPECTOR VIEWS OWN INSPECTIONS
# ===============================
@inspection_bp.route("/my-inspections", methods=["GET"])
@token_required
@role_required("inspector")
def my_inspections(current_user):

    inspections = Inspection.query.filter_by(
        inspector_id=current_user.id
    ).order_by(Inspection.created_at.desc()).all()

    return jsonify([
        {
            "id": i.id,
            "inspection_code": i.inspection_code,
            "inspection_type": i.inspection_type,
            "scheme_name": i.scheme_name,
            "work_order_number": i.work_order_number,
            "inspection_purpose": i.inspection_purpose,

            "state": i.state,
            "district": i.district,
            "taluka": i.taluka,
            "village": i.village,
            "site_name": i.site_name,
            "landmark": i.landmark,

            "latitude": i.latitude,
            "longitude": i.longitude,

            "work_progress_percentage": i.work_progress_percentage,
            "quality_assessment": i.quality_assessment,
            "compliance_status": i.compliance_status,
            "issues_observed": i.issues_observed,

            "photo": i.photo,
            "status": i.status,
            "created_at": i.created_at
        }
        for i in inspections
    ])



# ===============================
# ADMIN VIEWS ALL INSPECTIONS
# ===============================
@inspection_bp.route("/all-inspections", methods=["GET"])
@token_required
@role_required("admin")
def all_inspections(current_user):

    inspections = Inspection.query.order_by(Inspection.created_at.desc()).all()

    return jsonify([
    {
        "id": i.id,
        "inspection_code": i.inspection_code,
        "inspection_type": i.inspection_type,
        "scheme_name": i.scheme_name,
        "work_order_number": i.work_order_number,
        "inspection_purpose": i.inspection_purpose,

        "state": i.state,
        "district": i.district,
        "taluka": i.taluka,
        "village": i.village,
        "site_name": i.site_name,
        "landmark": i.landmark,

        "work_progress_percentage": i.work_progress_percentage,
        "quality_assessment": i.quality_assessment,
        "compliance_status": i.compliance_status,
        "safety_status": i.safety_status,
        "material_status": i.material_status,
        "labour_status": i.labour_status,
        "issues_observed": i.issues_observed,

        "status": i.status,
        "latitude": i.latitude,
        "longitude": i.longitude,
        "photo": i.photo,
        "created_at": i.created_at,
        "inspector": i.inspector.username
    }
    for i in inspections
])


# ===============================
# ADMIN AUDIT
# ===============================
@inspection_bp.route("/audit/<int:id>", methods=["PUT"])
@token_required
@role_required("admin")
def audit_inspection(current_user, id):

    inspection = Inspection.query.get_or_404(id)
    data = request.get_json()

    action = data.get("action")
    reason = data.get("reason")

    if action not in ["Approved", "Rejected"]:
        return jsonify({"message": "Invalid action"}), 400

    # ✅ First time decision (Pending → Approved/Rejected)
    if inspection.status == "Pending":
        inspection.status = action
        inspection.approved_by = current_user.id
        inspection.approved_at = datetime.utcnow()

        log = AuditLog(
            inspection_id=id,
            modified_by=current_user.id,
            action=action,
            reason="First level approval"
        )

    else:
        # ✅ Editing previous decision → reason required
        if not reason:
            return jsonify({"message": "Reason required for changing decision"}), 400

        inspection.status = action
        inspection.approved_by = current_user.id
        inspection.approved_at = datetime.utcnow()

        log = AuditLog(
            inspection_id=id,
            modified_by=current_user.id,
            action=action,
            reason=reason
        )

    db.session.add(log)
    db.session.commit()

    return jsonify({"message": f"Inspection {action} successfully"})
