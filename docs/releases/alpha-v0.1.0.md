# Internal Alpha Release Check — v0.1.0

**检查日期**：2026-07-21
**检查范围**：Module 1–6（Booking / Driver Account / Commission·Wallet·Settlement / Collection / GPS / Dispatch Center）
**结论**：**可以开始内部 Alpha 测试**（Admin + Driver），但有 1 个已发现并修复的 Critical 安全问题、3 个正式上线前必须处理的阻塞项，详见下方。

---

## 1. 当前完成的 Module

| Module | 内容 | Commit |
|---|---|---|
| 1 | Booking / 多 Leg / 智能贴文解析 | `8691a97` |
| 2 | Driver Account / Authentication / Driver Job Page | `900240b` |
| 3 | Commission / Driver Wallet / Daily Settlement | `262c5b4` |
| 4 | Collection（代收款）/ Settlement Offset | `eef17a7` |
| 5 | GPS Live Tracking / Driver Online Status | `9f4cef2` |
| 6 | Dispatch Center / Quick Assign / Quick Reassign | `a4473f5` |

未开始：Google Maps、轨迹回放、Geofence、ETA、路线规划、真正的 Dispatcher 角色（目前 Dispatch Center 仍是 ADMIN 专用页面）。

---

## 2. 测试帐号（仅限本地/Alpha 环境）

> ⚠️ 以下密码只用于本地开发种子资料，**不能**用在正式环境。

| 帐号 | 密码 | 角色 |
|---|---|---|
| `admin` | `DevPass123!` | ADMIN |
| `driver01` | `DevPass123!` | DRIVER |
| `driver02` | `DevPass123!` | DRIVER |

---

## 3. 本地启动步骤

```bash
# 1. 安装依赖（在 repo 根目录）
npm install

# 2. 准备 Backend 环境变量
cp apps/backend/.env.example apps/backend/.env
# 编辑 apps/backend/.env，指向本地 PostgreSQL，SESSION_SECRET 换成自己的随机字串

# 3. 准备 Frontend 环境变量
cp apps/frontend/.env.example apps/frontend/.env

# 4. 建立数据库（如果还没有）
createdb car_team_dev

# 5. 套用所有 migration
npm run prisma:migrate:deploy --workspace=apps/backend

# 6. 建立测试帐号
npm run db:seed --workspace=apps/backend

# 7. 启动 Backend（http://localhost:4000）
npm run dev:backend

# 8. 另开一个 terminal，启动 Frontend（http://localhost:5173）
npm run dev:frontend
```

---

## 4. 内部测试流程（建议顺序）

### 4.1 Admin 测试路径
1. 用 `admin` 登录
2. **Booking**：建立一笔 Booking，加 Outbound + Return 两个 Leg，分别指派给 driver01 / driver02
3. **Dispatch Center**（`/dispatch`）：确认新建的 Booking 出现在 Waiting 列表；用 Quick Assign 指派另一笔测试 Booking，观察 Statistics 数字变化
4. **GPS**（`/gps`）：等 Driver 上线后确认能看到座标、状态、更新时间
5. **Wallet / Daily Settlement**（`/wallet`、`/settlements/daily`）：Leg 完成后确认 Wallet 出现对应收入，选 Driver + 日期区间跑 Daily Settlement，确认 Reference 格式 `SET-YYYYMMDD-0001`
6. **Collection**（`/collections`）：Driver 提交代收款后，Verify / Void 都测一次
7. **Settlement History**：确认 Net Amount 显示正确（Company Pay Driver / Driver Need Return Company），试着 Void 一笔 Settlement 观察反向纪录

### 4.2 Driver 测试路径
1. 用 `driver01` 登录
2. **我的工作**（`/driver/jobs`）：Accept → Driver Arriving → Passenger On Board → Complete 走一次完整流程；另外找一笔试着 Reject（填原因）
3. **GPS**：右上角切换 Go Online，确认几秒后 Admin 那边的 GPS Dashboard 看得到自己的位置；切 Go Offline 确认状态消失/变灰
4. **My Earnings**（`/driver/earnings`）：确认完成 Leg 之后这里的待结算金额有更新
5. **Collection**（`/driver/collections`）：新增一笔代收款（Cash/Transfer To Driver/Transfer To Company 都试一次），上传一张真实图片当证明
6. **Settlement History**：Admin 帮忙结算后，确认这里看得到自己的结算纪录

### 4.3 交叉测试（两个角色一起看的场景）
- Admin 指派 → Driver Reject → Admin 在 Dispatch Center 用 Quick Reassign 派给另一位，全程不用离开 Dispatch Center 页面
- Driver 完全不 Go Online 的情况下，照样能完整跑完 Accept→Complete（验证 GPS 独立性）
- 同一个 Booking 的两个 Leg 分给不同 Driver，确认两人 Wallet 各自独立、互不影响

---

## 5. 已知限制

- 没有真正的「Dispatcher」角色，Dispatch Center 目前只能用 ADMIN 帐号使用
- Booking 没有可手动设定的 Priority 栏位，Dispatch Center 显示的 Priority 是用「等待多久」推算出来的
- GPS/Collection 第一版都没有地图，纯文字/座标显示
- DriverLocation 只存最新一笔，没有轨迹历史
- Collection 图片证明用本地磁盘存储（见下方上线阻塞项）
- 没有 Push Notification / Telegram 通知
- 没有 Cash/Transfer 之外更细的代收款对帐报表，只有明细列表

---

## 6. 上线阻塞项（正式对外营运前必须处理，Alpha 内部测试阶段可以先接受）

| # | 项目 | 说明 |
|---|---|---|
| B1 | **Collection 证明图片用本地磁盘存储** | `apps/backend/uploads/` 没有挂载持久化存储；部署到 Railway 等平台重新部署会遗失所有已上传的图片。正式上线前必须换成 Volume 挂载或 S3 类对象存储。 |
| B2 | **SESSION_SECRET 需要正式环境专用的随机字串** | 目前 `.env.example` 只是本地开发用的占位字串，正式环境部署时必须另外生成一个够长的随机字串，透过正式环境的 secret 管理机制注入，不能沿用 Alpha 测试环境的值。 |
| B3 | **GPS 定位需要 HTTPS** | 浏览器 `navigator.geolocation` 只在 `https://` 或 `localhost` 下可用，正式环境没有 HTTPS 的话 Driver 完全无法上传定位（不影响其他功能）。 |

---

## 7. 本次检查发现并处理的问题清单

### Critical（已修复）

**C1 — Collection 图片上传：Content-Type 伪造可绕过图片限制，导致 Stored XSS**

- **问题**：`fileFilter` 只检查上传者自己填的 `Content-Type` header，存档的副档名又是直接取自上传者填的原始档名——两者都可以任意伪造。实测：把一个内含 `<script>` 的 `.html` 档案、Content-Type 谎报成 `image/jpeg` 上传，系统真的收下了，存成 `.html` 档，并且透过 `/uploads/...`（不需要登录）原样用 `text/html` served 出来，`<script>` 会真的执行。
- **影响**：任何有效的 Driver 帐号都能在系统自己的网域下放一个可公开访问、未认证的 XSS 页面，可能被用来打 Admin（Session Cookie 是 httpOnly 挡掉了直接偷 Cookie，但 XSS 仍可利用浏览器自动带的登入态发出任意请求）。
- **修复**：
  1. 存档副档名改成完全从「已验证过的 MIME 白名单」查表决定，不再采信上传者填的原始档名
  2. 落盘后再读一次档案开头的 magic number 跟宣告的格式比对，对不上就删掉档案、直接拒绝（防止只伪造 header、内容根本不是图片的情况）
  3. `/uploads` 静态服务加上 `X-Content-Type-Options: nosniff`，做纵深防御
- **验证**：修复后重跑同样的攻击，正确被拒绝（400）；确认合法 JPEG 上传、5MB 大小限制、路径穿越档名都还是正常/安全的行为。
- **相关文件**：[apps/backend/src/common/upload.ts](../../apps/backend/src/common/upload.ts)、[apps/backend/src/app.ts](../../apps/backend/src/app.ts)

### High
无（本次检查未发现其他未修复的 High 问题）。

### Medium（列出清单，未擅自大改）

| # | 问题 | 建议 |
|---|---|---|
| M1 | 登录 API（`/api/auth/login`）没有 rate limiting，可以无限次重试密码 | 内部 Alpha 阶段帐号数量少、网址不公开，风险有限；正式上线前建议加上登入失败次数限制或延迟机制 |
| M2 | 测试套件极少数情况下会因为多个测试档案平行跑、在同一秒对真实 Postgres 触发 Settlement Reference 生成而短暂 flaky（本次检查跑到一次，立即重跑即通过） | Advisory lock 机制本身已有专门的并发测试验证正确；这是 vitest 多档案平行执行的测试环境议题，不是产品逻辑缺陷，建议之后有空评估 `fileParallelism: false` 或类似设定 |
| M3 | Frontend production build 是单一 JS bundle，约 1.46MB（gzip 后 450KB），Vite 提示可以 code-split | 目前页面不多，对内部使用者影响不大；页面继续增加后建议做路由层级的懒加载 |

### Low

| # | 问题 | 建议 |
|---|---|---|
| L1 | Driver 密码最小长度只要求 6 个字元，没有其他复杂度要求 | 内部系统、由 Admin 建帐号，风险有限；可考虑之后加长度/复杂度要求 |
| L2 | GPS 电量读取用的 `navigator.getBattery()` 是已经被多数浏览器移除的非标准 API | 已知限制，文档已记录，多数 Driver 未来会看不到电量资讀，属于锦上添花功能 |

---

## 8. 测试人员需要重点观察的问题

- **金额是否对得上**：Booking Total、Platform Amount、Driver Pool、每个 Leg 的分配、Wallet 待结算/已结算、Settlement 的 Company Pay Driver / Driver Need Return Company，只要哪一个数字看起来不对就要立刻回报，这是系统最核心也最不能出错的部分
- **重复点击/重复提交**：Complete Leg、Verify Collection、Confirm Settlement 这些按钮如果不小心点两次，系统应该要挡下第二次、不会重复记账——测试时可以刻意快速点两下试试看
- **GPS 状态显示是否符合预期**：Online / Connection Lost / Offline 的切换时间点感觉起来是否合理（30 秒/2 分钟）
- **Driver Reject 之后的动线**：Admin 在 Dispatch Center 重新指派是否顺畅，会不会漏单或卡住
- **上传图片**：正常的手机拍照图片上传是否顺利、失败时的错误讯息是否看得懂
- **权限边界**：用 Driver 帐号尝试直接改网址跳转到 Admin 的页面（例如 `/wallet`、`/dispatch`），应该会被导回自己的页面，不会看到任何 Admin 资料

---

## 9. Bug 回报格式

请用以下格式回报（复制贴到 issue / 讯息里即可）：

```
标题：[简短描述问题]

角色：Admin / Driver
帐号：admin / driver01 / driver02
页面/API：（例如 /dispatch 或 POST /api/admin/settlements）

重现步骤：
1. ...
2. ...
3. ...

预期结果：
（你觉得应该发生什么）

实际结果：
（实际发生了什么，最好附截图）

严重程度（自己先判断，我们会再确认）：
[ ] Critical（钱算错了 / 资料遗失 / 完全无法使用）
[ ] High（重要功能不能用，但有替代方式）
[ ] Medium（功能可用但体验不好 / 显示不正确但不影响资料）
[ ] Low（文字/排版/建议）

补充：
（浏览器、时间点、其他相关资讯）
```

---

## 10. 后续追踪

本次检查的 3 个上线阻塞项 + Medium/Low 清单会持续追踪，直到正式上线前逐一处理或明确决定延后。Alpha 测试期间新发现的 Bug 请用上方格式回报，不需要另外建立新文件。
