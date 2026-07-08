# 矩阵 CRM - Codex 接手说明

本文件给另一台电脑上的 Codex 使用。开始改动前先读本文件，再读根目录 `CLAUDE.md`，最后按需要读相关源码文件。不要只靠搜索结果改文件；真正编辑前必须打开目标文件确认上下文。

## 项目定位

这是一个教育/留学销售 Web 后台 CRM，用于客户线索、销售跟进、订单签约、收款、退款、渠道分成、转介绍收佣和后台报表。

仓库：`https://github.com/yangdyjp-glitch/ty.crm`

主分支：`main`

部署：Railway，push 到 `main` 后自动部署。

- 后端服务 Root：`backend`
- 前端服务 Root：`frontend`
- 后端公网 API：`https://tycrm-production.up.railway.app/api`
- 前端生产环境 `VITE_API_BASE` 必须是上面这个完整地址，包含 `https://` 和 `/api`

## 技术栈

- 后端：NestJS 11 + Prisma + PostgreSQL/Supabase，Node 22
- 前端：React 19 + Ant Design v6 + Vite
- 鉴权：JWT + 全局 `JwtAuthGuard` + `RolesGuard`
- 数据库同步：Railway 后端 `preDeployCommand` 会执行 `npx prisma db push --skip-generate`

## 本地目录

```text
backend/   NestJS API、Prisma schema、业务服务
frontend/  React 页面、布局、API client
CLAUDE.md  原项目上下文
CODEX.md   本文件，给 Codex 接手用
```

## 环境变量

不要提交任何 `.env`。

后端 `backend/.env` 需要：

```text
DATABASE_URL
DIRECT_URL
JWT_SECRET
PORT
```

前端本地如需直连后端，可使用 `frontend/.env`：

```text
VITE_API_BASE=http://localhost:3001/api
```

## 常用命令

在 Windows PowerShell 中，如果 `npm` 被执行策略拦截，使用 `npm.cmd`。

```text
cd backend
npm.cmd install
npm.cmd run build
npx.cmd prisma generate
```

```text
cd frontend
npm.cmd install
npm.cmd run build
```

这个项目通常不要求本地连数据库调试。改完后至少跑受影响端的 build；涉及 Prisma schema 或后端类型时，先跑 `npx.cmd prisma generate`，再跑后端 build。

## 提交和部署流程

用户要求：以后所有改动完成后，直接线上推送部署。

默认流程：

1. 从仓库根目录操作 Git，不要在 `frontend/` 里跑 Git。
2. 改动前后都看 `git status --short --branch`。
3. 不要提交用户已有的无关改动。
4. build 检查通过后提交。
5. push 到 `main`，Railway 自动部署。

提交信息结尾按项目旧约定追加：

```text
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## 角色和权限

当前角色枚举在 `backend/prisma/schema.prisma` 的 `UserRole`：

- `ADMIN`：管理员，全权后台权限
- `MARKET`：市场，登记线索、维护个人渠道、指派负责销售
- `SALES`：销售，负责自己的客户、跟进、签约、收款、退款发起
- `BUSINESS_SUPERVISOR`：营业主管，等于市场 + 销售的界面和业务能力，但不拥有管理员审核/支付/用户管理权限
- `DOWNSTREAM_SALES`：下游销售，查看分配给自己的转介绍收佣

客户数据范围由 `backend/src/common/scope.ts` 的 `customerScopeWhere(user)` 控制：

- 管理员看全部
- 销售看 `ownerUserId = user.id`
- 市场看 `enteredById = user.id`
- 营业主管看自己登记的 + 自己负责的
- 下游销售看 `downstreamSalesUserId = user.id`

新增角色或调整权限时，必须同时检查：

- 后端 `@Roles(...)`
- `customerScopeWhere`
- 前端 `frontend/src/layout/AppLayout.tsx` 菜单
- 前端页面内按钮条件
- `frontend/src/api/types.ts` 的 `ROLE_LABEL`
- 用户创建/编辑页角色选项

## 核心业务规则

- 双币种 CNY/JPY，永不折算，永不跨币种相加。
- 订单金额、收款、退款、分成都继承订单币种。
- 订单：首款必填，尾款选填，创建时生成 1 到 2 条待确认收款。
- 首款 + 尾款不等于应收时，必须填写说明。
- 退款：销售发起，管理员审核，管理员支付；退款会终止对应订单，并按比例追回佣金。
- 分成结算：管理员一步完成审核和支付。
- 核心数据使用 `deletedAt` 软删除，不做物理删除。
- 编号使用 6 位顺序号，工具函数是 `backend/src/common/util.ts` 的 `nextNo(...)`。

## 最近新增的重要功能

### 营业主管

后端：

- `backend/prisma/schema.prisma`
- `backend/src/common/scope.ts`
- 各业务 controller 的 `@Roles(...)`
- `backend/src/reports/reports.service.ts`
- `backend/src/users/users.controller.ts`
- `backend/src/customers/customers.service.ts`

前端：

- `frontend/src/api/types.ts`
- `frontend/src/layout/AppLayout.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/Customers.tsx`
- `frontend/src/pages/CustomerDetail.tsx`

营业主管可以看到并使用市场和销售相关界面：客户/线索、渠道管理、订单、收款、退款、跟进。管理员专属能力仍然只给 `ADMIN`。

### 管理员代理登录

规则来源：`E:/AIJP/Compass/docs/admin-impersonation-rules.md`

后端接口：

- `POST /auth/impersonate`
- `POST /auth/stop-impersonating`
- `GET /auth/impersonation-logs`
- `GET /auth/me` 会返回 `impersonator`

关键文件：

- `backend/src/auth/auth.service.ts`
- `backend/src/auth/auth.controller.ts`
- `backend/src/auth/jwt.strategy.ts`
- `backend/src/auth/current-user.decorator.ts`
- `backend/src/auth/dto/impersonate.dto.ts`
- `backend/prisma/schema.prisma` 的 `ImpersonationLog`

规则：

- 只有管理员可以发起代理登录。
- 不能代理自己。
- 不能嵌套代理登录。
- 只能代理启用且未删除的用户。
- 代理后权限按目标用户角色计算，不继承管理员权限。
- JWT 中保存 `impersonatorId`。
- start/stop 都写 `impersonation_logs`。

前端：

- 用户管理页：`frontend/src/pages/Users.tsx`，按钮文案是“登录该账户”
- 全局横幅：`frontend/src/components/ImpersonationBanner.tsx`
- 登录状态：`frontend/src/auth/AuthContext.tsx`
- 日志展示：`frontend/src/pages/AuditLogs.tsx` 的“代理登录日志”标签页

## UI 规范

- 背景淡绿：`#e9f5ec`
- 主色：绿色 + 金色
- 金色线条：横线 1px，竖线 2px
- 收款金额绿色：`#16a34a`
- 退款金额红色：`#dc2626`
- 侧边栏深绿到金色渐变
- 字体：思源宋体 / Noto Serif SC；数字使用 Times New Roman 技巧，见 `frontend/src/index.css`
- 表格列宽尽量稳定，订单页固定每页 12 条，不显示每页条数选择器

## 前端注意点

- `frontend/src/api/client.ts` 对 GET 有 30 分钟内存缓存。
- 任何 POST/PUT/PATCH/DELETE 成功后会清空缓存。
- 页面内如果需要强制新鲜数据，可使用 `{ noCache: true }`。
- Prisma Decimal 到前端常是字符串，回填 `InputNumber` 前必须 `Number(...)`。
- 客户号、订单号、用户名等尽量保持可点击跳详情。
- Dashboard 统计卡片应横向填满，避免超宽屏右侧留白。

## 后端注意点

- `@Public()` 只用于登录等无需鉴权接口。
- 默认全局鉴权，不加 `@Roles` 表示任意已登录用户可访问。
- 管理员专属能力必须显式 `@Roles(UserRole.ADMIN)`。
- 涉及客户、订单、收款、退款的数据读取时，优先通过 `customerScopeWhere(user)` 限制范围。
- 不要读取、重置或修改用户密码来实现代理登录。
- 对数据库 schema 有变更时，记得 `npx.cmd prisma generate`。

## 安全边界

- 不提交密钥。
- 不物理删除核心业务数据。
- 不把代理登录做成管理员万能权限套壳。
- 不允许普通用户查看代理登录日志。
- 不允许在代理登录状态下继续切换其他用户。
- 如果原管理员账户不可用，退出代理登录应失败并要求重新登录。

## 测试清单

改权限或认证时，至少检查：

- 管理员正常登录。
- 管理员能代理启用用户。
- 管理员不能代理自己。
- 管理员不能代理停用用户。
- 代理后菜单按目标用户角色变化。
- 代理状态出现顶部横幅。
- 点击“返回我的账户”能回到管理员。
- `impersonation_logs` 有 start 和 stop。
- 销售/市场/营业主管的数据范围没有越权。
- 前端 build 和后端 build 通过。

## 当前已知本地情况

如果新电脑从 GitHub 克隆，直接以远端 `main` 为准即可。旧电脑曾经有未提交的 `.gitignore` 本地改动，不要假设它属于功能提交。
