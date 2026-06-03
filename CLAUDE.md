# 矩阵 CRM — 项目说明（给 Claude 的上下文）

教育/留学销售 Web 后台 CRM。本文件供 Claude Code 快速理解项目，跨机器接续开发用。

## 技术栈
- **后端** `backend/`：NestJS + Prisma + PostgreSQL（Supabase，东京区）。Node 22。
- **前端** `frontend/`：React 19 + Ant Design v6 + Vite。
- **仓库**：GitHub `yangdyjp-glitch/ty.crm`，主分支 `main`。
- **部署**：Railway，两个服务——backend（Root=`backend`）与 frontend（Root=`frontend`），新加坡区，**push 到 main 自动部署**。
  - 后端公网：`https://tycrm-production.up.railway.app/api`
  - 前端 `VITE_API_BASE` 必须 = 上面这个完整地址（含 `https://` 和 `/api`），构建时注入。

## 环境变量（不在 Git 里，新机器需自备）
- `backend/.env`：`DATABASE_URL`（Supabase pooler，主机名 `aws-1-ap-northeast-1.pooler.supabase.com:5432`）、`DIRECT_URL`、`JWT_SECRET`、`PORT`。
- 前端本地开发：`frontend/.env` 里 `VITE_API_BASE`（本地可指向 `http://localhost:3001/api`）。
- 这些含密钥，**手动从旧机器/Railway/Supabase 后台拷贝，切勿提交到 Git**。

## 启动 / 构建
```
# 后端
cd backend && npm install && npm run build && node dist/main.js
# 前端
cd frontend && npm install && npm run dev   # 或 npm run build
```

## 核心业务规则
- **双币种 CNY/JPY，永不折算、不跨币种相加**。金额随订单记币种，收款/退款/分成继承。
- **四角色**：ADMIN（全权）/ SALES（自己负责的客户）/ MARKET（自己登记的线索，跟进仅状态）/ DOWNSTREAM（分配给自己的转介绍收佣）。数据范围由 `customerScopeWhere(user)` 控制。
- **来源**：自获取（只填获取渠道字典，不分成）/ 个人第三方 / 企业第三方（进渠道表+分成快照）。市场登记时可选企业第三方，但渠道管理里只看个人。
- **两种渠道资金结算模式**：模式一第三方代收（只记录）/ 模式二公司代收返佣（走结算工作流，服务完成后付）。第三方往来台账按币种分开。
- **退款**：3 步（销售发起→管理员审核→管理员支付）；**一律终止该订单**；佣金**等比例追回**；记名义额/现金额/抵减额三额，零现金流也照记。
- **分成结算**：合并为一步（审核+支付一次完成）。
- **订单**：首款必填 + 尾款选填 → 生成 1~2 笔待确认收款；首款+尾款≠应收时必须填说明。
- **软删除**：核心数据 `deletedAt`，不物理删。
- **编号**：6 位顺序号，前缀 用户YH/客户KH/订单DD/收款SK/退款TK/分成FC/渠道QD/合同HT；`nextNo(delegate, field, prefix)` 取 max+1。

## UI 规范
- 背景淡绿 `#e9f5ec`；主色绿+金；**所有框体直角**（borderRadius 0）；
- 字体：思源宋体 Noto Serif SC（`--font-serif`），数字用 Times New Roman（`NumTNR` @font-face + unicode-range 技巧，见 `index.css`）。
- 线条淡金色：**竖线 2px、横线 1px**。
- 收款金额绿色 `#16a34a`、退款红色 `#dc2626`（`api/money.tsx`）。主操作按钮深绿。侧边栏深绿→金渐变。
- 订单页固定 12 条/页，无每页条数选择器；表格列宽固定。
- 客户/订单号/用户名全程可点击跳详情；客户列表意向/状态/来源渠道可点击快改。

## 已知坑（重要）
- **git 从仓库根目录跑**：先 `cd /e/AIJP/CRM`（或仓库根）再 `git add 全路径`；在 `frontend/` 里跑 git 会出现 `frontend/frontend/...` 路径错。
- **Edit 前必须先 Read** 该文件（grep 不算）。
- **Prisma Decimal 字段序列化成字符串**：表单回填 InputNumber 前要 `Number()` 转换，否则报 "must be a number"（见 Channels/Products 的 openForm）。
- Windows 上 `prisma generate` 可能 EPERM（DLL 占用）：用 `prisma db push --skip-generate`，Railway 部署时会重新生成。
- 提交信息结尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## 提示
- 前端 axios `client.ts` 有 30 分钟 GET 缓存 + 变更后失效。
- 大模型接口目前仅"AI 摘要"预留（客户评分已移除）。
