// Loads the repo-root .env for local (non-Docker) runs. Must be imported before
// anything that reads process.env at module load. Existing environment
// variables win, so Docker/compose-provided values are never overridden.
import fs from 'fs'
import path from 'path'

const envFile = path.resolve(__dirname, '../../../.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
