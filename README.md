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

首次设置数据库后，跑一次种子资料（建立测试帐号）：

```bash
npm run db:seed --workspace=apps/backend
```

跑测试：

```bash
npm run test --workspace=apps/backend
```

### 本地开发测试帐号（仅限本地开发环境）

> ⚠️ 以下密码只用于本地开发种子资料，**不能**用在正式环境。正式环境的 Admin/Driver 密码要另外设定。

| 帐号 | 密码 | 角色 |
|---|---|---|
| `admin` | `DevPass123!` | ADMIN |
| `driver01` | `DevPass123!` | DRIVER |
| `driver02` | `DevPass123!` | DRIVER |

## 目录结构

```
apps/backend/    Express + TypeScript + Prisma REST API
apps/frontend/   React + Vite + TypeScript + Ant Design SPA
packages/        前后端共用的 TS 类型
docs/            架构与模块规格文件
```

## 上传档案（Collection 代收款证明图片）

Collection 模块的收据/转账截图目前存在本地磁盘 `apps/backend/uploads/`（已加进 `.gitignore`，不会被提交）。部署到 Railway 等平台时，这个目录在重新部署后会被清空，正式环境需要挂载 persistent volume 或改用云端对象存储，详见 [docs/modules/collection.md](docs/modules/collection.md) 的已知限制。
