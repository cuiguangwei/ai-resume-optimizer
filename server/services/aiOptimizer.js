/**
 * AI 简历优化服务
 * 支持 OpenAI 兼容接口（包括 OpenAI、DeepSeek、Claude 等）
 */

const API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const BASE_URL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

/**
 * 调用 LLM API
 */
async function callLLM(prompt, maxTokens = 4000) {
    if (!API_KEY) {
        console.warn('未配置 API Key，使用模拟数据');
        return getMockResponse(prompt);
    }

    const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                { role: 'system', content: '你是一位专业的简历优化专家，擅长根据目标职位要求优化简历，帮助求职者提高简历匹配度。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: maxTokens,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'AI 服务调用失败');
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * 优化简历
 */
async function optimize(resume, jd, configs) {
    // 1. 分析匹配度
    const analysis = await analyzeMatch(resume, jd);
    
    // 2. 生成优化建议
    const suggestions = await generateSuggestions(resume, jd, analysis);
    
    // 3. 生成多个版本的优化简历
    const versions = await generateVersions(resume, jd, configs);
    
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
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { score: 60, matched_skills: [], missing_skills: [], analysis: '分析完成' };
    } catch (error) {
        console.error('分析匹配度失败:', error);
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
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
    } catch (error) {
        console.error('生成建议失败:', error);
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
 */
async function generateVersions(resume, jd, configs) {
    const versions = [];
    
    // 版本一：突出技能匹配
    const version1 = await generateVersion(resume, jd, 'skill');
    versions.push(version1);
    
    // 版本二：突出项目经验
    const version2 = await generateVersion(resume, jd, 'project');
    versions.push(version2);
    
    // 版本三：精简一页版
    const version3 = await generateVersion(resume, jd, 'concise');
    versions.push(version3);
    
    return versions;
}

/**
 * 生成单个版本的优化简历
 */
async function generateVersion(resume, jd, style) {
    const stylePrompts = {
        skill: `优化重点：
- 重点突出与JD匹配的技术技能和关键词
- 将技能部分提前，并按匹配度排序
- 在工作经历中融入相关技能描述`,
        
        project: `优化重点：
- 详细描述与目标岗位相关的项目经验
- 突出项目成果和技术亮点
- 使用STAR法则描述项目贡献`,
        
        concise: `优化重点：
- 精简为一页简历，保留最核心内容
- 删除与目标岗位无关的经历
- 每段经历控制在3-5个要点`
    };

    const prompt = `请根据以下职位描述优化简历，${stylePrompts[style]}

职位描述：
${jd}

原始简历：
${resume}

请直接输出优化后的简历内容，使用 Markdown 格式：
- 用 # 表示姓名和联系方式
- 用 ## 表示各板块标题（如：教育背景、工作经历、项目经验、专业技能等）
- 用 ### 表示公司/学校名称
- 用 - 表示列表项
- 适当使用 **加粗** 强调重点

注意：
1. 保持真实性，不要编造虚假经历
2. 优化表述方式，使其更有影响力
3. 确保关键词与JD匹配`;

    try {
        const optimized = await callLLM(prompt, 3000);
        return optimized;
    } catch (error) {
        console.error(`生成${style}版本失败:`, error);
        return resume;
    }
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
