# AI 简历优化器

一款基于 AI 的智能简历优化工具，可以根据目标职位描述自动优化简历，生成多个版本供选择。

## 功能特点

- **智能解析**：支持 PDF、Word 格式简历上传，自动提取文本内容
- **AI 优化**：基于 LLM 智能分析简历与职位匹配度，生成优化建议
- **多版本输出**：生成三个优化版本（技能匹配版、项目经验版、精简一页版）
- **一键导出**：支持导出 PDF、Word 格式，方便投递

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，配置你的 AI API：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务端口
PORT=3000

# LLM API 配置（支持 OpenAI 兼容接口）
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

支持的 LLM 提供商：
- OpenAI: `LLM_BASE_URL=https://api.openai.com/v1`
- DeepSeek: `LLM_BASE_URL=https://api.deepseek.com/v1`
- Claude (通过 OpenAI 兼容接口): 需要配置对应的代理地址
- 其他兼容 OpenAI 接口的服务

### 3. 启动服务

```bash
npm run dev
```

访问 http://localhost:3000 即可使用。

## 部署上线

### 方式一：传统部署

```bash
# 安装依赖
npm install --production

# 启动服务
NODE_ENV=production npm start
```

建议使用 PM2 管理进程：

```bash
npm install -g pm2
pm2 start server.js --name "resume-optimizer"
```

### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t ai-resume-optimizer .

# 运行容器
docker run -d -p 3000:3000 --env-file .env ai-resume-optimizer
```

### 方式三：云服务部署

#### 部署到腾讯云/阿里云

1. 购买云服务器（推荐 2核4G 以上）
2. 安装 Node.js 18+
3. 克隆代码并安装依赖
4. 使用 PM2 启动服务
5. 配置 Nginx 反向代理

#### 部署到 Vercel/Railway

1. 连接 GitHub 仓库
2. 配置环境变量
3. 自动部署

## 项目结构

```
ai-resume-optimizer/
├── public/                 # 前端静态文件
│   ├── index.html         # 主页面
│   ├── css/
│   │   └── style.css      # 样式文件
│   └── js/
│       ├── app.js         # 前端逻辑
│       └── marked.min.js  # Markdown 解析
├── server/                 # 后端服务
│   └── services/
│       ├── resumeParser.js # 简历解析
│       ├── aiOptimizer.js  # AI 优化
│       └── exportService.js # 导出服务
├── uploads/                # 上传目录
├── server.js              # 服务入口
├── package.json
├── Dockerfile
└── README.md
```

## API 接口

### POST /api/parse-resume
解析上传的简历文件

**请求**: multipart/form-data
- file: 简历文件（PDF/DOC/DOCX）

**响应**:
```json
{
  "text": "提取的简历文本内容"
}
```

### POST /api/optimize
优化简历

**请求**:
```json
{
  "resume": "简历文本内容",
  "jd": "职位描述",
  "configs": ["keyword", "rewrite", "structure"]
}
```

**响应**:
```json
{
  "score": 75,
  "suggestions": [
    { "priority": "high", "text": "建议内容" }
  ],
  "versions": ["版本一内容", "版本二内容", "版本三内容"],
  "original": "原始简历"
}
```

### POST /api/export-pdf
导出 PDF 文件

### POST /api/export-word
导出 Word 文件

## 注意事项

1. **API Key 安全**：请勿将 API Key 提交到代码仓库
2. **文件大小**：默认限制 10MB，可在 `.env` 中调整
3. **并发处理**：建议使用队列处理大量并发请求
4. **数据隐私**：简历内容不会被存储，处理完成后立即删除

## 许可证

MIT License
