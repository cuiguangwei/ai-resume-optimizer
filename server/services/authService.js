/**
 * 用户认证服务（PostgreSQL 异步版）
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'resume-optimizer-secret-key-change-in-production';
const JWT_EXPIRES = '7d';

/**
 * 注册
 */
async function register(email, password, nickname) {
    if (!email || !password) {
        throw new Error('邮箱和密码不能为空');
    }
    if (password.length < 6) {
        throw new Error('密码至少 6 位');
    }

    // 检查是否已注册
    const { rows: existing } = await pool.query(
        'SELECT id FROM users WHERE email = $1', [email]
    );
    if (existing.length > 0) {
        throw new Error('该邮箱已注册');
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
        'INSERT INTO users (email, password_hash, nickname) VALUES ($1, $2, $3) RETURNING *',
        [email, passwordHash, nickname || email.split('@')[0]]
    );

    const user = rows[0];
    return {
        user: sanitizeUser(user),
        token: generateToken(user.id)
    };
}

/**
 * 登录
 */
async function login(email, password) {
    if (!email || !password) {
        throw new Error('邮箱和密码不能为空');
    }

    const { rows } = await pool.query(
        'SELECT * FROM users WHERE email = $1', [email]
    );
    const user = rows[0];
    if (!user) {
        throw new Error('邮箱或密码错误');
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
        throw new Error('邮箱或密码错误');
    }

    return {
        user: sanitizeUser(user),
        token: generateToken(user.id)
    };
}

/**
 * 根据 token 获取用户信息
 */
async function getUserByToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE id = $1', [decoded.userId]
        );
        if (rows.length === 0) return null;
        return sanitizeUser(rows[0]);
    } catch (e) {
        return null;
    }
}

/**
 * 获取用户完整信息（含用量统计）
 */
async function getUserProfile(userId) {
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE id = $1', [userId]
    );
    const user = rows[0];
    if (!user) throw new Error('用户不存在');

    // 今日使用次数
    const todayResult = await pool.query(
        `SELECT COUNT(*) as count FROM usage_records 
         WHERE user_id = $1 AND action = 'optimize' AND created_at::date = CURRENT_DATE`,
        [userId]
    );

    // 本月使用次数
    const monthResult = await pool.query(
        `SELECT COUNT(*) as count FROM usage_records 
         WHERE user_id = $1 AND action = 'optimize' 
         AND to_char(created_at, 'YYYY-MM') = to_char(NOW(), 'YYYY-MM')`,
        [userId]
    );

    const plan = await getEffectivePlan(user);
    const profile = sanitizeUser(user);
    profile.plan = plan; // 使用有效计划（可能已过期降级）
    profile.usage = {
        today: parseInt(todayResult.rows[0].count),
        month: parseInt(monthResult.rows[0].count),
        total: user.total_optimizations
    };
    profile.limits = getPlanLimits(plan);

    return profile;
}

/**
 * 各套餐的限额配置
 */
function getPlanLimits(plan) {
    const plans = {
        free: {
            name: '免费版',
            daily_optimizations: 1,
            can_export: false,
            themes: ['classic'],
            price: 0
        },
        monthly: {
            name: '月度会员',
            daily_optimizations: 999,
            can_export: true,
            themes: ['tech', 'finance', 'creative', 'medical', 'classic'],
            price: 2990  // 29.90 元（分为单位）
        },
        yearly: {
            name: '年度会员',
            daily_optimizations: 999,
            can_export: true,
            themes: ['tech', 'finance', 'creative', 'medical', 'classic'],
            price: 19900  // 199.00 元（分为单位）
        }
    };
    return plans[plan] || plans.free;
}

/**
 * 检查用户是否有权执行操作
 */
async function checkPermission(userId, action) {
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE id = $1', [userId]
    );
    const user = rows[0];
    if (!user) throw new Error('用户不存在');

    const plan = await getEffectivePlan(user);
    const limits = getPlanLimits(plan);

    if (action === 'optimize') {
        // 免费用户每日限额检查
        if (plan === 'free') {
            const todayResult = await pool.query(
                `SELECT COUNT(*) as count FROM usage_records 
                 WHERE user_id = $1 AND action = 'optimize' AND created_at::date = CURRENT_DATE`,
                [userId]
            );
            if (parseInt(todayResult.rows[0].count) >= limits.daily_optimizations) {
                return { allowed: false, reason: 'daily_limit', message: '今日免费次数已用完，升级会员可无限使用' };
            }
        }
        return { allowed: true };
    }

    if (action === 'export_pdf' || action === 'export_word') {
        if (!limits.can_export) {
            return { allowed: false, reason: 'need_vip', message: '导出功能需要升级会员' };
        }
        return { allowed: true };
    }

    if (action === 'theme') {
        return { allowed: true, themes: limits.themes };
    }

    return { allowed: true };
}

/**
 * 记录使用
 */
async function recordUsage(userId, action) {
    await pool.query(
        'INSERT INTO usage_records (user_id, action) VALUES ($1, $2)',
        [userId, action]
    );
    if (action === 'optimize') {
        await pool.query(
            'UPDATE users SET total_optimizations = total_optimizations + 1, updated_at = NOW() WHERE id = $1',
            [userId]
        );
    }
}

/**
 * 获取有效套餐（检查过期时间）
 */
async function getEffectivePlan(user) {
    if (user.plan === 'free') return 'free';
    if (!user.plan_expires_at) return 'free';
    if (new Date(user.plan_expires_at) < new Date()) {
        // 已过期，降级
        await pool.query(
            "UPDATE users SET plan = 'free', updated_at = NOW() WHERE id = $1",
            [user.id]
        );
        return 'free';
    }
    return user.plan;
}

/**
 * 升级套餐
 */
async function upgradePlan(userId, plan) {
    const { rows } = await pool.query(
        'SELECT * FROM users WHERE id = $1', [userId]
    );
    if (rows.length === 0) throw new Error('用户不存在');

    let expiresAt;
    if (plan === 'monthly') {
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (plan === 'yearly') {
        expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const result = await pool.query(
        'UPDATE users SET plan = $1, plan_expires_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
        [plan, expiresAt, userId]
    );

    return result.rows[0];
}

/**
 * 创建订单
 */
async function createOrder(userId, orderNo, plan, amount, status) {
    await pool.query(
        'INSERT INTO orders (user_id, order_no, plan, amount, status) VALUES ($1, $2, $3, $4, $5)',
        [userId, orderNo, plan, amount, status]
    );
}

/**
 * 更新订单状态
 */
async function updateOrderStatus(orderNo, status) {
    await pool.query(
        "UPDATE orders SET status = $1, paid_at = NOW() WHERE order_no = $2",
        [status, orderNo]
    );
}

// 辅助：去除敏感字段
function sanitizeUser(user) {
    const { password_hash, ...safe } = user;
    return safe;
}

function generateToken(userId) {
    return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

module.exports = {
    register,
    login,
    getUserByToken,
    getUserProfile,
    getPlanLimits,
    checkPermission,
    recordUsage,
    upgradePlan,
    createOrder,
    updateOrderStatus
};
