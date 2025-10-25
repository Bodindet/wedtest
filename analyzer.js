const tmModelURL = "https://teachablemachine.withgoogle.com/models/lIl4jvqJI/";
let tmModel, tmLabels;

async function loadTMModel() {
    if (window.tmImage) {
        tmModel = await tmImage.load(tmModelURL + "model.json", tmModelURL + "metadata.json");
        tmLabels = tmModel.getClassLabels();
    }
}
loadTMModel();

export async function analyzeImage() {
    const img = document.getElementById('previewImg');
    if (!img || !tmModel || !img.src || img.src === window.location.href || img.src === 'about:blank') {
        alert('กรุณาอัปโหลดหรือถ่ายภาพก่อนวิเคราะห์');
        return;
    }
    if (!(img.src.startsWith('data:') || img.src.startsWith('blob:') || img.src.startsWith('file:'))) {
        alert('รูปภาพไม่ถูกต้อง กรุณาอัปโหลดใหม่');
        return;
    }
    try {
        const prediction = await tmModel.predict(img);
        const best = prediction.reduce((a, b) => a.probability > b.probability ? a : b);
        document.getElementById('fabricType').textContent = best.className;
        document.getElementById('accuracy').textContent = (best.probability * 100).toFixed(1) + '%';
        document.getElementById('analysisResult').classList.remove('hidden');
        if (best.className === 'ลายกาบบัวจก' || best.className === 'ลายกาบบัวธรรมดา') {
            const region = document.getElementById('region');
            if (region) region.textContent = 'อุบลราชธานี';
        }
        console.log('Teachable Machine prediction:', prediction);
        const moreBtnId = 'ubon-more-btn';
        let moreBtn = document.getElementById(moreBtnId);
        if (best.className === 'ลายกาบบัวธรรมดา' || best.className === 'ลายกาบบัวจก') {
            if (!moreBtn) {
                moreBtn = document.createElement('a');
                moreBtn.id = moreBtnId;
                moreBtn.href = 'sector/Northeast/ubon.html';
                moreBtn.target = '_blank';
                moreBtn.className = 'mt-4 inline-block bg-thai-gold hover:bg-yellow-500 text-thai-blue px-4 py-2 rounded-lg font-medium transition-colors';
                moreBtn.textContent = '📖 อ่านต่อเกี่ยวกับลายนี้';
                const desc = document.getElementById('fabricDescription');
                if (desc) desc.parentNode.appendChild(moreBtn);
            } else {
                moreBtn.style.display = '';
            }
        } else if (moreBtn) {
            moreBtn.style.display = 'none';
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการทำนาย: ' + err);
        console.error(err);
    }
}

export function showFabricDetail(type) {
    alert('รายละเอียดผ้า: ' + type);
}

export function showFabricDetails() {
    alert('ข้อมูลเพิ่มเติมเกี่ยวกับผ้าชนิดนี้');
}

window.analyzer = { analyzeImage, showFabricDetail, showFabricDetails };
