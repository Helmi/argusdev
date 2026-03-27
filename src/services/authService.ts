/**
 * Authentication Service for ArgusDev WebUI
 *
 * Two-tier authentication:
 * 1. Access Token - 3 memorable words used as URL path
 * 2. Passcode - 6+ character alphanumeric code for session auth
 */

import bcrypt from 'bcrypt';
import {randomUUID} from 'crypto';
import {generateAccessToken, isValidTokenFormat} from '../utils/wordlist.js';

const BCRYPT_ROUNDS = 10;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

interface Session {
	id: string;
	createdAt: number;
	lastActivity: number;
	expiresAt: number;
}

interface RateLimitEntry {
	attempts: number;
	lastAttempt: number;
	lockedUntil: number | null;
}

class AuthService {
	private sessions: Map<string, Session> = new Map();
	private rateLimits: Map<string, RateLimitEntry> = new Map();

	/**
	 * Generate a new access token (3 words)
	 */
	generateToken(): string {
		return generateAccessToken();
	}

	/**
	 * Validate access token format
	 */
	validateTokenFormat(token: string): boolean {
		return isValidTokenFormat(token);
	}

	/**
	 * Hash a passcode using bcrypt
	 */
	async hashPasscode(passcode: string): Promise<string> {
		return bcrypt.hash(passcode, BCRYPT_ROUNDS);
	}

	/**
	 * Verify a passcode against its hash
	 */
	async verifyPasscode(passcode: string, hash: string): Promise<boolean> {
		return bcrypt.compare(passcode, hash);
	}

	/**
	 * Validate passcode meets requirements
	 * - Minimum 6 characters
	 * - Alphanumeric only (letters and numbers)
	 */
	validatePasscode(passcode: string): {valid: boolean; error?: string} {
		if (!passcode || passcode.length < 6) {
			return {valid: false, error: 'Passcode must be at least 6 characters'};
		}

		if (!/^[a-zA-Z0-9]+$/.test(passcode)) {
			return {
				valid: false,
				error: 'Passcode must contain only letters and numbers',
			};
		}

		return {valid: true};
	}

	/**
	 * Create a new session
	 */
	createSession(): Session {
		const now = Date.now();
		const session: Session = {
			id: randomUUID(),
			createdAt: now,
			lastActivity: now,
			expiresAt: now + SESSION_DURATION_MS,
		};

		this.sessions.set(session.id, session);
		return session;
	}

	/**
	 * Validate and refresh a session
	 * Returns the session if valid, null if invalid/expired
	 */
	validateSession(sessionId: string): Session | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;

		const now = Date.now();
		if (now > session.expiresAt) {
			this.sessions.delete(sessionId);
			return null;
		}

		// Refresh session on activity (keep-alive)
		session.lastActivity = now;
		session.expiresAt = now + SESSION_DURATION_MS;

		return session;
	}

	/**
	 * Invalidate a session (logout)
	 */
	invalidateSession(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	/**
	 * Check rate limiting for passcode attempts
	 * Returns: {allowed: boolean, retryAfter?: number, attemptsRemaining?: number}
	 */
	checkRateLimit(ip: string): {
		allowed: boolean;
		retryAfter?: number;
		attemptsRemaining?: number;
	} {
		const now = Date.now();
		let entry = this.rateLimits.get(ip);

		// Clean up old entries
		if (entry && now - entry.lastAttempt > RATE_LIMIT_WINDOW_MS) {
			this.rateLimits.delete(ip);
			entry = undefined;
		}

		if (!entry) {
			return {allowed: true, attemptsRemaining: 3};
		}

		// Check if locked out
		if (entry.lockedUntil && now < entry.lockedUntil) {
			return {
				allowed: false,
				retryAfter: Math.ceil((entry.lockedUntil - now) / 1000),
			};
		}

		// Clear lockout if expired
		if (entry.lockedUntil && now >= entry.lockedUntil) {
			entry.lockedUntil = null;
			entry.attempts = 0;
		}

		// Attempts 1-3: No delay
		if (entry.attempts < 3) {
			return {allowed: true, attemptsRemaining: 3 - entry.attempts};
		}

		// Attempts 4-9: 5s delay between attempts
		if (entry.attempts < 10) {
			const timeSinceLastAttempt = now - entry.lastAttempt;
			if (timeSinceLastAttempt < 5000) {
				return {
					allowed: false,
					retryAfter: Math.ceil((5000 - timeSinceLastAttempt) / 1000),
				};
			}
			return {allowed: true, attemptsRemaining: 10 - entry.attempts};
		}

		// 10+ attempts: 10 minute lockout
		return {allowed: false, retryAfter: 600};
	}

	/**
	 * Record a passcode attempt (success or failure)
	 */
	recordAttempt(ip: string, success: boolean): void {
		const now = Date.now();
		let entry = this.rateLimits.get(ip);

		if (!entry) {
			entry = {attempts: 0, lastAttempt: now, lockedUntil: null};
			this.rateLimits.set(ip, entry);
		}

		if (success) {
			// Clear on successful auth
			this.rateLimits.delete(ip);
			return;
		}

		entry.attempts++;
		entry.lastAttempt = now;

		// Apply 10 minute lockout after 10 failed attempts
		if (entry.attempts >= 10) {
			entry.lockedUntil = now + RATE_LIMIT_WINDOW_MS;
		}
	}

	/**
	 * Clean up expired sessions (call periodically)
	 */
	cleanupExpiredSessions(): number {
		const now = Date.now();
		let cleaned = 0;

		for (const [id, session] of this.sessions) {
			if (now > session.expiresAt) {
				this.sessions.delete(id);
				cleaned++;
			}
		}

		return cleaned;
	}

	/**
	 * Get active session count (for monitoring)
	 */
	getActiveSessionCount(): number {
		return this.sessions.size;
	}
}

// Export singleton instance
export const authService = new AuthService();

// Export types
export type {Session, RateLimitEntry};

// Convenience function exports for use outside the class
export const hashPasscode = (passcode: string) =>
	authService.hashPasscode(passcode);
export const verifyPasscode = (passcode: string, hash: string) =>
	authService.verifyPasscode(passcode, hash);
export const validatePasscode = (passcode: string) =>
	authService.validatePasscode(passcode);
