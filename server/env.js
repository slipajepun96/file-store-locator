import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load settings from .env in the project root, if present. Imported first so every module sees them.
// Variables already set by the host (e.g. a cloud dashboard) win over the file.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
