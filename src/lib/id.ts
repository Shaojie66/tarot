/** 随机 ID。不用 crypto.randomUUID：手机经局域网 http 访问时不是安全上下文，它不可用。 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
