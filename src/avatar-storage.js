import { getSupabase, getAvatarBucket } from "./supabase.js";

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

let bucketEnsured = false;

/**
 * Create the public avatars bucket if missing (service role required).
 */
export async function ensureAvatarBucket() {
  const bucket = getAvatarBucket();
  if (bucketEnsured) return bucket;

  const supabase = getSupabase();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();

  if (listError) {
    throw new Error(
      `Supabase Storage unavailable: ${listError.message}. Check SUPABASE_SERVICE_ROLE_KEY.`
    );
  }

  const exists = (buckets || []).some(
    (b) => b.name === bucket || b.id === bucket
  );

  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ],
    });

    if (
      createError &&
      !/already exists|duplicate|exists/i.test(createError.message)
    ) {
      throw new Error(
        `Could not create Supabase Storage bucket "${bucket}": ${createError.message}. ` +
          `In Supabase Dashboard → Storage, create a public bucket named "${bucket}".`
      );
    }
  }

  bucketEnsured = true;
  return bucket;
}

export async function uploadAvatarFile(file, login) {
  if (!file?.buffer?.length) {
    throw new Error("No image file provided.");
  }

  const mimetype = String(file.mimetype || "").toLowerCase();
  const ext = MIME_EXT[mimetype];
  if (!ext) {
    throw new Error("Only JPEG, PNG, GIF, or WebP images are allowed.");
  }

  const safeLogin = String(login || "contact")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 48) || "contact";
  const path = `${safeLogin}/${Date.now()}.${ext}`;
  const supabase = getSupabase();
  const bucket = await ensureAvatarBucket();

  const tryUpload = async () => {
    return supabase.storage.from(bucket).upload(path, file.buffer, {
      contentType: mimetype,
      upsert: true,
      cacheControl: "3600",
    });
  };

  let { error: uploadError } = await tryUpload();

  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    bucketEnsured = false;
    await ensureAvatarBucket();
    ({ error: uploadError } = await tryUpload());
  }

  if (uploadError) {
    throw new Error(
      uploadError.message ||
        `Avatar upload failed. Ensure Supabase Storage has a public bucket named "${bucket}".`
    );
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = publicData?.publicUrl;
  if (!url) {
    throw new Error("Could not resolve public URL for uploaded avatar.");
  }
  return url;
}
