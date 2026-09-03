export interface WorkspaceDirs {
  workspaceDir: string;
  bankPath: string;
  assetDir: string;
  exportDir: string;
  tempDir: string;
  historyDir: string;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
