type OwnedVideoRepository = {
  listOwnedObjectKeys(userId: string, videoId: string): Promise<string[] | null>;
  markDeleted(userId: string, videoId: string): Promise<void>;
};

type ObjectDeleter = { delete(key: string): Promise<void> };

export async function deleteVideo(input: { userId: string; videoId: string; videos: OwnedVideoRepository; storage: ObjectDeleter }) {
  const objectKeys = await input.videos.listOwnedObjectKeys(input.userId, input.videoId);
  if (!objectKeys) return false;
  for (const key of objectKeys) {
    try {
      await input.storage.delete(key);
    } catch (error) {
      if (!isMissingObjectError(error)) throw error;
    }
  }
  await input.videos.markDeleted(input.userId, input.videoId);
  return true;
}

function isMissingObjectError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ["NoSuchKey", "NotFound", "404"].includes(String(error.code));
}
