type ExpiredObject = {
  key: string;
  kind: "original" | "temporary" | "result";
};

type RetentionState = {
  listExpiredObjects(now: Date): Promise<ExpiredObject[]>;
  markObjectDeleted(object: ExpiredObject): Promise<void>;
};

type StorageDeleter = {
  delete(key: string): Promise<void>;
};

export async function cleanupExpiredObjects(input: { state: RetentionState; storage: StorageDeleter; now: Date }) {
  const expiredObjects = await input.state.listExpiredObjects(input.now);
  const deletedKeys: string[] = [];

  for (const object of expiredObjects) {
    try {
      await input.storage.delete(object.key);
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
    await input.state.markObjectDeleted(object);
    deletedKeys.push(object.key);
  }

  return { deletedKeys };
}

function isMissingObjectError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["NoSuchKey", "NotFound", "404"].includes(String(error.code));
}
