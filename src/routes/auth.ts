import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { registerUser, loginUser } from "../services/auth.service.js";

const authRouter = new Hono();

authRouter.post("/register", async (c) => {
  const body = await c.req.json();
  const user = await registerUser(body);
  return c.json({ success: true, user }, 201);
});

authRouter.post("/login", async (c) => {
  const { email, password } = await c.req.json();
  const { token, secure } = await loginUser({ email, password });

  setCookie(c, "Fluxgate_session", token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    maxAge: 60 * 60 * 24, // 1 day in seconds
    path: "/",
  });

  return c.json({ message: "Login successful" }, 200);
});

authRouter.post("/logout", async (c) => {
  deleteCookie(c, "Fluxgate_session", {
    path: "/",
  });
  return c.json({ success: true, message: "Logged out" });
});

export default authRouter;
