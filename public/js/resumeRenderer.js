/**
 * 简历结构化渲染引擎
 * 将 Markdown 格式的简历解析为结构化 HTML，支持多主题渲染
 */

const ResumeRenderer = {
    currentTheme: 'tech',

    themes: {
        tech:     { name: '科技互联网', icon: '' },
        finance:  { name: '金融商务',   icon: '' },
        creative: { name: '创意设计',   icon: '' },
        medical:  { name: '医疗科研',   icon: '' },
        classic:  { name: '经典通用',   icon: '' }
    },

    /**
     * 从 Markdown 文本解析出结构化简历数据
     * 增强版：支持多种中文简历格式
     */
    parseResume(markdown) {
        const lines = markdown.split('\n');
        const data = {
            name: '',
            contactRaw: '',
            contacts: [],
            sections: []
        };

        let currentSection = null;
        let currentItem = null;
        let headerDone = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed) continue;

            // H1 → 姓名 + 联系方式
            if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
                const headerText = trimmed.replace(/^# /, '').trim();
                const parts = headerText.split(/\s*[\|｜]\s*/);
                data.name = parts[0].replace(/\*\*/g, '').trim();
                if (parts.length > 1) {
                    data.contactRaw = parts.slice(1).join(' | ');
                }
                headerDone = false;
                continue;
            }

            // 紧跟 H1 的非标题行作为联系方式（可以有多行）
            if (data.name && !headerDone && !trimmed.startsWith('#')) {
                if (!currentSection) {
                    const contactLine = trimmed.replace(/\*\*/g, '');
                    // "求职意向：xxx" / "期望薪资：xxx" 等也归入联系方式区
                    const contactParts = contactLine.split(/\s*[\|｜]\s*/);
                    contactParts.forEach(p => {
                        const clean = p.trim();
                        if (clean) data.contacts.push(clean);
                    });
                    continue;
                }
            }

            // H2 → 板块标题
            if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
                headerDone = true;
                const title = trimmed.replace(/^## /, '').replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim();
                currentSection = {
                    title: title,
                    items: [],
                    bullets: [],
                    paragraphs: []
                };
                data.sections.push(currentSection);
                currentItem = null;
                continue;
            }

            // H3 → 经历标题（公司/学校/项目）
            if (trimmed.startsWith('### ') && currentSection) {
                headerDone = true;
                const itemHeader = trimmed.replace(/^### /, '').trim();
                // 支持多种分隔格式：| 分隔、（括号中的日期）、逗号分隔
                let company = '', role = '', date = '';
                
                // 先尝试 | 分隔
                const parts = itemHeader.split(/\s*[\|｜]\s*/);
                if (parts.length >= 2) {
                    company = (parts[0] || '').replace(/\*\*/g, '').trim();
                    role = (parts[1] || '').replace(/\*\*/g, '').trim();
                    date = (parts[2] || '').replace(/\*\*/g, '').trim();
                } else {
                    // 尝试识别括号中的日期
                    const dateInParens = itemHeader.match(/[（(](.+?)[)）]/);
                    if (dateInParens) {
                        date = dateInParens[1].trim();
                        company = itemHeader.replace(/[（(].+?[)）]/, '').replace(/\*\*/g, '').trim();
                    } else {
                        company = itemHeader.replace(/\*\*/g, '').trim();
                    }
                }
                
                currentItem = { company, role, date, bullets: [] };
                currentSection.items.push(currentItem);
                continue;
            }

            // 在 section 内识别 "公司：xxx" "职位：xxx" "时间：xxx" 格式行
            if (currentSection && currentItem) {
                const roleMatch = trimmed.match(/^(?:职位|职务|岗位|角色)[：:]\s*(.+)/);
                if (roleMatch) {
                    currentItem.role = roleMatch[1].replace(/\*\*/g, '').trim();
                    continue;
                }
                const dateMatch = trimmed.match(/^(?:时间|日期|在职时间|工作时间)[：:]\s*(.+)/);
                if (dateMatch) {
                    currentItem.date = dateMatch[1].replace(/\*\*/g, '').trim();
                    continue;
                }
                const dutyMatch = trimmed.match(/^(?:职责|职责描述|工作内容|描述)[：:]\s*(.+)/);
                if (dutyMatch) {
                    currentItem.bullets.push(dutyMatch[1].replace(/\*\*/g, '').trim());
                    continue;
                }
            }

            // 列表项
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
                headerDone = true;
                const bulletText = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim();
                if (currentItem) {
                    currentItem.bullets.push(bulletText);
                } else if (currentSection) {
                    currentSection.bullets.push(bulletText);
                }
                continue;
            }

            // 普通文本
            if (currentSection && trimmed !== '---' && !trimmed.startsWith('#')) {
                headerDone = true;
                if (currentItem) {
                    currentItem.bullets.push(trimmed);
                } else {
                    currentSection.paragraphs.push(trimmed);
                }
            }
        }

        return data;
    },

    /**
     * 渲染结构化简历数据为 HTML
     */
    renderStructured(data, theme) {
        theme = theme || this.currentTheme;

        let html = '<div class="resume-inner">';

        // Header
        html += '<div class="resume-header">';
        html += `<h1>${this.escapeHtml(data.name)}</h1>`;
        if (data.contacts.length > 0) {
            html += '<div class="contact-info">';
            data.contacts.forEach(c => {
                html += `<span>${this.escapeHtml(c)}</span>`;
            });
            html += '</div>';
        } else if (data.contactRaw) {
            html += `<div class="contact-info"><span>${this.escapeHtml(data.contactRaw)}</span></div>`;
        }
        html += '</div>';

        // Body
        html += '<div class="resume-body">';

        data.sections.forEach(section => {
            html += '<div class="resume-section">';
            html += `<div class="section-title">${this.escapeHtml(section.title)}</div>`;

            // 段落
            section.paragraphs.forEach(p => {
                html += `<p>${this.renderInline(p)}</p>`;
            });

            // 判断是否是技能类板块
            const isSkillSection = /技能|技术|skill/i.test(section.title);

            // 直接列表项
            if (section.bullets.length > 0) {
                if (isSkillSection && section.bullets.length <= 15 && section.items.length === 0) {
                    html += '<div class="skill-tags">';
                    section.bullets.forEach(b => {
                        // 尝试拆分技能标签
                        const skills = this.extractSkillTags(b);
                        skills.forEach(s => {
                            html += `<span class="skill-tag">${this.escapeHtml(s)}</span>`;
                        });
                    });
                    html += '</div>';
                } else {
                    html += '<ul>';
                    section.bullets.forEach(b => {
                        html += `<li>${this.renderInline(b)}</li>`;
                    });
                    html += '</ul>';
                }
            }

            // 经历条目
            section.items.forEach(item => {
                html += '<div class="experience-item">';
                html += '<div class="exp-header">';
                html += `<span class="exp-company">${this.renderInline(item.company)}</span>`;
                if (item.date) {
                    html += `<span class="exp-date">${this.escapeHtml(item.date)}</span>`;
                }
                html += '</div>';
                if (item.role) {
                    html += `<div class="exp-role">${this.renderInline(item.role)}</div>`;
                }
                if (item.bullets.length > 0) {
                    // 技能板块下的子项也用标签
                    if (isSkillSection && item.bullets.length <= 10) {
                        html += '<div class="skill-tags">';
                        item.bullets.forEach(b => {
                            const skills = this.extractSkillTags(b);
                            skills.forEach(s => {
                                html += `<span class="skill-tag">${this.escapeHtml(s)}</span>`;
                            });
                        });
                        html += '</div>';
                    } else {
                        html += '<ul>';
                        item.bullets.forEach(b => {
                            html += `<li>${this.renderInline(b)}</li>`;
                        });
                        html += '</ul>';
                    }
                }
                html += '</div>';
            });

            html += '</div>';
        });

        html += '</div></div>';
        return html;
    },

    /**
     * 从一行文字中提取技能标签
     */
    extractSkillTags(text) {
        // 去除 markdown 格式
        const clean = text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
        // 如果包含冒号，取冒号后面的部分
        let content = clean;
        const colonIdx = clean.search(/[：:]/);
        if (colonIdx > 0 && colonIdx < 20) {
            content = clean.substring(colonIdx + 1).trim();
        }
        // 尝试按各种分隔符拆分
        const parts = content.split(/[,，、;；\/\|]+/).map(s => s.trim()).filter(s => s.length > 0 && s.length < 40);
        if (parts.length >= 2) {
            return parts;
        }
        // 如果无法拆分，返回原文作为整体
        return [clean];
    },

    /**
     * 渲染行内 Markdown（加粗、斜体）
     */
    renderInline(text) {
        return this.escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
    },

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * 完整渲染流程：解析 Markdown + 应用主题
     */
    render(markdown, theme, container) {
        theme = theme || this.currentTheme;
        
        // 预处理：尝试修复不标准的 Markdown
        const processed = this.preprocessMarkdown(markdown);
        const data = this.parseResume(processed);

        // 只要解析到至少一个板块就用结构化渲染（姓名可以为空，用 "—" 占位）
        if (data.sections.length > 0) {
            if (!data.name) data.name = '—';
            container.innerHTML = this.renderStructured(data, theme);
        } else {
            // 回退到 Markdown 渲染，但包裹在 resume-inner 里保持样式一致
            let html = '';
            if (typeof marked !== 'undefined') {
                html = marked.parse(processed);
            } else {
                html = this.escapeHtml(processed).replace(/\n/g, '<br>');
            }
            container.innerHTML = '<div class="resume-inner resume-fallback">' + html + '</div>';
        }

        // 应用主题 class
        container.className = 'resume-preview theme-' + theme;
    },

    /**
     * 预处理非标准 Markdown，尝试转换为标准格式
     * 增强版：支持有空格的板块标题、"姓 名："前缀、混合格式等
     */
    preprocessMarkdown(text) {
        if (!text) return text;
        
        // 先做全局清理：去掉每个汉字之间的单个空格（如 "教 育 背 景" → "教育背景"）
        // 但保留英文之间的空格
        text = text.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '');
        
        let lines = text.split('\n');
        let result = [];
        let hasH1 = false;
        let hasH2Count = 0;
        
        // 检查是否已经是标准 Markdown
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('# ') && !t.startsWith('## ')) hasH1 = true;
            if (t.startsWith('## ')) hasH2Count++;
        }
        
        // 如果已经有 H1 且有 2 个以上 H2，基本是标准格式
        if (hasH1 && hasH2Count >= 2) return text;
        
        // 板块关键词（用于模糊匹配）
        const sectionKeywords = [
            '教育背景', '教育经历', '学历信息', '教育',
            '工作经历', '工作经验', '职业经历', '实习经历', '工作履历',
            '项目经验', '项目经历', '项目介绍',
            '专业技能', '技能特长', '技术能力', '技能', '技术栈', '核心技能', '技能&自评', '技能自评', '技能与自评',
            '个人信息', '基本信息', '基础信息', '联系方式',
            '自我评价', '个人评价', '自我介绍', '个人总结', '自我总结', '个人优势', '综合评价',
            '获奖情况', '荣誉奖项', '证书', '奖项荣誉', '资格证书',
            '求职意向', '目标职位', '期望职位',
            '社会实践', '课外活动', '志愿者经历', '培训经历',
            'Education', 'Experience', 'Work Experience', 'Skills', 'Projects', 'Summary'
        ];
        
        // 构建正则匹配
        const sectionRegex = new RegExp('^[\\s\\*\\#\\-\\=]*(' + sectionKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')[\\s\\*\\#\\-\\=:：]*$', 'i');
        
        let foundName = false;
        let nameLineIdx = -1;
        
        // 第一遍扫描：找到姓名行
        if (!hasH1) {
            for (let i = 0; i < Math.min(lines.length, 10); i++) {
                const trimmed = lines[i].trim();
                if (!trimmed) continue;
                if (trimmed.startsWith('#')) {
                    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
                        foundName = true;
                        nameLineIdx = i;
                    }
                    break;
                }
                
                // 识别 "姓名：李洋" 这种格式
                const nameMatch = trimmed.match(/^(?:姓\s*名|名\s*字)[：:]\s*(.+)$/);
                if (nameMatch) {
                    nameLineIdx = i;
                    foundName = true;
                    break;
                }
                
                // 邮箱行不是姓名
                if (trimmed.includes('@') || trimmed.match(/^\d{11}/) || trimmed.match(/^1[3-9]\d{9}/)) continue;
                
                // 短行且像名字（2-10个字的中文/英文名）
                const cleanText = trimmed.replace(/\*\*/g, '').trim();
                if (cleanText.length >= 2 && cleanText.length <= 20 && 
                    /^[\u4e00-\u9fa5a-zA-Z\s·•]+$/.test(cleanText) &&
                    !cleanText.includes('：') && !cleanText.includes(':')) {
                    nameLineIdx = i;
                    foundName = true;
                    break;
                }
            }
        }
        
        // 第二遍：重构文档
        let contactLines = []; // 紧跟姓名后的联系方式行
        let pastName = false;
        let firstSectionFound = false;
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            
            if (!trimmed) {
                result.push(line);
                continue;
            }
            
            // 处理已有 # 标记的行
            if (trimmed.startsWith('#')) {
                // 如果 ## 后面是板块关键词但写成了 ### 或更多，修正为 ##
                if (trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
                    const headerContent = trimmed.replace(/^#+\s*/, '').trim();
                    const cleanContent = headerContent.replace(/[\*\:：]/g, '').trim();
                    if (sectionKeywords.some(kw => cleanContent === kw || cleanContent.startsWith(kw))) {
                        result.push(`## ${headerContent.replace(/[:：]\s*$/, '')}`);
                        firstSectionFound = true;
                        continue;
                    }
                }
                result.push(line);
                if (trimmed.startsWith('## ')) firstSectionFound = true;
                continue;
            }
            
            // 姓名行处理
            if (i === nameLineIdx && !hasH1) {
                const nameMatch = trimmed.match(/^(?:姓\s*名|名\s*字)[：:]\s*(.+)$/);
                if (nameMatch) {
                    result.push(`# ${nameMatch[1].replace(/\*\*/g, '').trim()}`);
                } else {
                    result.push(`# ${trimmed.replace(/\*\*/g, '').trim()}`);
                }
                pastName = true;
                continue;
            }
            
            // 姓名行之后、第一个板块之前的行 → 联系方式/求职意向等
            if (pastName && !firstSectionFound) {
                // 检查是否是板块标题
                const cleanContent = trimmed.replace(/[\*\#\-\=\:：\s]/g, '').trim();
                const isSection = sectionKeywords.some(kw => cleanContent === kw || cleanContent.startsWith(kw));
                if (isSection) {
                    const cleanTitle = trimmed.replace(/^[\*\#\-\=]+\s*/, '').replace(/[\*\#\-\=]+\s*$/, '').replace(/[:：]\s*$/, '').trim();
                    result.push(`## ${cleanTitle}`);
                    firstSectionFound = true;
                    continue;
                }
                // 否则作为联系方式/补充信息直接保留
                result.push(line);
                continue;
            }
            
            // 识别板块标题（更宽松：允许有冒号、空格等）
            const cleanForMatch = trimmed.replace(/[\*\#\-\=\s]/g, '').replace(/[:：]\s*$/, '').trim();
            const isSectionTitle = sectionKeywords.some(kw => {
                return cleanForMatch === kw || cleanForMatch === kw.replace(/\s/g, '');
            });
            
            // 也检查原始行（保留格式检测）
            const isSectionByRegex = sectionRegex.test(trimmed);
            
            if (isSectionTitle || isSectionByRegex) {
                const cleanTitle = trimmed
                    .replace(/^[\*\#\-\=]+\s*/, '')
                    .replace(/[\*\#\-\=]+\s*$/, '')
                    .replace(/[:：]\s*$/, '')
                    .trim();
                result.push(`## ${cleanTitle}`);
                firstSectionFound = true;
                continue;
            }
            
            // 识别 "公司：xxx（时间）" 或 "公司名 | 职位 | 时间" 格式 → H3
            if (firstSectionFound && !trimmed.startsWith('-') && !trimmed.startsWith('*') && !/^\d+\./.test(trimmed)) {
                // 包含日期格式的行可能是经历标题
                const hasDate = /\d{4}[\.\-\/年]\d{0,2}[\.\-\/月]?\s*[-–~至到]\s*(?:\d{4}[\.\-\/年]?\d{0,2}[\.\-\/月]?|至今|present|now)/i.test(trimmed);
                const hasSep = /[\|｜]/.test(trimmed);
                if (hasDate || (hasSep && trimmed.length < 80)) {
                    // 检查是否已经在 ### 下，避免重复
                    const prevNonEmpty = result.filter(r => r.trim()).slice(-1)[0] || '';
                    if (!prevNonEmpty.trim().startsWith('### ')) {
                        result.push(`### ${trimmed.replace(/\*\*/g, '')}`);
                        continue;
                    }
                }
                
                // "公司：xxx" 或 "职位：xxx" 格式
                const companyMatch = trimmed.match(/^(?:公司|单位|机构|学校|院校)[：:]\s*(.+)/);
                if (companyMatch) {
                    result.push(`### ${companyMatch[1].replace(/\*\*/g, '').trim()}`);
                    continue;
                }
            }
            
            result.push(line);
        }
        
        return result.join('\n');
    },

    /**
     * 切换主题
     */
    setTheme(theme, container) {
        this.currentTheme = theme;
        // 如果有当前数据，重新渲染
        const currentMarkdown = container?.dataset?.markdown;
        if (currentMarkdown) {
            this.render(currentMarkdown, theme, container);
        } else {
            // 只切换 class
            container.className = 'resume-preview theme-' + theme;
        }
    }
};

// 导出到全局
window.ResumeRenderer = ResumeRenderer;
