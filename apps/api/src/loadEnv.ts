import { config } from 'dotenv';
import path from 'node:path';

// Load the repo-root .env during development. In production (Docker) the env
// comes from the container and the file is absent, so this is a no-op.
config({ path: path.resolve(process.cwd(), '../../.env') });
