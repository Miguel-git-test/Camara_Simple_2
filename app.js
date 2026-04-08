/**
 * SportCam Pro Logic
 */

const video = document.getElementById('preview');
const photoBtn = document.getElementById('photo-btn');
const videoBtn = document.getElementById('video-btn');
const galleryBtn = document.getElementById('gallery-btn');
const nativeGalleryBtn = document.getElementById('native-gallery-btn');
const closeGallery = document.getElementById('close-gallery');
const galleryModal = document.getElementById('gallery-modal');
const galleryGrid = document.getElementById('gallery-grid');
const emptyState = document.getElementById('empty-gallery');
const canvas = document.getElementById('capture-canvas');
const flash = document.getElementById('snap-flash');
const overlay = document.getElementById('recording-overlay');
const timerDisp = document.getElementById('recording-timer');
const switchBtn = document.getElementById('switch-camera-btn');

let stream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let timerInterval = null;
let currentFacingMode = 'environment';
let db = null;

// --- Database Setup (IndexedDB) ---
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('SportCamDB', 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('captures')) {
                db.createObjectStore('captures', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
};

const saveToDB = async (blob, type) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['captures'], 'readwrite');
        const store = transaction.objectStore('captures');
        const item = {
            blob,
            type,
            timestamp: Date.now()
        };
        const request = store.add(item);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
};

const getAllFromDB = async () => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['captures'], 'readonly');
        const store = transaction.objectStore('captures');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e);
    });
};

// --- Camera Logic ---
const startCamera = async () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    // Constraints optimized for sharp frames at 30fps
    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 3840 }, 
            height: { ideal: 2160 },
            frameRate: { ideal: 30 } // User requested 30fps
        },
        audio: true
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        console.log(`Resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);

        // Apply advanced Sports Settings (Fast Shutter)
        setTimeout(() => applySportsSettings(track), 1000);
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("No se pudo acceder a la cámara. Verifica los permisos.");
    }
};

const applySportsSettings = async (track) => {
    const capabilities = track.getCapabilities();
    console.log("Capabilities:", capabilities);

    const constraints = {};

    // 1. Exposure (Obturación)
    if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
        constraints.exposureMode = 'manual';
        
        // We want a very fast shutter. exposureTime is usually in micro-seconds or arbitrary values.
        // We aim for something like 1/500s or faster.
        if (capabilities.exposureTime) {
            const minTime = capabilities.exposureTime.min;
            const maxTime = capabilities.exposureTime.max;
            // Aim for the lower end of the spectrum for speed
            constraints.exposureTime = minTime + (maxTime - minTime) * 0.05; 
            console.log("Setting manual exposure time:", constraints.exposureTime);
        }
    } else {
        console.warn("Manual exposure not supported on this device.");
    }

    // 2. ISO/Gain (to compensate darkness if possible)
    if (capabilities.iso && capabilities.iso.min) {
        // Boost ISO slightly to compensate for fast shutter
        constraints.iso = Math.min(capabilities.iso.max, capabilities.iso.min * 4);
    }

    // 3. Focus (Sports should be infinity or continuous)
    if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        constraints.focusMode = 'continuous';
    }

    try {
        await track.applyConstraints({ advanced: [constraints] });
        console.log("Applied sports constraints:", constraints);
    } catch (err) {
        console.error("Failed to apply sports constraints:", err);
    }
};

// --- UI Actions ---
const takePhoto = async () => {
    if (!stream) return;

    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 100);

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    canvas.width = settings.width;
    canvas.height = settings.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
        await saveToDB(blob, 'image');
        updateGalleryPreview();
    }, 'image/jpeg', 0.95);
};

const startRecording = () => {
    recordedChunks = [];
    const options = { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 12000000 }; // Increased bitrate for clarity
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/mp4';
    }

    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: options.mimeType });
        await saveToDB(blob, 'video');
        updateGalleryPreview();
        stopTimer();
        document.body.classList.remove('recording');
        overlay.classList.add('hidden');
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();
    startTimer();
    document.body.classList.add('recording');
    overlay.classList.remove('hidden');
};

const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
};

const startTimer = () => {
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        timerDisp.textContent = `${mins}:${secs}`;
    }, 1000);
};

const stopTimer = () => {
    clearInterval(timerInterval);
    timerDisp.textContent = "00:00";
};

const updateGalleryPreview = async () => {
    const items = await getAllFromDB();
    galleryGrid.innerHTML = '';
    
    if (items.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    items.reverse().forEach(item => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        
        const url = URL.createObjectURL(item.blob);
        
        if (item.type === 'image') {
            const img = document.createElement('img');
            img.src = url;
            div.appendChild(img);
        } else {
            const vid = document.createElement('video');
            vid.src = url;
            div.appendChild(vid);
            const badge = document.createElement('span');
            badge.className = 'video-badge';
            badge.textContent = 'MOV';
            div.appendChild(badge);
        }
        
        div.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = `SportCam_${item.timestamp}.${item.type === 'image' ? 'jpg' : 'webm'}`;
            a.click();
        };

        galleryGrid.appendChild(div);
    });
};

// --- Events ---
photoBtn.addEventListener('click', takePhoto);

videoBtn.addEventListener('click', () => {
    if (document.body.classList.contains('recording')) {
        stopRecording();
    } else {
        startRecording();
    }
});

galleryBtn.addEventListener('click', async () => {
    await updateGalleryPreview();
    galleryModal.classList.remove('hidden');
});

nativeGalleryBtn.addEventListener('click', () => {
    // Attempt to open the phone's gallery
    // This is primarily for Android. On iOS it won't do much but we try.
    window.location.href = "intent:#Intent;action=android.intent.action.VIEW;type=image/*;end";
    
    // Fallback for non-android
    setTimeout(() => {
        alert("Si no se abrió la galería, es porque tu sistema (posiblemente iOS) bloquea el acceso directo desde el navegador.");
    }, 2000);
});

closeGallery.addEventListener('click', () => {
    galleryModal.classList.add('hidden');
});

switchBtn.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

// --- Init ---
window.onload = async () => {
    await initDB();
    await startCamera();
};
