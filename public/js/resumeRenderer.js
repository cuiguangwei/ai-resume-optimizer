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
                // 可能是 "张三 | 前端工程师" 或 "张三"
                const parts = headerText.split(/\s*\|\s*/);
                data.name = parts[0].replace(/\*\*/g, '').trim();
                if (parts.length > 1) {
                    data.contactRaw = parts.slice(1).join(' | ');
                }
                headerDone = false;
                continue;
            }

            // 紧跟 H1 的非标题行作为联系方式
            if (data.name && !headerDone && !trimmed.startsWith('#')) {
                if (!currentSection) {
                    // 提取联系方式
                    const contactLine = trimmed.replace(/\*\*/g, '');
                    const contactParts = contactLine.split(/\s*[\|｜]\s*/);
                    contactParts.forEach(p => {
                        const clean = p.trim();
                        if (clean) data.contacts.push(clean);
                    });
                    continue;
                }
            }

            // H2 → 板块标题
            if (trimmed.startsWith('## ')) {
                headerDone = true;
                const title = trimmed.replace(/^## /, '').replace(/\*\*/g, '').trim();
                currentSection = {
                    title: title,
                    items: [],
                    bullets: [],    // 直接的列表项（不在子标题下）
                    paragraphs: []  // 直接的段落文字
                };
                data.sections.push(currentSection);
                currentItem = null;
                continue;
            }

            // H3 → 经历标题（公司/学校）
            if (trimmed.startsWith('### ') && currentSection) {
                headerDone = true;
                const itemHeader = trimmed.replace(/^### /, '').trim();
                const parts = itemHeader.split(/\s*[\|｜]\s*/);
                currentItem = {
                    company: (parts[0] || '').replace(/\*\*/g, '').trim(),
                    role: (parts[1] || '').replace(/\*\*/g, '').trim(),
                    date: (parts[2] || '').replace(/\*\*/g, '').trim(),
                    bullets: []
                };
                currentSection.items.push(currentItem);
                continue;
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

        // 如果解析到了姓名和至少一个板块，用结构化渲染
        if (data.name && data.sections.length > 0) {
            container.innerHTML = this.renderStructured(data, theme);
        } else {
            // 回退到简单 Markdown 渲染
            if (typeof marked !== 'undefined') {
                container.innerHTML = marked.parse(processed);
            } else {
                container.innerHTML = '<div style="padding:40px;line-height:1.8;white-space:pre-wrap;">' + this.escapeHtml(processed) + '</div>';
            }
        }

        // 应用主题 class
        container.className = 'resume-preview theme-' + theme;
    },

    /**
     * 预处理非标准 Markdown，尝试转换为标准格式
     */
    preprocessMarkdown(text) {
        if (!text) return text;
        
        let lines = text.split('\n');
        let result = [];
        let hasH1 = false;
        let hasH2 = false;
        
        // 检查是否已经是标准 Markdown
        for (const line of lines) {
            if (line.trim().startsWith('# ') && !line.trim().startsWith('## ')) hasH1 = true;
            if (line.trim().startsWith('## ')) hasH2 = true;
        }
        
        // 如果已经有标准的标题格式，直接返回
        if (hasH1 && hasH2) return text;
        
        // 尝试智能识别并添加 Markdown 标记
        const sectionKeywords = [
            '教育背景', '教育经历', '学历', '教育',
            '工作经历', '工作经验', '职业经历', '实习经历',
            '项目经验', '项目经历', '项目',
            '专业技能', '技能特长', '技术能力', '技能', '技术栈',
            '个人信息', '基本信息', '联系方式',
            '自我评价', '个人评价', '自我介绍', '个人总结',
            '获奖情况', '荣誉奖项', '证书',
            '求职意向', '目标职位'
        ];
        
        let isFirstLine = true;
        let foundName = false;
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            
            if (!trimmed) {
                result.push(line);
                continue;
            }
            
            // 已经有 # 标记的直接保留
            if (trimmed.startsWith('#')) {
                result.push(line);
                if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) foundName = true;
                continue;
            }
            
            // 识别板块标题
            const isSectionTitle = sectionKeywords.some(kw => {
                const clean = trimmed.replace(/[\*\#\-\=\:：]/g, '').trim();
                return clean === kw || clean.startsWith(kw);
            });
            
            if (isSectionTitle) {
                const cleanTitle = trimmed.replace(/^[\*\#\-\=]+\s*/, '').replace(/[\*\#\-\=]+\s*$/, '').replace(/[:：]\s*$/, '').trim();
                result.push(`## ${cleanTitle}`);
                continue;
            }
            
            // 第一个看起来像名字的短行（2-5个字，不含特殊符号）
            if (!foundName && !hasH1 && trimmed.length <= 20 && i < 5) {
                const mightBeName = /^[\u4e00-\u9fa5a-zA-Z\s]{2,10}$/.test(trimmed.replace(/\*\*/g, ''));
                if (mightBeName && !trimmed.includes('：') && !trimmed.includes(':')) {
                    result.push(`# ${trimmed}`);
                    foundName = true;
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
