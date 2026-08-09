/**
 * ssrf-guard.ts
 *
 * SSRF 防护：服务端抓取用户可控 URL 前的安全校验。
 *
 * 拦截规则（对齐 OWASP SSRF 防护）：
 *   1. 只允许 http / https，拒绝 file: / gopher: / ftp: 等危险协议
 *   2. 拒绝直接以 IP 书写的私网/环回/link-local/保留地址
 *      （169.254.169.254 是云元数据服务，SSRF 头号目标）
 *   3. 拒绝 localhost / *.local / *.internal 等本地主机名
 *
 * 说明：这是「已知坏地址」黑名单式快速拦截，覆盖绝大多数攻击。
 * 对于短 TTL DNS rebinding 的 TOCTOU 攻击，需在网络层 pin IP，
 * 属更高成本方案，此处不做（应用场景为抓取公开学习资源）。
 */

/** 判断一个 IPv4/IPv6 字面量是否落在私网/环回/link-local/保留段 */
function isPrivateIp(host: string): boolean {
  // IPv6 环回 / 未指定 / link-local / unique-local
  const v6 = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (v6 === "::1" || v6 === "::" ) return true;
  if (v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  // IPv4-mapped IPv6，如 ::ffff:169.254.169.254
  const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ipv4 = mapped ? mapped[1] : host;

  const m = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 255 || b > 255) return false;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 环回
  if (a === 127) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 link-local（含云元数据 169.254.169.254）
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

/** 危险的本地主机名 */
function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "metadata.google.internal"
  );
}

/**
 * 校验 URL 是否可安全地由服务端抓取。
 * @returns 安全 → true；应拒绝 → false
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  // 只允许 http / https
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host) return false;
  if (isLocalHostname(host)) return false;
  if (isPrivateIp(host)) return false;
  return true;
}
