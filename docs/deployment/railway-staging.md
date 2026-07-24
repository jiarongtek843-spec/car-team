# Railway Staging Deployment

> **状态：内部测试环境（Staging），不是正式 Production。** 这份文件描述如何把这个 monorepo 部署到 Railway，建立一个可以给团队内部测试用的环境。不要把这份配置直接当成正式环境上线的依据——已知限制（第 6 章）列出了几个正式环境必须先解决、但这次 Staging 刻意先接受的问题（本地磁盘文件上传、单一 Postgres 无备份策略等）。

## 目录

1. [Railway Service 架构](#1-railway-service-架构)
2. [环境变量](#2-环境变量)
3. [Build / Start / Migration 指令](#3-build--start--migration-指令)
4. [部署步骤](#4-部署步骤)
5. [测试步骤](#5-测试步骤)
6. [已知限制](#6-已知限制)
7. [Rollback 方法](#7-rollback-方法)
8. [如何查看 Logs](#8-如何查看-logs)

---

## 1. Railway Service 架构

这个 repo 是 npm workspaces monorepo（`apps/backend` + `apps/frontend`），没有共用的 `packages/*`（README 提过这个目录，但实际上从没建立过，两个 app 互相独立，没有交叉依赖）。这次没有连 GitHub（这个 repo 目前没有设定任何 git remote），改用 Railway CLI 的 `railway up --path-as-root` 直接从本机上传每个 app 自己的目录，把它当成各自独立的部署单位：

```
Railway Project: car-team-staging
├── Postgres（Railway 官方 Database Plugin）
│   └── 提供 DATABASE_URL，Backend 唯一的资料来源
│
├── backend（Service，从 apps/backend/ 部署）
│   ├── Build：Nixpacks 自动侦测 Node，跑 apps/backend/railway.json 的 buildCommand
│   ├── Start：跑 migration 再启动 Express Server
│   ├── Healthcheck：GET /api/health（同时检查 Backend 存活 + Database 连线）
│   └── 对外网域：Railway 自动分配的 xxx.up.railway.app（HTTPS）
│
└── frontend（Service，从 apps/frontend/ 部署）
    ├── Build：vite build 出静态档案
    ├── Start：用 serve 套件把 dist/ 当静态网站跑起来
    └── 对外网域：Railway 自动分配的 xxx.up.railway.app（HTTPS）
```

**为什么两个 app 各自部署成独立 Service，而不是从 repo 根目录部署**：`railway up <path> --path-as-root` 会把指定的目录本身当成上传内容的根目录，等于 Railway 看到的就是一个独立、自包含的 Node 专案（`apps/backend/package.json` 或 `apps/frontend/package.json` 在根层级），不需要 npm workspaces 的 `--workspace=` 语法。两个 app 原本各自的 `package.json` 就已经声明了自己需要的全部依赖（没有依赖 hoist 到 repo 根目录的共用套件），所以这样部署完全不影响功能——本地也验证过 `cd apps/backend && npm run build`、`cd apps/frontend && npm run build` 两个都能独立跑成功。这也是这次把两个 `railway.json` 里 `--workspace=apps/backend`/`--workspace=apps/frontend` 拿掉、改成纯 `npm run build`/`npm run start` 的原因。

**Frontend 怎么连到 Backend**：Frontend 是纯静态 SPA（Vite build 出来的 HTML/JS/CSS），浏览器直接用 `fetch` 打 Backend 的 API，两者是完全独立、透过 HTTPS + CORS 沟通的两个服务，不是同一个 Server 反向代理。这代表 Session Cookie 是跨网域的（两个不同的 `*.up.railway.app` 子网域），第 2 章会说明这对 Cookie 设定的影响。

---

## 2. 环境变量

### Backend Service

| 变量 | 值（Staging） | 说明 |
|---|---|---|
| `DATABASE_URL` | Railway Postgres Plugin 提供的连线字串 | 用 Railway 的 Variable Reference（`${{ Postgres.DATABASE_URL }}`）自动带入，不要手动复制贴上（复制贴上的话，Postgres 密码轮替时 Backend 不会自动跟着换） |
| `SESSION_SECRET` | 一个随机长字串 | 只存在 Railway 的环境变量里，不进 git；本地开发用的值（`.env.example` 里的示范值）不能沿用到 Staging |
| `CORS_ORIGIN` | Frontend Service 的 Railway URL，例如 `https://frontend-staging-xxxx.up.railway.app` | 支持逗号分隔多个 origin（这次为了让 Backend 一开始就找不到 Frontend 真实网址的先后顺序问题，可以先填 Frontend 网址，Frontend 部署完成拿到真实网址后回来更新这个变量） |
| `NODE_ENV` | `production` | 只影响 Cookie 的 `Secure`/`SameSite` 行为（HTTPS 环境该有的设定），**不代表这是正式营运环境** |
| `APP_ENV` | `staging` | 独立于 `NODE_ENV` 的另一个开关，只用来决定这个环境可不可以写测试资料——设成 `staging` 才能执行 `npm run db:seed`；设成 `production` 会被 `prisma/seed.ts` 直接拒绝执行 |
| `SEED_PASSWORD` | Staging 专用密码（自己生一个，不要跟本地开发的 `DevPass123!` 一样） | 只有跑 `npm run db:seed` 时会用到，决定 5 个测试帐号的密码 |
| `PORT` | Railway 自动注入，不用手动设 | Railway 会自动帮每个 Service 注入 `PORT`，`server.ts` 已经读 `process.env.PORT`（透过 `env.port`），不用额外处理 |

### Frontend Service

| 变量 | 值（Staging） | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | Backend Service 的 Railway URL，例如 `https://backend-staging-xxxx.up.railway.app` | **必须在 Build 之前设定好**——Vite 的环境变量是打包时写死进产物的，不是执行时读取，改这个值一定要重新 Build 才会生效，单纯改 Railway 变量、不重新部署不会有任何效果 |
| `PORT` | Railway 自动注入 | `serve -s dist -l ${PORT:-3000}` 已经读这个变量 |

### 不要 commit 进 Git 的东西

`SESSION_SECRET`、`SEED_PASSWORD`、Railway 提供的 `DATABASE_URL` 都只存在 Railway 的环境变量设定里。仓库里只有 `apps/backend/.env.example`、`apps/frontend/.env.example` 两份范例文件（栏位名称 + 说明注解，没有真实值），`.gitignore` 已经排除所有 `.env`/`.env.local` 文件——检查过目前的 `.gitignore` 确实排除了 `apps/backend/.env`、`apps/frontend/.env`、`.env`、`.env.local`。

---

## 3. Build / Start / Migration 指令

两个 `railway.json`（`apps/backend/railway.json`、`apps/frontend/railway.json`）已经写好，Railway 会自动读取（前提是部署时的 Root Directory/`--path-as-root` 指到对的目录）：

**Backend**：
```
Build:     npm run build                                    （tsc 编译成 dist/）
Migration: npm run prisma:migrate:deploy                    （prisma migrate deploy）
Start:     npm run start                                    （node dist/server.js）
```
`startCommand` 把 Migration 跟 Start 串在一起：`npm run prisma:migrate:deploy && npm run start`——每次部署都会先跑一次 `prisma migrate deploy`，只套用还没套用过的 migration，不会重跑已经套用过的（见第 6 章的「部署失败会怎样」）。

**Frontend**：
```
Build: npm run build     （tsc -b && vite build，输出到 dist/）
Start: npm run start     （serve -s dist -l ${PORT:-3000}，纯静态文件服务器）
```

**Healthcheck**：`apps/backend/railway.json` 设了 `healthcheckPath: "/api/health"`，Railway 部署完新版本后会打这个路径，直到收到 2xx 才会把流量切过去、判定这次部署成功；`/api/health` 内部会真的对 Database 送一次 `SELECT 1`，Database 连不上会回 503（细节见第 4 章第 4 步）。Frontend 是纯静态文件服务，没有另外设 `healthcheckPath`，Railway 用预设的 TCP 存活检查。

---

## 4. 部署步骤

以下步骤用 Railway CLI 执行（这个 repo 没有连 GitHub，全部从本机直接上传部署，`railway up` 支持不经过 Git 的 CLI 部署）。前提：`railway login` 完成、`railway whoami` 确认已登入。

1. **建立 Railway Project**：`railway init --name car-team-staging`（在 repo 根目录执行，会把当前目录跟新专案连起来）
2. **加入 Postgres**：`railway add --database postgres` —— 会建立一个 Postgres Service，自动产生 `DATABASE_URL`
3. **建立 Backend Service 并部署**：
   - `railway add --service backend`（先建立空的 Service）
   - 设定环境变量（`railway variable --service backend set KEY=VALUE`，逐个设，或用 Railway 网页介面的 Variable Reference 语法把 `DATABASE_URL` 指向 Postgres Plugin）
   - `railway up apps/backend --path-as-root --service backend`（上传 `apps/backend/` 目录当作部署内容，触发 Build + Migration + Start）
4. **建立 Frontend Service 并部署**：
   - `railway add --service frontend`
   - 设定 `VITE_API_BASE_URL`（指向上一步 Backend Service 分配到的网域）
   - `railway up apps/frontend --path-as-root --service frontend`
5. **回头更新 Backend 的 `CORS_ORIGIN`**：Frontend 部署完成、拿到真实网域后，回去把 Backend 的 `CORS_ORIGIN` 更新成 Frontend 的真实网址，重新部署 Backend 让新的 CORS 设定生效
6. **建立 Staging 测试帐号**：用 `railway run --service backend npm run db:seed` 在 Backend Service 的环境变量情境下执行 Seed（这样才会读到 Railway 上设定的 `APP_ENV`/`SEED_PASSWORD`，而不是本机的值）
7. **确认两个 Service 各自的公开网域**：`railway domain --service backend`、`railway domain --service frontend`（或直接在 Railway 网页的 Service 设定页查看，Settings → Networking → Public Networking）

> 每一步的实际执行结果（Project/Service 是否建立成功、拿到的真实网域、Seed 是否成功）会在完成部署后另外整理成一份结果报告给你，不在这份操作手册里写死假设的网址。

---

## 5. 测试步骤

部署完成后，依序验证：

1. **Health Check**：`curl https://<backend-url>/api/health`，预期 `{"status":"ok","database":"ok",...}`
2. **4 个角色登入**：Owner（`admin`）、Manager（`manager01`）、Dispatcher（`dispatcher01`）、Driver（`driver01`）分别用 Staging 密码登入 Frontend
3. **页面刷新后 Session 是否保留**：登入后刷新浏览器，应该维持登入状态，不会被踢回登入页（这正是第 174 项修正的跨网域 Cookie `SameSite=None` 要解决的问题，务必实测确认）
4. **Admin 建立 Booking**：Owner/Manager/Dispatcher 建一笔新 Booking
5. **Assign Driver**：在 Dispatch Center 或 Booking 详情页把 Driver 指派到 Leg
6. **Driver Accept / Complete**：用 `driver01` 登入，Accept 指派、完成 Leg
7. **GPS Online/Offline**：Driver 端 Go Online（**必须用 HTTPS 网址**，`navigator.geolocation` 在非 HTTPS/非 localhost 环境下会被浏览器直接拒绝，Railway 的网域本身是 HTTPS，这点天然满足）、确认 GPS 状态更新、再 Go Offline
8. **Booking Charge**：对该 Booking 加一笔 Charge
9. **Revenue Finalize**：Preview + Finalize Revenue Sharing，确认自动建立 Wallet Transaction
10. **Wallet 显示**：`driver01` 查看自己的 Wallet，确认看得到刚才 Finalize 出来的收入

---

## 6. 已知限制

- **不是 Production**：这次的目标明确是内部测试环境，不代表可以正式对外营运。下面列的每一项限制都需要在真正上线前额外处理。
- **Collection Proof / Receipt 图片仍然存在本地磁盘**（`apps/backend/uploads/`）：Railway 的 Container 文件系统不是持久化的，**每次重新部署（包含这次文档描述的 Backend 部署流程本身）都会清空这个目录**，已经上传的收据/转账截图会全部消失。这是这次 Staging 阶段刻意接受的限制（[collection.md](../modules/collection.md) 已经记录过，Wallet Migration/Collection V2 都还没有处理这个问题），正式环境上线前必须换成持久化的对象存储（S3 类服务）或至少挂载 Railway Volume。
- **单一 Postgres，没有自动备份/高可用策略**：Railway 的 Postgres Plugin 本身有基础的 Point-in-time 能力，但这次没有额外设定备份排程或多副本，Staging 资料遗失是可以接受的风险，Production 不行。
- **Session Store 用 Postgres 里的一张表**（`connect-pg-simple`，`createTableIfMissing: true`）：这代表 Session 资料也会受上面「单一 Postgres」的限制影响；这不是新问题，本地开发环境本来就是这样，只是提醒 Staging 也一样。
- **没有自动化的 CI/CD**：这次是用 CLI 手动 `railway up` 部署，之后每次要更新 Staging 环境上的代码，都要重新执行一次同样的 `railway up` 指令（或之后接上 GitHub Actions/Railway 的 GitHub 集成自动化，这次没有做）。
- **Frontend Build-Time 环境变量的隐藏坑**：`VITE_API_BASE_URL` 一旦改了，一定要重新 Build 才会生效——只改 Railway 变量、不重新部署，Frontend 会继续打旧的 Backend 网址，容易被误以为「设定没生效」。
- **`CORS_ORIGIN` 需要手动维护成 Frontend 的实际网域**：Railway 分配的网域在第一次部署前无法预知，所以部署顺序上一定要先部署完 Frontend 拿到网址，再回头设定 Backend 的 `CORS_ORIGIN`，中间会有一段时间 Backend 的 CORS 设定是不完整/占位的。
- **Partial Collection 跨行金额验证**：这是 Collection V2 Schema 阶段已经记录的已知限制（[collection.md](../modules/collection.md)），跟这次 Railway 部署无关，只是提醒还没解决。（`Settlement 是否该排除 collectedBy=COMPANY 收款` 已经在 Mobile UAT Bug Fix 阶段解决——`getCollectionsInPeriod`/`getCollectionsOutsidePeriod` 现在会过滤 `collectedBy=DRIVER`，Company 直接收款不会再被算成 Driver 欠公司的负债。）

---

## 7. Rollback 方法

Railway 的每次部署都会保留历史记录（Deployment History），rollback 不需要重新 build：

1. **网页操作**（最简单）：进入 Service 页面 → Deployments 分页 → 找到上一个成功的部署 → 点 「Redeploy」，Railway 会直接把该次部署的产物重新指到线上，不会重新跑 Build
2. **CLI 操作**：`railway redeploy --service <backend|frontend>` 重新部署最近一次的部署（不重新 Build）；如果要退回更早之前的版本，用 `railway deployment list --service <backend|frontend>` 找到目标部署的 ID，再到网页上对该笔部署点「Redeploy」（CLI 目前没有直接「指定某个更早的 deployment ID 来 redeploy」的参数，需要搭配网页操作）
3. **Migration 的 Rollback 比较特殊**：`prisma migrate deploy` 不会自动 rollback（Prisma 官方就没有内建的 down-migration 机制）。如果新版本的 migration 本身有问题，正确做法是：
   - 先用 Railway 网页/CLI 把 Service **代码** rollback 到上一版（不影响资料库，因为 Postgres 是独立的 Service，rollback Backend Service 不会连带把 Database 也复原）
   - 如果新 migration 已经改坏了 Schema（例如误删了一个栏位），要另外写一个新的 migration 去修正——这个专案从 Wallet Migration 阶段开始就一直遵守「不回头编辑已经 Apply 过的 migration，永远用新的 migration 修正」的纪律（见 [wallet-migration.md](../modules/wallet-migration.md)），Staging 环境也照这个规矩来，不要手动进 Railway 的 Postgres 直接下 SQL 改 Schema
4. **部署失败不会自动重试危险操作**：`railway.json` 的 `restartPolicyType: "ON_FAILURE"` 只会重启「已经启动但后来挂掉」的 Container；如果是 `prisma migrate deploy` 这一步本身失败（例如某个 migration 语法错误、或跟目前资料库状态冲突），Prisma 会用非 0 状态码结束，`&&` 串接的 `npm run start` 根本不会被执行，Container 直接部署失败，Railway 不会静默略过这个失败然后照样把旧 Container 关掉换新的——旧版本会继续运作，不会有「资料库改了一半、程式却已经切到新版本」的中间状态。

---

## 8. 如何查看 Logs

Railway 会自动收集每个 Service 的 stdout/stderr：

- **网页操作**：进入 Service 页面 → Observability/Logs 分页，可以照时间范围、关键字搜寻
- **CLI 操作**：`railway logs --service backend`（即时 tail）或加 `--deployment <id>` 看特定一次部署的 log

这次的 Logging 改动（[errorHandler.ts](../../apps/backend/src/common/errorHandler.ts)、[server.ts](../../apps/backend/src/server.ts)）让下面这些事件都会出现在 Backend 的 Logs 里：

| 事件 | Log 前缀 | 触发时机 |
|---|---|---|
| Application Startup | `[STARTUP]` | Server 启动成功，会带上目前的 `APP_ENV` |
| Database Migration | （Prisma CLI 原生输出） | `prisma migrate deploy` 本身的输出（哪些 migration 被套用），因为是 `startCommand` 的一部分，会自然出现在部署 log 里 |
| Login 错误 | `[AUTH_ERROR]` | 401（帐号密码错误、帐号被停用等），只记 method/path/message，**不记 request body**（密码不会进 log） |
| 其他 API 错误 | `[API_ERROR]` | 400/403/404/409 等业务逻辑错误（Validation 失败、权限不足等） |
| Unhandled Exception | `[UNHANDLED_EXCEPTION]` | Express 请求处理过程中没被预期到的例外（会回 500） |
| 例外（Express 生命周期之外） | `[UNHANDLED_REJECTION]` / `[UNCAUGHT_EXCEPTION]` | 不在任何请求处理流程里发生的例外（例如某处忘记 await 的 Promise） |
| GPS 上传错误 | 沿用 `[AUTH_ERROR]`/`[API_ERROR]`/`[UNHANDLED_EXCEPTION]` | GPS 的路由（`driverPresence.routes.ts`）跟其他模块共用同一套 `asyncHandler` + `errorHandler`，没有另外特殊处理，错误会照上面几种分类自然出现 |

**不会出现在 Log 里的东西**：密码（登入请求的 `req.body` 完全不记）、Session Token/Cookie 内容、`SESSION_SECRET`/`DATABASE_URL` 等环境变量本身的值。
