import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PASTE_DIR = path.join(os.homedir(), '.my-agent', 'pastes');

export function checkClipboardImage(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const info = execSync("osascript -e 'clipboard info'", {
      encoding: 'utf-8',
      timeout: 2000,
    });
    if (!info.includes('«class PNGf»') && !info.includes('«class TIFF»')) {
      return null;
    }

    fs.mkdirSync(PASTE_DIR, { recursive: true });
    const filename = `paste_${Date.now()}.png`;
    const filepath = path.join(PASTE_DIR, filename);
    execSync(
      `osascript -e 'set png to (the clipboard as «class PNGf»)' -e 'set f to open for access POSIX file "${filepath}" with write permission' -e 'write png to f' -e 'close access f'`,
      { timeout: 5000 }
    );

    return filepath;
  } catch {
    return null;
  }
}

export function imageToBase64DataUrl(filepath: string): string {
  const buf = fs.readFileSync(filepath);
  const ext = path.extname(filepath).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export function getImageSize(filepath: string): number {
  return fs.statSync(filepath).size;
}
