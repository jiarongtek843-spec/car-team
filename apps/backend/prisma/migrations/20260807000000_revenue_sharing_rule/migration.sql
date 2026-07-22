-- Module 11 (Revenue Sharing API): Revenue Rule 配置栏位 + Snapshot 扩充栏位。
-- Revenue Rule 必须来自 Company Settings（用户明确要求），比照既有 defaultCommissionType/
-- Value 的模式：Company Commission 和 Dispatcher Commission 各自独立配置 type+value，
-- Driver Pool 没有独立栏位——定义上就是参与计算的总额扣掉两笔 Commission 后的余额。
-- ADD COLUMN 带 DEFAULT 会自动帮既有的那一笔 CompanySettings 资料回填，不需要额外 UPDATE。
ALTER TABLE "company_settings"
  ADD COLUMN "company_commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
  ADD COLUMN "company_commission_value" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "dispatcher_commission_type" "CommissionType" NOT NULL DEFAULT 'PERCENTAGE',
  ADD COLUMN "dispatcher_commission_value" INTEGER NOT NULL DEFAULT 0;

-- Dispatcher Commission 独立于 Company Revenue 之外单独记录一份，方便以后要单独结算
-- 给 Dispatcher 时可以直接追溯，不用从 charge_breakdown 反推。目前还没有任何 Booking
-- 被 Finalize 过（RevenueSharingSnapshot 表本身是这次改动之前的 migration 才建的、
-- 还没有任何 API 会写入），所以这里的 DEFAULT 0 只是让栏位型别合法，不代表任何历史资料回填。
ALTER TABLE "revenue_sharing_snapshots"
  ADD COLUMN "dispatcher_commission_cents" INTEGER NOT NULL DEFAULT 0;
