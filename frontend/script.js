window.addEventListener("offline", () => {
    alert("You are offline. Inspections will be saved locally.");
});

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
        window.addEventListener("online", syncOfflineInspections);
        loadOfflineInspections();
    };

    request.onerror = function(e) {
        console.error("IndexedDB error:", e.target.error);
    };
}

initIndexedDB();

let capturedImage = null;
let latitude = null;
let longitude = null;
let stream = null;
let currentStep = 1;
// ================= PAGINATION VARIABLES =================
let offlineCurrentPage = 1;
let syncedCurrentPage = 1;
const ITEMS_PER_PAGE = 10;
let syncedDataCache = []; // stores synced inspections for pagination


// ================= NAVIGATION =================
function goToRegister() {
    window.location.href = "register.html";
}

function goToLogin() {
    window.location.href = "index.html";
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
    .then(res => res.json())
    .then(data => {
        if (data.token) {
            localStorage.setItem("token", data.token);
            localStorage.setItem("role", data.role);
            window.location.href = "dashboard.html";
        } else {
            alert(data.message);
        }
    });
}

// ================= REGISTER =================
function register() {

    const username = document.getElementById("regUsername").value;
    const password = document.getElementById("regPassword").value;
    const confirmPassword = document.getElementById("regConfirmPassword").value;
    const role = document.getElementById("regRole").value;

    if (password !== confirmPassword) {
        alert("Passwords do not match");
        return;
    }

    fetch(`${API_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
    });
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
        loadMyInspections();
        loadOfflineInspections();
    }

    if (role === "admin") {
        document.getElementById("adminSection").style.display = "block";
        loadAllInspections();
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
            alert("Photo and location captured successfully");
        },
        () => alert("Location access denied")
    );
}

// ================= STEP CONTROL =================
function showStep(stepNumber) {

    if (stepNumber > currentStep + 1) {
        alert("Please complete previous steps first.");
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

    if (!document.getElementById("scheme_name").value ||
        !document.getElementById("work_order_number").value ||
        !document.getElementById("inspection_purpose").value) {

        alert("Please fill all required fields in Step 1");
        return;
    }

    showStep(2);
}

// ================= SUBMIT =================
function submitInspection() {

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
            alert(field.replaceAll("_", " ").toUpperCase() + " is required");
            return;
        }
    }

    // ✅ Photo & Location check
    if (!capturedImage || !latitude || !longitude) {
        alert("Please capture photo and location first");
        return;
    }

    // ✅ Declaration check
    if (!document.getElementById("inspector_declaration").checked) {
        alert("You must accept declaration before submitting.");
        return;
    }

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
    location_accuracy: "High",
    work_progress_percentage: document.getElementById("work_progress_percentage").value,
    quality_assessment: document.getElementById("quality_assessment").value,
    compliance_status: document.getElementById("compliance_status").value,
    safety_status: document.getElementById("safety_status").value,
    material_status: document.getElementById("material_status").value,
    labour_status: document.getElementById("labour_status").value,
    issues_observed: document.getElementById("issues_observed").value || null,
    photo: capturedImage
    };

    if (navigator.onLine) {
        sendToServer(inspectionData);
    } else {
        saveOffline(inspectionData);
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

        const pending = document.getElementById("pendingList");
        const approved = document.getElementById("approvedList");
        const rejected = document.getElementById("rejectedList");

        pending.innerHTML = "";
        approved.innerHTML = "";
        rejected.innerHTML = "";

        data.forEach(i => {

            const card = `
                <div onclick="openInspection(${i.id})"
                     style="border:1px solid black; margin:10px; padding:10px; cursor:pointer;">
                    <strong>${i.inspection_code}</strong><br>
                    Type: ${i.inspection_type}<br>
                    Status: ${i.status}
                </div>
            `;

            if (i.status === "Pending") pending.innerHTML += card;
            else if (i.status === "Approved") approved.innerHTML += card;
            else rejected.innerHTML += card;
        });
    });
}

// ================= MODAL =================
function openInspection(id) {

    fetch(`${API_URL}/all-inspections`, {
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(data => {

        const inspection = data.find(i => i.id === id);

        const content = document.getElementById("modalContent");

        content.innerHTML = `
        <h3>Basic Details</h3>
        Type: ${inspection.inspection_type}<br>
        Scheme: ${inspection.scheme_name}<br>
        Work Order: ${inspection.work_order_number}<br>
        Purpose: ${inspection.inspection_purpose}<br><br>

        <h3>Location</h3>
        State: ${inspection.state}<br>
        District: ${inspection.district}<br>
        Taluka: ${inspection.taluka}<br>
        Village: ${inspection.village}<br>
        Site: ${inspection.site_name}<br>
        Landmark: ${inspection.landmark}<br><br>

        <h3>Observation</h3>
        Progress: ${inspection.work_progress_percentage}%<br>
        Quality: ${inspection.quality_assessment}<br>
        Compliance: ${inspection.compliance_status}<br>
        Safety: ${inspection.safety_status}<br>
        Material: ${inspection.material_status}<br>
        Labour: ${inspection.labour_status}<br>
        Issues: ${inspection.issues_observed}<br><br>

        <img src="${inspection.photo}" width="300"/><br><br>

        <button onclick="updateStatus(${inspection.id}, 'Approved', '${inspection.status}')">Approve</button>
        <button onclick="updateStatus(${inspection.id}, 'Rejected', '${inspection.status}')">Reject</button>
        `;



        document.getElementById("inspectionModal").style.display = "block";
    });
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
        alert("Password required");
        return;
    }

    const reason = prompt("Enter reason for changing decision:");
    if (!reason) {
        alert("Reason required");
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
        alert("Incorrect admin password");
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
        alert(data.message);
        closeModal();
        loadAllInspections();
    });
}




// ================= OFFLINE =================
function sendToServer(data) {

    fetch(`${API_URL}/submit-inspection`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            return res.json().then(err => {
                throw new Error(err.message);
            });
        }
        return res.json();
    })
    .then(result => {
        alert(result.message);
        loadMyInspections();
        resetInspectionForm();
    })
    .catch(err => {
        alert("Error: " + err.message);
    });
}


async function saveOffline(data) {
    data.localId = Date.now();
    data.status = "Pending Sync";

    try {
        await addToIndexedDB("offline_inspections", data);
        alert("Saved offline in IndexedDB. Will sync when online.");
        loadOfflineInspections();
        resetInspectionForm();
    } catch (err) {
        console.error("Error saving offline:", err);
        alert("Failed to save offline");
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
            offlineData.map(item =>
                fetch(`${API_URL}/submit-inspection`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + localStorage.getItem("token")
                    },
                    body: JSON.stringify(item)
                })
                .then(res => {
                    if (!res.ok) {
                        return res.text().then(text => {
                            console.log("Sync error response:", text);
                            throw new Error("Sync failed");
                        });
                    }
                    return res.json();
                })
            )
        )
        .then(() => {
            // Remove all offline entries after successful sync
            const deleteTx = db.transaction("offline_inspections", "readwrite");
            const deleteStore = deleteTx.objectStore("offline_inspections");
            deleteStore.clear();

            deleteTx.oncomplete = function () {
                loadOfflineInspections();
                loadMyInspections();
                alert("Offline inspections synced successfully.");
            };
        })
        .catch(err => {
            console.log("Sync error:", err);
            alert("Some inspections failed to sync. Check console.");
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
        alert("Enter valid Work Progress (0–100)");
        return;
    }
    if (!quality) {
        alert("Select Quality Assessment");
        return;
    }
    if (!compliance) {
        alert("Select Compliance Status");
        return;
    }
    if (!safety) {
        alert("Select Safety Status");
        return;
    }
    if (!material) {
        alert("Select Material Status");
        return;
    }
    if (!labour) {
        alert("Select Labour Status");
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

    fetch(`${API_URL}/my-inspections`, {
        headers: {
            "Authorization": "Bearer " + localStorage.getItem("token")
        }
    })
    .then(res => res.json())
    .then(data => {

        const inspection = data.find(i => i.id === id);

        if (!inspection) return;

        const content = document.getElementById("modalContent");

        content.innerHTML = `
            <strong>Inspection Code:</strong> ${inspection.inspection_code}<br>
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
    });
}

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

function updateNetworkStatus() {

    const statusDiv = document.getElementById("networkStatus");

    if (!statusDiv) return;

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