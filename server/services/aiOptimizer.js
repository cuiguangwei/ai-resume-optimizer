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
 * 核心策略（v4）：
 * 直接调用 3 次 AI，每次用完全不同的 prompt 和侧重点。
 * 串行调用，每个版本的 prompt 中明确禁止和其他版本雷同。
 * 这是最可靠的方案 — 不依赖解析 AI 输出格式。
 */
async function generateVersions(resume, jd, configs) {
    console.log('[generateVersions v4] 开始串行生成三个版本...');
    
    const versionPrompts = getVersionPrompts(resume, jd);
    const versions = [];
    
    for (let i = 0; i < 3; i++) {
        console.log(`[generateVersions v4] 正在生成版本${i + 1}...`);
        const version = await generateSingleVersion(versionPrompts[i], i);
        versions.push(version);
    }
    
    console.log('[generateVersions v4] 版本长度:', 
        versions.map((v, i) => `v${i+1}=${v.length}`).join(', '));
    
    return versions;
}

/**
 * 构造三个版本的 prompt（极大化差异）
 */
function getVersionPrompts(resume, jd) {
    const commonSuffix = `\n\n---\n\n职位描述（JD）：\n${jd}\n\n---\n\n原始简历内容：\n${resume}\n\n---\n\n【输出格式要求】\n使用标准 Markdown 格式输出简历：# 姓名，## 板块标题，### 公司/项目名，- 列表项。\n直接输出简历正文，不要有任何额外说明。`;

    return [
        // ========= 版本一：技能匹配版 =========
        `你是一位资深简历优化专家。请根据目标职位 JD，以"技能匹配"为核心维度优化简历。

【版本一：技能匹配版 — 必须严格执行以下规则】

1. **板块顺序（必须严格遵守）**：
   基本信息 → 求职意向 → 专业技能（★核心板块，放在最前面）→ 工作经历 → 教育背景 → 自我评价

2. **「专业技能」是本版本的核心亮点**，要求：
   - 必须放在工作经历之前
   - 按"与JD匹配度"从高到低排列
   - 每项技能标注熟练度（精通/熟练/熟悉）
   - 每项技能简述在哪个项目中使用过，体现深度
   - 至少列出 8-12 项技能，分类整理（如：编程语言、框架、工具链等）

3. **工作经历**中重点突出"用了哪些技术"，每条要点必须包含具体技能名称

4. **不要包含独立的「项目经验」板块**（把项目融入工作经历中描述）

5. 全文约 1500-2000 字${commonSuffix}`,

        // ========= 版本二：项目经验版 =========
        `你是一位资深简历优化专家。请根据目标职位 JD，以"项目经验"为核心维度优化简历。

【版本二：项目经验版 — 必须严格执行以下规则】

1. **板块顺序（必须严格遵守）**：
   基本信息 → 求职意向 → 项目经验（★核心板块，放在最前面）→ 工作经历（精简版）→ 专业技能（简列）→ 教育背景

2. **「项目经验」是本版本的核心亮点**，要求：
   - 必须放在工作经历之前
   - 每个项目用 STAR 法则展开：**背景(S)**、**任务(T)**、**行动(A)**、**结果(R)**
   - 每个项目标注"技术栈"和"担任角色"
   - 重点展示与目标岗位最相关的 2-3 个项目
   - 每个项目至少 4-6 条详细描述

3. **工作经历精简**：每段经历最多 2 条要点，一句话概括即可

4. **专业技能精简**：只列技能名称，不需要详细描述，用逗号分隔

5. **不要包含「自我评价」板块**

6. 全文约 1500-2000 字${commonSuffix}`,

        // ========= 版本三：精简一页版 =========
        `你是一位资深简历优化专家。请根据目标职位 JD，将简历精简为一页纸的精华版。

【版本三：精简一页版 — 必须严格执行以下规则】

1. **板块顺序（必须严格遵守）**：
   基本信息（一行）→ 专业技能（标签式）→ 工作经历（极简）→ 教育背景（一行）

2. **全文严格控制在 400-600 字以内**

3. **基本信息**：只保留姓名、电话、邮箱，合并为一行

4. **专业技能**：用逗号分隔的标签列表，不分类，不描述熟练度，如：
   React, TypeScript, Vue 3, Node.js, Docker, CI/CD

5. **工作经历**：
   - 每段经历最多 2 条要点
   - 每条要点不超过一行（30字以内）
   - 只保留最核心的量化成果

6. **教育背景**：学校 + 专业 + 学历 + 年份，一行搞定

7. **彻底删除以下板块**：求职意向、项目经验、自我评价、证书荣誉

8. 追求极致精炼，每个字都要有价值${commonSuffix}`
    ];
}

/**
 * 生成单个版本的优化简历
 */
async function generateSingleVersion(prompt, versionIndex) {
    // 每个版本用不同的 temperature
    const temperatures = [0.4, 0.6, 0.3];
    const temperature = temperatures[versionIndex] || 0.5;
    // 版本三 token 限制更少（精简版）
    const maxTokens = versionIndex === 2 ? 1500 : 4000;
    
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const seed = Date.now() + versionIndex * 10000 + attempt * 99999;
            const result = await callLLM(prompt, maxTokens, { temperature, seed });
            const cleaned = cleanAIOutput(result);
            
            if (isOutputGarbled(cleaned)) {
                console.warn(`[generateSingleVersion] 版本${versionIndex + 1} 第${attempt + 1}次检测到乱码`);
                if (attempt < MAX_RETRIES) continue;
                return `（版本${versionIndex + 1}生成失败，请重试）`;
            }
            
            console.log(`[generateSingleVersion] 版本${versionIndex + 1} 生成成功，长度: ${cleaned.length}`);
            return cleaned;
        } catch (error) {
            console.error(`版本${versionIndex + 1}生成失败(第${attempt + 1}次):`, error);
            if (attempt >= MAX_RETRIES) return `（版本${versionIndex + 1}生成失败，请重试）`;
        }
    }
    return `（版本${versionIndex + 1}生成失败，请重试）`;
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
    
    // 模拟三个版本的响应（根据 prompt 关键词区分版本）
    if (prompt.includes('版本一') || prompt.includes('技能匹配')) {
        return `# 张三
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 求职意向
前端开发工程师 | 期望薪资面议

## 专业技能
- **前端框架**（精通）：React 18、Vue 3、Next.js，在电商系统、营销平台等3个核心项目中深度使用
- **类型系统**（精通）：TypeScript 4.x/5.x，全量 TS 项目开发经验，熟练运用泛型、类型体操
- **构建工具**（熟练）：Webpack 5、Vite 4、Rollup，搭建过完整的前端构建和发布流水线
- **状态管理**（熟练）：Redux Toolkit、Zustand、Pinia，大规模应用状态架构设计
- **CSS 方案**（熟练）：Tailwind CSS、Styled Components、CSS Modules，响应式布局
- **服务端技术**（熟悉）：Node.js、Express、Koa，RESTful API 开发
- **容器化部署**（熟悉）：Docker、Nginx、GitHub Actions CI/CD
- **测试工具**（熟悉）：Jest、Cypress、React Testing Library、Vitest
- **性能优化**（熟悉）：Lighthouse 审计、虚拟列表、代码分割、懒加载、Service Worker

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 运用 **React 18 + TypeScript** 主导核心产品重构，使用虚拟列表和代码分割技术，首屏加载提升 40%
- 基于 **GitHub Actions + Docker** 搭建 CI/CD 流水线，部署效率提升 60%
- 推行 **TypeScript 严格模式** + ESLint + Prettier + Husky，代码缺陷率下降 35%
- 主导电商后台系统重构，使用 **React + Ant Design Pro + 微前端**方案

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 使用 **Vue 3 + Composition API** 重构业务模块，覆盖 100万+ 用户
- 基于 **IntersectionObserver** 优化图片懒加载，移动端首屏时间降低 50%
- 参与 **Vue 3 组件库**建设，沉淀 30+ 可复用组件

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020
- GPA 3.8/4.0，获校级一等奖学金

## 自我评价
- 5年前端开发经验，精通 React + TypeScript 全栈技术体系，擅长性能优化和工程化建设`;
    }
    
    if (prompt.includes('版本二') || prompt.includes('项目经验')) {
        return `# 张三
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 求职意向
前端开发工程师 | 期望薪资面议

## 项目经验
### 电商平台管理系统 | React + TypeScript + Ant Design | 技术负责人
- **背景(S)**：公司核心电商后台基于 jQuery 的旧系统，代码量超 10 万行，频繁出现性能问题，无法支撑业务快速迭代
- **任务(T)**：主导整个后台管理系统的技术选型、架构设计和团队协作
- **行动(A)**：采用 React 18 + TypeScript + Ant Design Pro 方案；设计微前端架构支持 3 个团队并行开发；实现虚拟列表处理万级商品数据；封装 20+ 通用业务组件
- **结果(R)**：页面响应速度提升 **60%**，团队开发效率提升 **30%**，系统可用性达 99.9%
- **技术栈**：React 18, TypeScript, Ant Design Pro, qiankun 微前端, Webpack 5

### 移动端 H5 营销平台 | Vue 3 + Vant + SSR | 核心开发者
- **背景(S)**：公司需要高性能的移动端营销活动页面，日均 PV 超 50 万，首屏性能要求高
- **任务(T)**：负责活动页面框架设计、核心交互开发和性能优化
- **行动(A)**：基于 Vue 3 SSR 方案优化首屏渲染；使用 IntersectionObserver 实现智能懒加载；接入 CDN 和 Service Worker 缓存策略；设计 A/B 测试框架
- **结果(R)**：首屏加载时间从 3.2s 降至 **1.5s**，用户转化率提升 **25%**，活动页面支撑了双 11 峰值流量
- **技术栈**：Vue 3, Vant 4, Nuxt SSR, Service Worker

### 前端 CI/CD 自动化平台 | Node.js + Docker + GitHub Actions
- **背景(S)**：团队 15 人，部署流程手动操作多、耗时 30 分钟、容易出错
- **任务(T)**：从零搭建覆盖构建、测试、部署全流程的自动化平台
- **行动(A)**：基于 Docker 容器化构建环境；配置 GitHub Actions 流水线；集成自动化测试和代码质量门禁
- **结果(R)**：部署时间从 30 分钟缩短至 **5 分钟**，人工操作减少 **90%**
- **技术栈**：Node.js, Docker, GitHub Actions, Nginx

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 负责核心产品前端架构，带领 5 人团队
- 主导 3 个重点项目的技术选型和落地

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 负责移动端业务模块开发和性能优化

## 专业技能
React, TypeScript, Vue 3, Next.js, Webpack, Vite, Node.js, Docker, CI/CD, Jest

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020`;
    }
    
    // 版本三：精简一页版
    return `# 张三
138-xxxx-xxxx | zhangsan@email.com | github.com/zhangsan

## 专业技能
React, TypeScript, Vue 3, Next.js, Webpack, Vite, Node.js, Docker, CI/CD, Jest, Ant Design

## 工作经历
### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 主导 React + TS 产品重构，首屏加载提升 40%
- 搭建 CI/CD 流水线，部署效率提升 60%

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- Vue 3 重构业务模块，覆盖 100万+ 用户
- 优化移动端首屏时间降低 50%

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020`;
}

module.exports = { optimize };
