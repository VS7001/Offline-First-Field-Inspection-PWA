if (localStorage.getItem("role") === "inspector") {
    window.addEventListener("offline", () => {
        showToast("You are offline. Inspections will be saved locally.", "warning");
    });
}

const API_URL = "http://127.0.0.1:5000";
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
            if (window.location.pathname.includes("dashboard.html")) {
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
let location_accuracy = null;
// ================= PAGINATION VARIABLES =================
let offlineCurrentPage = 1;
let syncedCurrentPage = 1;
const ITEMS_PER_PAGE = 10;
let syncedDataCache = []; // stores synced inspections for pagination

let adminCurrentPage = 1;
const ADMIN_ITEMS_PER_PAGE = 10;
let adminDataCache = []; // Stores all admin inspection records
let pendingPage = 1;
let approvedPage = 1;
let rejectedPage = 1;

// ================= NAVIGATION =================
function goToRegister() {
    window.location.href = "register.html";
}

function goToLogin() {
    window.location.href = "index.html";
}

function showSpinner() {
    document.getElementById("loadingSpinner").style.display = "block";
}

function hideSpinner() {
    document.getElementById("loadingSpinner").style.display = "none";
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
    fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: document.getElementById("loginUsername").value,
            password: document.getElementById("loginPassword").value
        })
    })
    .then(async res => {
        const data = await res.json();

        if (!res.ok) {
            showToast(data.message || "Invalid credentials", "error");
            return;
        }

        // SUCCESS
        localStorage.setItem("token", data.token);
        localStorage.setItem("role", data.role);
        window.location.href = "dashboard.html";
    })
    .catch(() => {
        showToast("Server not reachable!", "error");
    });
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
    .then(res => res.json())
    .then(data => {
        showToast(data.message, "info");
    });
}
function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ================= DASHBOARD INIT =================
window.onload = function() {

    if (!window.location.pathname.includes("dashboard.html")) return;

    const role = localStorage.getItem("role");

    if (!role) {
        window.location.href = "index.html";
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
        loadAllInspections();

        // ⭐ Add this ONLY for admin
        window.addEventListener("offline", handleAdminOffline);
    }
};
// ================= CAMERA =================
async function startCamera() {

    if (stream) return;

    stream = await navigator.mediaDevices.getUserMedia({ video: true });

    const video = document.getElementById("video");
    video.style.display = "block";
    video.srcObject = stream;

    document.getElementById("captureBtn").style.display = "inline-block";
}

function capturePhoto() {

    const video = document.getElementById("video");
    const canvas = document.getElementById("canvas");
    const context = canvas.getContext("2d");

    canvas.style.display = "block";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    capturedImage = canvas.toDataURL("image/png");

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    video.srcObject = null;
    video.style.display = "none";
    document.getElementById("captureBtn").style.display = "none";

    navigator.geolocation.getCurrentPosition(
        (position) => {
            latitude = position.coords.latitude;
            longitude = position.coords.longitude;
            location_accuracy = position.coords.accuracy;
            showToast("Photo, location & accuracy captured successfully", "success");
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
    document.querySelector("button[onclick='submitInspection()']").disabled = true;
    const submitBtn = document.querySelector('#step4 button[onclick="submitInspection()"]');
    disableButton(submitBtn);
    showSpinner();

    // ✅ HIGH PRIORITY REQUIRED FIELD VALIDATION
    const requiredFields = [
        "inspection_type",
        "scheme_name",
        "work_order_number",
        "inspection_purpose",
        "state",
        "district",
        "site_name",
        "work_progress_percentage",
        "quality_assessment",
        "compliance_status"
    ];

    for (let field of requiredFields) {
        const element = document.getElementById(field);

        if (!element || !element.value) {
            stopSubmitLock();
            showToast(field.replaceAll("_", " ").toUpperCase() + " is required", "error");
            return;
        }
    }

    // ✅ Photo & Location check
    if (!capturedImage || !latitude || !longitude) {
        stopSubmitLock();
        showToast("Please capture photo and location first", "error");
        return;
    }

    // ✅ Declaration check
    if (!document.getElementById("inspector_declaration").checked) {
        stopSubmitLock();
        showToast("You must accept declaration before submitting.", "error");
        return;
    }
    inspection_end_time = new Date().toISOString();

    const inspectionData = {
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
    location_accuracy: location_accuracy || "Unknown",
    work_progress_percentage: document.getElementById("work_progress_percentage").value,
    quality_assessment: document.getElementById("quality_assessment").value,
    compliance_status: document.getElementById("compliance_status").value,
    safety_status: document.getElementById("safety_status").value,
    material_status: document.getElementById("material_status").value,
    labour_status: document.getElementById("labour_status").value,
    issues_observed: document.getElementById("issues_observed").value || null,
    photo: capturedImage,
    inspection_start_time,
    inspection_end_time
    };

    if (navigator.onLine) {
        sendToServer(inspectionData)
            .finally(() => {
                document.querySelector("button[onclick='submitInspection()']").disabled = false;
            });
    } else {
        saveOffline(inspectionData)
    .finally(() => {
        stopSubmitLock();
        document.querySelector("button[onclick='submitInspection()']").disabled = false;
    });
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

    fetch(`${API_URL}/all-inspections`, {
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(data => {

        // Store all admin inspections in memory
        adminDataCache = data;

        pendingPage = 1;
        approvedPage = 1;
        rejectedPage = 1;

        // Render first pagination page
        renderAdminLists();
    });
}

function renderAdminLists() {

    const pendingList = document.getElementById("pendingList");
    const approvedList = document.getElementById("approvedList");
    const rejectedList = document.getElementById("rejectedList");

    pendingList.innerHTML = "";
    approvedList.innerHTML = "";
    rejectedList.innerHTML = "";

    // FILTER DATA
    const pendingData = adminDataCache.filter(i => i.status === "Pending");
    const approvedData = adminDataCache.filter(i => i.status === "Approved");
    const rejectedData = adminDataCache.filter(i => i.status === "Rejected");

    // PAGINATION HELPERS
    function paginate(data, page) {
        const start = (page - 1) * ADMIN_ITEMS_PER_PAGE;
        const end = start + ADMIN_ITEMS_PER_PAGE;
        return data.slice(start, end);
    }

    // RENDER PENDING
    paginate(pendingData, pendingPage).forEach(i => {
        pendingList.innerHTML += `
            <div onclick="openInspection(${i.id})"
                 style="border:1px solid black; margin:10px; padding:10px; cursor:pointer;">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}
            </div>
        `;
    });

    // RENDER APPROVED
    paginate(approvedData, approvedPage).forEach(i => {
        approvedList.innerHTML += `
            <div onclick="openInspection(${i.id})"
                 style="border:1px solid black; margin:10px; padding:10px; cursor:pointer;">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}
            </div>
        `;
    });

    // RENDER REJECTED
    paginate(rejectedData, rejectedPage).forEach(i => {
        rejectedList.innerHTML += `
            <div onclick="openInspection(${i.id})"
                 style="border:1px solid black; margin:10px; padding:10px; cursor:pointer;">
                <strong>${i.inspection_code}</strong><br>
                Type: ${i.inspection_type}<br>
                Status: ${i.status}
            </div>
        `;
    });

    // UPDATE PAGE INFO
    document.getElementById("pendingPageInfo").innerText =
        `Page ${pendingPage} of ${Math.ceil(pendingData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;

    document.getElementById("approvedPageInfo").innerText =
        `Page ${approvedPage} of ${Math.ceil(approvedData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;

    document.getElementById("rejectedPageInfo").innerText =
        `Page ${rejectedPage} of ${Math.ceil(rejectedData.length / ADMIN_ITEMS_PER_PAGE) || 1}`;
}

function interpretAccuracy(value) {
    const meters = parseFloat(value);

    if (isNaN(meters)) return "Unknown";

    if (meters <= 50) return `Excellent (${meters} meters)`;
    if (meters <= 150) return `Good (${meters} meters)`;
    if (meters <= 300) return `Moderate (${meters} meters)`;
    return `Poor (${meters} meters)`;
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

    if (!inspection || typeof inspection !== "object") {
        showToast("Invalid inspection", "error");
        return;
    }

    if (!inspection) {
        showToast("Inspection not found in cache", "error");
        return;
    }

    const content = document.getElementById("modalContent");

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
        <strong>Accuracy:</strong> ${interpretAccuracy(inspection.location_accuracy)}<br><br>

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

        <button onclick="updateStatus(${inspection.id}, 'Approved', '${inspection.status}')">Approve</button>
        <button onclick="updateStatus(${inspection.id}, 'Rejected', '${inspection.status}')">Reject</button>
        <button onclick="loadAuditHistory(${inspection.id})">View Audit History</button>
    `;

    document.getElementById("inspectionModal").style.display = "block";
}

function closeModal() {
    document.getElementById("inspectionModal").style.display = "none";
}

// ================= ADMIN STATUS =================
function updateStatus(id, action, currentStatus) {

    if (!confirm(`Are you sure you want to mark this as ${action}?`)) {
        return;
    }

    // ✅ FIRST TIME → NO password, NO reason
    if (currentStatus === "Pending") {
        sendAuditRequest(id, action, null);
        return;
    }

    // ✅ SECOND TIME → Ask password + reason
    const password = prompt("Re-authorization required. Enter admin password:");
    if (!password) {
        showToast("Password required", "error");
        return;
    }

    const reason = prompt("Enter reason for changing decision:");
    if (!reason) {
        showToast("Reason required", "error");
        return;
    }

    fetch(`${API_URL}/verify-admin`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({ password: password })
    })
    .then(res => {
        if (!res.ok) throw new Error("Verification failed");
        return res.json();
    })
    .then(() => {
        sendAuditRequest(id, action, reason);
    })
    .catch(() => {
        showToast("Incorrect admin password", "error");
    });
}


function sendAuditRequest(id, action, reason) {

    fetch(`${API_URL}/audit/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({ action: action, reason: reason })
    })
    .then(res => {
        if (!res.ok) throw new Error("Server error");
        return res.json();
    })
    .then(data => {
        showToast(data.message, "success");
        closeModal();
        loadAllInspections();
    });
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
            return res.json().then(err => { throw new Error(err.message); });
        }
        return res.json();
    })
    .then(result => {
        showToast(result.message, "success");
        loadMyInspections();
        resetInspectionForm();
    })
    .catch(err => {
        showToast("Error: " + err.message, "error");
    });
}



async function saveOffline(data) {
    data.localId = Date.now();
    data.status = "Pending";
    data.offline_submission_time = new Date().toISOString();

    if (!data.inspection_start_time) data.inspection_start_time = inspection_start_time;
    if (!data.inspection_end_time) data.inspection_end_time = inspection_end_time;
    data.offline_submission_time = new Date().toISOString();
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
                    location_accuracy: item.location_accuracy,

                    work_progress_percentage: item.work_progress_percentage,
                    quality_assessment: item.quality_assessment,
                    compliance_status: item.compliance_status,
                    safety_status: item.safety_status,
                    material_status: item.material_status,
                    labour_status: item.labour_status,
                    issues_observed: item.issues_observed,

                    photo: item.photo,

                    inspection_start_time: item.inspection_start_time,
                    inspection_end_time: item.inspection_end_time
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
    try {
        const offlineData = await getAllFromIndexedDB("offline_inspections");

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
    localStorage.clear();
    window.location.href = "index.html";
}

function resetInspectionForm() {

    // Reset form fields
    document.getElementById("inspection_type").value = "Routine";
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
    offlineCurrentPage++;
    loadOfflineInspections();
}

function prevOfflinePage() {
    if (offlineCurrentPage > 1) {
        offlineCurrentPage--;
        loadOfflineInspections();
    }
}

function renderSyncedPage() {

    const container = document.getElementById("myInspectionList");
    container.innerHTML = "";

    const totalPages = Math.ceil(syncedDataCache.length / ITEMS_PER_PAGE) || 1;

    if (syncedCurrentPage > totalPages) syncedCurrentPage = totalPages;

    const start = (syncedCurrentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;

    const pageItems = syncedDataCache.slice(start, end);

    pageItems.forEach(i => {
    container.innerHTML += `
        <div onclick="openInspectorInspection(${i.id})"
             style="border:1px solid black; margin:10px; padding:10px; cursor:pointer;">
            <strong>${i.inspection_code}</strong><br>
            Type: ${i.inspection_type}<br>
            Scheme: ${i.scheme_name}<br>
            Status: ${i.status}<br>
            Date: ${new Date(i.created_at).toLocaleString()}
        </div>
    `;
});

    document.getElementById("syncedPageInfo").innerText =
        `Page ${syncedCurrentPage} of ${totalPages}`;
}

function nextSyncedPage() {
    syncedCurrentPage++;
    renderSyncedPage();
}

function prevSyncedPage() {
    if (syncedCurrentPage > 1) {
        syncedCurrentPage--;
        renderSyncedPage();
    }
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
        <strong>Date:</strong> ${new Date(inspection.created_at).toLocaleString()}
    `;

    document.getElementById("inspectionModal").style.display = "block";
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("offline", handleAdminOffline);

function updateNetworkStatus() {
    const statusDiv = document.getElementById("networkStatus");

    if (!statusDiv) return;

    // 🚫 Admin should NOT see anything
    if (localStorage.getItem("role") === "admin") {
        statusDiv.style.display = "none";
        return;
    }

    // Inspector mode only
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
    pendingPage++;
    renderAdminLists();
}
function prevPendingPage() {
    if (pendingPage > 1) pendingPage--;
    renderAdminLists();
}

function nextApprovedPage() {
    approvedPage++;
    renderAdminLists();
}
function prevApprovedPage() {
    if (approvedPage > 1) approvedPage--;
    renderAdminLists();
}

function nextRejectedPage() {
    rejectedPage++;
    renderAdminLists();
}
function prevRejectedPage() {
    if (rejectedPage > 1) rejectedPage--;
    renderAdminLists();
}

function handleAdminOffline() {
    if (localStorage.getItem("role") === "admin") {
        if (!navigator.onLine) {
            document.body.innerHTML = `
                <div style="
                    text-align:center;
                    margin-top:20%;
                    font-size:24px;
                    font-weight:bold;
                    color:red;
                ">
                    ❌ No Internet Connection<br>
                    <span style="font-size:18px; color:black;">
                        Admin dashboard requires internet to load inspections.
                    </span>
                    <br><br>
                    <button onclick="location.reload()">Retry</button>
                </div>
            `;
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

function stopSubmitLock() {
    hideSpinner();
    const submitBtn = document.querySelector('#step4 button[onclick="submitInspection()"]');
    enableButton(submitBtn);
    submitBtn.disabled = false;
}