import { spawn } from 'child_process';
import fs from 'fs';

const args = process.argv.slice(2);
let k6Bin = 'k6';

const defaultProgramFilesPath = 'C:\\Program Files\\k6\\k6.exe';
if (fs.existsSync(defaultProgramFilesPath)) {
  k6Bin = defaultProgramFilesPath;
}

const child = spawn(k6Bin, args, { stdio: 'inherit' });

child.on('error', (err) => {
  console.error('❌ Failed to launch k6:', err.message);
  console.error('Make sure k6 is installed at C:\\Program Files\\k6\\k6.exe or in your PATH.');
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

