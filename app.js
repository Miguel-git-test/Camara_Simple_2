const video = document.getElementById('preview');
const photoBtn = document.getElementById('photo-btn');
const videoBtn = document.getElementById('video-btn');
const galleryBtn = document.getElementById('gallery-btn');
const closeGallery = document.getElementById('close-gallery');
const galleryModal = document.getElementById('gallery-modal');
const galleryGrid = document.getElementById('gallery-grid');
const emptyState = document.getElementById('empty-gallery');
const canvas = document.getElementById('capture-canvas');
const flash = document.getElementById('snap-flash');
const overlay = document.getElementById('recording-overlay');
const timerDisp = document.getElementById('recording-timer');
const switchBtn = document.getElementById('switch-camera-btn');

// Detail View Elements
const itemDetail = document.getElementById('item-detail');
const detailContent = document.querySelector('.detail-content');
const closeDetail = document.getElementById('close-detail');
const shareItemBtn = document.getElementById('share-item');
const saveItemBtn = document.getElementById('save-item');
const deleteItemBtn = document.getElementById('delete-item');

let stream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let timerInterval = null;
let currentFacingMode = 'environment';
let db = null;
let currentItem = null; // Currently viewed item in detail view

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

const deleteFromDB = async (id) => {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['captures'], 'readwrite');
        const store = transaction.objectStore('captures');
        const request = store.delete(id);
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

    const constraints = {
        video: {
            facingMode: currentFacingMode,
            width: { ideal: 3840 }, 
            height: { ideal: 2160 },
            frameRate: { ideal: 30 }
        },
        audio: true
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        console.log(`Resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);

        setTimeout(() => applySportsSettings(track), 1000);
    } catch (err) {
        console.error("Error accessing camera:", err);
        alert("No se pudo acceder a la cámara. Verifica los permisos.");
    }
};

const applySportsSettings = async (track) => {
    const capabilities = track.getCapabilities();
    const constraints = {};

    if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
        constraints.exposureMode = 'manual';
        if (capabilities.exposureTime) {
            const minTime = capabilities.exposureTime.min;
            const maxTime = capabilities.exposureTime.max;
            constraints.exposureTime = minTime + (maxTime - minTime) * 0.05; 
        }
    }

    if (capabilities.iso && capabilities.iso.min) {
        constraints.iso = Math.min(capabilities.iso.max, capabilities.iso.min * 4);
    }

    if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        constraints.focusMode = 'continuous';
    }

    try {
        await track.applyConstraints({ advanced: [constraints] });
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
    const options = { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 12000000 };
    
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
        
        div.onclick = () => openDetailView(item);
        galleryGrid.appendChild(div);
    });
};

const openDetailView = (item) => {
    currentItem = item;
    detailContent.innerHTML = '';
    const url = URL.createObjectURL(item.blob);
    
    if (item.type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        detailContent.appendChild(img);
    } else {
        const vid = document.createElement('video');
        vid.src = url;
        vid.controls = true;
        vid.autoplay = true;
        detailContent.appendChild(vid);
    }
    
    itemDetail.classList.remove('hidden');
};

const closeDetailView = () => {
    itemDetail.classList.add('hidden');
    detailContent.innerHTML = '';
    currentItem = null;
};

const shareItem = async () => {
    if (!currentItem) return;
    
    const fileExtension = currentItem.type === 'image' ? 'jpg' : 'webm';
    const file = new File([currentItem.blob], `SportCam_${currentItem.timestamp}.${fileExtension}`, {
        type: currentItem.blob.type
    });

    if (navigator.share && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'SportCam Pro Capture',
                text: 'Mira esta captura de mi SportCam!'
            });
        } catch (err) {
            console.error('Error sharing:', err);
        }
    } else {
        alert("Tu navegador no soporta la función de compartir archivos directamente.");
    }
};

const saveItem = () => {
    if (!currentItem) return;
    const url = URL.createObjectURL(currentItem.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SportCam_${currentItem.timestamp}.${currentItem.type === 'image' ? 'jpg' : 'webm'}`;
    a.click();
};

const deleteItem = async () => {
    if (!currentItem) return;
    if (confirm("¿Estás seguro de que quieres eliminar esta captura permanentemente?")) {
        await deleteFromDB(currentItem.id);
        closeDetailView();
        await updateGalleryPreview();
    }
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

closeGallery.addEventListener('click', () => {
    galleryModal.classList.add('hidden');
});

closeDetail.addEventListener('click', closeDetailView);
shareItemBtn.addEventListener('click', shareItem);
saveItemBtn.addEventListener('click', saveItem);
deleteItemBtn.addEventListener('click', deleteItem);

switchBtn.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

// --- Init ---
window.onload = async () => {
    await initDB();
    await startCamera();
};
