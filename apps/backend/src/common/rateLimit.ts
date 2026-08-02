import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";

// 跑测试时 Vitest 预设会把 NODE_ENV 设成 "test"（不用另外设定），整批 integration test
// 短时间内会对同一个 supertest instance 打非常多次请求，套用真实限流会让测试变得不稳定、
// 常态性撞到 429——这跟「防止有人写脚本爬资料」这个限流的目的无关，所以测试环境预设跳过
// （用 Number.MAX_SAFE_INTEGER 等同关闭）。`forceEnable` 只给 rateLimit.test.ts 自己用，
// 让「限流本身有没有正确挡下第 N+1 次请求」这件事也能被测试覆盖到，不用去踩线上真实的
// 300/10 门槛，也不用真的关掉整个 isTest 短路。
const isTest = process.env.NODE_ENV === "test";

export function buildRateLimiter(
  options: Partial<Options> & { limit: number },
  { forceEnable = false }: { forceEnable?: boolean } = {}
) {
  return rateLimit({
    windowMs: 60 * 1000,
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    limit: isTest && !forceEnable ? Number.MAX_SAFE_INTEGER : options.limit
  });
}

// 全局限流：防止有人写脚本/工具照分页把整个资料库扫一遍。这个数字刻意设得宽松——
// 正常人手动操作系统（包含开好几个分页、react-query 自动 refetch）不会碰到，
// 但连续翻页扫资料的脚本会很快撞到。
export const apiRateLimiter = buildRateLimiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: { error: "请求太频繁，请稍后再试" }
});

// 登入端点额外加一层更严格的限流——除了防机器人硬爬资料，也顺便防密码暴力破解
// （之前完全没有这层保护）。用「帐号 username + IP」当 key 而不是单纯 IP：同一个
// 公司 IP 底下多个人各自登入自己帐号，不该互相卡到彼此的额度。
export const loginRateLimiter = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // 用 express-rate-limit 官方的 ipKeyGenerator 处理 IP 部分（正确处理 IPv6 的多种文字
  // 表示法都要 normalize 成同一个 key，不然同一台机器可能因为 IPv6 地址写法不同而绕过限流）。
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${typeof req.body?.username === "string" ? req.body.username : ""}`,
  message: { error: "登入尝试次数过多，请稍后再试" }
});
