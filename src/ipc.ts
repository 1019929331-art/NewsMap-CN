import { invoke } from "@tauri-apps/api/core";

/**
 * Tauri IPC 在 WebView 首次加载时存在竞态：首个 invoke 的响应可能丢失导致永久挂起。
 * 这里对调用加超时并在超时后重试，直到 IPC 就绪。
 */
export async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = 2000,
  retries = 15,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await Promise.race([
        invoke<T>(cmd, args),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("IPC 超时")), timeoutMs),
        ),
      ]);
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`命令 ${cmd} 调用失败`);
}
