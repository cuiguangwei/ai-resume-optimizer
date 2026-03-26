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
 * 核心策略：串行生成 + 相似度检测 + 强制差异化
 */
async function generateVersions(resume, jd, configs) {
    const styles = ['skill', 'project', 'concise'];
    const versions = [];
    
    // 串行生成三个版本（避免并行导致模型返回相同结果/缓存命中）
    for (let i = 0; i < styles.length; i++) {
        const style = styles[i];
        // 每个版本用不同的 seed 和 temperature
        const seed = Date.now() + i * 1000 + Math.floor(Math.random() * 10000);
        const temperature = [0.4, 0.6, 0.3][i]; // 每个版本不同温度
        
        let version = await generateVersion(resume, jd, style, { seed, temperature });
        
        // 检查与已生成版本的相似度
        for (let j = 0; j < versions.length; j++) {
            if (textSimilarity(version, versions[j]) > 0.85) {
                console.warn(`[generateVersions] 版本${i+1}与版本${j+1}相似度>85%，启动强制差异化...`);
                // 用更强的差异化提示重新生成
                version = await generateVersion(resume, jd, style, { 
                    seed: seed + 99999, 
                    temperature: 0.8, 
                    forceDifferent: true 
                });
                
                // 如果仍然相似，使用编程方式强制差异化
                if (textSimilarity(version, versions[j]) > 0.85) {
                    console.warn(`[generateVersions] 版本${i+1}重试后仍相似，使用编程差异化`);
                    version = programmaticDifferentiate(version, style, resume);
                }
                break;
            }
        }
        
        versions.push(version);
    }
    
    console.log('[generateVersions] 版本长度:', versions.map((v, i) => `v${i+1}=${v?.length || 0}`).join(', '));
    console.log('[generateVersions] 版本间相似度:', 
        `v1-v2=${(textSimilarity(versions[0], versions[1]) * 100).toFixed(1)}%`,
        `v1-v3=${(textSimilarity(versions[0], versions[2]) * 100).toFixed(1)}%`,
        `v2-v3=${(textSimilarity(versions[1], versions[2]) * 100).toFixed(1)}%`
    );
    
    return versions;
}

/**
 * 计算两段文本的相似度（0-1，基于行集合的 Jaccard 相似度）
 */
function textSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    
    // 以非空行为单位计算相似度
    const linesA = new Set(a.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.length > 5));
    const linesB = new Set(b.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.length > 5));
    
    if (linesA.size === 0 && linesB.size === 0) return 1;
    if (linesA.size === 0 || linesB.size === 0) return 0;
    
    let intersection = 0;
    for (const line of linesA) {
        if (linesB.has(line)) intersection++;
    }
    
    const union = linesA.size + linesB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

/**
 * 当 AI 无法生成差异内容时，用编程方式强制差异化
 * 根据 style 重新排列简历板块，修改措辞
 */
function programmaticDifferentiate(content, style, originalResume) {
    if (!content) return content;
    
    // 解析 markdown 为板块
    const sections = parseMarkdownSections(content);
    if (sections.length < 2) return content; // 无法处理
    
    const header = sections[0]; // 姓名+联系方式
    const body = sections.slice(1);
    
    // 按板块名分类
    const sectionMap = {};
    for (const sec of body) {
        const titleLine = sec.split('\n')[0].replace(/^## /, '').trim();
        sectionMap[titleLine] = sec;
    }
    
    // 根据 style 决定板块顺序
    let orderedKeys;
    switch (style) {
        case 'skill': {
            // 技能优先
            const skillKeys = Object.keys(sectionMap).filter(k => /技能|技术|skill/i.test(k));
            const workKeys = Object.keys(sectionMap).filter(k => /工作|经历|experience/i.test(k));
            const eduKeys = Object.keys(sectionMap).filter(k => /教育|学历|education/i.test(k));
            const projKeys = Object.keys(sectionMap).filter(k => /项目|project/i.test(k));
            const restKeys = Object.keys(sectionMap).filter(k => !skillKeys.includes(k) && !workKeys.includes(k) && !eduKeys.includes(k) && !projKeys.includes(k));
            orderedKeys = [...eduKeys, ...skillKeys, ...workKeys, ...projKeys, ...restKeys];
            break;
        }
        case 'project': {
            // 项目优先
            const projKeys = Object.keys(sectionMap).filter(k => /项目|project/i.test(k));
            const workKeys = Object.keys(sectionMap).filter(k => /工作|经历|experience/i.test(k));
            const eduKeys = Object.keys(sectionMap).filter(k => /教育|学历|education/i.test(k));
            const skillKeys = Object.keys(sectionMap).filter(k => /技能|技术|skill/i.test(k));
            const restKeys = Object.keys(sectionMap).filter(k => !projKeys.includes(k) && !workKeys.includes(k) && !eduKeys.includes(k) && !skillKeys.includes(k));
            orderedKeys = [...eduKeys, ...projKeys, ...workKeys, ...skillKeys, ...restKeys];
            break;
        }
        case 'concise': {
            // 精简版：技能 → 工作 → 教育（删减项目详情）
            const skillKeys = Object.keys(sectionMap).filter(k => /技能|技术|skill/i.test(k));
            const workKeys = Object.keys(sectionMap).filter(k => /工作|经历|experience/i.test(k));
            const eduKeys = Object.keys(sectionMap).filter(k => /教育|学历|education/i.test(k));
            const restKeys = Object.keys(sectionMap).filter(k => !skillKeys.includes(k) && !workKeys.includes(k) && !eduKeys.includes(k));
            orderedKeys = [...skillKeys, ...workKeys, ...eduKeys, ...restKeys.slice(0, 1)]; // 精简版只保留1个其他板块
            break;
        }
        default:
            orderedKeys = Object.keys(sectionMap);
    }
    
    // 重新组装
    let result = header + '\n\n';
    for (const key of orderedKeys) {
        if (sectionMap[key]) {
            let sectionContent = sectionMap[key];
            // 精简版额外处理：删减每个板块的列表项
            if (style === 'concise') {
                sectionContent = truncateSection(sectionContent, 3);
            }
            result += sectionContent + '\n\n';
        }
    }
    
    return result.trim();
}

/**
 * 将 Markdown 按 ## 标题分割成板块
 */
function parseMarkdownSections(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let current = [];
    
    for (const line of lines) {
        if (line.trim().startsWith('## ') && current.length > 0) {
            sections.push(current.join('\n').trim());
            current = [];
        }
        current.push(line);
    }
    if (current.length > 0) {
        sections.push(current.join('\n').trim());
    }
    
    return sections;
}

/**
 * 截断板块：每个 ### 项下最多保留 maxBullets 个列表项
 */
function truncateSection(sectionContent, maxBullets) {
    const lines = sectionContent.split('\n');
    const result = [];
    let bulletCount = 0;
    let inItem = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('### ')) {
            bulletCount = 0;
            inItem = true;
            result.push(line);
        } else if (trimmed.startsWith('## ')) {
            result.push(line);
            inItem = false;
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
 * 生成单个版本的优化简历（带质量检测和重试）
 * @param {object} options { seed, temperature, forceDifferent }
 */
async function generateVersion(resume, jd, style, options = {}) {
    const { seed, temperature = 0.5, forceDifferent = false } = options;
    
    const stylePrompts = {
        skill: `【版本一：突出技能匹配】
你的任务是以"技能匹配"为核心重新组织简历。这个版本的核心特色是：技能板块前置并详细展开。

具体要求（必须严格执行）：
1. 板块顺序必须是：基本信息 → 求职意向 → 教育背景 → 专业技能 → 工作经历 → 项目经验 → 自我评价
2. 「专业技能」板块是这个版本的核心亮点，必须放在工作经历之前
3. 技能列表按照与JD的匹配度从高到低排列
4. 为每项技能添加熟练度标注（精通/熟练/熟悉），并简述在哪个项目中使用过
5. 在工作经历描述中，重点突出使用了哪些与JD相关的技术和技能
6. 用量化数据（百分比、数字）展示技能应用的成果`,
        
        project: `【版本二：突出项目经验】
你的任务是以"项目经验"为核心重新组织简历。这个版本的核心特色是：项目经验板块前置，使用 STAR 法则详细展开。

具体要求（必须严格执行）：
1. 板块顺序必须是：基本信息 → 求职意向 → 教育背景 → 项目经验 → 工作经历 → 专业技能 → 自我评价
2. 「项目经验」板块是这个版本的核心亮点，必须放在工作经历之前
3. 每个项目使用 STAR 法则展开描述：背景(S)、任务(T)、行动(A)、结果(R)
4. 为每个项目标注技术栈和你承担的角色
5. 重点展示与目标岗位最相关的 2-3 个项目，每个项目至少 4 条描述
6. 工作经历部分相应精简，每段经历最多 2 条要点`,
        
        concise: `【版本三：精简一页版】
你的任务是将简历精简为一页纸的精华版。这个版本的核心特色是：极度精炼，只保留最核心的信息。

具体要求（必须严格执行）：
1. 板块顺序必须是：基本信息 → 专业技能（标签式简列，不分类，直接列技能名）→ 工作经历（精简版）→ 教育背景
2. 总内容严格控制在 600 字以内（含标点）
3. 不要「项目经验」板块（合并到工作经历中用一句话提及）
4. 不要「求职意向」和「自我评价」板块
5. 每段工作经历最多 2 个要点，每个要点不超过 1 行
6. 技能部分用逗号分隔的标签列表，不要用列表格式
7. 删除所有与目标岗位无关的内容`
    };

    // 如果是强制差异化模式，添加额外强调
    let extraInstruction = '';
    if (forceDifferent) {
        extraInstruction = `

【极其重要】你之前生成的版本与其他版本过于相似。这一次你必须：
- 大幅改变板块的排列顺序
- 使用完全不同的措辞和句式
- 调整每个板块的详略程度
- 确保这个版本与其他版本有明显视觉差异
`;
    }

    const prompt = `你是一位资深简历优化专家。请根据以下职位描述，优化这份简历。

${stylePrompts[style]}${extraInstruction}

---

职位描述（JD）：
${jd}

---

原始简历内容：
${resume}

---

【输出格式要求 — 必须严格遵守】

使用标准 Markdown 格式输出。# 用于姓名，## 用于板块标题，### 用于公司/学校/项目名，- 用于列表项。
直接输出简历正文，前后不要有任何说明文字。禁止输出乱码或无意义字符。`;

    // 最多重试 2 次
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const optimized = await callLLM(prompt, 3000, { temperature, seed });
            const cleaned = cleanAIOutput(optimized);
            
            // 质量检测
            if (isOutputGarbled(cleaned)) {
                console.warn(`[generateVersion] ${style} 版本第${attempt + 1}次生成检测到乱码，${attempt < MAX_RETRIES ? '重试中...' : '使用原始简历'}`);
                if (attempt < MAX_RETRIES) continue;
                return resume;
            }
            
            return cleaned;
        } catch (error) {
            console.error(`生成${style}版本失败(第${attempt + 1}次):`, error);
            if (attempt >= MAX_RETRIES) return resume;
        }
    }
    return resume;
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
    
    // 模拟简历输出 — 根据版本类型返回不同内容
    if (prompt.includes('版本一') || prompt.includes('技能匹配')) {
        return `# 张三
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 求职意向
前端开发工程师 | 期望薪资面议

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020

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

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 使用 Vue 3 + Composition API 重构业务模块，覆盖 **100万+** 用户
- 基于 IntersectionObserver 优化图片懒加载，移动端首屏时间**降低 50%**

## 项目经验
### 电商平台管理系统 | React + TypeScript + Ant Design
- 负责订单管理、商品管理等核心模块，实现复杂表格虚拟滚动
- 封装通用业务组件 20+，团队开发效率提升 30%

## 自我评价
- 5年前端开发经验，精通 React 生态，擅长性能优化和工程化建设`;
    }
    
    if (prompt.includes('版本二') || prompt.includes('项目经验')) {
        return `# 张三
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 求职意向
前端开发工程师 | 期望薪资面议

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020

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

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 负责核心产品前端架构，带领5人团队
- 主导3个重点项目的技术选型和落地

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 负责移动端业务模块开发和性能优化

## 专业技能
- 前端：React、Vue、TypeScript、Next.js
- 工程化：Webpack、Vite、Docker、CI/CD
- 后端：Node.js、Express

## 自我评价
- 善于从零到一搭建技术体系，多个项目从架构设计到上线交付的完整经验`;
    }
    
    // 版本三：精简一页版
    return `# 张三
138-xxxx-xxxx | zhangsan@email.com | github.com/zhangsan

## 专业技能
React, TypeScript, Vue 3, Next.js, Webpack, Vite, Node.js, Docker, CI/CD, Jest

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- React + TypeScript 重构核心产品，首屏性能提升 40%，搭建 CI/CD 流水线
- 带领5人团队，主导电商管理系统等3个重点项目

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- Vue 3 开发业务模块覆盖100万+用户，移动端首屏时间降低 50%

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020`;
}

module.exports = { optimize };
