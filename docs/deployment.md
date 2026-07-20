# 部署到 GitHub + Railway

以下步骤需要你自己的 GitHub / Railway 账号权限，我没办法代劳，照着做就可以了。本地代码已经准备好可以直接部署（`railway.json` 已经放在 `apps/backend` 和 `apps/frontend`，Railway 会自动读取 build/start 指令）。

## 1. 建立 GitHub Repo

1. 到 GitHub 建一个新的空 repo（不要勾选 "Add README"），例如叫 `car-team`
2. 在这个专案目录跑：
   ```bash
   git add .
   git commit -m "chore: phase 0 project scaffold"
   git branch -M main
   git remote add origin https://github.com/<你的帐号>/car-team.git
   git push -u origin main
   ```

## 2. 建立 Railway 专案

1. 到 [railway.app](https://railway.app) 用 GitHub 账号登入
2. New Project → Deploy from GitHub repo → 选刚刚的 `car-team`
3. 这个 repo 会建一个 service，先不管它，接下来手动加 3 个东西：

### 2.1 加 PostgreSQL

- 专案里点 "New" → "Database" → "Add PostgreSQL"
- Railway 会自动帮这个 Postgres 生成 `DATABASE_URL`，等一下要接给 backend service 用

### 2.2 设定 Backend service

- 把刚刚自动建的 service（或新建一个）设定：
  - **Root Directory**: `apps/backend`
  - **Variables**（环境变量）：
    - `DATABASE_URL` → 点 "Add Reference"，选刚刚那个 Postgres 的 `DATABASE_URL`（不要手动复制贴上，用 reference 以后密码变了会自动更新）
    - `CORS_ORIGIN` → 先填 `*`，等 frontend 部署好拿到网址后再改成 frontend 的实际网址
- Railway 会自动侦测 `apps/backend/railway.json`，用 `npm run build` build，启动时先跑 `prisma migrate deploy`（正式环境安全的 migration 指令，不会像 `migrate dev` 那样互动式提问）再启动 server
- 部署完成后，Railway 会给一个网址，例如 `https://car-team-backend-production.up.railway.app`，记下来

### 2.3 设定 Frontend service

- 新增一个 service，一样指向同一个 GitHub repo：
  - **Root Directory**: `apps/frontend`
  - **Variables**：
    - `VITE_API_BASE_URL` → 填上一步 backend 的网址（例如 `https://car-team-backend-production.up.railway.app`）
- 部署完成后一样会给一个网址，这个就是以后同事们要打开的系统网址

### 2.4 回头补上 CORS_ORIGIN

- Frontend 网址确定后，回到 backend service 的 `CORS_ORIGIN`，改成 frontend 的实际网址（例如 `https://car-team-frontend-production.up.railway.app`），存档后 Railway 会自动重新部署 backend

## 3. 验证

打开 frontend 的网址，应该会看到「车队管理系统 — Backend 连线状态」卡片，状态显示 `ok`，代表 frontend、backend、Railway 的 Postgres 三者都接通了。

## 之后的部署流程

以后每个 Module 开发完、你测试没问题后，直接 `git push` 到 `main`，Railway 会自动重新 build + deploy，不需要手动操作。GitHub Actions CI（`.github/workflows/ci.yml`）会在 push 时自动跑 lint + typecheck，帮忙挡住低级错误。
