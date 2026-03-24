// ============ 状态管理 ============
const state = {
    currentStep: 1,
    resumeText: '',
    resumeFile: null,
    jdText: '',
    configs: ['keyword', 'rewrite', 'structure'],
    results: null,
    currentVersion: 0
};

// ============ 工具函数 ============
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(60px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function updateStepIndicator(step) {
    for (let i = 1; i <= 3; i++) {
        const circle = document.getElementById(`step-circle-${i}`);
        const label = document.getElementById(`step-label-${i}`);
        circle.classList.remove('active', 'done');
        label.classList.remove('active');
        if (i < step) {
            circle.classList.add('done');
            circle.textContent = '✓';
        } else if (i === step) {
            circle.classList.add('active');
            circle.textContent = i;
            label.classList.add('active');
        } else {
            circle.textContent = i;
        }
        if (i < 3) {
            const line = document.getElementById(`step-line-${i}`);
            line.classList.toggle('done', i < step);
        }
    }
}

// ============ 步骤导航 ============
function goToStep(step) {
    if (step === 2 && !state.resumeText) {
        showToast('请先上传简历或粘贴简历内容', 'error');
        return;
    }
    state.currentStep = step;
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${step}`).classList.add('active');
    updateStepIndicator(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetAll() {
    state.currentStep = 1;
    state.resumeText = '';
    state.resumeFile = null;
    state.jdText = '';
    state.results = null;
    state.currentVersion = 0;
    
    document.getElementById('resume-text').value = '';
    document.getElementById('jd-text').value = '';
    document.getElementById('file-info').classList.remove('show');
    document.getElementById('upload-zone').classList.remove('has-file');
    document.getElementById('resume-file').value = '';
    
    goToStep(1);
    showToast('已重置，可以开始新的优化', 'info');
}

// ============ 文件上传 ============
document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('upload-zone');
    const resumeFile = document.getElementById('resume-file');

    uploadZone.addEventListener('click', () => resumeFile.click());
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length) handleFile(files[0]);
    });
    
    resumeFile.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });
    
    // 按钮事件绑定
    document.getElementById('btn-remove-file').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile();
    });
    
    document.getElementById('btn-step1-next').addEventListener('click', () => goToStep(2));
    document.getElementById('btn-step2-back').addEventListener('click', () => goToStep(1));
    document.getElementById('btn-optimize').addEventListener('click', startOptimize);
    document.getElementById('btn-view-optimized').addEventListener('click', () => switchResultTab('optimized'));
    document.getElementById('btn-step3-back').addEventListener('click', () => goToStep(2));
    document.getElementById('btn-restart').addEventListener('click', resetAll);
    document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);
    document.getElementById('btn-export-word').addEventListener('click', exportWord);
    document.getElementById('btn-copy-resume').addEventListener('click', copyResume);
    
    // 配置项点击
    document.querySelectorAll('.config-item').forEach(item => {
        item.addEventListener('click', () => toggleConfig(item));
    });
    
    // 标签页切换
    document.querySelectorAll('.result-tab').forEach(tab => {
        tab.addEventListener('click', () => switchResultTab(tab.dataset.tab));
    });
    
    // 版本切换
    document.querySelectorAll('.version-btn').forEach(btn => {
        btn.addEventListener('click', () => switchVersion(parseInt(btn.dataset.version)));
    });
});

function handleFile(file) {
    const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(pdf|doc|docx)$/i)) {
        showToast('仅支持 PDF、DOC、DOCX 格式', 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('文件大小不能超过 10MB', 'error');
        return;
    }
    state.resumeFile = file;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    document.getElementById('file-info').classList.add('show');
    document.getElementById('upload-zone').classList.add('has-file');

    const formData = new FormData();
    formData.append('file', file);
    showToast('正在解析简历文件...', 'info');

    fetch('/api/parse-resume', {
        method: 'POST',
        body: formData
    })
    .then(res => {
        if (!res.ok) throw new Error('解析失败');
        return res.json();
    })
    .then(data => {
        state.resumeText = data.text;
        document.getElementById('resume-text').value = data.text;
        updateResumeCharCount();
        checkStep1Valid();
        showToast('简历解析成功', 'success');
    })
    .catch(err => {
        showToast('简历解析失败，请尝试直接粘贴文本', 'error');
        console.error(err);
    });
}

function removeFile() {
    state.resumeFile = null;
    state.resumeText = document.getElementById('resume-text').value.trim();
    document.getElementById('file-info').classList.remove('show');
    document.getElementById('upload-zone').classList.remove('has-file');
    document.getElementById('resume-file').value = '';
    checkStep1Valid();
}

// ============ 文本输入 ============
document.getElementById('resume-text')?.addEventListener('input', (e) => {
    state.resumeText = e.target.value.trim();
    updateResumeCharCount();
    checkStep1Valid();
});

function updateResumeCharCount() {
    const count = document.getElementById('resume-text').value.length;
    document.getElementById('resume-char-count').textContent = count + ' 字';
}

function checkStep1Valid() {
    const btn = document.getElementById('btn-step1-next');
    btn.disabled = !state.resumeText;
}

// ============ 配置选择 ============
function toggleConfig(el) {
    el.classList.toggle('selected');
    const config = el.dataset.config;
    if (el.classList.contains('selected')) {
        if (!state.configs.includes(config)) state.configs.push(config);
    } else {
        state.configs = state.configs.filter(c => c !== config);
    }
}

// ============ 开始优化 ============
async function startOptimize() {
    state.jdText = document.getElementById('jd-text').value.trim();
    if (!state.jdText) {
        showToast('请输入职位描述', 'error');
        return;
    }
    if (state.configs.length === 0) {
        showToast('请至少选择一个优化方向', 'error');
        return;
    }

    showLoading('AI 正在分析你的简历...', '正在对比简历与岗位要求，生成优化建议');

    try {
        const res = await fetch('/api/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resume: state.resumeText,
                jd: state.jdText,
                configs: state.configs
            })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || '优化请求失败');
        }

        state.results = await res.json();
        hideLoading();
        renderResults();
        goToStep(3);
        showToast('简历优化完成', 'success');
    } catch (err) {
        hideLoading();
        showToast(err.message || '优化失败，请稍后重试', 'error');
        console.error(err);
    }
}

function showLoading(text, sub) {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-sub').textContent = sub;
    document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.remove('show');
}

// ============ 渲染结果 ============
function renderResults() {
    if (!state.results) return;
    const { score, suggestions, versions, original } = state.results;

    document.getElementById('score-number').textContent = score + '%';

    const listEl = document.getElementById('suggestion-list');
    listEl.innerHTML = suggestions.map(s => `
        <div class="suggestion-item">
            <span class="suggestion-badge ${s.priority}">${s.priority === 'high' ? '重要' : s.priority === 'medium' ? '建议' : '可选'}</span>
            <div class="suggestion-text">${s.text}</div>
        </div>
    `).join('');

    document.getElementById('original-resume').textContent = original || state.resumeText;

    if (versions && versions.length > 0) {
        renderVersion(0);
    }
}

function renderVersion(index) {
    if (!state.results || !state.results.versions || !state.results.versions[index]) return;
    state.currentVersion = index;
    const content = state.results.versions[index];
    const html = renderMarkdown(content);
    document.getElementById('optimized-resume').innerHTML = html;
}

function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }
    return text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br>');
}

function switchResultTab(tab) {
    document.querySelectorAll('.result-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.result-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${tab}`);
    });
}

function switchVersion(index) {
    document.querySelectorAll('.version-btn').forEach((b, i) => {
        b.classList.toggle('active', i === index);
    });
    renderVersion(index);
}

// ============ 导出功能 ============
async function exportPDF() {
    if (!state.results) return;
    showToast('正在生成 PDF...', 'info');
    
    try {
        const res = await fetch('/api/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: state.results.versions[state.currentVersion],
                format: 'pdf'
            })
        });
        
        if (!res.ok) throw new Error('导出失败');
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '优化后简历.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('PDF 导出成功', 'success');
    } catch (err) {
        showToast('PDF 导出失败', 'error');
        console.error(err);
    }
}

async function exportWord() {
    if (!state.results) return;
    showToast('正在生成 Word...', 'info');
    
    try {
        const res = await fetch('/api/export-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: state.results.versions[state.currentVersion]
            })
        });
        
        if (!res.ok) throw new Error('导出失败');
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '优化后简历.docx';
        a.click();
        window.URL.revokeObjectURL(url);
        showToast('Word 导出成功', 'success');
    } catch (err) {
        showToast('Word 导出失败', 'error');
        console.error(err);
    }
}

function copyResume() {
    if (!state.results) return;
    const text = state.results.versions[state.currentVersion];
    navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}
