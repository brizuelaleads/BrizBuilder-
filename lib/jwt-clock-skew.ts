import {
  jwtVerify,
  type JWTVerifyOptions,
  type JWTVerifyResult,
} from "jose";

/** Maximum clock difference accepted between distributed authentication peers. */
export const JWT_CLOCK_SKEW_TOLERANCE_SECONDS = 30;

/**
 * Short retries stay inside the tolerance window and let a freshly minted
 * gateway token become valid on a slightly slower downstream clock.
 */
const JWT_CLOCK_SKEW_RETRY_DELAYS_MS = [5_000, 10_000, 15_000] as const;

type VerificationKey = CryptoKey | Uint8Array;

export type ClockSkewVerificationOptions = Omit<
  JWTVerifyOptions,
  "clockTolerance" | "currentDate"
> & {
  currentDate?: Date;
  toleranceSeconds?: number;
};

/**
 * Verifies a JWT with bounded tolerance for `iat` and `nbf` only.
 *
 * jose applies clock tolerance to both ends of the validity window, so the
 * strict expiration check below deliberately removes that relaxation for
 * `exp`. Signature verification is always performed by jose.
 */
export async function verifyJwtWithClockSkew(
  token: string,
  key: VerificationKey,
  options: ClockSkewVerificationOptions = {},
): Promise<JWTVerifyResult> {
  const {
    currentDate = new Date(),
    toleranceSeconds = JWT_CLOCK_SKEW_TOLERANCE_SECONDS,
    ...verifyOptions
  } = options;
  const tolerance = Math.max(
    0,
    Math.min(JWT_CLOCK_SKEW_TOLERANCE_SECONDS, toleranceSeconds),
  );
  const requiredClaims = new Set(verifyOptions.requiredClaims ?? []);
  requiredClaims.add("exp");

  const result = await jwtVerify(token, key, {
    ...verifyOptions,
    requiredClaims: [...requiredClaims],
    currentDate,
    clockTolerance: tolerance,
  });
  const now = Math.floor(currentDate.getTime() / 1_000);

  if (typeof result.payload.exp !== "number" || result.payload.exp <= now) {
    throw new Error("JWT has expired.");
  }
  if (
    typeof result.payload.iat === "number" &&
    result.payload.iat > now + tolerance
  ) {
    throw new Error("JWT issued outside the allowed clock-skew tolerance.");
  }

  return result;
}

/** Only timing failures that can become valid as clocks advance are retryable. */
export function isRetryableJwtClockSkewError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\bJWT issued at future\b/i.test(message) ||
    /\bJWT is not yet valid\b/i.test(message) ||
    /["']nbf["'] claim timestamp check failed/i.test(message)
  );
}

type ClockSkewRetryOptions = {
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  toleranceSeconds?: number;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Retries a remote validation failure only while it can be explained by the
 * bounded clock-skew allowance. All other errors pass through immediately.
 */
export async function withJwtClockSkewRetry<T>(
  operation: () => Promise<T>,
  options: ClockSkewRetryOptions = {},
): Promise<T> {
  const wait = options.sleep ?? sleep;
  const delays = options.retryDelaysMs ?? JWT_CLOCK_SKEW_RETRY_DELAYS_MS;
  const toleranceMs =
    Math.max(
      0,
      Math.min(
        JWT_CLOCK_SKEW_TOLERANCE_SECONDS,
        options.toleranceSeconds ?? JWT_CLOCK_SKEW_TOLERANCE_SECONDS,
      ),
    ) * 1_000;
  let waitedMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = delays[attempt];
      if (
        !isRetryableJwtClockSkewError(error) ||
        typeof delay !== "number" ||
        delay <= 0 ||
        waitedMs + delay > toleranceMs
      ) {
        throw error;
      }
      await wait(delay);
      waitedMs += delay;
    }
  }
}
