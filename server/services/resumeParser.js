const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

/**
 * 解析简历文件，提取文本内容
 */
async function parseFile(filePath, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    
    switch (ext) {
        case '.pdf':
            return parsePDF(filePath);
        case '.doc':
        case '.docx':
            return parseWord(filePath);
        default:
            throw new Error('不支持的文件格式');
    }
}

/**
 * 解析 PDF 文件
 */
async function parsePDF(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return cleanText(data.text);
}

/**
 * 解析 Word 文件
 */
async function parseWord(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value);
}

/**
 * 清理文本
 */
function cleanText(text) {
    return text
        .replace(/\r\n/g, '\n')           // 统一换行符
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')       // 多个空行合并
        .replace(/[ \t]+/g, ' ')          // 多个空格合并
        .replace(/^[ \t]+/gm, '')         // 删除行首空格
        .replace(/[ \t]+$/gm, '')         // 删除行尾空格
        .trim();
}

module.exports = { parseFile };
