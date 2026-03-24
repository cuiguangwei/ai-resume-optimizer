#!/bin/bash

echo "========================================"
echo "  AI 简历优化器 - 启动脚本"
echo "========================================"
echo ""

# 检查 Node.js 版本
NODE_VERSION=$(node -v 2>/dev/null)
if [ -z "$NODE_VERSION" ]; then
    echo "❌ 错误：未安装 Node.js，请先安装 Node.js 18 或更高版本"
    exit 1
fi

echo "✓ Node.js 版本: $NODE_VERSION"

# 检查是否存在 node_modules
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
    echo "✓ 依赖安装完成"
fi

# 检查 .env 文件
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  警告：未找到 .env 配置文件"
    echo "   将使用模拟数据进行测试"
    echo ""
    echo "   如需使用真实 AI 服务，请："
    echo "   1. 复制 .env.example 为 .env"
    echo "   2. 配置你的 API Key"
    echo ""
fi

# 创建上传目录
mkdir -p uploads

echo "🚀 启动服务..."
echo ""

# 启动服务
node server.js
