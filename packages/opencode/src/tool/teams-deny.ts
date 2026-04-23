// Path-glob denylist applied at the file-system layer when the running agent
// is "teams". Closes the gap where path-keyed permission rules don't reach
// ripgrep for grep/glob/list (those tools pass their own search pattern, not
// the file path, to the permission system).
//
// Edit this list to change which paths are excluded for the teams agent.
// Order matters: ripgrep glob precedence is later-wins, so a positive entry
// after a deny re-enables specific files (e.g. .env.example) within a broader
// exclusion.
//
// Categories:
//   - env files (and re-allow .env.example)
//   - filename conventions for secrets/credentials/keys
//   - private SSH/TLS material
//   - user/system credential stores
//   - git internals carrying tokens
//   - IDE configs that may embed connection strings
//   - Laravel-specific caches and logs
//   - backup/temp files
//   - DB dumps and embedded sqlite
//   - heavy build artifacts (signal hygiene, not security)
const TEAMS_DENY: string[] = [
  // env files
  "!**/.env",
  "!**/.env.local",

  // filename conventions
  "!**/credentials*",
  "!**/secret*",
  "!**/private*",

  // crypto material
  "!**/*.pem",
  "!**/*.key",
  "!**/*.p12",
  "!**/*.pfx",
  "!**/*.jks",
  "!**/id_rsa",
  "!**/id_ed25519",
  "!**/id_ecdsa",

  // user/system credential stores
  "!**/.aws/credentials",
  "!**/.aws/config",
  "!**/.ssh/**",
  "!**/.netrc",
  "!**/.pgpass",
  "!**/.docker/config.json",
  "!**/.npmrc",
  "!**/.yarnrc",
  "!**/.yarnrc.yml",

  // git internals
  "!**/.git/config",
  "!**/.git/credentials",

  // IDE configs
  "!**/.idea/dataSources/**",
  "!**/.idea/workspace.xml",
  "!**/.idea/sshConfigs.xml",
  "!**/.vscode/settings.json",
  "!**/.vscode/launch.json",

  // Laravel-specific
  "!**/storage/logs/**",
  "!**/storage/debugbar/**",
  "!**/storage/framework/cache/**",
  "!**/bootstrap/cache/**",

  // backup/temp
  "!**/*.bak",
  "!**/*.backup",
  "!**/*.swp",
  "!**/*.swo",
  "!**/*~",
  "!**/*.orig",

  // DB dumps / embedded
  "!**/*.sqlite",
  "!**/*.sqlite3",
  "!**/*.db",
  "!**/*.dump",
  "!**/dump.sql",

  // heavy build artifacts (signal hygiene)
  "!**/*.min.js",
  "!**/*.min.css",
  "!**/*.map",

  // generic dump locations
  "!**/dump/**",
  "!**/dumps/**",
  "!**/backup/**",
  "!**/backups/**",
]

export function teamsDenyGlobs(agent: string): string[] {
  if (agent !== "teams") return []
  return TEAMS_DENY
}

// Evaluates a resolved file/directory path against the deny list using
// last-rule-wins semantics (matching ripgrep's --glob precedence). Returns
// true if the path is denied for this agent. Used to refuse explicit-file
// grep calls that bypass ripgrep's own glob filtering.
export function teamsPathIsDenied(filePath: string, agent: string): boolean {
  const denies = teamsDenyGlobs(agent)
  if (denies.length === 0) return false
  let denied = false
  for (const entry of denies) {
    const isNeg = entry.startsWith("!")
    const pattern = isNeg ? entry.slice(1) : entry
    if (new Bun.Glob(pattern).match(filePath)) denied = isNeg
  }
  return denied
}
