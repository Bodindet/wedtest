import { handleFile } from './upload.js';

export function initCamera() {
    const cameraBtn = document.getElementById('cameraBtn');
    const cameraModal = document.getElementById('cameraModal');
    const cameraVideo = document.getElementById('cameraVideo');
    const captureBtn = document.getElementById('captureBtn');
    const closeCameraBtn = document.getElementById('closeCameraBtn');
    const cameraCanvas = document.getElementById('cameraCanvas');
    let cameraStream = null;

    if (!(cameraBtn && cameraModal && cameraVideo && captureBtn && closeCameraBtn && cameraCanvas)) return;

    cameraBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('เบราว์เซอร์ของคุณไม่รองรับการเปิดกล้อง');
            return;
        }
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            cameraVideo.srcObject = cameraStream;
            cameraModal.classList.remove('hidden');
        } catch (err) {
            alert('ไม่สามารถเข้าถึงกล้องได้ หรือคุณไม่ได้อนุญาต');
        }
    });

    captureBtn.addEventListener('click', () => {
        if (!cameraVideo.srcObject) return;
        const width = cameraVideo.videoWidth;
        const height = cameraVideo.videoHeight;
        cameraCanvas.width = width;
        cameraCanvas.height = height;
        const ctx = cameraCanvas.getContext('2d');
        ctx.drawImage(cameraVideo, 0, 0, width, height);
        cameraCanvas.toBlob(blob => {
            if (blob) handleFile(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg');
        stopCamera();
        cameraModal.classList.add('hidden');
    });

    closeCameraBtn.addEventListener('click', () => {
        stopCamera();
        cameraModal.classList.add('hidden');
    });

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        cameraVideo.srcObject = null;
    }
}

document.addEventListener('DOMContentLoaded', initCamera);
