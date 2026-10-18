/**
 * SERVER ONLY. OpenF1 access tokens for real-time data (a paid OpenF1 subscription). Documented flow (openf1.org/auth.html):
 * POST https://api.openf1.org/token, form fields username/password -> { access_token, expires_in (s), token_type: "bearer" }; tokens expire
 * after an hour and there is no refresh token, so a new one is requested shortly before expiry. Credentials come from the server
 * environment only (OPENF1_USERNAME, OPENF1_PASSWORD), are never sent to the browser, and never appear in errors or logs.
 */
export class OpenF1AuthError extends Error {
  constructor(
    readonly category: "unconfigured" | "auth" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "OpenF1AuthError";
  }
}

export interface TokenOptions {
  username?: string;
  password?: string;
  fetch?: typeof fetch;
  now?: () => number;
  tokenUrl?: string;
  /** Renew this long before expiry (ms). */
  renewBeforeMs?: number;
  /** After a rejected login, do not try again for this long (ms): never hammer the token endpoint with bad credentials. */
  authFailureCooldownMs?: number;
}

export class TokenManager {
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;
  private blockedUntil = 0;
  private readonly o: Required<Omit<TokenOptions, "username" | "password">> & { username?: string; password?: string };

  constructor(opts: TokenOptions = {}) {
    this.o = {
      username: opts.username,
      password: opts.password,
      fetch: opts.fetch ?? ((...a) => fetch(...a)),
      now: opts.now ?? Date.now,
      tokenUrl: opts.tokenUrl ?? "https://api.openf1.org/token",
      renewBeforeMs: opts.renewBeforeMs ?? 60_000,
      authFailureCooldownMs: opts.authFailureCooldownMs ?? 5 * 60_000,
    };
  }

  get configured() {
    return !!this.o.username && !!this.o.password;
  }

  /** Forget the current token (e.g. after the API answered 401 with it). */
  invalidate() {
    this.token = null;
  }

  /** A valid access token; concurrent callers share one request. */
  async get(): Promise<string> {
    if (!this.configured) throw new OpenF1AuthError("unconfigured", "OpenF1 real-time access is not configured (OPENF1_USERNAME / OPENF1_PASSWORD)");
    const now = this.o.now();
    if (this.token && now < this.token.expiresAt - this.o.renewBeforeMs) return this.token.value;
    if (now < this.blockedUntil) throw new OpenF1AuthError("auth", "OpenF1 rejected the credentials recently; not retrying yet");
    this.pending ??= this.request().finally(() => (this.pending = null));
    return this.pending;
  }

  private async request(): Promise<string> {
    let res: Response;
    try {
      res = await this.o.fetch(this.o.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: this.o.username!, password: this.o.password! }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OpenF1AuthError("unavailable", "OpenF1 token endpoint unreachable");
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      this.blockedUntil = this.o.now() + this.o.authFailureCooldownMs;
      throw new OpenF1AuthError("auth", `OpenF1 rejected the credentials (HTTP ${res.status})`);
    }
    if (!res.ok) throw new OpenF1AuthError("unavailable", `OpenF1 token endpoint answered HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    const value = typeof body?.access_token === "string" ? body.access_token : null;
    if (!value) throw new OpenF1AuthError("unavailable", "OpenF1 token response had no access_token");
    const ttl = Number(body?.expires_in);
    this.token = { value, expiresAt: this.o.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 };
    return value;
  }
}
