/**
 * File system errors shaped as Node makes them: `code`, `errno`, `syscall`, `path` (and `dest` for a rename or a copy),
 * and the message `<CODE>: <description>, <syscall> '<path>'`. The numbers are Linux's, as workerd reports them.
 */

/** The error codes this file system raises. */
export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL' | 'EXDEV' | 'EBADF' | 'ENOSYS' | 'EROFS' | 'ENOSPC' | 'EPERM' | 'EFBIG' | 'EIO';

const ERRNO: Record<FsErrorCode, number> = {
  EPERM: -1,
  ENOENT: -2,
  EIO: -5,
  EBADF: -9,
  EEXIST: -17,
  EXDEV: -18,
  ENOTDIR: -20,
  EISDIR: -21,
  EINVAL: -22,
  EFBIG: -27,
  ENOSPC: -28,
  EROFS: -30,
  ENOSYS: -38,
  ENOTEMPTY: -39,
};

const DESCRIPTION: Record<FsErrorCode, string> = {
  EPERM: 'operation not permitted',
  ENOENT: 'no such file or directory',
  EIO: 'i/o error',
  EBADF: 'bad file descriptor',
  EEXIST: 'file already exists',
  EXDEV: 'cross-device link not permitted',
  ENOTDIR: 'not a directory',
  EISDIR: 'illegal operation on a directory',
  EINVAL: 'invalid argument',
  EFBIG: 'file too large',
  ENOSPC: 'no space left on device',
  EROFS: 'read-only file system',
  ENOSYS: 'function not implemented',
  ENOTEMPTY: 'directory not empty',
};

/** An error as `node:fs` throws it. */
export interface FsError extends Error {
  code: FsErrorCode;
  errno: number;
  syscall: string;
  path?: string;
  dest?: string;
}

/** Makes an error as `node:fs` would for `syscall` on `path` (and `dest`); `detail` is added to the message only. */
export function fsError(code: FsErrorCode, syscall: string, path?: string, dest?: string, detail?: string): FsError {
  let message = `${code}: ${DESCRIPTION[code]}, ${syscall}`;
  if (path !== undefined) message += ` '${path}'`;
  if (dest !== undefined) message += ` -> '${dest}'`;
  if (detail) message += ` (${detail})`;
  const error = new Error(message) as FsError;
  error.errno = ERRNO[code];
  error.code = code;
  error.syscall = syscall;
  if (path !== undefined) error.path = path;
  if (dest !== undefined) error.dest = dest;
  return error;
}

/** Whether `error` is a file system error with `code`. */
export function isFsError(error: unknown, code?: FsErrorCode): error is FsError {
  return error instanceof Error && typeof (error as Partial<FsError>).syscall === 'string' && (code === undefined || (error as FsError).code === code);
}

/** The error of a `node:fs` member this file system does not offer (nothing the type server calls in hosted mode needs it). */
export function unsupportedMember(name: string): FsError {
  return fsError('ENOSYS', name, undefined, undefined, `node:fs ${name} is not available on this platform`);
}
