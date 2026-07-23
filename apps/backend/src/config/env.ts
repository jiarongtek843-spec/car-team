import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// CORS_ORIGIN 支持逗号分隔多个 origin（例如 Railway staging 的 frontend URL 加上本地测试用的
// localhost），cors() 的 origin 选项接受 string[]。
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean);

// NODE_ENV=production 代表「部署在真实服务器上、跑在 HTTPS 底下」，Staging 跟 Production
// 都应该设成这个值——它只控制 cookie 的 Secure/SameSite 这类「是不是 HTTPS 部署环境」的行为，
// 不代表这是正式营运数据库。「这是不是可以塞测试资料的环境」是完全独立的另一个概念，见 appEnv。
const isProduction = process.env.NODE_ENV === "production";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  corsOrigins,
  sessionSecret: required("SESSION_SECRET"),
  isProduction,
  // APP_ENV 是跟 NODE_ENV 分开的独立开关：只用来决定「这个环境能不能被写入测试资料」
  // （见 prisma/seed.ts 的 production 拒绝检查），预设 "development"。Railway staging
  // 部署时明确设成 "staging"；真正的 production 环境要设成 "production"，一旦设成
  // "production"，db:seed 会直接拒绝执行，避免测试帐号被误建进正式资料库。
  appEnv: process.env.APP_ENV ?? "development"
};
