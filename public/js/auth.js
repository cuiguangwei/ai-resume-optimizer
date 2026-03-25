/**
 * 用户认证与会员管理（前端）
 */
const Auth = {
    token: localStorage.getItem('auth_token') || null,
    user: null,

    /** 是否已登录 */
    isLoggedIn() {
        return !!this.token;
    },

    /** 是否是会员 */
    isVip() {
        return this.user && this.user.plan !== 'free';
    },

    /** 获取 token */
    getToken() {
        return this.token;
    },

    /** 带认证的 fetch */
    async fetch(url, options = {}) {
        if (!options.headers) options.headers = {};
        if (this.token) {
            options.headers['Authorization'] = 'Bearer ' + this.token;
        }
        const res = await fetch(url, options);

        // token 过期
        if (res.status === 401) {
            const data = await res.json().catch(() => ({}));
            if (data.code === 'TOKEN_EXPIRED' || data.code === 'AUTH_REQUIRED') {
                this.showLoginModal();
                throw new Error('请先登录');
            }
        }

        // 权限不足（免费用户限制）
        if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data.code === 'daily_limit') {
                this.showUpgradeModal('limit');
                throw new Error(data.error);
            }
            if (data.code === 'need_vip') {
                this.showUpgradeModal('export');
                throw new Error(data.error);
            }
        }

        return res;
    },

    /** 注册 */
    async register(email, password, nickname) {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, nickname })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.setAuth(data.token, data.user);
        return data;
    },

    /** 登录 */
    async login(email, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        this.setAuth(data.token, data.user);
        return data;
    },

    /** 获取当前用户信息 */
    async fetchMe() {
        if (!this.token) return null;
        try {
            const res = await this.fetch('/api/auth/me');
            if (!res.ok) {
                this.clearAuth();
                return null;
            }
            this.user = await res.json();
            this.updateUI();
            return this.user;
        } catch (e) {
            this.clearAuth();
            return null;
        }
    },

    /** 保存认证信息 */
    setAuth(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('auth_token', token);
        this.updateUI();
        this.closeModals();
    },

    /** 退出登录 */
    logout() {
        this.clearAuth();
        showToast('已退出登录', 'info');
    },

    clearAuth() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('auth_token');
        this.updateUI();
    },

    /** 更新导航栏用户状态 */
    updateUI() {
        const authArea = document.getElementById('auth-area');
        if (!authArea) return;

        if (this.user) {
            const planBadge = this.user.plan !== 'free'
                ? `<span class="plan-badge vip">${this.user.plan === 'monthly' ? '月度会员' : '年度会员'}</span>`
                : '<span class="plan-badge free">免费版</span>';
            const usageInfo = this.user.usage
                ? `<span class="usage-info">今日已用 ${this.user.usage.today}/${this.user.limits?.daily_optimizations === 999 ? '∞' : this.user.limits?.daily_optimizations} 次</span>`
                : '';
            authArea.innerHTML = `
                ${usageInfo}
                ${planBadge}
                <div class="user-menu">
                    <button class="btn btn-ghost btn-sm user-btn" onclick="Auth.toggleUserMenu()">
                        ${this.user.nickname || this.user.email.split('@')[0]}
                    </button>
                    <div class="user-dropdown" id="user-dropdown">
                        <div class="dropdown-item" onclick="Auth.showUpgradeModal('manual')">${this.isVip() ? '我的会员' : '升级会员'}</div>
                        <div class="dropdown-divider"></div>
                        <div class="dropdown-item" onclick="Auth.logout()">退出登录</div>
                    </div>
                </div>
            `;
        } else {
            authArea.innerHTML = `
                <button class="btn btn-ghost btn-sm" onclick="Auth.showLoginModal()">登录</button>
                <button class="btn btn-primary btn-sm" onclick="Auth.showRegisterModal()">注册</button>
            `;
        }
    },

    toggleUserMenu() {
        const dropdown = document.getElementById('user-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('show');
            // 点击外部关闭
            setTimeout(() => {
                const handler = (e) => {
                    if (!e.target.closest('.user-menu')) {
                        dropdown.classList.remove('show');
                        document.removeEventListener('click', handler);
                    }
                };
                document.addEventListener('click', handler);
            }, 0);
        }
    },

    // ============ 登录弹窗 ============
    showLoginModal() {
        this.closeModals();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'auth-modal';
        modal.innerHTML = `
            <div class="modal-box">
                <button class="modal-close" onclick="Auth.closeModals()">&times;</button>
                <h2 class="modal-title">登录</h2>
                <p class="modal-desc">登录后即可使用 AI 简历优化功能</p>
                <form onsubmit="Auth.handleLogin(event)" class="auth-form">
                    <div class="form-group">
                        <label>邮箱</label>
                        <input type="email" id="login-email" placeholder="your@email.com" required>
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <input type="password" id="login-password" placeholder="输入密码" required minlength="6">
                    </div>
                    <div class="form-error" id="login-error"></div>
                    <button type="submit" class="btn btn-primary btn-block" id="login-submit">登录</button>
                </form>
                <div class="modal-footer">
                    还没有账号？<a href="#" onclick="Auth.showRegisterModal(); return false;">立即注册</a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    },

    showRegisterModal() {
        this.closeModals();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'auth-modal';
        modal.innerHTML = `
            <div class="modal-box">
                <button class="modal-close" onclick="Auth.closeModals()">&times;</button>
                <h2 class="modal-title">注册</h2>
                <p class="modal-desc">创建账号，开始使用 AI 简历优化</p>
                <form onsubmit="Auth.handleRegister(event)" class="auth-form">
                    <div class="form-group">
                        <label>昵称</label>
                        <input type="text" id="reg-nickname" placeholder="你的昵称（选填）">
                    </div>
                    <div class="form-group">
                        <label>邮箱</label>
                        <input type="email" id="reg-email" placeholder="your@email.com" required>
                    </div>
                    <div class="form-group">
                        <label>密码</label>
                        <input type="password" id="reg-password" placeholder="至少 6 位" required minlength="6">
                    </div>
                    <div class="form-error" id="reg-error"></div>
                    <button type="submit" class="btn btn-primary btn-block" id="reg-submit">注册</button>
                </form>
                <div class="modal-footer">
                    已有账号？<a href="#" onclick="Auth.showLoginModal(); return false;">去登录</a>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    },

    // ============ 升级弹窗 ============
    showUpgradeModal(reason) {
        this.closeModals();
        let title = '升级会员';
        let desc = '解锁全部功能，无限次优化简历';
        if (reason === 'limit') {
            title = '今日免费次数已用完';
            desc = '升级会员可无限次使用 AI 优化';
        } else if (reason === 'export') {
            title = '导出需要会员';
            desc = '升级会员可导出 PDF/Word，使用全部行业模板';
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'upgrade-modal';
        modal.innerHTML = `
            <div class="modal-box modal-wide">
                <button class="modal-close" onclick="Auth.closeModals()">&times;</button>
                <h2 class="modal-title">${title}</h2>
                <p class="modal-desc">${desc}</p>
                <div class="plan-cards">
                    <div class="plan-card">
                        <div class="plan-name">月度会员</div>
                        <div class="plan-price"><span class="price-symbol">¥</span>29.9<span class="price-period">/月</span></div>
                        <ul class="plan-features">
                            <li>无限次 AI 优化</li>
                            <li>全部 5 套行业模板</li>
                            <li>导出 PDF/Word</li>
                            <li>详细匹配分析</li>
                        </ul>
                        <button class="btn btn-primary btn-block" onclick="Auth.handleUpgrade('monthly')">立即开通</button>
                    </div>
                    <div class="plan-card recommended">
                        <div class="plan-tag">推荐</div>
                        <div class="plan-name">年度会员</div>
                        <div class="plan-price"><span class="price-symbol">¥</span>199<span class="price-period">/年</span></div>
                        <div class="plan-save">约 ¥16.6/月，省 40%</div>
                        <ul class="plan-features">
                            <li>无限次 AI 优化</li>
                            <li>全部 5 套行业模板</li>
                            <li>导出 PDF/Word</li>
                            <li>详细匹配分析</li>
                            <li>优先使用新功能</li>
                        </ul>
                        <button class="btn btn-primary btn-block" onclick="Auth.handleUpgrade('yearly')">立即开通</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => modal.classList.add('show'), 10);
    },

    // ============ 事件处理 ============
    async handleLogin(e) {
        e.preventDefault();
        const btn = document.getElementById('login-submit');
        const errEl = document.getElementById('login-error');
        btn.disabled = true;
        btn.textContent = '登录中...';
        errEl.textContent = '';
        try {
            await this.login(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
            );
            showToast('登录成功', 'success');
            this.fetchMe(); // 刷新完整用户信息
        } catch (err) {
            errEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.textContent = '登录';
        }
    },

    async handleRegister(e) {
        e.preventDefault();
        const btn = document.getElementById('reg-submit');
        const errEl = document.getElementById('reg-error');
        btn.disabled = true;
        btn.textContent = '注册中...';
        errEl.textContent = '';
        try {
            await this.register(
                document.getElementById('reg-email').value,
                document.getElementById('reg-password').value,
                document.getElementById('reg-nickname').value
            );
            showToast('注册成功', 'success');
            this.fetchMe();
        } catch (err) {
            errEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.textContent = '注册';
        }
    },

    async handleUpgrade(plan) {
        try {
            const res = await this.fetch('/api/orders/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            this.user = data.user;
            this.updateUI();
            this.closeModals();
            showToast(data.message, 'success');
        } catch (err) {
            showToast(err.message || '支付失败', 'error');
        }
    },

    closeModals() {
        ['auth-modal', 'upgrade-modal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            }
        });
    }
};

// 页面加载时自动检查登录状态
document.addEventListener('DOMContentLoaded', () => {
    Auth.updateUI();
    if (Auth.isLoggedIn()) {
        Auth.fetchMe();
    }
});
