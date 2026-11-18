# 矩阵 CRM — 跨电脑 Codex 接续开发 Handoff

> 本文件用于在另一台电脑上继续开发。第一原则：**先从 GitHub 完整克隆仓库，再配置本地环境并同步线上；不要把旧电脑的代码目录当作新起点，也不要只复制部分源码。**

## 1. 项目入口

- GitHub：`https://github.com/yangdyjp-glitch/ty.crm.git`
- 主分支：`main`
- 技术栈：NestJS + Prisma + PostgreSQL/Supabase；React + Ant Design + Vite
- Node.js：22
- 部署：Railway，`main` 推送后自动部署前后端；当前 Railway 项目整理方案另见 `RAILWAY_PROJECT_MERGE_HANDOFF.md`
- 后端线上 API：`https://tycrm-production.up.railway.app/api`

权威顺序：当前 `origin/main` 源码 > 本文件 > `CODEX.md` > `CLAUDE.md`。文档和源码冲突时，以最新源码及数据库结构为准，并更新文档。

## 2. 新电脑必须先完整下载 GitHub 仓库

不要下载 ZIP，不要浅克隆，不要先从旧电脑复制项目文件。请在新电脑 PowerShell 中执行：

```powershell
cd C:\Users\<你的用户名>\Documents\Codex
git clone https://github.com/yangdyjp-glitch/ty.crm.git
cd .\ty.crm
git fetch --all --tags --prune
git switch main
git pull --ff-only origin main
git status --short --branch
git rev-parse HEAD
```

验收结果：

- 当前分支是 `main`。
- 状态显示本地与 `origin/main` 一致。
- 工作区没有未提交文件。
- 根目录可以看到 `backend/`、`frontend/`、`HANDOFF.md`、`CODEX.md` 和 `CLAUDE.md`。

如果新电脑已经有同名旧目录，不要直接覆盖，也不要执行 `git reset --hard`。先运行 `git status --short --branch` 检查是否存在未提交改动；最稳妥的做法是把旧目录改名备份，然后按上面的步骤重新克隆。确认旧改动有用时，再逐项迁移。

## 3. 给新电脑 Codex 的第一条指令

将下面整段发给新电脑上的 Codex：

```text
请先确认当前目录是从 https://github.com/yangdyjp-glitch/ty.crm.git 完整克隆的新仓库。先阅读根目录 HANDOFF.md、CODEX.md、CLAUDE.md，再检查 git status、当前分支和 origin/main 的差异。必须先把本地 main 以 fast-forward 方式同步到最新 origin/main；保护所有已有本地改动，禁止 reset --hard 或覆盖用户文件。之后再处理我的修改要求。完成修改后执行相应构建和测试，检查差异，提交到 main 并推送 GitHub，让 Railway 自动同步线上。数据库是线上业务库，禁止 reset、seed、清库或物理删除业务数据。
```

## 4. 本地密钥和环境配置

GitHub 不包含 `.env`。请从旧电脑、Railway 或 Supabase 的安全后台单独取得密钥，**不要通过 Git 传输，也不要把真实值写入文档、聊天截图或提交记录。**

创建 `backend/.env`：

```dotenv
DATABASE_URL=<Supabase PostgreSQL 连接串>
DIRECT_URL=<Supabase PostgreSQL 直连或项目当前指定连接串>
JWT_SECRET=<现网 JWT 密钥>
PORT=3001
```

本地前端需要连接本地后端时，创建 `frontend/.env`：

```dotenv
VITE_API_BASE=http://localhost:3001/api
```

Railway 前端生产环境的 `VITE_API_BASE` 必须是：

```text
https://tycrm-production.up.railway.app/api
```

`.gitignore` 已排除 `.env`。提交前仍要再次确认这些文件没有进入 Git。

## 5. 安装依赖与首次验证

Windows PowerShell 如遇执行策略问题，统一使用 `npm.cmd` 和 `npx.cmd`。

后端：

```powershell
cd .\backend
npm.cmd install
npx.cmd prisma generate
npm.cmd run build
npm.cmd test
```

前端：

```powershell
cd ..\frontend
npm.cmd install
npm.cmd run build
npm.cmd test
```

本地启动：

```powershell
# 终端 1
cd .\backend
npm.cmd run start:dev

# 终端 2
cd .\frontend
npm.cmd run dev
```

除非明确需要，不必为了普通前端修改连接生产数据库。严禁对生产库执行以下操作：

- `npm run db:reset`
- `prisma migrate reset`
- `prisma db seed`
- 清表、删库或批量物理删除业务数据

## 6. 每次修改前：同步本地与 GitHub

从仓库根目录执行：

```powershell
git status --short --branch
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
git pull --ff-only origin main
```

如果工作区有改动，先阅读并保护它们，确认来源后再决定提交、暂存或手动合并。不要用破坏性命令清掉改动。

## 7. 每次修改后：同步 GitHub、Railway 和线上库

1. 运行受影响端的构建和测试。后端完整回归使用 `npm.cmd test`；只改财务计算时可额外用 `npm.cmd run test:finance` 快速定位。真实 PostgreSQL 集成测试只能连接专用的一次性测试库，绝不能指向线上库。
2. 检查 `git status` 和 `git diff`，不要夹带无关文件、构建产物或密钥。
3. 提交到 `main`，提交信息末尾保留项目约定：

   ```text
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

4. 推送：

   ```powershell
   git push origin main
   ```

5. Railway 会自动部署前后端服务：后端 Root 为 `backend`，前端 Root 为 `frontend`。如果 Railway 项目尚未完成合并，仍按现有两个项目分别观察部署，不要为了代码同步擅自迁移或删除服务。
6. 后端部署前会自动执行 `npx prisma db push --skip-generate && node scripts/backfill-shared-sales.js`，先同步兼容的 Prisma schema，再幂等补齐历史共同销售关系。
7. 部署后检查后端健康地址 `https://tycrm-production.up.railway.app/api/health`，再登录前端核验实际页面和业务数据。

注意：代码推送负责线上应用同步；Supabase 中的业务数据本来就是线上共享数据，不要用本地样例数据覆盖。需要修正线上数据时，必须先查询确认目标记录、币种、订单和关联收付款，再做最小范围更新并复核结果。

## 8. 当前已完成的重要业务与界面状态

- 客户状态按黄色、绿色、红色色系展示，同色系状态用不同深浅区分；筛选下拉显示各状态线索数量。
- 渠道管理主版面纵向铺满，新增高度主要分配给官方渠道区域。
- 订单页包含数量和销售人员，支持按签约月份、项目、销售人员筛选。客户当前销售取 `CustomerSales` 的有效平级关系；订单业绩取签约时固化的 `OrderSales`，不要再用旧的 `ownerUserId` 作为权限或业绩口径。
- 订单确认状态已统一颜色：服务中为绿色，待付款为橙色。
- 分成/账目页先显示现金账目，再显示分成结算；“无返佣”为嫩绿色；自渠道要显示实际渠道，而不是“无”。
- 公司直接签约且无返佣的订单，资金模式应为“公司直收”，不是“公司代收·返佣”。
- 第三方代收、自扣、公司直收等模式按各自规则计算实际入账和当前结余，CNY/JPY 不折算也不混加。
- 黄泫哲订单总额 24,000，首款和尾款各 12,000；每次到账产生 15% 返佣 1,800，两笔返佣分别显示并可分别确认支付。
- 报表已把渠道和销售合并到一页并隐藏销售漏斗；财务页支持按销售和按产品拆分，并支持报表期间筛选。
- “按产品统计客户线索”不显示“客户线索数”列。

继续调整相关功能时，先核对当前源码与线上实际数据，不要仅凭本段摘要写死客户姓名、金额或状态。

## 9. 不能破坏的核心规则

- CNY 与 JPY 永不折算、永不跨币种相加。
- 客户权限以 `CustomerSales` 的有效关系为准；订单业绩以签约时固化的 `OrderSales` 为准。多个销售平级，`ownerUserId` 只保留旧结构兼容，不得作为权限或业绩口径。
- 订单首款必填、尾款选填；每笔实际到账可形成独立返佣记录与支付状态。
- 退款按既定审核/支付流程处理，并按比例追回佣金。
- 核心业务数据使用 `deletedAt` 软删除，不做物理删除。
- 所有金额修改都要同时检查：合同金额、实际入账、返佣、自扣、退款、当前结余以及币种。
- 读取客户、订单、收款、退款时必须继续遵守角色数据范围，不能为了显示方便绕过权限。
- 管理员代理登录不能读取、重置或修改目标用户密码。

更完整的角色、权限、代理登录和 UI 规则见 `CODEX.md`。

## 10. 交付前最低检查清单

- 管理员可以正常登录；如登录失败，先查后端健康状态、Railway 日志、JWT 配置和 API 地址。
- 订单页数量、销售人员、三个筛选器和状态颜色正常。
- 现金账目中的合同金额、实际入账、返佣和当前结余一致。
- 第三方代收、公司直收、公司代收返佣、自扣、无返佣等类型至少各抽查一条。
- 黄泫哲两笔 1,800 返佣分别显示、分别可确认，合计 3,600。
- 财务报表按币种、资金模式、销售、产品拆分时总额不重复、不跨币种。
- 前后端构建和普通测试通过；需要真实 PostgreSQL 的集成测试只能使用专用测试库。
- `git status --short --branch` 干净，`main` 与 `origin/main` 一致。
- Railway 部署成功，线上登录和受影响页面复核通过。

## 11. 本 Handoff 的版本说明

本文创建时，同步到的功能基线为 `167fcd5`。新电脑接手时不要停留在该提交，必须以当时 `origin/main` 的最新提交为准；克隆后 `git log -1 --oneline` 应包含本文或更新后的提交。
