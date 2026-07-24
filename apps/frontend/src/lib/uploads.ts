// Backend 存的是相对路径（例如 /uploads/collections/x.jpg），但实际服务这个档案的是一支
// 要求登入 + 权限检查的路由，挂在 /api/uploads/...，不是公开的 express.static（见
// apps/backend/src/app.ts）。这里统一负责把存的相对路径转成可以打的请求路径，全项目只有
// 这一个地方做这个转换——不允许各个组件各自拼绝对 URL（那正是 Critical Bug「Not
// authenticated」/Proof 图片看不到 同一类问题的根源：硬编一个跨网域的绝对 API_BASE_URL，
// Railway 上 Frontend/Backend 是不同网域，装置会打到自己的 localhost 或错的网域）。
export function toProofUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return `/api${path}`;
}
