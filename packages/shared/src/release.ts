export function getReleaseCommit() {
  return process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "unknown";
}
