import { useEffect, useRef } from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function useDebugLog(enabled: boolean) {
  const streamRef = useRef<fs.WriteStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const dir = path.join(os.homedir(), '.my-agent');
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'debug.log');
    streamRef.current = fs.createWriteStream(logPath, { flags: 'a' });
    streamRef.current.write(
      `[${new Date().toISOString()}] === session start ===\n`
    );
    return () => {
      streamRef.current?.write(
        `[${new Date().toISOString()}] === session end ===\n`
      );
      streamRef.current?.end();
    };
  }, [enabled]);

  return (msg: string) => {
    if (streamRef.current) {
      streamRef.current.write(`[${new Date().toISOString()}] ${msg}\n`);
    }
  };
}
