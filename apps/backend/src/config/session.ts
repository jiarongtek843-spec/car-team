import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import { env } from "./env.js";

declare module "express-session" {
  interface SessionData {
    userId: number;
  }
}

const sessionPool = new Pool({ connectionString: env.databaseUrl });
const PgSession = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgSession({ pool: sessionPool, tableName: "session", createTableIfMissing: true }),
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: "car_team_sid",
  // Railway 部署下 Frontend/Backend 是两个不同的 *.up.railway.app 子网域，浏览器视为不同
  // Site（cookie SameSite 判断用的是 registrable domain，Railway 的子网域各自算独立 Site）。
  // fetch 用 credentials:"include" 打跨网域 API 时，SameSite=Lax 的 Cookie 不会被送出
  // （Lax 只在「同网站」或「跨网站顶层导航」才带 Cookie，跨站的 XHR/fetch 子请求不算），
  // 会造成登入后马上被当成没登入。所以部署环境（isProduction，见 config/env.ts 的说明）
  // 一律用 SameSite=None——这个设定必须搭配 Secure:true 才会被浏览器接受，两者绑在一起改。
  // 本地开发是同网域（都是 localhost，不同 port 不影响 SameSite 判断），维持 Lax + 不要求
  // Secure，才能在 http://localhost 底下正常运作。
  cookie: {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});
