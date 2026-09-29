// Loads the repo-root .env for local (non-Docker) runs. Must be imported before
// anything that reads process.env at module load. Existing environment
// variables win, so Docker/compose-provided values are never overridden.
import fs from 'fs'
import path from 'path'

const envFile = path.resolve(__dirname, '../../../.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

// Compose files pass optional settings as `${VAR:-}`, which sets them to "".
// Treat empty as unset so defaults apply (Number("") would otherwise turn a
// timeout into 0 and "" is not a valid rate-limit window).
for (const [key, value] of Object.entries(process.env)) {
  if (value === '') delete process.env[key]
}
