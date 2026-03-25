/**
 * JWT 认证中间件（异步版）
 */
const authService = require('../services/authService');

/**
 * 必须登录（未登录返回 401）
 */
async function requireAuth(req, res, next) {
    try {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
        }

        const user = await authService.getUserByToken(token);
        if (!user) {
            return res.status(401).json({ error: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('认证中间件错误:', err.message);
        res.status(500).json({ error: '认证服务异常' });
    }
}

/**
 * 可选登录（有 token 就解析，没有也放行）
 */
async function optionalAuth(req, res, next) {
    try {
        const token = extractToken(req);
        if (token) {
            const user = await authService.getUserByToken(token);
            if (user) {
                req.user = user;
            }
        }
        next();
    } catch (err) {
        // 可选认证失败不阻断
        next();
    }
}

/**
 * 检查操作权限
 */
function checkPermission(action) {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
            }
            const result = await authService.checkPermission(req.user.id, action);
            if (!result.allowed) {
                return res.status(403).json({
                    error: result.message,
                    code: result.reason,
                    upgradeUrl: '/api/plans'
                });
            }
            req.permission = result;
            next();
        } catch (err) {
            console.error('权限检查错误:', err.message);
            res.status(500).json({ error: '权限检查异常' });
        }
    };
}

function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return null;
}

module.exports = { requireAuth, optionalAuth, checkPermission };
