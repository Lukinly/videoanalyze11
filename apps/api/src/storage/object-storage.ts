export interface ObjectStorage {
  createUpload(input: { objectKey: string; contentType: string; contentLength: number }): Promise<{ uploadUrl: string; expiresAt: string }>;
  head(objectKey: string): Promise<{ size: number; contentType: string }>;
  getDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  downloadToFile(objectKey: string, destination: string): Promise<void>;
  delete(objectKey: string): Promise<void>;
}
