import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const target = process.env.NEWSMAP_TARGET ?? "x86_64-pc-windows-gnu";
if (!["x86_64-pc-windows-gnu", "x86_64-pc-windows-msvc"].includes(target)) {
  throw new Error(`Unsupported Windows target: ${target}`);
}
const result = spawnSync(process.execPath, [cli, "build", "--bundles", "nsis", "--target", target, "--", "--locked"], {
  stdio: "inherit",
  env: { ...process.env, RUSTUP_TOOLCHAIN: `stable-${target}` },
});
process.exit(result.status ?? 1);
