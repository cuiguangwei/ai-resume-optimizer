const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 文件上传配置
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '10') * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('仅支持 PDF、DOC、DOCX 格式'));
        }
    }
});

// API 路由
const resumeParser = require('./server/services/resumeParser');
const aiOptimizer = require('./server/services/aiOptimizer');
const exportService = require('./server/services/exportService');

// 解析简历文件
app.post('/api/parse-resume', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请上传文件' });
        }
        
        const text = await resumeParser.parseFile(req.file.path, req.file.originalname);
        
        // 删除临时文件
        fs.unlinkSync(req.file.path);
        
        res.json({ text });
    } catch (error) {
        console.error('解析简历失败:', error);
        res.status(500).json({ error: error.message || '解析简历失败' });
    }
});

// AI 优化简历
app.post('/api/optimize', async (req, res) => {
    try {
        const { resume, jd, configs } = req.body;
        
        if (!resume || !jd) {
            return res.status(400).json({ error: '请提供简历和职位描述' });
        }
        
        const result = await aiOptimizer.optimize(resume, jd, configs || ['keyword', 'rewrite', 'structure']);
        res.json(result);
    } catch (error) {
        console.error('优化简历失败:', error);
        res.status(500).json({ error: error.message || '优化简历失败' });
    }
});

// 导出 PDF
app.post('/api/export-pdf', async (req, res) => {
    try {
        const { content } = req.body;
        const pdfBuffer = await exportService.generatePDF(content);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('导出PDF失败:', error);
        res.status(500).json({ error: '导出PDF失败' });
    }
});

// 导出 Word
app.post('/api/export-word', async (req, res) => {
    try {
        const { content } = req.body;
        const wordBuffer = await exportService.generateWord(content);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.docx"');
        res.send(wordBuffer);
    } catch (error) {
        console.error('导出Word失败:', error);
        res.status(500).json({ error: '导出Word失败' });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 启动服务
app.listen(PORT, () => {
    console.log(`\n🚀 AI 简历优化器服务已启动`);
    console.log(`📍 本地访问: http://localhost:${PORT}`);
    console.log(`📁 上传目录: ${path.resolve(uploadDir)}`);
    console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}\n`);
});
