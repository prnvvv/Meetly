import { apiRequest } from "@/lib/api-client";
import { getAuthToken } from "@/lib/auth-token";
import { API_BASE_URL, REQUEST_TIMEOUT_MS, REST } from "@/lib/constants";
import { ApiError, type ApiErrorBody } from "@/types/api";
import type { Profile, ProfileUpdate } from "@/types/profile";

export const getMyProfile = () => apiRequest<Profile>(REST.myProfile);

export const getProfile = (userId: number) => apiRequest<Profile>(REST.userProfile(userId));

export const updateMyProfile = (patch: ProfileUpdate) =>
  apiRequest<Profile>(REST.myProfile, { method: "PATCH", body: patch });

export const removeMyAvatar = () => apiRequest<Profile>(REST.myAvatar, { method: "DELETE" });

export const checkUsername = (username: string) =>
  apiRequest<{ username: string; available: boolean; reason: string | null }>(
    `${REST.usernameAvailable}?username=${encodeURIComponent(username)}`
  );

/** Raw-bytes upload (the server verifies the real image type, not this header). */
export async function uploadMyAvatar(file: Blob): Promise<Profile> {
  const token = await getAuthToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS * 2);
  try {
    const response = await fetch(`${API_BASE_URL}${REST.myAvatar}`, {
      method: "PUT",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": file.type || "application/octet-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const detail = (parsed as ApiErrorBody | null)?.detail;
      throw new ApiError(
        typeof detail === "string" ? detail : "Could not upload that image.",
        response.status
      );
    }
    return parsed as Profile;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Cannot reach the meeting service. Check your connection.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
