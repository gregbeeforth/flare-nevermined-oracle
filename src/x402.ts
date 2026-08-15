export interface X402Decoded {
  x402Version?: number;
  accepted?: {
    planId?: string;
    network?: string;
    scheme?: string;
    extra?: { agentId?: string; httpVerb?: string };
  };
}

export interface X402VerifyResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface PaymentRequired {
  x402Version: number;
  resource: { url: string };
  accepts: Array<{
    scheme: string;
    network: string;
    planId: string;
    extra: { version: string; agentId?: string; httpVerb?: string };
  }>;
  extensions: Record<string, unknown>;
}

export function decodeX402Token(token: string): X402Decoded | null {
  try {
    const base64 = token
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(token.length + ((4 - (token.length % 4)) % 4), "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as X402Decoded;
  } catch {
    return null;
  }
}

export function isLiveApiKey(nvmApiKey: string): boolean {
  return nvmApiKey.startsWith("live:");
}

export function getNvmBackend(nvmApiKey: string): string {
  return isLiveApiKey(nvmApiKey)
    ? "https://api.live.nevermined.app/"
    : "https://api.sandbox.nevermined.app/";
}

export function buildPaymentRequired(
  planId: string,
  options: {
    agentId?: string;
    httpVerb?: string;
    endpoint?: string;
    network?: string;
    scheme?: string;
  },
): PaymentRequired {
  const scheme = options.scheme ?? "nvm:erc4337";
  const network = options.network ?? "eip155:84532";
  const extra: { version: string; agentId?: string; httpVerb?: string } = {
    version: "1",
  };
  if (options.agentId) extra.agentId = options.agentId;
  if (options.httpVerb) extra.httpVerb = options.httpVerb;

  return {
    x402Version: 2,
    resource: { url: options.endpoint ?? "" },
    accepts: [{ scheme, network, planId, extra }],
    extensions: {},
  };
}

export async function verifyX402Token(params: {
  backend: string;
  nvmApiKey: string;
  x402AccessToken: string;
  paymentRequired: PaymentRequired;
}): Promise<X402VerifyResult> {
  const url = new URL("/api/v1/x402/verify", params.backend);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.nvmApiKey}`,
    },
    body: JSON.stringify({
      paymentRequired: params.paymentRequired,
      x402AccessToken: params.x402AccessToken,
    }),
  });

  if (!response.ok) {
    return {
      isValid: false,
      invalidReason: `x402 verification request failed (HTTP ${response.status})`,
    };
  }

  const data = (await response.json()) as { isValid?: boolean; invalidReason?: string };
  return {
    isValid: data.isValid === true,
    invalidReason: data.invalidReason,
  };
}