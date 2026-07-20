# Fleet Management System (车队管理系统)

公司内部车队管理系统。Backend (Express + TypeScript + Prisma) 与 Frontend (React + Vite + Ant Design) 分离的 monorepo。

架构规划详见 `docs/architecture.md`。

## 本地开发

```bash
# 安装依赖（在 repo 根目录）
npm install

# 启动 backend（预设 http://localhost:4000）
npm run dev:backend

# 启动 frontend（预设 http://localhost:5173）
npm run dev:frontend
```

Backend 需要 `apps/backend/.env`（参考 `apps/backend/.env.example`），指向本地 PostgreSQL。

## 目录结构

```
apps/backend/    Express + TypeScript + Prisma REST API
apps/frontend/   React + Vite + TypeScript + Ant Design SPA
packages/        前后端共用的 TS 类型
docs/            架构与模块规格文件
```
