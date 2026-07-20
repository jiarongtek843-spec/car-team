# 车队管理系统 (Fleet Management System) — 架构规划

## Context

这是公司内部使用的车队管理系统，长期项目，会以 Module 方式逐步开发。目标是先定好一套简单、稳定、容易维护、高度模块化的架构，让以后每加一个新功能都能"插进去"而不需要重构底层。

**已确认的需求（用户回答）：**
- 使用方式：内部电脑网页版 (Web)，管理员/调度员在浏览器操作。未来可能开放司机手机端，架构需预留空间但现在不做。
- 部署：GitHub + Railway
- 规模：单一车队，规模不大，不需要多分公司/多租户
- 技术栈：交给我依「简单、稳定、容易维护」原则决定

**开发原则（用户设定）：**
1. 一个 Module 一个 Module 开发，每完成一个先给用户测试再继续
2. 程式码/DB/API/Function/Class/Variable 全部英文命名，沟通用华语
3. 不因小问题打断开发流程，只在业务流程受影响时才询问
4. 技术决策优先简单稳定
5. 保持高度模块化，方便未来持续加功能
6. 主动指出设计风险与优化建议

---

## 一、技术栈选型

| 层 | 选择 | 原因 |
|---|---|---|
| Backend | Node.js + TypeScript + Express | 生态成熟、Railway 原生支持好、招人/维护容易、强类型减少长期维护的 bug |
| Database | PostgreSQL | 车队数据（车辆/司机/派车/保养）关联性强，关系型数据库最合适；Railway 一键提供 Postgres |
| ORM | Prisma | Schema 即文档、migration 机制成熟，非常适合"模块化、逐步扩充 schema"的开发方式 |
| Frontend | React + TypeScript + Vite | 轻量、生态大、内部管理系统的标准做法 |
| UI 组件库 | Ant Design | 内部后台系统里最常用的表格/表单/CRUD 场景，开发速度快，减少重复造轮子 |
| Auth | Session-based（httpOnly cookie）+ 角色权限 (RBAC) | 比裸 JWT 存在前端 JS 更安全，实作依然简单，符合内部系统场景 |
| 部署 | GitHub → Railway（2 个 service：backend / frontend，同一个 repo） | 用户已指定，Railway 对 monorepo 多 service 支持良好 |

**架构选择：前后端分离（Backend REST API + Frontend SPA）**，而不是用 Next.js 全栈合一。
原因：这是长期、模块持续增加的系统，且用户已表明未来可能要开放司机手机端。前后端分离让 backend 的每个业务模块（vehicles / drivers / dispatch / maintenance…）都是独立、可测试的 API，不受前端框架变动影响；未来无论是加手机 App 还是换前端框架，都不用动 backend。代价是要维护两个 service，但在 Railway 上这依然很简单（一个 repo，两个 service，各自指定 root directory）。

---

## 二、Database 规划（起始核心结构，之后按 Module 逐步扩充字段）

先定出骨架，实际栏位在做对应 Module 时再细化。命名一律 snake_case（Postgres 惯例），Prisma 自动映射成 TS 的 camelCase。

**核心实体（Entity）：**

- `users` — 系统登入账号（id, name, email, password_hash, role, status, created_at…）
  角色（role）：`ADMIN`、`DISPATCHER`，未来可加 `DRIVER`
- `drivers` — 司机资料（id, name, phone, license_no, license_expiry, status…）。**刻意与 `users` 分开**：司机不一定有登入权限，登入账号是另一回事。这样以后要开放司机手机端登入，直接给该司机建一个 user 关联即可，不用改结构。
- `vehicles` — 车辆资料（id, plate_no, brand, model, year, status[ACTIVE/MAINTENANCE/RETIRED], current_mileage, insurance_expiry, road_tax_expiry…）
- `dispatch_records`（派车记录）— 谁在什么时间用哪台车（id, vehicle_id, driver_id, start_time, end_time, purpose, status）
- `maintenance_records`（保养/维修记录）— (id, vehicle_id, type, date, cost, mileage_at_service, notes)
- `audit_logs`（操作日志）— 谁在什么时候改了什么。**建议第一阶段就建好**，现在加成本很低，事后补几乎不可能补齐历史。

以上是概念 ERD，用来验证架构方向；正式栏位设计会在对应 Module 开发时再确认。

---

## 三、Module 规划与开发顺序

| 阶段 | Module | 说明 |
|---|---|---|
| Phase 0 | 基础建设 | Repo 初始化、CI（lint/typecheck）、Railway 部署管线、DB 连线、基础 project skeleton |
| Phase 1 | 用户与权限管理 | 登入、角色（Admin/Dispatcher）、权限控管 — 其他所有模块的地基 |
| Phase 2 | 车辆管理 | 车辆 CRUD、状态、证件到期（保险/路税）提醒 |
| Phase 3 | 司机管理 | 司机 CRUD、执照到期提醒 |
| Phase 4 | 派车 / 调度管理 | 车辆+司机 配对、时间安排、状态追踪 |
| Phase 5 | 保养维修管理 | 保养记录、依里程/日期提醒下次保养 |
| Phase 6 | 费用管理 | 油费、过路费、维修费用记录与统计 |
| Phase 7 | 报表 / Dashboard | 使用率、成本分析等总览数据 |
| Phase 8+ | 未来功能（按需） | 司机手机端、GPS 对接、违章/事故管理、文件上传（行照/保险扫描）、Email/SMS 提醒等 |

排序逻辑：先地基（登入权限）→ 核心主数据（车辆、司机）→ 业务流程（派车）→ 支援模块（保养、费用）→ 分析（报表）→ 进阶功能。

**开发流程（每个 Module 一致）：** Backend API（CRUD + 业务规则）→ Frontend 页面（列表/详情/新增/编辑）→ 交给用户测试 → 确认后再进下一个 Module。

---

## 四、Folder Structure

```
car-team/
├── apps/
│   ├── backend/                    # Node.js + Express + TypeScript
│   │   ├── src/
│   │   │   ├── modules/            # 一个业务模块一个资料夹
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   └── auth.routes.ts
│   │   │   │   ├── vehicles/
│   │   │   │   ├── drivers/
│   │   │   │   ├── dispatch/
│   │   │   │   ├── maintenance/
│   │   │   │   └── ...            # 未来新模块直接加在这里
│   │   │   ├── common/             # 共用 middleware、错误处理、utils
│   │   │   ├── config/             # env config、db 连线
│   │   │   ├── prisma/             # schema.prisma、migrations
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   └── package.json
│   └── frontend/                   # React + Vite + TypeScript
│       ├── src/
│       │   ├── modules/            # 与 backend 模块一一对应
│       │   │   ├── auth/
│       │   │   ├── vehicles/
│       │   │   ├── drivers/
│       │   │   ├── dispatch/
│       │   │   ├── maintenance/
│       │   │   └── ...
│       │   ├── components/         # 共用 UI 组件
│       │   ├── layouts/
│       │   ├── router/
│       │   ├── api/                # API client（统一的 request 封装）
│       │   ├── store/              # 全局状态（登入 session 等）
│       │   ├── App.tsx
│       │   └── main.tsx
│       └── package.json
├── packages/
│   └── shared-types/               # FE/BE 共用的 TS type / DTO / enum
├── .github/workflows/              # CI：push 时跑 lint + typecheck
├── docs/                           # 架构笔记、各 module 规格
├── README.md
└── package.json                    # npm workspaces root
```

Backend 每个模块内部分层：`routes`（HTTP 入口）→ `controller`（接参数/回应）→ `service`（业务逻辑）→ `prisma`（资料层）。刻意不做过度复杂的 clean architecture，符合「简单稳定」原则。

---

## 五、主动提出的风险与建议

1. **Auth 用 httpOnly cookie session，不用裸 JWT 存前端 JS** — 避免 XSS 情况下 token 被偷，实作复杂度差不多。
2. **车辆/司机用软删除（status/deleted_at），不做物理删除** — 派车记录、保养记录会引用到车辆/司机，硬删除会破坏历史数据完整性。
3. **`audit_logs` 从 Phase 1 就建**，之后想补几乎补不回来，现在加成本很低。
4. **文件上传要早点决定方案**（行照、保险单、执照扫描件迟早会需要）— Railway 本身的档案存储不是持久化的（重新部署会消失），建议接 Cloudflare R2 或 AWS S3 这类物件存储，现在先把接口设计留好，晚点再接。
5. **时间一律存 UTC，前端显示时才转当地时区** — 派车/保养涉及时间排程，时区处理不一致是常见的隐性 bug 来源。
6. **本地开发 DB 与 Railway production DB 从一开始就分开**，`.env` 不进版控，及早建立习惯。
7. **CI 从 Phase 0 就跑基本的 lint + typecheck** — 长期多模块累积下，及早挡住低级错误比之后补救便宜很多。

---

## 六、验证方式

Phase 0 完成后的验收标准：
- Repo 建好，`apps/backend`、`apps/frontend` 骨架可各自本地跑起来
- Backend 能连上本地 Postgres（Prisma migrate 成功）
- Frontend 能打到 backend 一个健康检查（health check）API 并显示结果
- GitHub push 后，Railway 能自动部署 backend + frontend 两个 service，且能连上 Railway 提供的 Postgres
- CI 在 push 时跑 lint + typecheck 并通过

之后每个 Module 完成后，验收方式统一为：本地跑起来、走一遍该 Module 的完整流程（新增/查看/编辑/删除等），交给用户在浏览器实际操作确认，再进下一阶段。
