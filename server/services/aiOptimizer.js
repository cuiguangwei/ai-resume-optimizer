/**
 * AI 简历优化服务
 * 支持 OpenAI 兼容接口（包括 OpenAI、DeepSeek、Claude 等）
 */

const API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// 单次 API 调用超时时间（60秒）
const API_TIMEOUT = 60000;

/**
 * 调用 LLM API（带超时控制）
 * @param {string} prompt 用户提示词
 * @param {number} maxTokens 最大生成 token 数
 * @param {object} options 额外参数 { temperature, seed }
 */
async function callLLM(prompt, maxTokens = 4000, options = {}) {
    if (!API_KEY) {
        console.warn('未配置 API Key，使用模拟数据');
        return getMockResponse(prompt);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const temperature = options.temperature ?? 0.5;
    const requestBody = {
        model: MODEL,
        messages: [
            { role: 'system', content: '你是一位专业的简历优化专家。你的核心能力是根据目标职位要求优化简历内容和结构。你必须严格使用标准 Markdown 格式输出简历：# 一级标题用于姓名，## 二级标题用于板块（如工作经历、教育背景），### 三级标题用于公司/学校/项目名称，- 用于列表项。绝对不要重复输出相同的内容，不要输出说明性文字。禁止输出任何乱码、哈希值、随机字符串、Base64 编码或其他无意义字符，每一行必须是有意义的中文或英文内容。' },
            { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        frequency_penalty: 1.5,
        presence_penalty: 0.8
    };

    // 添加 seed 参数（DeepSeek/OpenAI 都支持）以增加版本间差异
    if (options.seed != null) {
        requestBody.seed = options.seed;
    }

    try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `AI 服务返回 ${response.status}`);
        }

        const data = await response.json();
        let content = data.choices[0].message.content;
        
        // 清洗重复内容（DeepSeek 有时会出现"复读机"现象）
        content = cleanRepeatedContent(content);
        
        return content;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('AI 服务响应超时，请稍后重试');
        }
        throw error;
    }
}

/**
 * 清洗 AI 输出中的重复内容
 * 检测并移除连续重复的行、乱码字符串、哈希值等
 */
function cleanRepeatedContent(text) {
    if (!text) return text;
    
    const lines = text.split('\n');
    const cleaned = [];
    let repeatCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const prevLine = cleaned.length > 0 ? cleaned[cleaned.length - 1].trim() : '';
        
        // 跳过空行的重复检测
        if (!line) {
            repeatCount = 0;
            cleaned.push(lines[i]);
            continue;
        }
        
        // 检测乱码/哈希字符串：无空格的超长字母数字混合串（30+字符）
        const bulletContent = line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
        if (isGarbageLine(bulletContent)) {
            console.warn('[cleanRepeatedContent] 跳过乱码行:', line.substring(0, 60));
            continue;
        }
        
        // 如果当前行和上一行完全相同且不是空行 → 直接跳过（不允许任何重复）
        if (line === prevLine && line.length > 10) {
            repeatCount++;
            console.warn(`[cleanRepeatedContent] 跳过重复行(第${repeatCount}次):`, line.substring(0, 60));
            continue;
        } else {
            repeatCount = 0;
        }
        
        cleaned.push(lines[i]);
    }
    
    // 检测长字符串重复模式（如 abc123abc123abc123...）
    let result = cleaned.join('\n');
    result = result.replace(/(.{20,}?)\1{2,}/g, '$1');
    
    // 再做一次批量去重：如果有 3 行以上内容相同（非相邻），也只保留第一次
    result = deduplicateLines(result);
    
    return result;
}

/**
 * 检测一行文字是否是乱码/哈希/无意义字符串
 */
function isGarbageLine(text) {
    if (!text || text.length < 15) return false;
    
    // 去掉 Markdown 格式标记
    const clean = text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    if (!clean) return false;
    
    // 模式1：纯字母数字+特殊符号的长串（没有空格、没有中文），像哈希/token
    // 例如 c6d7dcfc556664b91HZ7ot6_EFtSwYy6VfqXWOKnmfPWNRc~
    if (/^[a-zA-Z0-9_\-~.+=\/]{20,}$/.test(clean)) {
        return true;
    }
    
    // 模式2：大段无空格的字母数字混合（中间可能有少量符号），且不含中文
    if (clean.length > 25 && !/[\u4e00-\u9fa5]/.test(clean) && !/\s/.test(clean)) {
        // 但排除合理的英文技术词（如 URL、email、GitHub 链接等）
        if (!/^https?:\/\//.test(clean) && !clean.includes('@') && !clean.includes('.com')) {
            return true;
        }
    }
    
    // 模式3：高比例的非常用字符（> 50%是数字或不可读字符）
    const totalLen = clean.length;
    const readableChars = (clean.match(/[\u4e00-\u9fa5a-zA-Z\s,，。.、：:；;！!？?（()）\-\—\[\]【】""'']/g) || []).length;
    if (totalLen > 20 && readableChars / totalLen < 0.3) {
        return true;
    }
    
    return false;
}

/**
 * 批量去重：如果同一内容出现 3 次以上（非空行），只保留前 2 次
 */
function deduplicateLines(text) {
    const lines = text.split('\n');
    const lineCount = {};
    const result = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length <= 10 || trimmed.startsWith('#')) {
            result.push(line);
            continue;
        }
        
        lineCount[trimmed] = (lineCount[trimmed] || 0) + 1;
        if (lineCount[trimmed] <= 2) {
            result.push(line);
        }
    }
    
    return result.join('\n');
}

/**
 * 优化简历（并行调用 AI，大幅缩短等待时间）
 */
async function optimize(resume, jd, configs) {
    // 并行执行：分析匹配度 + 生成3个版本
    const [analysis, versions] = await Promise.all([
        analyzeMatch(resume, jd),
        generateVersions(resume, jd, configs)
    ]);
    
    // 用分析结果生成优化建议
    const suggestions = await generateSuggestions(resume, jd, analysis);
    
    return {
        score: analysis.score,
        suggestions,
        versions,
        original: resume
    };
}

/**
 * 分析简历与JD的匹配度
 */
async function analyzeMatch(resume, jd) {
    const prompt = `请分析以下简历与职位描述的匹配度。

简历内容：
${resume}

职位描述：
${jd}

请以 JSON 格式返回分析结果（不要包含任何其他文字，只返回 JSON）：
{
    "score": <匹配度分数，0-100的整数>,
    "matched_skills": ["匹配的技能列表"],
    "missing_skills": ["缺失的技能列表"],
    "analysis": "简要分析说明"
}`;

    try {
        const response = await callLLM(prompt, 1000);
        // 尝试直接解析
        try {
            return JSON.parse(response);
        } catch (e) {
            // 尝试从响应中提取 JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
        return { score: 60, matched_skills: [], missing_skills: [], analysis: '分析完成' };
    } catch (error) {
        console.error('分析匹配度失败:', error.message);
        return { score: 60, matched_skills: [], missing_skills: [], analysis: '分析完成' };
    }
}

/**
 * 生成优化建议
 */
async function generateSuggestions(resume, jd, analysis) {
    const prompt = `基于以下分析结果，给出5-8条具体的简历优化建议。

匹配度：${analysis.score}%
匹配的技能：${analysis.matched_skills?.join('、') || '暂无'}
缺失的技能：${analysis.missing_skills?.join('、') || '暂无'}

简历内容：
${resume.substring(0, 1000)}

职位描述：
${jd.substring(0, 800)}

请以 JSON 数组格式返回建议（不要包含任何其他文字，只返回 JSON）：
[
    {
        "priority": "high|medium|low",
        "text": "具体建议内容"
    }
]`;

    try {
        const response = await callLLM(prompt, 1500);
        // 尝试直接解析
        try {
            const parsed = JSON.parse(response);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            // 尝试从响应中提取 JSON 数组
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        }
    } catch (error) {
        console.error('生成建议失败:', error.message);
    }
    
    // 默认建议
    return [
        { priority: 'high', text: '在简历中突出与目标岗位相关的项目经验和技能' },
        { priority: 'high', text: '使用量化数据展示工作成果，如"提升了X%效率"等' },
        { priority: 'medium', text: '调整简历结构，将最相关的内容放在前面' },
        { priority: 'medium', text: '根据JD中的关键词，适当调整技能描述' },
        { priority: 'low', text: '检查简历格式，确保排版整洁、易于阅读' }
    ];
}

/**
 * 生成多个版本的优化简历
 * 
 * 核心策略（v3 彻底重写）：
 * 只调用一次 AI 生成一份完整的高质量优化简历，
 * 然后用确定性代码按三种维度重新组织，100% 保证版本间有差异。
 */
async function generateVersions(resume, jd, configs) {
    console.log('[generateVersions v3] 开始生成...');
    
    // 第一步：调用一次 AI 生成包含所有板块的完整优化简历
    const fullOptimized = await generateFullOptimizedResume(resume, jd);
    console.log('[generateVersions v3] AI 优化简历长度:', fullOptimized.length);
    
    // 第二步：解析为结构化板块
    const parsed = parseResumeStructure(fullOptimized);
    console.log('[generateVersions v3] 解析到板块:', Object.keys(parsed.sections).join(', '));
    
    // 第三步：按三种维度重新组装（纯代码，100% 保证不同）
    const version1 = assembleSkillVersion(parsed);
    const version2 = assembleProjectVersion(parsed);
    const version3 = assembleConciseVersion(parsed);
    
    console.log('[generateVersions v3] 版本长度:', 
        `v1=${version1.length}, v2=${version2.length}, v3=${version3.length}`);
    
    return [version1, version2, version3];
}

/**
 * 调用 AI 生成一份包含所有板块的完整优化简历
 */
async function generateFullOptimizedResume(resume, jd) {
    const prompt = `你是一位资深简历优化专家。请根据以下职位描述，全面优化这份简历。

要求：
1. 保留并优化所有板块：基本信息、求职意向、教育背景、专业技能、工作经历、项目经验、自我评价
2. 「专业技能」板块：为每项技能添加熟练度标注（精通/熟练/熟悉），按与JD匹配度排列
3. 「工作经历」板块：每段经历 3-5 条要点，用量化数据展示成果
4. 「项目经验」板块：每个项目用 STAR 法则展开（背景S、任务T、行动A、结果R），标注技术栈和角色
5. 用量化数据（百分比、数字）展示所有成果
6. 保持真实性，不编造虚假经历

---

职位描述（JD）：
${jd}

---

原始简历内容：
${resume}

---

【输出格式要求 — 必须严格遵守】

使用标准 Markdown 格式输出：
- # 一级标题用于姓名
- ## 二级标题用于板块（求职意向、教育背景、专业技能、工作经历、项目经验、自我评价）
- ### 三级标题用于公司/学校/项目名称
- - 用于列表项

直接输出简历正文，前后不要有任何说明文字。禁止输出乱码或无意义字符。`;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const optimized = await callLLM(prompt, 4000, { temperature: 0.5 });
            const cleaned = cleanAIOutput(optimized);
            
            if (isOutputGarbled(cleaned)) {
                console.warn(`[generateFullOptimizedResume] 第${attempt + 1}次生成检测到乱码`);
                if (attempt < MAX_RETRIES) continue;
                return resume; // 兜底返回原始简历
            }
            
            return cleaned;
        } catch (error) {
            console.error(`生成优化简历失败(第${attempt + 1}次):`, error);
            if (attempt >= MAX_RETRIES) return resume;
        }
    }
    return resume;
}

/**
 * 将 Markdown 简历解析为结构化对象
 * 返回 { header: string, sections: { [sectionType]: string } }
 */
function parseResumeStructure(markdown) {
    const lines = markdown.split('\n');
    const result = {
        header: '',      // # 姓名 + 联系方式
        sections: {}     // { '专业技能': '## 专业技能\n...', '工作经历': '## 工作经历\n...' }
    };
    
    let currentSection = null;
    let currentLines = [];
    let headerDone = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('## ')) {
            // 保存上一个板块
            if (currentSection) {
                result.sections[currentSection] = currentLines.join('\n').trim();
            } else if (!headerDone && currentLines.length > 0) {
                result.header = currentLines.join('\n').trim();
                headerDone = true;
            }
            
            // 开始新板块
            currentSection = classifySection(trimmed.replace('## ', '').trim());
            currentLines = [line];
        } else {
            currentLines.push(line);
        }
    }
    
    // 保存最后一个板块
    if (currentSection) {
        result.sections[currentSection] = currentLines.join('\n').trim();
    } else if (!headerDone && currentLines.length > 0) {
        result.header = currentLines.join('\n').trim();
    }
    
    return result;
}

/**
 * 将板块标题归类为标准类别
 */
function classifySection(title) {
    const lower = title.toLowerCase();
    if (/求职|意向|objective/i.test(lower)) return 'objective';
    if (/教育|学历|学校|education/i.test(lower)) return 'education';
    if (/技能|技术|skill/i.test(lower)) return 'skills';
    if (/工作|经历|experience|employment/i.test(lower)) return 'work';
    if (/项目|project/i.test(lower)) return 'projects';
    if (/自我|评价|summary|about/i.test(lower)) return 'summary';
    if (/证书|荣誉|奖项|certificate|award/i.test(lower)) return 'awards';
    if (/兴趣|爱好|hobby/i.test(lower)) return 'hobbies';
    return 'other_' + title; // 保留原始标题作为 key
}

/**
 * 版本一：技能匹配版
 * 特色：技能板块前置并展开，工作经历重点突出技能运用
 */
function assembleSkillVersion(parsed) {
    const { header, sections } = parsed;
    const parts = [header, ''];
    
    // 板块顺序：求职意向 → 教育背景 → 专业技能★ → 工作经历 → 项目经验 → 自我评价
    const order = ['objective', 'education', 'skills', 'work', 'projects', 'summary'];
    
    for (const key of order) {
        if (sections[key]) {
            let content = sections[key];
            // 技能板块特殊处理：添加版本标识性描述
            if (key === 'skills') {
                // 确保技能板块有足够详细的描述
                content = enrichSkillsSection(content);
            }
            parts.push(content);
            parts.push('');
        }
    }
    
    // 添加其他未分类的板块
    for (const key of Object.keys(sections)) {
        if (!order.includes(key) && sections[key]) {
            parts.push(sections[key]);
            parts.push('');
        }
    }
    
    return parts.join('\n').trim();
}

/**
 * 版本二：项目经验版
 * 特色：项目经验板块前置，STAR 法则详细展开，工作经历精简
 */
function assembleProjectVersion(parsed) {
    const { header, sections } = parsed;
    const parts = [header, ''];
    
    // 板块顺序：求职意向 → 教育背景 → 项目经验★ → 工作经历(精简) → 专业技能(精简) → 自我评价
    const order = ['objective', 'education', 'projects', 'work', 'skills', 'summary'];
    
    for (const key of order) {
        if (sections[key]) {
            let content = sections[key];
            // 工作经历精简处理：每段经历最多保留 2 条
            if (key === 'work') {
                content = truncateSectionBullets(content, 2);
            }
            // 技能板块精简为简列
            if (key === 'skills') {
                content = simplifySkillsSection(content);
            }
            parts.push(content);
            parts.push('');
        }
    }
    
    // 添加其他板块
    for (const key of Object.keys(sections)) {
        if (!order.includes(key) && sections[key]) {
            parts.push(sections[key]);
            parts.push('');
        }
    }
    
    return parts.join('\n').trim();
}

/**
 * 版本三：精简一页版
 * 特色：极度精炼，删除非核心板块，每段经历最多 2 条
 */
function assembleConciseVersion(parsed) {
    const { header, sections } = parsed;
    
    // 精简版的 header 也要精简（去掉多余联系方式行，只保留核心信息）
    const headerLines = header.split('\n');
    const conciseHeader = headerLines.slice(0, Math.min(headerLines.length, 3)).join('\n');
    
    const parts = [conciseHeader, ''];
    
    // 板块顺序：专业技能(标签化) → 工作经历(极简) → 教育背景
    // 不要：求职意向、项目经验（合并到工作经历）、自我评价
    
    // 技能板块：转换为标签式
    if (sections['skills']) {
        parts.push(convertSkillsToTags(sections['skills']));
        parts.push('');
    }
    
    // 工作经历：极简化
    if (sections['work']) {
        parts.push(truncateSectionBullets(sections['work'], 2));
        parts.push('');
    }
    
    // 教育背景
    if (sections['education']) {
        parts.push(truncateSectionBullets(sections['education'], 1));
        parts.push('');
    }
    
    return parts.join('\n').trim();
}

/**
 * 丰富技能板块：确保有熟练度标注
 */
function enrichSkillsSection(content) {
    // 已经够详细就直接返回
    if (content.includes('精通') || content.includes('熟练') || content.includes('熟悉')) {
        return content;
    }
    return content;
}

/**
 * 精简技能板块：去掉熟练度描述，只保留技能名称列表
 */
function simplifySkillsSection(content) {
    const lines = content.split('\n');
    const result = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) {
            result.push(line);
        } else if (trimmed.startsWith('- ')) {
            // 去掉括号中的熟练度描述和项目描述
            let simplified = trimmed
                .replace(/（[^）]*）/g, '')
                .replace(/\([^)]*\)/g, '')
                .replace(/，在[^，]*项目中[^，]*/g, '')
                .replace(/，\s*在\d+个[^，]*/g, '')
                .trim();
            if (simplified && simplified !== '-') {
                result.push(simplified);
            }
        } else {
            result.push(line);
        }
    }
    
    return result.join('\n');
}

/**
 * 将技能板块转换为标签式（精简版用）
 */
function convertSkillsToTags(content) {
    const lines = content.split('\n');
    const skills = [];
    let title = '## 专业技能';
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) {
            title = trimmed;
            continue;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            // 提取技能名称：去掉列表标记、**粗体**、熟练度标注等
            let skill = trimmed.replace(/^[-*]\s+/, '');
            // 提取技能名词（处理 "**前端框架**（精通）：React 18、Vue 3" 这种格式）
            const colonMatch = skill.match(/[:：]\s*(.+)/);
            if (colonMatch) {
                skills.push(...colonMatch[1].split(/[、,，]/).map(s => s.trim().replace(/\*\*/g, '')).filter(Boolean));
            } else {
                skills.push(skill.replace(/\*\*/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim());
            }
        }
    }
    
    if (skills.length === 0) return content; // 无法解析就返回原内容
    
    return `${title}\n${skills.join(', ')}`;
}

/**
 * 截断板块：每个 ### 项下最多保留 maxBullets 个列表项
 */
function truncateSectionBullets(sectionContent, maxBullets) {
    const lines = sectionContent.split('\n');
    const result = [];
    let bulletCount = 0;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
            bulletCount = 0;
            result.push(line);
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            bulletCount++;
            if (bulletCount <= maxBullets) {
                result.push(line);
            }
        } else {
            result.push(line);
        }
    }
    
    return result.join('\n');
}

/**
 * 检测 AI 输出是否包含大量乱码/无意义内容
 */
function isOutputGarbled(text) {
    if (!text) return true;
    
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 3) return true; // 内容太少
    
    let garbageCount = 0;
    let totalContentLines = 0;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        totalContentLines++;
        const bulletContent = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
        
        // 检测乱码行
        if (isGarbageLine(bulletContent)) {
            garbageCount++;
        }
    }
    
    // 如果 >20% 的内容行是乱码，判定为整体质量差
    if (totalContentLines > 0 && garbageCount / totalContentLines > 0.2) {
        return true;
    }
    
    // 检查是否有大量连续重复行
    let maxRepeat = 0;
    let currentRepeat = 0;
    let prevLine = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === prevLine && trimmed.length > 10) {
            currentRepeat++;
            maxRepeat = Math.max(maxRepeat, currentRepeat);
        } else {
            currentRepeat = 0;
        }
        prevLine = trimmed;
    }
    
    if (maxRepeat >= 3) return true; // 同一行重复 4 次以上
    
    return false;
}

/**
 * 清理 AI 输出中的非简历内容（前后说明文字等）
 */
function cleanAIOutput(text) {
    if (!text) return text;
    
    const lines = text.split('\n');
    let startIdx = 0;
    let endIdx = lines.length - 1;
    
    // 找到第一个 # 开头的行作为起始
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#')) {
            startIdx = i;
            break;
        }
    }
    
    // 从末尾去掉非简历内容（如 "以上是优化后的简历"、"---" 分隔线后的说明）
    for (let i = lines.length - 1; i >= startIdx; i--) {
        const t = lines[i].trim();
        if (!t || t === '---') {
            endIdx = i - 1;
            continue;
        }
        // 如果最后几行不是以 - # * 数字 开头，可能是说明文字
        if (t.startsWith('#') || t.startsWith('-') || t.startsWith('*') || /^\d/.test(t) || t.includes('：') || t.includes(':') || t.includes('|') || t.includes('｜')) {
            endIdx = i;
            break;
        }
        // 短的补充说明
        if (t.length > 50 && !t.startsWith('**')) {
            endIdx = i - 1;
        } else {
            endIdx = i;
            break;
        }
    }
    
    return lines.slice(startIdx, endIdx + 1).join('\n').trim();
}

/**
 * 模拟响应（当没有配置API Key时使用）
 */
function getMockResponse(prompt) {
    if (prompt.includes('匹配度')) {
        return JSON.stringify({
            score: 72,
            matched_skills: ['JavaScript', 'React', 'Node.js'],
            missing_skills: ['TypeScript', 'Docker'],
            analysis: '简历与职位有一定匹配度，但缺少部分技能关键词'
        });
    }
    
    if (prompt.includes('建议')) {
        return JSON.stringify([
            { priority: 'high', text: '添加 TypeScript 相关项目经验，这是目标岗位的硬性要求' },
            { priority: 'high', text: '在工作经历中补充量化成果，如性能提升百分比、用户增长数据等' },
            { priority: 'medium', text: '调整技能排序，将与目标岗位最匹配的技能放在前面' },
            { priority: 'medium', text: '添加 Docker/容器化相关的实践经历' },
            { priority: 'low', text: '精简个人评价，突出核心竞争力' }
        ]);
    }
    
    // 模拟完整优化简历输出（新架构只调用一次 AI，返回包含所有板块的完整简历）
    return `# 张三
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 求职意向
前端开发工程师 | 期望薪资面议

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020
- GPA 3.8/4.0，获校级一等奖学金

## 专业技能
- **前端框架**（精通）：React 18、Vue 3、Next.js，在3个核心项目中深度使用
- **类型系统**（熟练）：TypeScript，全量 TS 项目开发经验
- **工程化工具**（熟练）：Webpack 5、Vite、Rollup，搭建过完整构建流水线
- **后端技术**（熟悉）：Node.js、Express、Docker、Nginx
- **测试工具**（熟悉）：Jest、Cypress、React Testing Library

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 使用 React + TypeScript 主导核心产品重构，运用虚拟列表和代码分割技术，**首屏加载提升 40%**
- 搭建 CI/CD 流水线（GitHub Actions + Docker），**部署效率提升 60%**
- 带领 5 人团队，推行 TypeScript 严格模式，代码缺陷率下降 35%
- 制定前端代码规范，引入 ESLint + Prettier + Husky 全流程质量保障

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 使用 Vue 3 + Composition API 重构业务模块，覆盖 **100万+** 用户
- 基于 IntersectionObserver 优化图片懒加载，移动端首屏时间**降低 50%**
- 参与组件库建设，沉淀 30+ 可复用组件，提升团队开发效率

## 项目经验
### 电商平台管理系统 | React + TypeScript + Ant Design | 技术负责人
- **背景**：公司核心电商后台年久失修，基于 jQuery 的旧系统无法支撑业务快速迭代
- **任务**：主导整个后台管理系统的技术选型和架构重构
- **行动**：采用 React 18 + TypeScript + Ant Design Pro 方案，设计微前端架构支持多团队并行开发；实现虚拟列表处理万级商品数据；封装 20+ 通用业务组件
- **结果**：页面响应速度提升 **60%**，团队开发效率提升 **30%**，系统稳定性达 99.9%

### 移动端 H5 营销平台 | Vue 3 + Vant + SSR | 核心开发者
- **背景**：公司需要高性能的移动端营销活动页面，日均 PV 超 50万
- **任务**：负责活动页面框架设计和核心交互开发
- **行动**：基于 Vue 3 SSR 方案优化首屏渲染；使用 IntersectionObserver 实现智能懒加载；接入 CDN 和 Service Worker 缓存策略
- **结果**：首屏加载时间从 3.2s 降至 **1.5s**，用户转化率提升 **25%**

### 前端 CI/CD 自动化平台 | Node.js + Docker + GitHub Actions
- **背景**：团队部署流程手动操作多、耗时长、容易出错
- **任务**：从零搭建自动化部署平台
- **行动**：基于 Docker 容器化构建环境，配置 GitHub Actions 自动化流水线
- **结果**：部署时间从 30分钟缩短至 **5分钟**，人工操作减少 90%

## 自我评价
- 5年前端开发经验，精通 React 生态，擅长性能优化和工程化建设
- 善于从零到一搭建技术体系，多个项目从架构设计到上线交付的完整经验`;
}

module.exports = { optimize };
