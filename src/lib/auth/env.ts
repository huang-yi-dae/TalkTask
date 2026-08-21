/**
 * Auth 模块的环境变量校验。
 *
 * `AUTH_SECRET` 是 JWT 签发 / 校验的 HS256 密钥。它**必须存在**且**≥ 32 字符**，
 * 否则一旦发布到生产环境就会被攻击者伪造 token——这是最危险的安全事故之一。
 *
 * 实现策略：
 *   - 模块加载时同步 assert；失败抛错并打印明确指引（含生成命令）。
 *   - 在所有其他 auth 子模块（jwt/cookie/temp-account/current-user）import 之前
 *     先 import 此模块，确保启动期就触发校验。
 *   - 测试/REPL 场景如果想跳过校验，可设 `AUTH_SECRET_ALLOW_INSECURE=1`，
 *     此时 secret 会被替换为一个稳定的本地占位串。**仅供本地手测。**
 */

const MIN_LENGTH = 32;

declare global {
  // eslint-disable-next-line no-var
  var __authSecret: string | undefined;
}

function resolveSecret(): string {
  const raw = process.env.AUTH_SECRET;
  const allowInsecure = process.env.AUTH_SECRET_ALLOW_INSECURE === "1";

  if (raw && raw.length >= MIN_LENGTH) {
    return raw;
  }

  if (allowInsecure) {
    // 32+ 字符占位符，确保 jwt 签名可以走通。仅本地手测。
    const placeholder = "insecure-dev-only-do-not-use-in-prod-32+chars";
    console.warn(
      "[auth] AUTH_SECRET not set or too short; using insecure placeholder because AUTH_SECRET_ALLOW_INSECURE=1.",
    );
    return placeholder;
  }

  throw new Error(
    `AUTH_SECRET environment variable is required and must be at least ${MIN_LENGTH} characters.\n` +
      `Generate one with:  openssl rand -hex 32\n` +
      `Then set it in .env / Vercel project settings.`,
  );
}

// 模块级 eager 校验（import 即跑），避免运行时才抛。
const cached = globalThis.__authSecret ?? (globalThis.__authSecret = resolveSecret());

export const AUTH_SECRET: string = cached;
export const AUTH_COOKIE_NAME = "__Host-session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 天

export function requireAuthSecret(): string {
  return AUTH_SECRET;
}