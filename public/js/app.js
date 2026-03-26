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

    // 主题切换
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const theme = btn.dataset.theme;
            const container = document.getElementById('optimized-resume');
            if (window.ResumeRenderer) {
                ResumeRenderer.setTheme(theme, container);
                // 如果有当前版本数据，重新渲染
                if (state.results && state.results.versions && state.results.versions[state.currentVersion]) {
                    renderVersion(state.currentVersion);
                }
            }
        });
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
    // 检查登录状态
    if (!Auth.isLoggedIn()) {
        Auth.showLoginModal();
        return;
    }

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

    // 动态更新进度提示
    const progressMessages = [
        { time: 5000, text: 'AI 正在深度分析...', sub: '正在生成多个优化版本' },
        { time: 15000, text: '正在生成优化方案...', sub: '已完成分析，正在优化简历表述' },
        { time: 30000, text: '即将完成...', sub: '正在精修最终版本，请耐心等待' },
        { time: 60000, text: '还在处理中...', sub: '简历内容较多，AI 需要更多时间' },
        { time: 90000, text: '快好了...', sub: '正在做最后的检查和优化' }
    ];
    const progressTimers = progressMessages.map(msg => 
        setTimeout(() => {
            document.getElementById('loading-text').textContent = msg.text;
            document.getElementById('loading-sub').textContent = msg.sub;
        }, msg.time)
    );

    // 3 分钟总超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
        const res = await Auth.fetch('/api/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resume: state.resumeText,
                jd: state.jdText,
                configs: state.configs
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        progressTimers.forEach(t => clearTimeout(t));

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || '优化请求失败');
        }

        state.results = await res.json();
        
        // 调试：打印各版本的内容长度和差异
        if (state.results.versions) {
            console.log('[优化结果] 共', state.results.versions.length, '个版本');
            state.results.versions.forEach((v, i) => {
                console.log(`  版本${i+1}: ${v ? v.length : 0}字, 前80字: ${v ? v.substring(0, 80) : '(空)'}`);
            });
            // 检查版本间是否相同
            if (state.results.versions.length >= 2) {
                const v0 = state.results.versions[0];
                const v1 = state.results.versions[1];
                const v2 = state.results.versions[2];
                if (v0 === v1) console.warn('[警告] 版本1和版本2内容完全相同！');
                if (v0 === v2) console.warn('[警告] 版本1和版本3内容完全相同！');
                if (v1 === v2) console.warn('[警告] 版本2和版本3内容完全相同！');
            }
        }
        
        hideLoading();
        renderResults();
        goToStep(3);
        showToast('简历优化完成', 'success');
    } catch (err) {
        clearTimeout(timeoutId);
        progressTimers.forEach(t => clearTimeout(t));
        hideLoading();
        if (err.name === 'AbortError') {
            showToast('请求超时，请稍后重试。建议缩短简历或JD长度后再试', 'error');
        } else {
            showToast(err.message || '优化失败，请稍后重试', 'error');
        }
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
        // 调试输出 + 差异检测
        console.log('[renderResults] 版本数:', versions.length);
        versions.forEach((v, i) => {
            console.log(`  版本${i+1}: ${v ? v.length : 0}字`);
        });
        
        // 更新版本按钮显示版本字数信息
        const versionBtns = document.querySelectorAll('.version-btn');
        const versionLabels = ['技能匹配', '项目经验', '精简一页'];
        versionBtns.forEach((btn, i) => {
            const charCount = versions[i] ? versions[i].length : 0;
            btn.textContent = `版本${['一','二','三'][i]}：${versionLabels[i]}（${charCount}字）`;
        });
        
        renderVersion(0);
    }
}

function renderVersion(index) {
    if (!state.results || !state.results.versions || !state.results.versions[index]) return;
    state.currentVersion = index;
    let content = state.results.versions[index];
    
    // 前端防御：过滤乱码/哈希行
    content = cleanGarbageLines(content);
    
    const container = document.getElementById('optimized-resume');
    // 存储 markdown 以便切换主题时重新渲染
    container.dataset.markdown = content;
    // 使用结构化渲染引擎
    if (window.ResumeRenderer) {
        ResumeRenderer.render(content, ResumeRenderer.currentTheme, container);
    } else {
        const html = renderMarkdown(content);
        container.innerHTML = html;
    }
    
    // 调试：打印各版本内容长度
    console.log(`[版本切换] 当前版本: ${index}, 内容长度: ${content.length}, 前100字: ${content.substring(0, 100)}`);
}

/**
 * 前端防御：过滤乱码/哈希/无意义字符串
 */
function cleanGarbageLines(text) {
    if (!text) return text;
    const lines = text.split('\n');
    const cleaned = [];
    let prevTrimmed = '';
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // 跳过空行直接保留
        if (!trimmed) {
            cleaned.push(line);
            prevTrimmed = '';
            continue;
        }
        
        // 去掉列表标记后检测内容
        const bulletContent = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
        
        // 检测乱码：无空格的超长字母数字混合串
        if (bulletContent.length >= 20 && /^[a-zA-Z0-9_\-~.+=\/]{20,}$/.test(bulletContent)) {
            console.warn('[前端过滤] 跳过乱码行:', trimmed.substring(0, 60));
            continue;
        }
        
        // 检测无中文、无空格的长串
        if (bulletContent.length > 25 && !/[\u4e00-\u9fa5]/.test(bulletContent) && !/\s/.test(bulletContent)) {
            if (!/^https?:\/\//.test(bulletContent) && !bulletContent.includes('@') && !bulletContent.includes('.com')) {
                console.warn('[前端过滤] 跳过疑似乱码行:', trimmed.substring(0, 60));
                continue;
            }
        }
        
        // 连续完全相同的行，只保留第一次
        if (trimmed === prevTrimmed && trimmed.length > 10) {
            continue;
        }
        
        cleaned.push(line);
        prevTrimmed = trimmed;
    }
    
    return cleaned.join('\n');
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
    
    // 添加切换动画效果
    const container = document.getElementById('optimized-resume');
    container.style.opacity = '0.3';
    container.style.transition = 'opacity 0.15s ease';
    
    setTimeout(() => {
        renderVersion(index);
        container.style.opacity = '1';
    }, 150);
}

// ============ 导出功能 ============
async function exportPDF() {
    if (!state.results) return;
    showToast('正在生成 PDF...', 'info');
    
    try {
        const res = await Auth.fetch('/api/export-pdf', {
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
        const res = await Auth.fetch('/api/export-word', {
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
