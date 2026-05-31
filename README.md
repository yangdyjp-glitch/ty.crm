# TY CRM — 客户与渠道管理系统（精简版一期）

面向教育 / 留学 / 课程销售业务的轻量化 **Web 后台 CRM**，打通客户全生命周期闭环：
获客 → 跟进 → 签约收款 → 服务 → 渠道分成结算 → 退款处理 → 数据报表。

## 技术栈
- **后端**：NestJS（TypeScript）+ Prisma + PostgreSQL（Supabase）
- **前端**：React + Ant Design（Vite）
- **鉴权**：JWT + 角色守卫（RBAC）

## 目录结构
```
backend/    NestJS 后端（API、Prisma 模型、业务逻辑）
frontend/   React + Ant Design 前端
```

## 核心特性
- **四角色权限**：市场 / 销售 / 下游销售 / 管理员，按数据范围隔离可见数据
- **双币种**：CNY / JPY，分币种统计、不折算、永不跨币种相加
- **两种渠道资金结算模式**：第三方代收净额 / 公司代收返佣
- **退款**：一律终止订单、支持零现金流退款记录、佣金等比例追回
- **第三方往来 / 抵扣台账**：垫付与抵扣按币种轧差
- **转介绍收佣**：公司作为渠道方向下游公司收佣

## 本地启动

### 后端
```bash
cd backend
npm install
cp .env.example .env        # 填入数据库连接、JWT 密钥
npx prisma db push          # 同步表结构
npx prisma db seed          # 写入测试账号与样例数据
npm run start:dev           # 启动（默认 http://localhost:3001/api）
```

测试账号（密码均为 `admin123`）：`admin` / `market` / `sales` / `downstream`

### 前端
```bash
cd frontend
npm install
npm run dev
```

## 说明
本仓库为一期实现；二期内容（服务记录、阶梯分成、高级看板、IM 提醒等）暂不在范围内。
