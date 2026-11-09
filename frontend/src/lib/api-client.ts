import { getAuthToken } from "./auth-token";
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "./constants";
import { ApiError, type ApiErrorBody } from "@/types/api";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
}

function detailToMessage(body: ApiErrorBody | null): string | null {
  if (!body) return null;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (Array.isArray(body.detail) && body.detail.length > 0) {
    const first = body.detail[0];
    if (typeof first?.msg === "string" && first.msg.trim()) return first.msg;
  }
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return null;
}

/**
 * Thin fetch wrapper: single base URL, timeout, JSON handling and a stable
 * error type. Every REST call in the app goes through this module.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { body, timeoutMs = REQUEST_TIMEOUT_MS, headers, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const token = await getAuthToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new ApiError("The server took too long to respond. Please try again.", 0, "TIMEOUT");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request was cancelled. Please try again.", 0, "ABORTED");
    }
    throw new ApiError("Cannot reach the meeting service. Check your connection.", 0, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const message =
      detailToMessage(parsed as ApiErrorBody) ?? defaultHttpMessage(response.status);
    throw new ApiError(message, response.status);
  }

  return parsed as T;
}

function defaultHttpMessage(status: number): string {
  switch (status) {
    case 400:
      return "That request was not valid. Check the details and try again.";
    case 401:
      return "You are not signed in. Please sign in and try again.";
    case 403:
      return "You do not have permission to do that.";
    case 404:
      return "We could not find what you were looking for.";
    case 409:
      return "That action conflicts with the current meeting state.";
    case 422:
      return "Some of the details you entered are not valid.";
    case 500:
    case 502:
    case 503:
    case 504:
      return "The meeting service is temporarily unavailable. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Converts any thrown value into copy that is safe to show a user. */
export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export const api = { request: apiRequest };
