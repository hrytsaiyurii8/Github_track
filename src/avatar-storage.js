import { getSupabase, getAvatarBucket } from "./supabase.js";

const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

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
  const bucket = getAvatarBucket();
  const supabase = getSupabase();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file.buffer, {
      contentType: mimetype,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(uploadError.message || "Avatar upload failed");
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = publicData?.publicUrl;
  if (!url) {
    throw new Error("Could not resolve public URL for uploaded avatar.");
  }
  return url;
}
