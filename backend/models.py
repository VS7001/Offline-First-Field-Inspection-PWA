from datetime import datetime
from extensions import db


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)

    # Inspector Profile Fields
    department = db.Column(db.String(100))
    designation = db.Column(db.String(100))
    office_division = db.Column(db.String(150))
    contact_number = db.Column(db.String(20))
    device_id = db.Column(db.String(100))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Inspection(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    parent_inspection_id = db.Column(db.Integer, db.ForeignKey('inspection.id'))

    # Identification
    inspection_code = db.Column(db.String(50), unique=True)
    inspection_type = db.Column(db.String(50))
    scheme_name = db.Column(db.String(150))
    work_order_number = db.Column(db.String(100))
    inspection_purpose = db.Column(db.Text)

    # Location
    state = db.Column(db.String(100))
    district = db.Column(db.String(100))
    taluka = db.Column(db.String(100))
    village = db.Column(db.String(100))
    site_name = db.Column(db.String(150))
    landmark = db.Column(db.String(150))

    latitude = db.Column(db.String(50))
    longitude = db.Column(db.String(50))
    geo_tag_verified = db.Column(db.Boolean, default=False)

    # Inspection Observations
    work_progress_percentage = db.Column(db.Integer)
    quality_assessment = db.Column(db.String(50))
    compliance_status = db.Column(db.String(50))
    safety_status = db.Column(db.String(50))
    material_status = db.Column(db.String(50))
    labour_status = db.Column(db.String(50))
    issues_observed = db.Column(db.Text)

    # Photo Evidence
    photo = db.Column(db.Text)
    photo_timestamp = db.Column(db.DateTime)

    # Declaration
    inspector_declaration = db.Column(db.Boolean, default=False)
    record_locked = db.Column(db.Boolean, default=False)

    # Status & Audit
    status = db.Column(db.String(50), default="Pending")
    audit_remarks = db.Column(db.Text)
    verified_location_status = db.Column(db.String(50))
    verified_timestamp_status = db.Column(db.String(50))
    reinspection_required = db.Column(db.Boolean, default=False)

    approved_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    approved_at = db.Column(db.DateTime)

    decision_count = db.Column(db.Integer, default=0)

    # Timestamps
    inspection_start_time = db.Column(db.DateTime)
    inspection_end_time = db.Column(db.DateTime)
    offline_submission_time = db.Column(db.DateTime)
    online_sync_time = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    # Relationship
    inspector_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    inspector = db.relationship('User', foreign_keys=[inspector_id])


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    inspection_id = db.Column(db.Integer, db.ForeignKey('inspection.id'))
    modified_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    action = db.Column(db.String(100))
    reason = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
