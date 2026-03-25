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

// 数据库 & 认证
const { pool, initDB } = require('./server/db');
const authService = require('./server/services/authService');
const { requireAuth, optionalAuth, checkPermission } = require('./server/middleware/auth');

// API 路由
const resumeParser = require('./server/services/resumeParser');
const aiOptimizer = require('./server/services/aiOptimizer');
const exportService = require('./server/services/exportService');

// ============ 用户认证 API ============

// 注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, nickname } = req.body;
        const result = await authService.register(email, password, nickname);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 获取当前用户信息
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const profile = await authService.getUserProfile(req.user.id);
        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取套餐列表
app.get('/api/plans', (req, res) => {
    res.json({
        plans: [
            {
                id: 'free',
                name: '免费版',
                price: 0,
                priceLabel: '免费',
                features: ['每日 1 次优化', '经典通用模板', '基础匹配分析'],
                limitations: ['不可导出 PDF/Word', '仅 1 套模板']
            },
            {
                id: 'monthly',
                name: '月度会员',
                price: 2990,
                priceLabel: '¥29.9/月',
                features: ['无限次优化', '全部 5 套行业模板', '导出 PDF/Word', '详细匹配分析'],
                limitations: [],
                recommended: true
            },
            {
                id: 'yearly',
                name: '年度会员',
                price: 19900,
                priceLabel: '¥199/年',
                priceNote: '约 ¥16.6/月，省 40%',
                features: ['无限次优化', '全部 5 套行业模板', '导出 PDF/Word', '详细匹配分析', '优先使用新功能'],
                limitations: []
            }
        ]
    });
});

// 模拟支付（后续接入微信支付后替换）
app.post('/api/orders/create', requireAuth, async (req, res) => {
    try {
        const { plan } = req.body;
        if (!['monthly', 'yearly'].includes(plan)) {
            return res.status(400).json({ error: '无效的套餐' });
        }
        const limits = authService.getPlanLimits(plan);
        const orderNo = 'ORD' + Date.now() + Math.random().toString(36).substring(2, 8);
        
        // 创建订单
        await authService.createOrder(req.user.id, orderNo, plan, limits.price, 'pending');

        // 模拟支付：直接标记为已支付并升级（正式接入支付后移到回调中）
        await authService.updateOrderStatus(orderNo, 'paid');
        await authService.upgradePlan(req.user.id, plan);

        const profile = await authService.getUserProfile(req.user.id);
        res.json({
            success: true,
            message: '支付成功，已升级为' + limits.name,
            order_no: orderNo,
            user: profile
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ 原有业务 API（加入权限控制）============

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

// AI 优化简历（需登录 + 用量检查）
app.post('/api/optimize', requireAuth, checkPermission('optimize'), async (req, res) => {
    try {
        const { resume, jd, configs } = req.body;
        
        if (!resume || !jd) {
            return res.status(400).json({ error: '请提供简历和职位描述' });
        }
        
        const result = await aiOptimizer.optimize(resume, jd, configs || ['keyword', 'rewrite', 'structure']);
        
        // 记录使用
        await authService.recordUsage(req.user.id, 'optimize');
        
        res.json(result);
    } catch (error) {
        console.error('优化简历失败:', error);
        res.status(500).json({ error: error.message || '优化简历失败' });
    }
});

// 导出 PDF（需登录 + 会员）
app.post('/api/export-pdf', requireAuth, checkPermission('export_pdf'), async (req, res) => {
    try {
        const { content } = req.body;
        const pdfBuffer = await exportService.generatePDF(content);
        
        await authService.recordUsage(req.user.id, 'export_pdf');
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('导出PDF失败:', error);
        res.status(500).json({ error: '导出PDF失败' });
    }
});

// 导出 Word（需登录 + 会员）
app.post('/api/export-word', requireAuth, checkPermission('export_word'), async (req, res) => {
    try {
        const { content } = req.body;
        const wordBuffer = await exportService.generateWord(content);
        
        await authService.recordUsage(req.user.id, 'export_word');
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="resume.docx"');
        res.send(wordBuffer);
    } catch (error) {
        console.error('导出Word失败:', error);
        res.status(500).json({ error: '导出Word失败' });
    }
});

// 健康检查
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'error', database: 'disconnected', error: err.message });
    }
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 启动服务（先初始化数据库，再监听端口）
async function start() {
    try {
        await initDB();
        
        app.listen(PORT, () => {
            const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
            console.log(`\n🚀 AI 简历优化器服务已启动`);
            console.log(`📍 本地访问: http://localhost:${PORT}`);
            console.log(`📁 上传目录: ${path.resolve(uploadDir)}`);
            console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🗄️  数据库: PostgreSQL (已连接)`);
            console.log(`🔑 API Key: ${apiKey ? '已配置 (' + apiKey.substring(0, 6) + '...)' : '未配置（将使用模拟数据）'}`);
            console.log(`🌐 Base URL: ${process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || '未配置'}`);
            console.log(`🤖 Model: ${process.env.LLM_MODEL || '未配置'}\n`);
        });
    } catch (err) {
        console.error('❌ 启动失败:', err.message);
        process.exit(1);
    }
}

start();
