import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // 所有 Integration Test 都打同一个共用的开发用 Postgres（没有每个测试档案各自
    // 独立的 schema/DB），并行跑多个测试档案会互相看到彼此尚未清理完的资料（例如
    // 全表查询 charge_types/以日期为 key 的 Settlement Reference 生成）。用单一
    // process 依序执行，用时间换取稳定、可重现的结果。
    fileParallelism: false
  }
});
