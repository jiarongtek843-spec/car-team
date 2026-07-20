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
  cookie: {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});
