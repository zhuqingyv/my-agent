import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const HELPER_VERSION = '2';

const HELPER_SOURCE = String.raw`
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>

static NSString *service = @"my-agent";

static void fail(NSString *message, int code) {
  fprintf(stderr, "%s\n", [message UTF8String]);
  exit(code);
}

static NSString *statusMessage(OSStatus status) {
  CFStringRef message = SecCopyErrorMessageString(status, NULL);
  if (message) {
    return CFBridgingRelease(message);
  }
  return [NSString stringWithFormat:@"OSStatus %d", (int)status];
}

static NSMutableDictionary *baseQuery(NSString *account) {
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: service,
    (__bridge id)kSecAttrAccount: account
  } mutableCopy];
}

static NSData *readStdin(void) {
  return [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
}

static SecAccessRef createAccess(NSString *account) {
  SecTrustedApplicationRef trusted = NULL;
  OSStatus trustedStatus = SecTrustedApplicationCreateFromPath(NULL, &trusted);
  if (trustedStatus != errSecSuccess) {
    fail([NSString stringWithFormat:@"trusted app failed: %@", statusMessage(trustedStatus)], 8);
  }

  NSArray *trustedApps = @[CFBridgingRelease(trusted)];
  SecAccessRef access = NULL;
  NSString *label = [NSString stringWithFormat:@"MA credential %@", account];
  OSStatus accessStatus = SecAccessCreate((__bridge CFStringRef)label, (__bridge CFArrayRef)trustedApps, &access);
  if (accessStatus != errSecSuccess) {
    fail([NSString stringWithFormat:@"access failed: %@", statusMessage(accessStatus)], 9);
  }
  return access;
}

static void addOrUpdate(NSString *account, NSData *secret) {
  NSMutableDictionary *query = baseQuery(account);
  SecItemDelete((__bridge CFDictionaryRef)query);

  SecAccessRef access = createAccess(account);
  query[(__bridge id)kSecValueData] = secret;
  query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
  query[(__bridge id)kSecAttrAccess] = CFBridgingRelease(access);
  query[(__bridge id)kSecAttrLabel] = [NSString stringWithFormat:@"MA credential %@", account];
  query[(__bridge id)kSecAttrDescription] = @"API key stored by my-agent";

  OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  if (status != errSecSuccess) {
    fail([NSString stringWithFormat:@"store failed: %@", statusMessage(status)], 2);
  }
}

static void authenticate(NSString *reason) {
  LAContext *context = [[LAContext alloc] init];
  NSError *error = nil;
  if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error]) {
    fail([NSString stringWithFormat:@"authentication unavailable: %@", error.localizedDescription], 6);
  }

  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  __block BOOL ok = NO;
  __block NSString *message = nil;
  [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:reason reply:^(BOOL success, NSError *authError) {
    ok = success;
    if (authError) message = [authError.localizedDescription copy];
    dispatch_semaphore_signal(sem);
  }];
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

  if (!ok) {
    fail([NSString stringWithFormat:@"authentication failed: %@", message ?: @"cancelled"], 7);
  }
}

static NSData *copySecret(NSString *account, NSString *reason, BOOL requireAuth) {
  if (requireAuth) authenticate(reason);
  NSMutableDictionary *query = baseQuery(account);
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef item = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &item);
  if (status != errSecSuccess) {
    fail([NSString stringWithFormat:@"get failed: %@", statusMessage(status)], status == errSecItemNotFound ? 3 : 4);
  }
  return CFBridgingRelease(item);
}

static void deleteSecret(NSString *account, NSString *reason) {
  (void)copySecret(account, reason, YES);
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)baseQuery(account));
  if (status != errSecSuccess && status != errSecItemNotFound) {
    fail([NSString stringWithFormat:@"delete failed: %@", statusMessage(status)], 5);
  }
}

static void repairAccess(NSString *account) {
  NSMutableDictionary *attrs = [NSMutableDictionary dictionary];
  SecAccessRef access = createAccess(account);
  attrs[(__bridge id)kSecAttrAccess] = CFBridgingRelease(access);
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)baseQuery(account), (__bridge CFDictionaryRef)attrs);
  if (status != errSecSuccess) {
    fail([NSString stringWithFormat:@"repair failed: %@", statusMessage(status)], status == errSecItemNotFound ? 3 : 10);
  }
}

static void existsSecret(NSString *account) {
  NSMutableDictionary *query = baseQuery(account);
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge id)kSecReturnAttributes] = @YES;
  query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUISkip;
  CFTypeRef item = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &item);
  if (item) CFRelease(item);
  if (status == errSecSuccess) {
    printf("yes\n");
    exit(0);
  }
  if (status == errSecItemNotFound) {
    printf("no\n");
    exit(3);
  }
  fail([NSString stringWithFormat:@"exists failed: %@", statusMessage(status)], 4);
}

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc < 3) {
      fail(@"usage: ma-keychain-helper <store|get|get-auth|delete|exists|repair> <account> [reason]", 1);
    }
    NSString *command = [NSString stringWithUTF8String:argv[1]];
    NSString *account = [NSString stringWithUTF8String:argv[2]];
    NSString *reason = argc >= 4
      ? [NSString stringWithUTF8String:argv[3]]
      : [NSString stringWithFormat:@"MA needs access to %@", account];

    if ([command isEqualToString:@"store"]) {
      addOrUpdate(account, readStdin());
    } else if ([command isEqualToString:@"get"]) {
      [[NSFileHandle fileHandleWithStandardOutput] writeData:copySecret(account, reason, NO)];
    } else if ([command isEqualToString:@"get-auth"]) {
      [[NSFileHandle fileHandleWithStandardOutput] writeData:copySecret(account, reason, YES)];
    } else if ([command isEqualToString:@"delete"]) {
      deleteSecret(account, reason);
    } else if ([command isEqualToString:@"repair"]) {
      repairAccess(account);
    } else if ([command isEqualToString:@"exists"]) {
      existsSecret(account);
    } else {
      fail([NSString stringWithFormat:@"unknown command: %@", command], 1);
    }
  }
  return 0;
}
`;

function helperPaths(): { dir: string; source: string; bin: string } {
  const dir = path.join(os.homedir(), '.my-agent', 'bin');
  return {
    dir,
    source: path.join(dir, 'ma-keychain-helper.m'),
    bin: path.join(dir, 'ma-keychain-helper'),
  };
}

export function ensureKeychainHelper(): string {
  if (process.platform !== 'darwin') {
    throw new Error('macOS Keychain secret storage is only supported on macOS');
  }
  const clang = spawnSync('which', ['clang'], { encoding: 'utf-8' });
  if (clang.status !== 0) {
    throw new Error('clang not found; cannot build macOS Keychain helper');
  }

  const { dir, source, bin } = helperPaths();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const current = fs.existsSync(source) ? fs.readFileSync(source, 'utf-8') : '';
  if (current !== HELPER_SOURCE) {
    fs.writeFileSync(source, HELPER_SOURCE, { encoding: 'utf-8', mode: 0o600 });
  }
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(source).mtimeMs) {
    const compiled = spawnSync('clang', [
      source,
      '-fobjc-arc',
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-framework',
      'LocalAuthentication',
      '-o',
      bin,
    ], { encoding: 'utf-8' });
    if (compiled.status !== 0) {
      throw new Error(`failed to build macOS Keychain helper: ${compiled.stderr || compiled.stdout}`);
    }
    spawnSync('codesign', ['--force', '--sign', '-', bin], { encoding: 'utf-8' });
    fs.chmodSync(bin, 0o700);
  }
  return bin;
}

function accountFromRef(ref: string): string {
  return ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
}

export function makeSecretRef(credentialId: string): string {
  return `keychain:credential:${credentialId}`;
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '********';
  return `${secret.slice(0, 3)}...${secret.slice(-4)}`;
}

export function storeSecret(ref: string, secret: string): void {
  if (ref.startsWith('env:')) {
    throw new Error('env secret refs are read-only');
  }
  const helper = ensureKeychainHelper();
  const result = spawnSync(helper, ['store', accountFromRef(ref)], {
    input: secret,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'failed to store secret').trim());
  }
}

export interface ReadSecretOptions {
  authenticate?: boolean;
}

export function readSecret(ref: string, reason: string, options: ReadSecretOptions = {}): string {
  if (ref.startsWith('env:')) {
    const name = ref.slice('env:'.length);
    const value = process.env[name];
    if (!value) throw new Error(`environment secret ${name} is not set`);
    return value;
  }
  const helper = ensureKeychainHelper();
  const command = options.authenticate ? 'get-auth' : 'get';
  const result = spawnSync(helper, [command, accountFromRef(ref), reason], {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'failed to read secret').trim());
  }
  return result.stdout;
}

export function deleteSecret(ref: string, reason: string): void {
  if (ref.startsWith('env:')) {
    throw new Error('env secret refs are read-only');
  }
  const helper = ensureKeychainHelper();
  const result = spawnSync(helper, ['delete', accountFromRef(ref), reason], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'failed to delete secret').trim());
  }
}

export function repairSecretAccess(ref: string): void {
  if (ref.startsWith('env:')) {
    throw new Error('env secret refs do not use Keychain access control');
  }
  const helper = ensureKeychainHelper();
  const result = spawnSync(helper, ['repair', accountFromRef(ref)], {
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'failed to repair secret access').trim());
  }
}

export function canUseMacOSKeychain(): boolean {
  return os.platform() === 'darwin';
}
