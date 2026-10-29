import { expect, test, type APIRequestContext } from "@playwright/test";
import { resolve } from "node:path";

async function readMail(request: APIRequestContext, email: string, subject: string): Promise<string> {
  let text = "";
  await expect.poll(async () => {
    const listing = await (await request.get("http://127.0.0.1:8025/api/v1/messages?limit=50")).json();
    const mail = listing.messages.find((message: { Subject: string }) => message.Subject.includes(subject) && JSON.stringify(message).includes(email));
    if (!mail) return false;
    const detail = await (await request.get(`http://127.0.0.1:8025/api/v1/message/${mail.ID}`)).json();
    text = detail.Text;
    return true;
  }).toBe(true);
  return text;
}

test("recovers a password through email and rejects the old password, session and reused link", async ({ page, request }) => {
  test.skip(process.env.E2E_RUNTIME !== "1", "Requires pnpm local:dev and Mailpit");
  const email = `recovery-${Date.now()}@example.test`;
  const originalPassword = "Original-secure-password!";
  const password = "Updated-secure-password!";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  expect((await request.post("/api/auth/registration-code", { data: { email } })).status()).toBe(202);
  const registrationMail = await readMail(request, email, "注册验证码");
  const code = registrationMail.match(/\d{6}/)?.[0];
  expect((await request.post("/api/auth/register", { data: { email, password: originalPassword, confirmPassword: originalPassword, verificationCode: code } })).status()).toBe(202);
  expect((await request.post("/api/auth/login", { data: { email, password: originalPassword } })).status()).toBe(200);

  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "忘记密码？" }).click();
  await expect(page.getByLabel("邮箱")).toHaveValue(email);
  await page.getByRole("button", { name: "发送重置链接" }).click();
  await expect(page.getByRole("status")).toContainText("如果该邮箱已注册");
  await expect(page.getByRole("button", { name: /秒后可重新发送/ })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(".local/screenshots/password-recovery-mobile.png"), fullPage: true });

  const resetMail = await readMail(request, email, "重置你的");
  const link = new URL(resetMail.match(/https?:\/\/\S+/)![0]);
  const resetPath = `${link.pathname}${link.search}`;
  // Follow the exact address from the email, including its configured origin.
  await page.goto(link.href);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill("mismatched password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("alert")).toContainText("两次输入的密码不一致");
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "登录你的工作台" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("密码已重置");
  expect((await request.get("/api/auth/me")).status()).toBe(401);
  expect((await request.post("/api/auth/login", { data: { email, password: originalPassword } })).status()).toBe(401);
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: /把每段视频/ })).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();

  await page.goto(resetPath);
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("alert")).toContainText("重置链接已失效或已使用");
  await page.getByRole("button", { name: "重新获取重置链接" }).click();
  await expect(page.getByRole("heading", { name: "忘记密码" })).toBeVisible();
  expect(errors).toEqual([]);
});
