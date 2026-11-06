import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { cookieSecure } from "../config/env.js";
import { parseBody } from "../lib/validate.js";
import {
  dashBoardAuth,
  SESSION_COOKIE,
  type DashboardEnv,
} from "../middleware/dashBoardAuth.js";
import { throttleByIp } from "../middleware/throttle.js";
import {
  getProfile,
  loginUser,
  SESSION_MAX_AGE_SECONDS,
  signup,
} from "../services/auth.service.js";

const authRouter = new Hono<DashboardEnv>();

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const email = z.email().max(254);
// bcrypt ignores input past 72 bytes.
const newPassword = z.string().min(10, "must be at least 10 characters").max(72);

const signupSchema = z.object({
  tenantName: z.string().trim().min(2).max(80),
  email,
  password: newPassword,
});

const loginSchema = z.object({
  email,
  password: z.string().min(1).max(72),
});

authRouter.post(
  "/signup",
  throttleByIp("signup", 20, FIFTEEN_MINUTES_MS),
  async (c) => {
    const user = await signup(await parseBody(c, signupSchema));
    return c.json({ success: true, user }, 201);
  },
);

authRouter.post(
  "/login",
  throttleByIp("login", 30, FIFTEEN_MINUTES_MS),
  async (c) => {
    const { token } = await loginUser(await parseBody(c, loginSchema));

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "strict",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });

    return c.json({ message: "Login successful" }, 200);
  },
);

authRouter.post("/logout", async (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ success: true, message: "Logged out" });
});

authRouter.get("/me", dashBoardAuth, async (c) => {
  return c.json({ user: await getProfile(c.get("userId")) });
});

export { newPassword, email as emailSchema };
export default authRouter;
