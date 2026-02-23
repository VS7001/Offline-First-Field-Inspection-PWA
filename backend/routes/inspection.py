import uuid
from flask import Blueprint, request, jsonify
from extensions import db
from models import User, Inspection, AuditLog
from utils import token_required, role_required
from datetime import datetime
from dateutil.parser import isoparse

inspection_bp = Blueprint("inspection", __name__)

# ===============================
# INSPECTOR SUBMITS INSPECTION
# ===============================
@inspection_bp.route("/submit-inspection", methods=["POST"])
@token_required
@role_required("inspector")
def submit_inspection(current_user):

    data = request.get_json()

    # -------------------------------
    # RECORD LOCK CHECK
    # -------------------------------
    existing = Inspection.query.filter_by(
        inspector_id=current_user.id,
        work_order_number=data.get("work_order_number")
    ).first()

    # Skip record lock enforcement if offline submission
    if not data.get("offline_submission_time"):  
        if existing and existing.record_locked:
            return jsonify({
                "message": "This inspection is locked and cannot be edited or resubmitted."
            }), 403
    # -------------------------------
    # REQUIRED FIELDS
    # -------------------------------
    required_fields = [
        "inspection_type", "scheme_name", "work_order_number",
        "inspection_purpose", "state", "district", "site_name",
        "work_progress_percentage", "quality_assessment",
        "compliance_status", "photo", "latitude", "longitude"
    ]

    for field in required_fields:
        if not data.get(field):
            return jsonify({"message": f"{field} is required"}), 400

    # -------------------------------
    # UNIQUE CODE
    # -------------------------------
    inspection_code = f"INS-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"

    def safe(v):
        return v if v else "N/A"

    # -------------------------------
    # DATE PARSING (🔥 FIXED)
    # -------------------------------
    try:
        start_time = isoparse(data["inspection_start_time"]) if data.get("inspection_start_time") else datetime.utcnow()
        end_time = isoparse(data["inspection_end_time"]) if data.get("inspection_end_time") else datetime.utcnow()
    except:
        return jsonify({"message": "Invalid datetime format"}), 400

    # -------------------------------
    # CREATE NEW INSPECTION
    # -------------------------------
    inspection = Inspection(
        inspection_code=inspection_code,

        inspection_type=data.get("inspection_type"),
        scheme_name=data.get("scheme_name"),
        work_order_number=data.get("work_order_number"),
        inspection_purpose=data.get("inspection_purpose"),

        state=data.get("state"),
        district=data.get("district"),
        taluka=safe(data.get("taluka")),
        village=safe(data.get("village")),
        site_name=data.get("site_name"),
        landmark=safe(data.get("landmark")),

        latitude=str(data.get("latitude")),
        longitude=str(data.get("longitude")),

        work_progress_percentage=int(data.get("work_progress_percentage")),
        quality_assessment=data.get("quality_assessment"),
        compliance_status=data.get("compliance_status"),
        safety_status=safe(data.get("safety_status")),
        material_status=safe(data.get("material_status")),
        labour_status=safe(data.get("labour_status")),
        issues_observed=safe(data.get("issues_observed")),

        photo=data.get("photo"),
        photo_timestamp=datetime.utcnow(),

        inspector_declaration=True,
        record_locked=True,

        inspection_start_time=start_time,
        inspection_end_time=end_time,

        inspector_id=current_user.id
    )

    # -------------------------------
    # OFFLINE / ONLINE SYNC HANDLING
    # -------------------------------
    offline_time = data.get("offline_submission_time")
    inspection.offline_submission_time = (
        isoparse(offline_time) if offline_time else None
    )

    inspection.online_sync_time = (
        datetime.utcnow() if offline_time else None
    )

    db.session.add(inspection)
    db.session.commit()

    return jsonify({
        "message": "Inspection submitted successfully",
        "inspection_code": inspection_code
    }), 201


# ===============================
# INSPECTOR – VIEW OWN INSPECTIONS
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
            "created_at": i.created_at,

            "inspection_start_time": i.inspection_start_time,
            "inspection_end_time": i.inspection_end_time,
            "offline_submission_time": i.offline_submission_time,
            "online_sync_time": i.online_sync_time
        }
        for i in inspections
    ])


# ===============================
# ADMIN – VIEW ALL INSPECTIONS
# ===============================
@inspection_bp.route("/all-inspections", methods=["GET"])
@token_required
@role_required("admin")
def all_inspections(current_user):

    inspections = Inspection.query.order_by(
        Inspection.created_at.desc()).all()

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
            "safety_status": i.safety_status,
            "material_status": i.material_status,
            "labour_status": i.labour_status,
            "issues_observed": i.issues_observed,

            "status": i.status,
            "photo": i.photo,
            "created_at": i.created_at,

            "inspection_start_time": i.inspection_start_time,
            "inspection_end_time": i.inspection_end_time,
            "offline_submission_time": i.offline_submission_time,
            "online_sync_time": i.online_sync_time,

            "inspector_name": i.inspector.username
        }
        for i in inspections
    ])


# ===============================
# ADMIN – APPROVE / REJECT
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

    # FIRST TIME
    if inspection.status == "Pending":
        reason_text = "First level approval"
    else:
        if not reason:
            return jsonify({"message": "Reason required"}), 400
        reason_text = reason

    inspection.status = action
    inspection.approved_by = current_user.id
    inspection.approved_at = datetime.utcnow()

    log = AuditLog(
        inspection_id=id,
        modified_by=current_user.id,
        action=action,
        reason=reason_text
    )

    db.session.add(log)
    db.session.commit()

    return jsonify({"message": f"Inspection {action} successfully"})


# ===============================
# ADMIN – AUDIT HISTORY
# ===============================
@inspection_bp.route("/inspection/<int:id>/audit-history", methods=["GET"])
@token_required
@role_required("admin")
def audit_history(current_user, id):

    logs = AuditLog.query.filter_by(
        inspection_id=id
    ).order_by(AuditLog.timestamp.desc()).all()

    return jsonify([
        {
            "action": log.action,
            "reason": log.reason,
            "modified_by": User.query.get(log.modified_by).username,
            "timestamp": log.timestamp
        }
        for log in logs
    ])