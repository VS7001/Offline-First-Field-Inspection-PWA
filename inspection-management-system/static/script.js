window.onerror = function(msg, url, line, col, error) {
    console.log("🔥 GLOBAL ERROR →", msg, " at line:", line, "col:", col);
};

const API_URL = "";
// ================= INDEXEDDB SETUP =================
let db;
const DB_NAME = "inspection_db";
const DB_VERSION = 1;

function initIndexedDB() {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function(e) {
        db = e.target.result;

        // Create stores only if not exist
        if (!db.objectStoreNames.contains("offline_inspections")) {
            db.createObjectStore("offline_inspections", { keyPath: "localId" });
        }

        if (!db.objectStoreNames.contains("synced_cache")) {
            db.createObjectStore("synced_cache", { keyPath: "id" });
        }

        console.log("IndexedDB setup complete");
    };

    request.onsuccess = function(e) {
        db = e.target.result;
        console.log("IndexedDB initialized");

        setTimeout(() => {
            if (window.location.pathname.toLowerCase().includes("dashboard")) {
                window.addEventListener("online", syncOfflineInspections);
                loadOfflineInspections();
            }
        }, 100);
    };
    request.onerror = function(e) {
        console.error("IndexedDB error:", e.target.error);
    };
}

initIndexedDB();

let inspection_start_time = null;
let inspection_end_time = null;
let capturedImage = null;   
let latitude = null;
let longitude = null;
let stream = null;
let currentStep = 1;
// ================= PAGINATION VARIABLES =================
let offlineCurrentPage = 1;
const ITEMS_PER_PAGE = 10;
let syncedDataCache = []; // stores synced inspections for pagination


let adminCurrentPage = 1;
const ADMIN_ITEMS_PER_PAGE = 10;
let adminDataCache = []; // Stores all admin inspection records
let adminFilterActive = false;
let inspectorFilterActive = false;
// INSPECTOR
let inspectorPendingPage = 1;
let inspectorApprovedPage = 1;
let inspectorRejectedPage = 1;
let inspectorReinspectPage = 1;

// ADMIN
let adminPendingPage = 1;
let adminApprovedPage = 1;
let adminRejectedPage = 1;
let adminReinspectPage = 1;


// ================= NAVIGATION =================
function goToRegister() {
    window.location.href = "/register";
}

function goToLogin() {
    window.location.href = "/";
}

function showSpinner() {
    const spinner = document.getElementById("loadingSpinner");
    if (spinner) spinner.style.display = "block";
}

function hideSpinner() {
    const spinner = document.getElementById("loadingSpinner");
    if (spinner) spinner.style.display = "none";
}

function disableButton(btn) {
    btn.disabled = true;
    btn.style.opacity = "0.6";
}

function enableButton(btn) {
    btn.disabled = false;
    btn.style.opacity = "1";
}

function safe(v, fallback = "N/A") {
    return (v === undefined || v === null || v === "undefined" || v === "") 
        ? fallback 
        : v;
}

// ================= LOGIN =================
function login() {

    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;

    if (!username || !password) {
        showToast("Enter username and password", "warning");
        return;
    }
    showSpinner();
    fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            password
        })
    })
    .then(async res => {
         hideSpinner();
        const data = await res.json();

        if (!res.ok) {
            showToast(data.message || "Invalid credentials", "error");
            return;
        }

        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role);

        if (data.role === "admin" && window.matchMedia('(display-mode: standalone)').matches) {
            alert("Admin dashboard should be accessed from browser, not installed app.");
            localStorage.clear();
            return;
        }

        window.location.href = "/dashboard";
    })
    .catch(() => {
        showToast("Server not reachable!", "error");
    });
}

function getStatusClass(status) {
    if (!status) return "";
    status = status.toLowerCase();

    if (status === "pending") return "status-pending";
    if (status === "approved") return "status-approved";
    if (status === "rejected") return "status-rejected";

    return "";
}

// ================= REGISTER =================
function register() {

    const username = document.getElementById("regUsername").value;
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirmPassword").value;
    const role = document.getElementById("regRole").value;

    if (password !== confirmPassword) {
        showToast("Passwords do not match", "error");
        return;
    }

    fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            password,
            role,
            department: document.getElementById("regDepartment").value || null,
            designation: document.getElementById("regDesignation").value || null,
            office_division: document.getElementById("regOfficeDivision").value || null,
            contact_number: document.getElementById("regContactNumber").value || null,
            device_id: document.getElementById("regDeviceID").value || null
        })
    })
    .then(async res => {
        const data = await res.json();

        if (!res.ok) {
            showToast(data.message || "Registration failed", "error");
            return;
        }

        // SUCCESS
        showToast("Registration Successful!", "success");

        // Optionally clear form
        document.getElementById("regUsername").value = "";
        document.getElementById("regPassword").value = "";
        document.getElementById("regConfirmPassword").value = "";

        // Redirect after 1.5 sec
        setTimeout(() => {
            window.location.href = "/";
        }, 1500);
    })
    .catch(() => showToast("Server not reachable!", "error"));
}
function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

if (localStorage.getItem("role") === "inspector") {
    window.addEventListener("offline", () => {
        showToast("You are offline. Inspections will be saved locally.", "warning");
    });
}


// ================= DASHBOARD INIT =================
window.onload = function() {
    if (!window.location.pathname.toLowerCase().includes("dashboard")) return;

    const role = localStorage.getItem("role");

    if (!role) {
        window.location.href = "/";
        return;
    }

    document.getElementById("roleTitle").innerText =
        role.toUpperCase() + " DASHBOARD";

    updateNetworkStatus();

    if (role === "inspector") {
        document.getElementById("inspectorSection").style.display = "block";
        document.getElementById("profileSection").style.display = "block";  // SHOW PROFILE
        loadInspectorProfile();
        loadMyInspections();

        // Start time captured as soon as inspection screen loads
        inspection_start_time = new Date().toISOString();
    }

    if (role === "admin") {
    document.getElementById("adminSection").style.display = "block";

    // Only update network bar, do NOT replace whole body
    updateNetworkStatus();

    if (navigator.onLine) {
        loadAllInspections();
    }

    window.addEventListener("online", () => {
        updateNetworkStatus();
        loadAllInspections();
    });

    window.addEventListener("offline", () => {
        updateNetworkStatus();
    });
}
};
// ================= CAMERA =================
async function startCamera() {

    if (stream) return;

    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
        showToast("Camera permission denied", "error");
        return;
    }

    const video = document.getElementById("video");
    video.style.display = "block";
    video.srcObject = stream;

    document.getElementById("captureBtn").style.display = "inline-block";
}
function stopCamera(){
    if(stream){
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }

    const video = document.getElementById("video");
    if(video){
        video.srcObject = null;
        video.style.display = "none";
    }

    const captureBtn = document.getElementById("captureBtn");
    if(captureBtn){
        captureBtn.style.display = "none";
    }
}

function capturePhoto() {

    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("2d");

    canvas.style.display = "block";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    capturedImage = canvas.toDataURL("image/png");

    stopCamera();

    navigator.geolocation.getCurrentPosition(
        (position) => {
            latitude = position.coords.latitude;
            longitude = position.coords.longitude;
            showToast("Photo & location captured successfully", "success");
        },
        () => showToast("Location access denied", "error")
    );
}

// ================= STEP CONTROL =================
function showStep(stepNumber) {

    if (stepNumber > currentStep + 1) {
        showToast("Please complete previous steps first.", "warning");
        return;
    }

    // Hide all steps
    for (let i = 1; i <= 4; i++) {
        document.getElementById("step" + i).style.display = "none";
    }

    // Show selected step
    document.getElementById("step" + stepNumber).style.display = "block";

    // ✅ Update step indicator dynamically
    document.getElementById("stepIndicator").innerText =
        "Step " + stepNumber + " of 4";

    currentStep = stepNumber;
}


function validateStep1() {

    const type = document.getElementById("inspection_type").value;
    const scheme = document.getElementById("scheme_name").value;
    const workOrder = document.getElementById("work_order_number").value;
    const purpose = document.getElementById("inspection_purpose").value;

    if (!type || !scheme || !workOrder || !purpose) {
        showToast("Please fill all required fields in Step 1", "error");
        return;
    }

    showStep(2);
}

// ================= SUBMIT =================
function submitInspection() {
    if(document.querySelector('#step4 button[onclick="submitInspection()"]').disabled){
        return;
    }

    const submitBtn = document.querySelector('#step4 button[onclick="submitInspection()"]');
    disableButton(submitBtn);
    showSpinner();

    const requiredFields = [
        "inspection_type","scheme_name","work_order_number","inspection_purpose",
        "state","district","site_name","work_progress_percentage",
        "quality_assessment","compliance_status"
    ];

    for (let field of requiredFields) {
        if (!document.getElementById(field).value) {
            stopSubmitLock();
            showToast(field.replaceAll("_"," ").toUpperCase() + " is required", "error");
            return;
        }
    }

    if (!capturedImage || !latitude || !longitude) {
        stopSubmitLock();
        showToast("Please capture photo and location first", "error");
        return;
    }

    if (!document.getElementById("inspector_declaration").checked) {
        stopSubmitLock();
        showToast("You must accept declaration before submitting.", "error");
        return;
    }

    inspection_end_time = new Date().toISOString();
    continueSubmit();
}

function continueSubmit() {

    const inspectionData = {
        client_id: crypto.randomUUID(),
        inspection_type: document.getElementById("inspection_type").value,
        scheme_name: document.getElementById("scheme_name").value,
        work_order_number: document.getElementById("work_order_number").value,
        inspection_purpose: document.getElementById("inspection_purpose").value,

        state: document.getElementById("state").value,
        district: document.getElementById("district").value,
        taluka: document.getElementById("taluka").value || null,
        village: document.getElementById("village").value || null,
        site_name: document.getElementById("site_name").value,
        landmark: document.getElementById("landmark").value || null,

        latitude,
        longitude,

        work_progress_percentage: document.getElementById("work_progress_percentage").value,
        quality_assessment: document.getElementById("quality_assessment").value,
        compliance_status: document.getElementById("compliance_status").value,
        safety_status: document.getElementById("safety_status").value,
        material_status: document.getElementById("material_status").value,
        labour_status: document.getElementById("labour_status").value,
        issues_observed: document.getElementById("issues_observed").value || null,

        photo: capturedImage,

        inspection_start_time,
        inspection_end_time,
        offline_submission_time: navigator.onLine ? null : new Date().toISOString(),
        online_sync_time: navigator.onLine ? new Date().toISOString() : null
    };

    // ⭐ Add parent ID if follow-up
    // ❗ SAFETY CHECK — block accidental parent carry-over
    if (inspectionData.inspection_purpose !== "Re-Inspection") {
        localStorage.removeItem("parent_inspection_id");
    }

    if (localStorage.getItem("parent_inspection_id")) {
        inspectionData.parent_inspection_id =
            localStorage.getItem("parent_inspection_id");
    }

    // ⭐ NOW send to server / offline
    if (navigator.onLine) {
        sendToServer(inspectionData).finally(() => stopSubmitLock());
    } else {
        saveOffline(inspectionData).finally(() => stopSubmitLock());
    }
    
}

// ================= LOAD INSPECTOR =================
async function loadMyInspections() {

    const token = localStorage.getItem("token");

    if (navigator.onLine) {

        // ONLINE → Fetch from server
        fetch(`${API_URL}/my-inspections`, {
            headers: { "Authorization": "Bearer " + token }
        })
        .then(res => res.json())
        .then(async data => {

            syncedDataCache = data; // update UI cache

            // Store to IndexedDB
            const tx = db.transaction("synced_cache", "readwrite");
            const store = tx.objectStore("synced_cache");

            // Clear old cache
            store.clear();

            // Add new data
            data.forEach(item => store.add(item));

            tx.oncomplete = function () {
                console.log("Synced cache updated in IndexedDB");
            };

            renderSyncedPage();
        })
        .catch(async () => {
            // In case API fails but still online
            console.warn("API failed, loading cached data...");
            const cached = await getAllFromIndexedDB("synced_cache");
            syncedDataCache = cached;
            renderSyncedPage();
        });

    } else {

        // OFFLINE → Show cached inspections
        console.log("Offline → loading cached inspections");
        const cached = await getAllFromIndexedDB("synced_cache");
        syncedDataCache = cached;
        renderSyncedPage();
    }
}


// ================= LOAD ADMIN =================
function loadAllInspections() {
    if (adminFilterActive) return;

    fetch(`${API_URL}/all-inspections`, {
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(data => {

        // Store all admin inspections in memory
        adminDataCache = data;
        updateAdminStats();

        // Render first pagination page
        renderAdminLists();
    });
}

function renderAdminLists() {
    // ⛔ If filter is active, DO NOT render full list again
    if (adminFilterActive) return;

    const pendingList = document.getElementById("pendingList");
    const approvedList = document.getElementById("approvedList");
    const rejectedList = document.getElementById("rejectedList");
    const reinspectList = document.getElementById("reinspectList");

    pendingList.innerHTML = "";
    approvedList.innerHTML = "";
    rejectedList.innerHTML = "";
    reinspectList.innerHTML = "";

    // FILTER DATA
    const pendingData = adminDataCache.filter(i => i.status === "Pending");
    const reinspectData = adminDataCache.filter(i => i.status === "Re-Inspection Requested");
    const approvedData = adminDataCache.filter(i => i.status === "Approved");
    const rejectedData = adminDataCache.filter(i => i.status === "Rejected");

    // PAGINATION HELPERS
    function paginate(data, page) {
        const start = (page - 1) * ADMIN_ITEMS_PER_PAGE;
        const end = start + ADMIN_ITEMS_PER_PAGE;
        return data.slice(start, end);
    }

    // RENDER PENDING
    paginate(pendingData, adminPendingPage).forEach(i => {
        pendingList.innerHTML += `
            <div class="${getStatusClass(i.status)}"
                onclick="openInspection(${i.id})"
                style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
    
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>

                ${i.parent_inspection_id
                    ? `<span style='color:blue; font-weight:bold;'>
                        Re‑Inspection<br>
                        Parent: #${i.parent_inspection_id}<br>
                        New ID: #${i.id}
                        </span><br>`
                    : `<span style='color:green; font-weight:bold;'>Original Inspection</span><br>`}

                Status: ${i.status}
            </div>
        `;
    });

    // RENDER REINSPECTION REQUESTED
    paginate(reinspectData, adminReinspectPage).forEach(i => {
        reinspectList.innerHTML += `
        <div class="${getStatusClass(i.status)}"
            onclick="openInspection(${i.id})"
            style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">

            <strong>${i.inspection_code}</strong><br>
            Type: ${i.inspection_type}<br>

            ${i.parent_inspection_id 
                ? `<span style='color:blue; font-weight:bold;'>Re‑Inspection of #${i.parent_inspection_id}</span><br>`
                : `<span style='color:green; font-weight:bold;'>Original Inspection</span><br>`}

            Status: ${i.status}
        </div>
    `;
    });

    // RENDER APPROVED
    paginate(approvedData, adminApprovedPage).forEach(i => {
        approvedList.innerHTML += `
            <div class="${getStatusClass(i.status)}"
                onclick="openInspection(${i.id})"
                style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}
            </div>
        `;
    });

    // RENDER REJECTED
    paginate(rejectedData, adminRejectedPage).forEach(i => {
        rejectedList.innerHTML += `
            <div class="${getStatusClass(i.status)}"
                onclick="openInspection(${i.id})"
                style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}
            </div>
        `;
    });

    // UPDATE PAGE INFO
    document.getElementById("pendingPageInfo").innerText =
        `Page ${adminPendingPage} of ${Math.ceil(pendingData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;

    document.getElementById("reinspectPageInfo").innerText =
        `Page ${adminReinspectPage} of ${Math.ceil(reinspectData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;

    document.getElementById("approvedPageInfo").innerText =
        `Page ${adminApprovedPage} of ${Math.ceil(approvedData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;

    document.getElementById("rejectedPageInfo").innerText =
        `Page ${adminRejectedPage} of ${Math.ceil(rejectedData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;
}

function applyAdminFilters() {
    adminPendingPage = 1;
    adminApprovedPage = 1;
    adminRejectedPage = 1;
    adminReinspectPage = 1;
    adminFilterActive = true;
    let q = document.getElementById("adminSearch").value.trim().toLowerCase();
    let from = document.getElementById("adminStartDate").value;
    let to = document.getElementById("adminEndDate").value;
    let status = document.getElementById("adminStatusFilter").value;
    let type = document.getElementById("adminTypeFilter").value;       
    let quality = document.getElementById("adminQualityFilter").value;

    let filtered = [...adminDataCache];

    // TEXT SEARCH
    if (q.length >= 1) {
        filtered = filtered.filter(i =>
            (i.inspection_code || "").toLowerCase().includes(q) ||
            (i.scheme_name || "").toLowerCase().includes(q) ||
            (i.state || "").toLowerCase().includes(q) ||
            (i.district || "").toLowerCase().includes(q)
        );
    }

    // DATE RANGE
    if (from) filtered = filtered.filter(i => new Date(i.created_at) >= new Date(from));
    if (to)   filtered = filtered.filter(i => new Date(i.created_at) <= new Date(to + "T23:59:59"));

    // STATUS MATCH
    if (status) filtered = filtered.filter(i => i.status === status);

    // TYPE  ⭐ NEW
    if (type) filtered = filtered.filter(i => i.inspection_type === type);

    // QUALITY ⭐ NEW
    if (quality) filtered = filtered.filter(i => i.quality_assessment === quality);

    // ⭐ THE MAIN FIX — RENDER FILTERED RESULTS
    renderFilteredAdminLists(filtered);
    updateAdminStatsFiltered(filtered);

    // Hide pagination
    document.getElementById("pendingPageInfo").innerText = "";
    document.getElementById("approvedPageInfo").innerText = "";
    document.getElementById("rejectedPageInfo").innerText = "";
    document.getElementById("reinspectPageInfo").innerText = "";
}

function renderFilteredAdminLists(data) {
    const pendingList = document.getElementById("pendingList");
    const approvedList = document.getElementById("approvedList");
    const rejectedList = document.getElementById("rejectedList");
    const reinspectList = document.getElementById("reinspectList");

    pendingList.innerHTML = "";
    approvedList.innerHTML = "";
    rejectedList.innerHTML = "";
    reinspectList.innerHTML = "";

    data.forEach(i => {
        const card = `
            <div class="${getStatusClass(i.status)}"
                 onclick="openInspection(${i.id})"
                 style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}<br>
                ${
                    i.parent_inspection_id
                    ? `<span style='color:blue;font-weight:bold;'>Re‑Inspection of #${i.parent_inspection_id}</span>`
                    : `<span style='color:green;font-weight:bold;'>Original Inspection</span>`
                }
            </div>
        `;

        if (i.status === "Pending") pendingList.innerHTML += card;
        else if (i.status === "Approved") approvedList.innerHTML += card;
        else if (i.status === "Rejected") rejectedList.innerHTML += card;
        else if (i.status === "Re-Inspection Requested") reinspectList.innerHTML += card;
    });

    document.getElementById("pendingPageInfo").innerText = "";
    document.getElementById("approvedPageInfo").innerText = "";
    document.getElementById("rejectedPageInfo").innerText = "";
    document.getElementById("reinspectPageInfo").innerText = "";
}

function loadAuditHistory(id) {

    fetch(`${API_URL}/inspection/${id}/audit-history`, {
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(history => {

        if (history.length === 0) {
            showToast("No audit history found.", "info");
            return;
        }

        let html = "<h3>Audit History</h3>";

        history.forEach(log => {
            html += `
                <div style="border:1px solid gray; padding:10px; margin:10px 0;">
                    <strong>Action:</strong> ${log.action}<br>
                    <strong>By:</strong> ${log.modified_by}<br>
                    <strong>Reason:</strong> ${log.reason}<br>
                    <strong>Time:</strong> ${new Date(log.timestamp).toLocaleString()}<br>
                </div>
            `;
        });

        document.getElementById("modalContent").innerHTML = html;
    });
}

// ================= MODAL =================
function openInspection(id) {
    const inspection = adminDataCache.find(i => i.id === id);

    if (!inspection) {
        showToast("Inspection not found", "error");
        return;
    }

    const content = document.getElementById("modalContent");

    // STEP 1 — Base modal content
    content.innerHTML = `
        <h3>Basic Details</h3>
        <strong>Inspection Code:</strong> ${safe(inspection.inspection_code)}<br>
        <strong>Type:</strong> ${safe(inspection.inspection_type)}<br>
        <strong>Scheme:</strong> ${safe(inspection.scheme_name)}<br>
        <strong>Work Order:</strong> ${safe(inspection.work_order_number)}<br>
        <strong>Purpose:</strong> ${safe(inspection.inspection_purpose)}<br>
        <strong>Created At:</strong> ${safe(new Date(inspection.created_at).toLocaleString())}<br>
        <strong>Inspector:</strong> ${safe(inspection.inspector_name)}<br><br>

        <h3>Timing Information</h3>
        <strong>Started:</strong> ${safe(inspection.inspection_start_time ? new Date(inspection.inspection_start_time).toLocaleString() : "Not Recorded")}<br>
        <strong>Ended:</strong> ${safe(inspection.inspection_end_time ? new Date(inspection.inspection_end_time).toLocaleString() : "Not Recorded")}<br><br>

        <strong>Offline Submitted At:</strong> ${safe(inspection.offline_submission_time ? new Date(inspection.offline_submission_time).toLocaleString() : "N/A")}<br>
        <strong>Online Synced At:</strong> ${safe(inspection.online_sync_time ? new Date(inspection.online_sync_time).toLocaleString() : "N/A")}<br><br>

        <h3>Location</h3>
        <strong>State:</strong> ${safe(inspection.state)}<br>
        <strong>District:</strong> ${safe(inspection.district)}<br>
        <strong>Taluka:</strong> ${safe(inspection.taluka)}<br>
        <strong>Village:</strong> ${safe(inspection.village)}<br>
        <strong>Site:</strong> ${safe(inspection.site_name)}<br>
        <strong>Landmark:</strong> ${safe(inspection.landmark)}<br><br>

        <strong>Latitude:</strong> ${safe(inspection.latitude)}<br>
        <strong>Longitude:</strong> ${safe(inspection.longitude)}<br>

        <h4>Map Preview</h4>
        ${
            inspection.latitude && inspection.longitude
                ? `
                    <iframe width="100%" height="250" frameborder="0"
                        src="https://maps.google.com/maps?q=${inspection.latitude},${inspection.longitude}&z=15&output=embed">
                    </iframe>
                `
                : `<div style="color:red;">No GPS data available</div>`
        }

        <br><br>

        <h3>Observation</h3>
        <strong>Progress:</strong> ${safe(inspection.work_progress_percentage)}%<br>
        <strong>Quality:</strong> ${safe(inspection.quality_assessment)}<br>
        <strong>Compliance:</strong> ${safe(inspection.compliance_status)}<br>
        <strong>Safety:</strong> ${safe(inspection.safety_status)}<br>
        <strong>Material:</strong> ${safe(inspection.material_status)}<br>
        <strong>Labour:</strong> ${safe(inspection.labour_status)}<br>
        <strong>Issues:</strong> ${safe(inspection.issues_observed, "None")}<br><br>

        <h3>Photo Evidence</h3>
        <img src="${safe(inspection.photo, '')}" width="300"
            onerror="this.style.display='none'"/><br><br>

        <div id="adminActionButtons"></div>
        <br>
        <button onclick="loadAuditHistory(${inspection.id})"
        style="background:#444;color:white;padding:6px;">
        View Audit History
        </button>

        ${inspection.status === "Re-Inspection Requested" ? `
            <div style="color:red; font-weight:bold; margin-top:10px;">
                Awaiting Re‑Inspection by Inspector
            </div>
        ` : ""}
    `;

    // STEP 2 — Append Parent Block after the main template
    if (inspection.parent_inspection_id) {
    // This inspection is NEW → child = inspection
        const parent = adminDataCache.find(p => p.id === inspection.parent_inspection_id);
        if (parent) {
            content.innerHTML += renderComparisonBlock(parent, inspection);
        }
    } else {
    // This inspection might be OLD → check if a child exists
        const child = adminDataCache.find(c => c.parent_inspection_id === inspection.id);
        if (child) {
            content.innerHTML += renderComparisonBlock(inspection, child);
        }
    }

    document.getElementById("modalOverlay").style.display = "block";
    renderAdminActionButtons(inspection);
}

function closeModal() {
    document.getElementById("modalOverlay").style.display = "none";
}

function renderAdminActionButtons(inspection) {

    const container = document.getElementById("adminActionButtons");
    container.innerHTML = "";

    const status = inspection.status;
    const count = inspection.decision_count || 0;

    // 🔒 LOCK AFTER 2 DECISIONS
    if (count >= 2) {
        container.innerHTML = `
            <p style="color:red;font-weight:bold;">
            This inspection is locked.
            </p>
        `;
        return;
    }

    // ⭐ FIRST DECISION
    if (count === 0) {
        container.innerHTML = `
            <button onclick="adminDecision(${inspection.id}, 'Approved')">
                Approve
            </button>

            <button onclick="adminDecision(${inspection.id}, 'Rejected')">
                Reject
            </button>

            <button onclick="requestReinspection(${inspection.id})">
                Request Re‑Inspection
            </button>
        `;
        return;
    }

    // ⭐ SECOND DECISION
    if (count === 1) {

        if (status === "Approved") {

            container.innerHTML = `
                <button onclick="adminDecisionWithReason(${inspection.id}, 'Rejected')">
                    Change to Reject
                </button>

                <button onclick="requestReinspection(${inspection.id})">
                    Request Re‑Inspection
                </button>
            `;

        } else if (status === "Rejected") {

            container.innerHTML = `
                <button onclick="adminDecisionWithReason(${inspection.id}, 'Approved')">
                    Change to Approve
                </button>

                <button onclick="requestReinspection(${inspection.id})">
                    Request Re‑Inspection
                </button>
            `;

        }

    }
}


// ================= OFFLINE =================
function sendToServer(data) {
    return fetch(`${API_URL}/submit-inspection`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify(data)
    })
    .then(res => {
        hideSpinner();
        const submitBtn = document.querySelector('#step4 button[onclick="submitInspection()"]');
        enableButton(submitBtn);

        if (!res.ok) {
            return res.text().then(text => {
                console.error("SERVER RAW ERROR:", text);
                throw new Error(text);
            });
        }
        return res.json();
    })
    .then(result => {
        showToast(result.message, "success");
        localStorage.removeItem("parent_inspection_id");

        if (localStorage.getItem("role") === "inspector") {
            loadMyInspections();
            resetInspectionForm();
        }
    })
    .catch(err => {
        showToast("Error: " + err.message, "error");
    });
}

async function saveOffline(data) {
    if(!db){
        showToast("Database not ready", "error");
        return;
    }
    data.localId = Date.now();
    data.status = "Pending";
    data.offline_submission_time = new Date().toISOString();

    if (!data.inspection_start_time) data.inspection_start_time = inspection_start_time;
    if (!data.inspection_end_time) data.inspection_end_time = inspection_end_time;
    try {
        await addToIndexedDB("offline_inspections", data);
        showToast("Saved offline. Will sync when online.", "success");
        loadOfflineInspections();
        resetInspectionForm();
    } catch (err) {
        console.error("Error saving offline:", err);
        showToast("Failed to save offline", "error");
    }
}

function syncOfflineInspections() {
    if(!db) return;
    if (!navigator.onLine) return;

    const tx = db.transaction("offline_inspections", "readonly");
    const store = tx.objectStore("offline_inspections");

    const getAllRequest = store.getAll();

    getAllRequest.onsuccess = function () {
        const offlineData = getAllRequest.result;

        if (!offlineData || offlineData.length === 0) {
            console.log("No offline data to sync.");
            return;
        }

        Promise.all(
            offlineData.map(item => {

                // ensure offline timestamp is present
                if (!item.offline_submission_time) {
                    item.offline_submission_time = new Date().toISOString();
                }

                // 🔥 Create a clean copy without forbidden fields
                let cleaned = {
                    client_id: item.client_id,
                    inspection_type: item.inspection_type,
                    scheme_name: item.scheme_name,
                    work_order_number: item.work_order_number,
                    inspection_purpose: item.inspection_purpose,
                    state: item.state,
                    district: item.district,
                    taluka: item.taluka,
                    village: item.village,
                    site_name: item.site_name,
                    landmark: item.landmark,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    work_progress_percentage: item.work_progress_percentage,
                    quality_assessment: item.quality_assessment,
                    compliance_status: item.compliance_status,
                    safety_status: item.safety_status,
                    material_status: item.material_status,
                    labour_status: item.labour_status,
                    issues_observed: item.issues_observed,
                    photo: item.photo,
                    inspection_start_time: item.inspection_start_time,
                    inspection_end_time: item.inspection_end_time,
                    offline_submission_time: item.offline_submission_time
                };
                // Send cleaned data
                return fetch(`${API_URL}/submit-inspection`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + localStorage.getItem("token")
                    },
                    body: JSON.stringify(cleaned)
                })
                .then(res => {
                    if (!res.ok) {
                        return res.text().then(text => {
                            console.log("Sync error response:", text);
                            throw new Error("Sync failed");
                        });
                    }
                    return res.json();
                });

            })
        )
        .then(() => {
            const deleteTx = db.transaction("offline_inspections", "readwrite");
            const deleteStore = deleteTx.objectStore("offline_inspections");
            deleteStore.clear();

            deleteTx.oncomplete = function () {
                loadOfflineInspections();
                loadMyInspections();
                showToast("Offline inspections synced successfully.", "success");
            };
        })
        .catch(err => {
            console.log("Sync error:", err);
            showToast("Some inspections failed to sync.", "error");
        });
    };
}

async function loadOfflineInspections() {
    if(!db) return;
    try {
        const offlineData = await getAllFromIndexedDB("offline_inspections");
        // Update Offline Count Badge
        const offlineHeader = document.querySelector("#offlineSection h4");
        if (offlineHeader) {
            offlineHeader.innerText = "Pending Sync (Offline) (" + offlineData.length + ")";
        }

        const container = document.getElementById("offlineList");
        container.innerHTML = "";

        const totalPages = Math.ceil(offlineData.length / ITEMS_PER_PAGE) || 1;
        if (offlineCurrentPage > totalPages) offlineCurrentPage = totalPages;

        const start = (offlineCurrentPage - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;

        const pageItems = offlineData.slice(start, end);

        pageItems.forEach(i => {
            container.innerHTML += `
                <div style="border:1px dashed red; margin:10px; padding:10px;">
                    <strong>${i.scheme_name}</strong><br>
                    Status: Pending Sync
                </div>
            `;
        });

        document.getElementById("offlinePageInfo").innerText =
            `Page ${offlineCurrentPage} of ${totalPages}`;

    } catch (err) {
        console.error("IndexedDB read error:", err);
    }
}

// ================= LOGOUT =================
function logout() {

    if(!confirm("Are you sure you want to logout?")) return;

    localStorage.clear();
    window.location.href = "/";
}

function resetInspectionForm() {
    stopCamera();
    // Reset form fields
    document.getElementById("inspection_type").value = "";
    document.getElementById("scheme_name").value = "";
    document.getElementById("work_order_number").value = "";
    document.getElementById("inspection_purpose").value = "";
    document.getElementById("state").value = "";
    document.getElementById("district").value = "";
    document.getElementById("taluka").value = "";
    document.getElementById("village").value = "";
    document.getElementById("site_name").value = "";
    document.getElementById("landmark").value = "";
    document.getElementById("work_progress_percentage").value = "";
    document.getElementById("issues_observed").value = "";
    document.getElementById("inspector_declaration").checked = false;
    document.getElementById("quality_assessment").value="";
    document.getElementById("compliance_status").value="";
    document.getElementById("safety_status").value="";
    document.getElementById("material_status").value="";
    document.getElementById("labour_status").value="";

    // Reset camera variables
    capturedImage = null;
    latitude = null;
    longitude = null;

    document.getElementById("canvas").style.display = "none";

    // Reset step flow
    currentStep = 1;

    showStep(1);
}

function validateStep3() {

    const progress = document.getElementById("work_progress_percentage").value;
    const quality = document.getElementById("quality_assessment").value;
    const compliance = document.getElementById("compliance_status").value;

    const safety = document.getElementById("safety_status").value;
    const material = document.getElementById("material_status").value;
    const labour = document.getElementById("labour_status").value;

    if (!progress || progress < 0 || progress > 100) {
        showToast("Enter valid Work Progress (0–100)", "error");
        return;
    }
    if (!quality) {
        showToast("Select Quality Assessment", "error");
        return;
    }
    if (!compliance) {
        showToast("Select Compliance Status", "error");
        return;
    }
    if (!safety) {
        showToast("Select Safety Status", "error");
        return;
    }
    if (!material) {
        showToast("Select Material Status", "error");
        return;
    }
    if (!labour) {
        showToast("Select Labour Status", "error");
        return;
    }

    showStep(4);
}

function nextOfflinePage() {

    getAllFromIndexedDB("offline_inspections").then(data => {

        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE) || 1;

        if (offlineCurrentPage < totalPages) {
            offlineCurrentPage++;
            loadOfflineInspections();
        }

    });

}

function prevOfflinePage() {

    if (offlineCurrentPage > 1) {
        offlineCurrentPage--;
        loadOfflineInspections();
    }

}

function renderSyncedPage() {
    document.getElementById("statTotal").innerText = syncedDataCache.length;
    document.getElementById("statPending").innerText =
    syncedDataCache.filter(i => i.status === "Pending").length;

    document.getElementById("statApproved").innerText =
    syncedDataCache.filter(i => i.status === "Approved").length;

    document.getElementById("statRejected").innerText =
    syncedDataCache.filter(i => i.status === "Rejected").length;
    if (inspectorFilterActive) return;

    const pending = document.getElementById("inspPending");
    const reinspect = document.getElementById("inspReinspect");
    const approved = document.getElementById("inspApproved");
    const rejected = document.getElementById("inspRejected");

    pending.innerHTML = "";
    reinspect.innerHTML = "";
    approved.innerHTML = "";
    rejected.innerHTML = "";

    const pendingData = syncedDataCache.filter(i => i.status === "Pending");
    const reinspectData = syncedDataCache.filter(i => i.status === "Re-Inspection Requested");
    const approvedData = syncedDataCache.filter(i => i.status === "Approved");
    const rejectedData = syncedDataCache.filter(i => i.status === "Rejected");

    function paginate(data, page) {
        const start = (page - 1) * ITEMS_PER_PAGE;
        return data.slice(start, start + ITEMS_PER_PAGE);
    }

    function renderBlock(container, data, page) {
        paginate(data, page).forEach(i => {
            container.innerHTML += `
                <div class="${getStatusClass(i.status)}"
                    onclick="openInspectorInspection(${i.id})"
                    style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                    <strong>${i.inspection_code}</strong><br>
                    Type: ${i.inspection_type}<br>
                    Scheme: ${i.scheme_name}<br>
                    Status: ${i.status}<br>
                    ${i.parent_inspection_id
                        ? `<span style='color:blue; font-weight:bold;'>Re‑Inspection of #${i.parent_inspection_id}</span><br>`
                        : `<span style='color:green; font-weight:bold;'>Original Inspection</span><br>`}
                    Date: ${new Date(i.created_at).toLocaleString()}
                </div>
            `;
        });
    }

    renderBlock(pending, pendingData, inspectorPendingPage);
    renderBlock(reinspect, reinspectData, inspectorReinspectPage);
    renderBlock(approved, approvedData, inspectorApprovedPage);
    renderBlock(rejected, rejectedData, inspectorRejectedPage);

    document.getElementById("pendingPageInfo").innerText =
    `Page ${inspectorPendingPage} of ${Math.ceil(pendingData.length / ITEMS_PER_PAGE) || 1}`;
    document.getElementById("reinspectPageInfo").innerText =
    `Page ${inspectorReinspectPage} of ${Math.ceil(reinspectData.length / ITEMS_PER_PAGE) || 1}`;
    document.getElementById("approvedPageInfo").innerText =
    `Page ${inspectorApprovedPage} of ${Math.ceil(approvedData.length / ITEMS_PER_PAGE) || 1}`;
    document.getElementById("rejectedPageInfo").innerText =
    `Page ${inspectorRejectedPage} of ${Math.ceil(rejectedData.length / ITEMS_PER_PAGE) || 1}`;
}

function filterInspector() {
    inspectorPendingPage = 1;
    inspectorApprovedPage = 1;
    inspectorRejectedPage = 1;
    inspectorReinspectPage = 1;
    inspectorFilterActive = true;
    let q = document.getElementById("inspectorSearch").value.trim().toLowerCase();
    let from = document.getElementById("inspStartDate").value;
    let to = document.getElementById("inspEndDate").value;
    let status = document.getElementById("inspStatusFilter").value;

    let filtered = [...syncedDataCache];

    // TEXT SEARCH
    if (q) {
        filtered = filtered.filter(i =>
            (i.inspection_code || "").toLowerCase().includes(q) ||
            (i.scheme_name || "").toLowerCase().includes(q) ||
            (i.work_order_number || "").toLowerCase().includes(q) ||
            (i.state || "").toLowerCase().includes(q) ||
            (i.district || "").toLowerCase().includes(q)
        );
    }

    // DATE RANGE
    if (from) filtered = filtered.filter(i => new Date(i.created_at) >= new Date(from));
    if (to)   filtered = filtered.filter(i => new Date(i.created_at) <= new Date(to + "T23:59:59"));

    // STATUS
    if (status) filtered = filtered.filter(i => i.status === status);

    renderFilteredInspectorListsByStatus(filtered);
}


function renderFilteredInspectorListsByStatus(data) {

    // CLEAR ALL FOUR BLOCKS
    document.getElementById("inspPending").innerHTML = "";
    document.getElementById("inspReinspect").innerHTML = "";
    document.getElementById("inspApproved").innerHTML = "";
    document.getElementById("inspRejected").innerHTML = "";

    data.forEach(i => {
        const card = `
            <div class="${getStatusClass(i.status)}"
                onclick="openInspectorInspection(${i.id})"
                style="margin:10px;padding:12px;cursor:pointer;background:white;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
                
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Scheme: ${i.scheme_name}<br>
                Status: ${i.status}<br>

                ${i.parent_inspection_id
                    ? `<span style='color:blue; font-weight:bold;'>Re‑Inspection of #${i.parent_inspection_id}</span><br>`
                    : `<span style='color:green; font-weight:bold;'>Original Inspection</span><br>`}

                Date: ${new Date(i.created_at).toLocaleString()}
            </div>
        `;

        if (i.status === "Pending") 
            document.getElementById("inspPending").innerHTML += card;
        if (i.status === "Re-Inspection Requested") 
            document.getElementById("inspReinspect").innerHTML += card;
        if (i.status === "Approved") 
            document.getElementById("inspApproved").innerHTML += card;
        if (i.status === "Rejected") 
            document.getElementById("inspRejected").innerHTML += card;
    });

    // Remove pagination info during filtering
    document.getElementById("pendingPageInfo").innerText = "";
    document.getElementById("approvedPageInfo").innerText = "";
    document.getElementById("rejectedPageInfo").innerText = "";
    document.getElementById("reinspectPageInfo").innerText = "";
}

function clearInspectorFilters() {
    document.getElementById("inspStartDate").value = "";
    document.getElementById("inspEndDate").value = "";
    document.getElementById("inspStatusFilter").value = "";

    renderSyncedPage();
}

function openInspectorInspection(id) {

    const inspection = syncedDataCache.find(i => i.id === id);

    if (!inspection) {
        showToast("Inspection not found", "error");
        return;
    }

    const content = document.getElementById("modalContent");

    content.innerHTML = `
        <strong>Inspection Code:</strong> ${safe(inspection.inspection_code, "Not Assigned")}<br>
        <strong>Type:</strong> ${inspection.inspection_type}<br>
        <strong>Scheme:</strong> ${inspection.scheme_name}<br>
        <strong>Work Order:</strong> ${inspection.work_order_number}<br>
        <strong>Purpose:</strong> ${inspection.inspection_purpose}<br><br>
       
        <strong>Location:</strong><br>
        ${inspection.state}, ${inspection.district}<br>
        ${inspection.site_name}<br>
        <strong>Latitude:</strong> ${inspection.latitude}<br>
        <strong>Longitude:</strong> ${inspection.longitude}<br><br>

        <strong>Observations:</strong><br>
        Progress: ${inspection.work_progress_percentage}%<br>
        Quality: ${inspection.quality_assessment}<br>
        Compliance: ${inspection.compliance_status}<br>
        Safety: ${inspection.safety_status}<br>
        Material: ${inspection.material_status}<br>
        Labour: ${inspection.labour_status}<br>
        Issues: ${inspection.issues_observed}<br><br>

        <img src="${inspection.photo}" width="300"/><br><br>

        <strong>Status:</strong> ${inspection.status}<br>

        ${inspection.admin_reason 
            ? `<strong style="color:red;">Admin Remark:</strong> ${inspection.admin_reason}<br>`
            : ""}
        ${inspection.parent_inspection_id
            ? `<strong style="color:blue;">This is a Re‑Inspection (Parent ID: ${inspection.parent_inspection_id})</strong><br>`
            : `<strong style="color:green;">This is an Original Inspection</strong><br>`}

        ${inspection.parent_inspection_id
            ? `<strong>Follow‑up for:</strong> ${inspection.parent_inspection_id}<br>`
            : ""}

        <strong>Date:</strong> ${new Date(inspection.created_at).toLocaleString()}
    `;

    // If this inspection is a child (re-inspection)
    if (inspection.parent_inspection_id) {
        const parent = syncedDataCache.find(p => p.id === inspection.parent_inspection_id);
        if (parent) {
            content.innerHTML += `
                <button style="margin-top:10px; background:#007bff; color:white; padding:6px;"
                    onclick="openInspectorInspection(${inspection.parent_inspection_id})">
                    View Original (Parent) Inspection
                </button>       
                <hr><h3 style="color:blue;">Parent Inspection Summary</h3>
                Inspection Code: ${parent.inspection_code}<br>
                Type: ${parent.inspection_type}<br>
                Progress: ${parent.work_progress_percentage}%<br>
                Quality: ${parent.quality_assessment}<br>
                <br>
                <img src="${parent.photo}" width="200"/>
            `;
        }
    }
    if (inspection.status === "Re-Inspection Requested") {
    content.innerHTML += `
        <br>
        <button onclick="startReinspection(${inspection.id})"
            style="background:orange; padding:8px;">
            Start Re‑Inspection
        </button><br><br>
    `;
    }
    document.getElementById("modalOverlay").style.display = "block";

    const child = syncedDataCache.find(c => c.parent_inspection_id === id);
if (child) {
    content.innerHTML += `
        <div style="margin-top:10px; padding:8px; border:1px dashed blue;">
            <strong style="color:blue;">
                Follow‑up Re‑Inspection Exists → ID: ${child.id}
            </strong><br>
            <button onclick="openInspectorInspection(${child.id})"
                    style="margin-top:5px; background:#007bff; color:white; padding:6px;">
                View New Re‑Inspection
            </button>
        </div>
    `;
}
}

function startReinspection(id) {
    localStorage.setItem("parent_inspection_id", id);

    document.getElementById("re_parent_id").value = id;
    document.getElementById("reinspectionModal").style.display = "block";

    closeModal(); // close the view modal
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
function handleAdminOffline() {

    const statusDiv = document.getElementById("networkStatus");

    if (!statusDiv) return;

    if (!navigator.onLine) {
        statusDiv.innerHTML = "🔴 Admin requires internet connection";
        statusDiv.style.color = "red";
        statusDiv.style.display = "block";
    } else {
        statusDiv.style.display = "none";
    }
}
function updateNetworkStatus() {
    const statusDiv = document.getElementById("networkStatus");
    if (!statusDiv) return;

    const role = localStorage.getItem("role");

    if (role === "admin") {
        // Admin should ONLY block offline access, not hide anything
        if (!navigator.onLine) {
            handleAdminOffline();  
        } else {
            statusDiv.style.display = "none"; 
        }
        return;
    }

    // Inspector
    if (navigator.onLine) {
        statusDiv.innerHTML = "🟢 System Online";
        statusDiv.style.color = "green";
    } else {
        statusDiv.innerHTML = "🔴 System Offline (Working in offline mode)";
        statusDiv.style.color = "red";
    }
}

function addToIndexedDB(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);

        store.add(data);

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
    });
}

function getAllFromIndexedDB(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);

        const req = store.getAll();

        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function nextPendingPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        const data = adminDataCache.filter(i => i.status === "Pending");
        const totalPages = Math.ceil(data.length / ADMIN_ITEMS_PER_PAGE) || 1;

        if (adminPendingPage < totalPages) {
            adminPendingPage++;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        const data = syncedDataCache.filter(i => i.status === "Pending");
        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE) || 1;

        if (inspectorPendingPage < totalPages) {
            inspectorPendingPage++;
            renderSyncedPage();
        }
    }
}
function prevPendingPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        if (adminPendingPage > 1) {
            adminPendingPage--;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        if (inspectorPendingPage > 1) {
            inspectorPendingPage--;
            renderSyncedPage();
        }
    }
}

function nextApprovedPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        const data = adminDataCache.filter(i => i.status === "Approved");
        const totalPages = Math.ceil(data.length / ADMIN_ITEMS_PER_PAGE) || 1;

        if (adminApprovedPage < totalPages) {
            adminApprovedPage++;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        const data = syncedDataCache.filter(i => i.status === "Approved");
        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE) || 1;

        if (inspectorApprovedPage < totalPages) {
            inspectorApprovedPage++;
            renderSyncedPage();
        }
    }
}
function prevApprovedPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        if (adminApprovedPage > 1) {
            adminApprovedPage--;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        if (inspectorApprovedPage > 1) {
            inspectorApprovedPage--;
            renderSyncedPage();
        }
    }
}

function nextRejectedPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        const data = adminDataCache.filter(i => i.status === "Rejected");
        const totalPages = Math.ceil(data.length / ADMIN_ITEMS_PER_PAGE) || 1;

        if (adminRejectedPage < totalPages) {
            adminRejectedPage++;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        const data = syncedDataCache.filter(i => i.status === "Rejected");
        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE) || 1;

        if (inspectorRejectedPage < totalPages) {
            inspectorRejectedPage++;
            renderSyncedPage();
        }
    }
}
function prevRejectedPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        if (adminRejectedPage > 1) {
            adminRejectedPage--;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        if (inspectorRejectedPage > 1) {
            inspectorRejectedPage--;
            renderSyncedPage();
        }
    }
}


function loadInspectorProfile() {
    const token = localStorage.getItem("token");

    fetch(`${API_URL}/my-profile`, {
        headers: { "Authorization": "Bearer " + token }
    })
    .then(res => res.json())
    .then(data => {

        // Title
        document.getElementById("roleTitle").innerText =
            `Inspector Dashboard – ${data.username}`;

        // Profile summary fields
        document.getElementById("prof_username").innerText = data.username || "N/A";
        document.getElementById("prof_department").innerText = data.department || "N/A";
        document.getElementById("prof_designation").innerText = data.designation || "N/A";
        document.getElementById("prof_office_division").innerText = data.office_division || "N/A";
        document.getElementById("prof_contact").innerText = data.contact_number || "N/A";
        document.getElementById("prof_device").innerText = data.device_id || "N/A";

        document.getElementById("profileSection").style.display = "block";
    })
    .catch(err => console.error("Profile load error:", err));
}

function openProfile() {
    const token = localStorage.getItem("token");

    fetch(`${API_URL}/my-profile`, {
        headers: { "Authorization": "Bearer " + token }
    })
    .then(res => res.json())
    .then(data => {

        document.getElementById("profileModalContent").innerHTML = `
            <strong>Username:</strong> ${data.username}<br><br>

            <label>Department</label><br>
            <input id="profDept" value="${data.department || ''}"><br><br>

            <label>Designation</label><br>
            <input id="profDesg" value="${data.designation || ''}"><br><br>

            <label>Office Division</label><br>
            <input id="profDiv" value="${data.office_division || ''}"><br><br>

            <label>Contact Number</label><br>
            <input id="profContact" value="${data.contact_number || ''}"><br><br>

            <label>Device ID</label><br>
            <input id="profDevice" value="${data.device_id || ''}"><br><br>

            <button onclick="saveProfile()">Save Changes</button>
        `;

        document.getElementById("profileModal").style.display = "block";
    });
}

function closeProfileModal() {
    document.getElementById("profileModal").style.display = "none";
}

function saveProfile() {
    const token = localStorage.getItem("token");

    const updated = {
        department: document.getElementById("profDept").value.trim(),
        designation: document.getElementById("profDesg").value.trim(),
        office_division: document.getElementById("profDiv").value.trim(),
        contact_number: document.getElementById("profContact").value.trim(),
        device_id: document.getElementById("profDevice").value.trim()
    };

    // 🚨 VALIDATION
    if (!updated.department || !updated.designation || !updated.office_division) {
        showToast("Please fill all required profile fields.", "error");
        return;
    }

    // Disable save button
    const btn = document.querySelector("#profileModal button[onclick='saveProfile()']");
    disableButton(btn);
    showSpinner();

    fetch(`${API_URL}/update-profile`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify(updated)
    })
    .then(res => res.json())
    .then(data => {
        hideSpinner();
        enableButton(btn);
        showToast(data.message, "success");
        closeProfileModal();
        loadInspectorProfile();
    })
    .catch(() => {
        hideSpinner();
        enableButton(btn);
        showToast("Failed to update profile", "error");
    });
}
function toggleProfile() {
    const body = document.getElementById("profileBody");
    const header = document.querySelector("#profileSection h3");

    if (body.style.display === "none") {
        body.style.display = "block";
        header.innerHTML = "My Profile ⯅";
    } else {
        body.style.display = "none";
        header.innerHTML = "My Profile ⯆";
    }
}
function toggleInspectionForm() {
    const container = document.getElementById("inspectionFormContainer");

    if (!container) return;

    const header = document.getElementById("inspectionFormHeader"); 
    // Add id="inspectionFormHeader" to your form title <h3>

    if (container.style.display === "none") {
        container.style.display = "block";
        if (header) header.innerHTML = "New Inspection ⯅";
    } else {
        container.style.display = "none";
        if (header) header.innerHTML = "New Inspection ⯆";
    }
}


function stopSubmitLock() {
    hideSpinner();
    const submitBtn = document.querySelector('#step4 button[onclick="submitInspection()"]');
    enableButton(submitBtn);
    submitBtn.disabled = false;
}


function resetInspectorFilters() {
    inspectorFilterActive = false;

    document.getElementById("inspectorSearch").value = "";
    document.getElementById("inspStartDate").value = "";
    document.getElementById("inspEndDate").value = "";
    document.getElementById("inspStatusFilter").value = ""

    loadMyInspections(); // <-- REAL FIX
}

function resetAdminFilters() {
    adminFilterActive = false;

    document.getElementById("adminSearch").value = "";
    document.getElementById("adminStartDate").value = "";
    document.getElementById("adminEndDate").value = "";
    document.getElementById("adminStatusFilter").value = "";
    document.getElementById("adminTypeFilter").value = "";
    document.getElementById("adminQualityFilter").value = "";
    loadAllInspections();  // <-- REAL FIX
}

function requestReinspection(id) {

    if (!confirm("Request re‑inspection for this site?")) return;

    fetch(`${API_URL}/request-reinspection/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(data => {
        showToast(data.message, "success");

        closeModal();

        loadAllInspections();
    })
    .catch(() => showToast("Server error", "error"));
}

function nextReinspectPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        const data = adminDataCache.filter(i => i.status === "Re-Inspection Requested");
        const totalPages = Math.ceil(data.length / ADMIN_ITEMS_PER_PAGE) || 1;

        if (adminReinspectPage < totalPages) {
            adminReinspectPage++;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        const data = syncedDataCache.filter(i => i.status === "Re-Inspection Requested");
        const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE) || 1;

        if (inspectorReinspectPage < totalPages) {
            inspectorReinspectPage++;
            renderSyncedPage();
        }
    }
}
function prevReinspectPage() {

    const role = localStorage.getItem("role");

    if(role === "admin"){
        if (adminReinspectPage > 1) {
            adminReinspectPage--;
            renderAdminLists();
        }
    }

    if(role === "inspector"){
        if (inspectorReinspectPage > 1) {
            inspectorReinspectPage--;
            renderSyncedPage();
        }
    }
}

function renderParentBlock(parent) {
    if (!parent) return "";

    return `
        <hr>
        <h2>Old Inspection (Parent)</h2>

        <strong>Inspection Code:</strong> ${parent.inspection_code}<br>
        <strong>Type:</strong> ${parent.inspection_type}<br>
        <strong>Scheme:</strong> ${parent.scheme_name}<br>
        <strong>Work Order:</strong> ${parent.work_order_number}<br><br>

        <strong>Progress:</strong> ${parent.work_progress_percentage}%<br>
        <strong>Quality:</strong> ${parent.quality_assessment}<br>
        <strong>Compliance:</strong> ${parent.compliance_status}<br>
        <strong>Safety:</strong> ${parent.safety_status}<br>
        <strong>Material:</strong> ${parent.material_status}<br>
        <strong>Labour:</strong> ${parent.labour_status}<br>
        <strong>Issues:</strong> ${safe(parent.issues_observed, "None")}<br><br>

        <img src="${parent.photo}" width="250" onerror="this.style.display='none'"><br><br>
    `;
}

let re_stream = null;
let re_capturedImage = null;

async function startReCamera(){
    try{
        if (re_stream) return;

        re_stream = await navigator.mediaDevices.getUserMedia({ video: true });

        const video = document.getElementById("re_video");
        video.style.display = "block";
        video.srcObject = re_stream;

        document.getElementById("re_captureBtn").style.display = "inline-block";

    }catch{
        showToast("Camera permission denied", "error");
    }
}

function captureRePhoto() {
    const video = document.getElementById("re_video");
    const canvas = document.getElementById("re_canvas");
    const ctx = canvas.getContext("2d");

    canvas.style.display = "block";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    re_capturedImage = canvas.toDataURL("image/png");

    if (re_stream) {
        re_stream.getTracks().forEach(t => t.stop());
        re_stream = null;
    }

    video.style.display = "none";
    document.getElementById("re_captureBtn").style.display = "none";

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            document.getElementById("re_latitude").value = pos.coords.latitude;
            document.getElementById("re_longitude").value = pos.coords.longitude;
            showToast("Photo & location captured successfully", "success");
        },
        () => showToast("Location denied", "error")
    );
}

function submitReInspection() {
    // REQUIRED FIELD VALIDATION
    const requiredFields = [
        "re_scheme_name",
        "re_work_order_number",
        "re_state",
        "re_district",
        "re_site_name",
        "re_work_progress_percentage",
        "re_quality_assessment",
        "re_compliance_status",
        "re_safety_status",
        "re_material_status",
        "re_labour_status"
    ];

    for (let field of requiredFields) {
        const el = document.getElementById(field);
        if (!el || !el.value) {
            showToast(field.replace("re_","").replaceAll("_"," ").toUpperCase() + " is required", "error");
            return;
        }
    }

    const parent_id = localStorage.getItem("parent_inspection_id");
    if(!parent_id){
        showToast("Parent inspection not found","error");
        return;
    }

    const data = {
        client_id: crypto.randomUUID(),
        parent_inspection_id: parent_id,

        inspection_type: document.getElementById("re_inspection_type").value,
        inspection_purpose: "Re-Inspection",

        scheme_name: document.getElementById("re_scheme_name").value,
        work_order_number: document.getElementById("re_work_order_number").value,

        state: document.getElementById("re_state").value,
        district: document.getElementById("re_district").value,
        taluka: document.getElementById("re_taluka").value,
        village: document.getElementById("re_village").value,
        site_name: document.getElementById("re_site_name").value,
        landmark: document.getElementById("re_landmark").value,

        work_progress_percentage: document.getElementById("re_work_progress_percentage").value,
        quality_assessment: document.getElementById("re_quality_assessment").value,
        compliance_status: document.getElementById("re_compliance_status").value,

        safety_status: document.getElementById("re_safety_status").value,
        material_status: document.getElementById("re_material_status").value,
        labour_status: document.getElementById("re_labour_status").value,

        issues_observed: document.getElementById("re_issues_observed").value,
        photo: re_capturedImage,

        latitude: document.getElementById("re_latitude").value,
        longitude: document.getElementById("re_longitude").value,

        inspection_start_time: new Date().toISOString(),
        inspection_end_time: new Date().toISOString()
    };
    if(!re_capturedImage){
        showToast("Capture photo first","error")
        return
    }

    if(!document.getElementById("re_latitude").value){
        showToast("Location required","error")
        return
    }
    fetch(`${API_URL}/submit-inspection`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify(data)
    })
    .then(res => res.json())
    .then(r => {
        showToast("Re‑Inspection Submitted!", "success");

        localStorage.removeItem("parent_inspection_id");
        closeReinspectionModal();

        loadMyInspections();
    });
}


function closeReinspectionModal() {
    stopReCamera();
    document.getElementById("reinspectionModal").style.display = "none";
}

function renderFullParentBlock(p) {
    return `
        <hr><h2>Original Inspection (Parent Report)</h2>

        <h3>Basic Details</h3>
        <strong>Inspection Code:</strong> ${safe(p.inspection_code)}<br>
        <strong>Type:</strong> ${safe(p.inspection_type)}<br>
        <strong>Scheme:</strong> ${safe(p.scheme_name)}<br>
        <strong>Work Order:</strong> ${safe(p.work_order_number)}<br>
        <strong>Purpose:</strong> ${safe(p.inspection_purpose)}<br>
        <strong>Inspector:</strong> ${safe(p.inspector_name)}<br>
        <strong>Created At:</strong> ${safe(new Date(p.created_at).toLocaleString())}<br><br>

        <h3>Location</h3>
        <strong>State:</strong> ${safe(p.state)}<br>
        <strong>District:</strong> ${safe(p.district)}<br>
        <strong>Taluka:</strong> ${safe(p.taluka)}<br>
        <strong>Village:</strong> ${safe(p.village)}<br>
        <strong>Site:</strong> ${safe(p.site_name)}<br>
        <strong>Landmark:</strong> ${safe(p.landmark)}<br><br>

        <h3>GPS</h3>
        <strong>Latitude:</strong> ${safe(p.latitude)}<br>
        <strong>Longitude:</strong> ${safe(p.longitude)}<br>
        <iframe width="100%" height="250" frameborder="0"
            src="https://maps.google.com/maps?q=${p.latitude},${p.longitude}&z=15&output=embed">
        </iframe><br><br>

        <h3>Observations</h3>
        <strong>Progress:</strong> ${safe(p.work_progress_percentage)}%<br>
        <strong>Quality:</strong> ${safe(p.quality_assessment)}<br>
        <strong>Compliance:</strong> ${safe(p.compliance_status)}<br>
        <strong>Safety:</strong> ${safe(p.safety_status)}<br>
        <strong>Material:</strong> ${safe(p.material_status)}<br>
        <strong>Labour:</strong> ${safe(p.labour_status)}<br>
        <strong>Issues:</strong> ${safe(p.issues_observed, "None")}<br><br>

        <h3>Photo Evidence</h3>
        <img src="${p.photo}" width="300" onerror="this.style.display='none'"/><br><br>

        <h3>Timing</h3>
        <strong>Start:</strong> ${safe(new Date(p.inspection_start_time).toLocaleString())}<br>
        <strong>End:</strong> ${safe(new Date(p.inspection_end_time).toLocaleString())}<br>
        <strong>Offline Submitted:</strong> ${safe(p.offline_submission_time)}<br>
        <strong>Online Synced:</strong> ${safe(p.online_sync_time)}<br>
    `;
}

function renderComparisonBlock(parent, child) {
    return `
        <hr>
        <h2>Re‑Inspection Comparison</h2>

        <div style="display:flex; gap:20px; width:100%;">
            
            <!-- LEFT: OLD -->
            <div style="flex:1; border:1px solid gray; padding:10px;">
                <h3 style="color:red;">OLD Inspection (#${parent.id})</h3>
                <strong>Inspection Code:</strong> ${parent.inspection_code}<br>
                <strong>Type:</strong> ${parent.inspection_type}<br>
                <strong>Scheme:</strong> ${parent.scheme_name}<br>
                <strong>Work Order:</strong> ${parent.work_order_number}<br>
                <strong>Purpose:</strong> ${parent.inspection_purpose}<br><br>

                <strong>State:</strong> ${parent.state}<br>
                <strong>District:</strong> ${parent.district}<br>
                <strong>Taluka:</strong> ${parent.taluka}<br>
                <strong>Village:</strong> ${parent.village}<br>
                <strong>Site:</strong> ${parent.site_name}<br>
                <strong>Landmark:</strong> ${parent.landmark}<br><br>

                <strong>Progress:</strong> ${parent.work_progress_percentage}%<br>
                <strong>Quality:</strong> ${parent.quality_assessment}<br>
                <strong>Compliance:</strong> ${parent.compliance_status}<br>
                <strong>Safety:</strong> ${parent.safety_status}<br>
                <strong>Material:</strong> ${parent.material_status}<br>
                <strong>Labour:</strong> ${parent.labour_status}<br>
                <strong>Issues:</strong> ${parent.issues_observed}<br><br>

                <img src="${parent.photo}" width="250">
            </div>

            <!-- RIGHT: NEW -->
            <div style="flex:1; border:1px solid gray; padding:10px;">
                <h3 style="color:green;">NEW Re‑Inspection (#${child.id})</h3>
                <strong>Inspection Code:</strong> ${child.inspection_code}<br>
                <strong>Type:</strong> ${child.inspection_type}<br>
                <strong>Scheme:</strong> ${child.scheme_name}<br>
                <strong>Work Order:</strong> ${child.work_order_number}<br>
                <strong>Purpose:</strong> ${child.inspection_purpose}<br><br>

                <strong>State:</strong> ${child.state}<br>
                <strong>District:</strong> ${child.district}<br>
                <strong>Taluka:</strong> ${child.taluka}<br>
                <strong>Village:</strong> ${child.village}<br>
                <strong>Site:</strong> ${child.site_name}<br>
                <strong>Landmark:</strong> ${child.landmark}<br><br>

                <strong>Progress:</strong> ${child.work_progress_percentage}%<br>
                <strong>Quality:</strong> ${child.quality_assessment}<br>
                <strong>Compliance:</strong> ${child.compliance_status}<br>
                <strong>Safety:</strong> ${child.safety_status}<br>
                <strong>Material:</strong> ${child.material_status}<br>
                <strong>Labour:</strong> ${child.labour_status}<br>
                <strong>Issues:</strong> ${child.issues_observed}<br><br>

                <img src="${child.photo}" width="250">
            </div>
        </div>
    `;
}

function adminDecision(id, action) {
    fetch(`${API_URL}/audit/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({ action, reason: null })
    })
    .then(res => res.json())
    .then(data => {
        showToast(data.message, "success");
        closeModal();
        loadAllInspections();
    });
}

function adminDecisionWithReason(id, action) {

    const password = prompt("Admin Password Required:");
    if (!password) {
        alert("Password is required.");
        return;
    }

    const reason = prompt("Enter reason for this change:");
    if (!reason) {
        alert("Reason is required.");
        return;
    }

    fetch(`${API_URL}/audit/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({
            action: action,
            reason: reason,
            password: password   // 🔥 send password
        })
    })
    .then(res => res.json())
    .then(data => {
        showToast(data.message, "success");
        closeModal();
        loadAllInspections();
    });
}
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/static/service-worker.js")
    .then(reg => console.log("Service Worker registered"))
    .catch(err => console.log("Service Worker error", err));
}

let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {

    // Only allow install button on dashboard page
    if (!window.location.pathname.toLowerCase().includes("dashboard")) return;
    const role = localStorage.getItem("role");
    if (role !== "inspector") return;
    e.preventDefault();
    deferredPrompt = e;

    const installBtn = document.createElement("button");
    installBtn.innerText = "Install App";
    installBtn.style.position = "fixed";
    installBtn.style.bottom = "20px";
    installBtn.style.right = "20px";
    installBtn.style.padding = "10px";
    installBtn.style.background = "#138808";
    installBtn.style.color = "white";
    installBtn.style.borderRadius = "8px";
    installBtn.style.border = "none";
    installBtn.style.cursor = "pointer";

    installBtn.onclick = () => {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => {
            deferredPrompt = null;
            installBtn.remove();
        });
    };

    if (!document.getElementById("installBtn")) {
        installBtn.id = "installBtn";
        document.body.appendChild(installBtn);
    }

});
function updateAdminStats() {

    document.getElementById("statTotal").innerText = adminDataCache.length;

    document.getElementById("statPending").innerText =
        adminDataCache.filter(i => i.status === "Pending").length;

    document.getElementById("statApproved").innerText =
        adminDataCache.filter(i => i.status === "Approved").length;

    document.getElementById("statRejected").innerText =
        adminDataCache.filter(i => i.status === "Rejected").length;
}
function updateAdminStatsFiltered(data) {
    document.getElementById("statTotal").innerText = data.length;

    document.getElementById("statPending").innerText =
        data.filter(i => i.status === "Pending").length;

    document.getElementById("statApproved").innerText =
        data.filter(i => i.status === "Approved").length;

    document.getElementById("statRejected").innerText =
        data.filter(i => i.status === "Rejected").length;
}
function stopReCamera(){
    if(re_stream){
        re_stream.getTracks().forEach(t=>t.stop());
        re_stream = null;
    }
}