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
 */
async function callLLM(prompt, maxTokens = 4000) {
    if (!API_KEY) {
        console.warn('未配置 API Key，使用模拟数据');
        return getMockResponse(prompt);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: '你是一位专业的简历优化专家。你的核心能力是根据目标职位要求优化简历内容和结构。你必须严格使用标准 Markdown 格式输出简历：# 一级标题用于姓名，## 二级标题用于板块（如工作经历、教育背景），### 三级标题用于公司/学校/项目名称，- 用于列表项。绝对不要重复输出相同的内容，不要输出说明性文字。' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: maxTokens,
                temperature: 0.7,
                frequency_penalty: 1.2,
                presence_penalty: 0.6
            }),
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
 * 检测并移除连续重复的行或段落
 */
function cleanRepeatedContent(text) {
    if (!text) return text;
    
    const lines = text.split('\n');
    const cleaned = [];
    let repeatCount = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const prevLine = cleaned.length > 0 ? cleaned[cleaned.length - 1].trim() : '';
        
        // 如果当前行和上一行完全相同且不是空行，且不是常见的列表分隔
        if (line === prevLine && line.length > 10) {
            repeatCount++;
            // 允许最多1次重复（比如表格分隔线），超过就跳过
            if (repeatCount > 1) continue;
        } else {
            repeatCount = 0;
        }
        
        cleaned.push(lines[i]);
    }
    
    // 检测长字符串重复模式（如 abc123abc123abc123...）
    let result = cleaned.join('\n');
    result = result.replace(/(.{20,}?)\1{3,}/g, '$1');
    
    return result;
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
 * 生成多个版本的优化简历（并行生成）
 */
async function generateVersions(resume, jd, configs) {
    const [version1, version2, version3] = await Promise.all([
        generateVersion(resume, jd, 'skill'),
        generateVersion(resume, jd, 'project'),
        generateVersion(resume, jd, 'concise')
    ]);
    
    return [version1, version2, version3];
}

/**
 * 生成单个版本的优化简历
 */
async function generateVersion(resume, jd, style) {
    const stylePrompts = {
        skill: `【版本一：突出技能匹配】
你的任务是以"技能匹配"为核心重新组织简历。具体要求：
1. 将"专业技能"板块放在工作经历之前（紧跟教育背景后面）
2. 技能列表按照与JD的匹配度从高到低排列
3. 在每段工作经历的描述中，重点突出使用了哪些与JD相关的技术和技能
4. 用量化数据（百分比、数字）展示技能应用的成果
5. 为技能添加熟练度标注（如：精通、熟练、熟悉）`,
        
        project: `【版本二：突出项目经验】
你的任务是以"项目经验"为核心重新组织简历。具体要求：
1. 将"项目经验"板块提前到仅次于教育背景的位置
2. 每个项目使用 STAR 法则详细描述：背景(Situation)、任务(Task)、行动(Action)、结果(Result)
3. 为每个项目标注技术栈和个人角色
4. 重点展示与目标岗位最相关的 2-3 个项目，充分展开描述
5. 其他项目可以简要提及
6. 工作经历部分相应精简，突出与项目相关的职责`,
        
        concise: `【版本三：精简一页版】
你的任务是将简历精简为一页纸的精华版。具体要求：
1. 总内容控制在 800 字以内
2. 只保留与目标岗位最相关的经历和技能
3. 每段工作经历最多 3 个要点，每个要点不超过 2 行
4. 删除与目标岗位无关的经历、项目和技能
5. 合并同类技能，用简洁的标签式列举
6. 自我评价精简为 1-2 句话的核心亮点`
    };

    const prompt = `你是一位资深简历优化专家。请根据以下职位描述，优化这份简历。

${stylePrompts[style]}

---

职位描述（JD）：
${jd}

---

原始简历内容：
${resume}

---

【输出格式要求 — 必须严格遵守，这是最重要的规则】

你必须使用标准 Markdown 格式输出，格式模板如下：

# 姓名
电话：xxx | 邮箱：xxx | 其他联系方式

## 求职意向
目标职位 | 期望薪资

## 教育背景
### 学校名称 | 学历/专业 | 起止时间
- 相关描述

## 工作经历
### 公司名称 | 职位 | 起止时间
- 工作描述1（用量化数据展示成果）
- 工作描述2

## 项目经验
### 项目名称 | 技术栈
- 项目描述（背景、职责、成果）

## 专业技能
- 技能分类1：技能A、技能B、技能C
- 技能分类2：技能D、技能E

## 自我评价
- 核心优势描述

格式铁律（违反将被拒绝）：
1. 第一行必须是 # 开头的姓名（一级标题），如 # 张三
2. 每个板块标题必须用 ## 开头（二级标题），如 ## 工作经历
3. 公司/学校/项目名称必须用 ### 开头（三级标题），如 ### 腾讯 | 高级工程师 | 2022-至今
4. 列表项必须用 - 开头
5. 禁止使用代码块、表格、HTML标签
6. 保持真实性，不编造虚假经历
7. 直接输出简历正文，前后不要有任何说明文字、分析或总结`;

    try {
        const optimized = await callLLM(prompt, 3000);
        // 二次清理：去掉 AI 可能加的前后说明文字
        return cleanAIOutput(optimized);
    } catch (error) {
        console.error(`生成${style}版本失败:`, error);
        return resume;
    }
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
    
    // 模拟简历输出
    return `# 张三 | 前端开发工程师
电话：138-xxxx-xxxx | 邮箱：zhangsan@email.com | GitHub: github.com/zhangsan

## 专业技能
- **前端开发**：精通 React、Vue 框架，熟悉 TypeScript
- **工程化**：熟练使用 Webpack、Vite 构建工具，了解 CI/CD 流程
- **后端基础**：熟悉 Node.js、Express，了解 Docker 容器化部署

## 工作经历

### XX科技有限公司 | 高级前端工程师 | 2022.03 - 至今
- 负责公司核心产品前端架构设计，使用 React + TypeScript 重构主站，**性能提升 40%**
- 主导前端工程化建设，搭建 CI/CD 流水线，**部署效率提升 60%**
- 带领 5 人团队完成多个核心项目，代码质量和交付效率显著提升

### YY互联网公司 | 前端开发工程师 | 2020.07 - 2022.02
- 使用 Vue.js 开发多个业务模块，覆盖用户 100 万+
- 优化移动端 H5 页面，首屏加载时间**降低 50%**
- 参与组件库建设，沉淀 30+ 可复用组件

## 教育背景
### XX大学 | 计算机科学与技术 | 本科 | 2016 - 2020

## 项目经验
### 电商平台管理系统
- 技术栈：React + TypeScript + Ant Design
- 负责订单管理、商品管理等核心模块开发
- 实现复杂表格组件，支持大数据量渲染`;
}

module.exports = { optimize };
