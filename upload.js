export function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    const previewImg = document.getElementById('previewImg');
    const uploadContent = document.getElementById('uploadContent');
    const imagePreview = document.getElementById('imagePreview');
    const fileInput = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');
    reader.onload = e => {
        if (previewImg) previewImg.src = e.target.result;
        if (uploadContent) uploadContent.classList.add('hidden');
        if (imagePreview) imagePreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

export function initUpload() {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const cameraInput = document.getElementById('cameraInput');
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const removeImgBtn = document.getElementById('removeImgBtn');
    const uploadContent = document.getElementById('uploadContent');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');

    if (!(uploadArea && fileInput && cameraInput && uploadContent && imagePreview && previewImg)) return;

    if (chooseFileBtn) {
        chooseFileBtn.addEventListener('click', e => {
            e.stopPropagation();
            fileInput.value = '';
            fileInput.click();
        });
    }

    uploadArea.addEventListener('dragover', e => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', e => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', e => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', e => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    cameraInput.addEventListener('change', e => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    if (removeImgBtn) {
        removeImgBtn.addEventListener('click', () => {
            if (previewImg) previewImg.src = '';
            imagePreview.classList.add('hidden');
            uploadContent.classList.remove('hidden');
            fileInput.value = '';
            cameraInput.value = '';
        });
    }
}

document.addEventListener('DOMContentLoaded', initUpload);
