/**
 * 数据库初始化（PostgreSQL）
 * 使用连接池，支持并发，数据持久化
 */
const { Pool } = require('pg');

// 支持 DATABASE_URL（Railway 自动注入）或单独配置
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
        ? { rejectUnauthorized: false }
        : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// 连接错误处理
pool.on('error', (err) => {
    console.error('数据库连接池异常:', err.message);
});

/**
 * 初始化数据库表（启动时调用一次）
 */
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            -- 用户表
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE,
                phone VARCHAR(20) UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                nickname VARCHAR(100) DEFAULT '',
                avatar TEXT DEFAULT '',
                plan VARCHAR(20) DEFAULT 'free' CHECK(plan IN ('free', 'monthly', 'yearly')),
                plan_expires_at TIMESTAMPTZ,
                total_optimizations INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- 使用记录表
            CREATE TABLE IF NOT EXISTS usage_records (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                action VARCHAR(20) NOT NULL CHECK(action IN ('optimize', 'export_pdf', 'export_word')),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- 订单表
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                order_no VARCHAR(50) UNIQUE NOT NULL,
                plan VARCHAR(20) NOT NULL CHECK(plan IN ('monthly', 'yearly', 'single')),
                amount INTEGER NOT NULL,
                status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'refunded')),
                pay_method VARCHAR(20) DEFAULT '',
                paid_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            -- 索引
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_records(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
        `);
        console.log('✅ 数据库表初始化完成');
    } catch (err) {
        console.error('❌ 数据库初始化失败:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };
