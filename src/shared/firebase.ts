/**
 * Firebase Authentication utilities.
 *
 * Firebase Auth is used by many platforms (HighLevel, etc.) for user authentication.
 * This module provides shared types, schemas, and utilities for Firebase Auth tokens
 * stored in localStorage.
 */

import { z } from "zod";
import type { Page } from "playwright";

// ============================================================================
// Schemas & Types
// ============================================================================

/**
 * Zod schema for validated Firebase auth token from localStorage.
 * Use this after parsing to ensure the token has all required fields.
 */
export const FirebaseAuthTokenSchema = z.object({
  stsTokenManager: z.object({
    accessToken: z.string(),
    expirationTime: z.number().optional(),
    refreshToken: z.string().optional(),
  }),
});

export type FirebaseAuthToken = z.infer<typeof FirebaseAuthTokenSchema>;

/**
 * Raw Firebase auth data structure from localStorage (before validation).
 * Use this type when parsing JSON from localStorage.
 */
export interface FirebaseAuthRaw {
  stsTokenManager?: {
    accessToken?: string;
    expirationTime?: number;
    refreshToken?: string;
  };
}

// ============================================================================
// localStorage Key Detection
// ============================================================================

/**
 * The localStorage key pattern for Firebase auth tokens.
 * Firebase stores auth tokens with keys like "firebase:authUser:API_KEY:[DEFAULT]"
 */
export const FIREBASE_AUTH_KEY_PATTERN = "firebase:authUser";

/**
 * Finds the Firebase auth token key in localStorage.
 * Returns null if no Firebase auth token is found.
 */
export function findFirebaseAuthKey(storage: Storage): string | null {
  return Object.keys(storage).find((k) => k.includes(FIREBASE_AUTH_KEY_PATTERN)) ?? null;
}

// ============================================================================
// Token Utilities
// ============================================================================

/**
 * Checks if a Firebase auth token is expired.
 */
export function isTokenExpired(token: FirebaseAuthRaw): boolean {
  const expirationTime = token.stsTokenManager?.expirationTime;
  if (!expirationTime) {
    // No expiration time means we can't determine if expired
    // Assume valid if we have an access token
    return !token.stsTokenManager?.accessToken;
  }
  return Date.now() >= expirationTime;
}

/**
 * Extracts the access token from Firebase auth data.
 */
export function getAccessToken(token: FirebaseAuthRaw): string | undefined {
  return token.stsTokenManager?.accessToken;
}

// ============================================================================
// Page Utilities (Playwright)
// ============================================================================

/* v8 ignore start */

/**
 * Checks if the page has a valid (non-expired) Firebase auth token in localStorage.
 */
export async function hasValidFirebaseToken(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      ({ keyPattern }) => {
        const tokenKey = Object.keys(localStorage).find((k) => k.includes(keyPattern));
        if (!tokenKey) return false;

        interface FirebaseAuthData {
          stsTokenManager?: {
            accessToken?: string;
            expirationTime?: number;
          };
        }

        const tokenData = JSON.parse(localStorage.getItem(tokenKey) ?? "{}") as FirebaseAuthData;
        const expirationTime = tokenData?.stsTokenManager?.expirationTime;

        if (expirationTime) {
          return Date.now() < expirationTime;
        }

        return !!tokenData?.stsTokenManager?.accessToken;
      },
      { keyPattern: FIREBASE_AUTH_KEY_PATTERN }
    );
  } catch {
    return false;
  }
}

/**
 * Extracts the Firebase auth token from the page's localStorage.
 * Returns the raw token data or null if not found.
 */
export async function extractFirebaseAuthFromPage(page: Page): Promise<FirebaseAuthRaw | null> {
  return page.evaluate(
    ({ keyPattern }): FirebaseAuthRaw | null => {
      const tokenKey = Object.keys(localStorage).find((k) => k.includes(keyPattern));
      if (!tokenKey) return null;

      interface FirebaseAuthData {
        stsTokenManager?: {
          accessToken?: string;
          expirationTime?: number;
          refreshToken?: string;
        };
      }

      try {
        return JSON.parse(localStorage.getItem(tokenKey) ?? "{}") as FirebaseAuthData;
      } catch {
        return null;
      }
    },
    { keyPattern: FIREBASE_AUTH_KEY_PATTERN }
  );
}

/* v8 ignore stop */
