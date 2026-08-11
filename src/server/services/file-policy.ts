import { HttpError } from "@/lib/http";

const MEBIBYTE = 1024 * 1024;

export const MAX_UPLOAD_BYTES = 10 * MEBIBYTE;
export const MAX_WORKSPACE_FILE_BYTES = 100 * MEBIBYTE;
export const FILE_RETENTION_DAYS = 15;
export const FILE_RETENTION_MS = FILE_RETENTION_DAYS * 86_400_000;
export const EXPORT_RETENTION_DAYS = 7;

export function fileExpiresAt(createdAt = new Date()) {
  return new Date(createdAt.getTime() + FILE_RETENTION_MS);
}

export function assertFileUploadAllowed(fileBytes: number, workspaceBytes = 0) {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) {
    throw new HttpError(400, "Invalid file size", "invalid_file_size");
  }
  if (fileBytes > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, "Files must be 10MB or smaller", "file_too_large");
  }
  if (workspaceBytes + fileBytes > MAX_WORKSPACE_FILE_BYTES) {
    throw new HttpError(413, "Workspace file storage is limited to 100MB", "workspace_storage_limit");
  }
}
