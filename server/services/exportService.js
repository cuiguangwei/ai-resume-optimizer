const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const puppeteer = require('puppeteer');
const marked = require('marked');

/**
 * 生成 PDF 文件
 */
async function generatePDF(markdownContent) {
    // 将 Markdown 转换为 HTML
    const htmlContent = marked.parse(markdownContent);
    
    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
        }
        h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 8px;
            color: #111;
            text-align: center;
        }
        h2 {
            font-size: 16px;
            font-weight: 600;
            color: #4F46E5;
            margin: 24px 0 12px;
            padding-bottom: 6px;
            border-bottom: 2px solid #E5E7EB;
        }
        h3 {
            font-size: 14px;
            font-weight: 600;
            color: #111;
            margin: 12px 0 6px;
        }
        p {
            font-size: 13px;
            margin-bottom: 8px;
        }
        ul {
            padding-left: 20px;
            margin-bottom: 8px;
        }
        li {
            font-size: 13px;
            margin-bottom: 4px;
        }
        strong {
            font-weight: 600;
        }
        em {
            font-style: normal;
            color: #666;
        }
        a {
            color: #4F46E5;
            text-decoration: none;
        }
        @media print {
            body { padding: 20px; }
        }
    </style>
</head>
<body>
${htmlContent}
</body>
</html>`;

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: {
            top: '20mm',
            right: '15mm',
            bottom: '20mm',
            left: '15mm'
        },
        printBackground: true
    });
    
    await browser.close();
    return pdfBuffer;
}

/**
 * 生成 Word 文件
 */
async function generateWord(markdownContent) {
    // 简单解析 Markdown 并转换为 Word 段落
    const lines = markdownContent.split('\n');
    const children = [];
    
    for (const line of lines) {
        if (!line.trim()) {
            children.push(new Paragraph({ text: '' }));
            continue;
        }
        
        // H1 标题
        if (line.startsWith('# ')) {
            children.push(new Paragraph({
                text: line.substring(2),
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 }
            }));
        }
        // H2 标题
        else if (line.startsWith('## ')) {
            children.push(new Paragraph({
                text: line.substring(3),
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 300, after: 100 },
                border: {
                    bottom: { color: "4F46E5", space: 1, size: 6, style: "single" }
                }
            }));
        }
        // H3 标题
        else if (line.startsWith('### ')) {
            children.push(new Paragraph({
                text: line.substring(4),
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 200, after: 80 }
            }));
        }
        // 列表项
        else if (line.startsWith('- ')) {
            const text = parseInlineFormatting(line.substring(2));
            children.push(new Paragraph({
                children: text,
                bullet: { level: 0 },
                spacing: { after: 60 }
            }));
        }
        // 普通段落
        else {
            const text = parseInlineFormatting(line);
            children.push(new Paragraph({
                children: text,
                spacing: { after: 100 }
            }));
        }
    }
    
    const doc = new Document({
        sections: [{
            properties: {},
            children
        }]
    });
    
    return Packer.toBuffer(doc);
}

/**
 * 解析行内格式（加粗、斜体等）
 */
function parseInlineFormatting(text) {
    const runs = [];
    let remaining = text;
    
    while (remaining.length > 0) {
        // 匹配 **加粗**
        const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
        if (boldMatch && boldMatch.index === 0) {
            runs.push(new TextRun({ text: boldMatch[1], bold: true }));
            remaining = remaining.substring(boldMatch[0].length);
            continue;
        }
        
        // 匹配 *斜体*
        const italicMatch = remaining.match(/\*([^*]+)\*/);
        if (italicMatch && italicMatch.index === 0) {
            runs.push(new TextRun({ text: italicMatch[1], italics: true }));
            remaining = remaining.substring(italicMatch[0].length);
            continue;
        }
        
        // 普通文本，找到下一个格式标记或到结尾
        const nextBold = remaining.indexOf('**');
        const nextItalic = remaining.indexOf('*');
        let nextFormat = -1;
        
        if (nextBold !== -1 && nextItalic !== -1) {
            nextFormat = Math.min(nextBold, nextItalic);
        } else if (nextBold !== -1) {
            nextFormat = nextBold;
        } else if (nextItalic !== -1) {
            nextFormat = nextItalic;
        }
        
        if (nextFormat > 0) {
            runs.push(new TextRun({ text: remaining.substring(0, nextFormat) }));
            remaining = remaining.substring(nextFormat);
        } else if (nextFormat === -1) {
            runs.push(new TextRun({ text: remaining }));
            break;
        } else {
            runs.push(new TextRun({ text: remaining[0] }));
            remaining = remaining.substring(1);
        }
    }
    
    return runs;
}

module.exports = { generatePDF, generateWord };
