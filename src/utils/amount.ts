export interface XRPAmount {
  type: "xrp";
  drops: string;
}

export interface IssuedTokenAmount {
  type: "iou";
  value: string;
  currency: string;
  issuer: string;
}

export interface MPTAmount {
  type: "mpt";
  value: string;
  mpt_issuance_id: string;
}

export type ParsedAmount = XRPAmount | IssuedTokenAmount | MPTAmount;

const INVALID_MSG = (input: string) =>
  `invalid amount "${input}" — use "1.5" for XRP, "10/USD/rIssuer" for issued token, or "100/<48-char-hex>" for MPT`;

export function parseAmount(input: string): ParsedAmount {
  // XRP drops suffix
  if (input.endsWith("drops")) {
    const dropsStr = input.slice(0, -5).trim();
    if (!/^\d+$/.test(dropsStr)) {
      throw new Error(INVALID_MSG(input));
    }
    return { type: "xrp", drops: dropsStr };
  }

  // IOU or MPT: contains '/'
  if (input.includes("/")) {
    const parts = input.split("/");
    if (parts.length !== 3 && parts.length !== 2) {
      throw new Error(INVALID_MSG(input));
    }

    const value = parts[0];
    if (!value || isNaN(Number(value))) {
      throw new Error(INVALID_MSG(input));
    }

    if (parts.length === 2) {
      // Could be MPT if second part is 48-char hex
      const second = parts[1];
      if (/^[0-9a-fA-F]{48}$/.test(second)) {
        return { type: "mpt", value, mpt_issuance_id: second };
      }
      throw new Error(INVALID_MSG(input));
    }

    // IOU: value/currency/issuer
    const currency = parts[1];
    const issuer = parts[2];

    const validCurrency = /^[A-Za-z0-9!@#$%^&*()]{3}$/.test(currency) || /^[0-9a-fA-F]{40}$/.test(currency);
    if (!validCurrency) {
      throw new Error(INVALID_MSG(input));
    }
    if (!issuer || !issuer.startsWith("r")) {
      throw new Error(INVALID_MSG(input));
    }

    return { type: "iou", value, currency, issuer };
  }

  // Plain XRP decimal
  const num = Number(input);
  if (isNaN(num) || input.trim() === "") {
    throw new Error(INVALID_MSG(input));
  }

  const drops = Math.round(num * 1_000_000).toString();
  return { type: "xrp", drops };
}

export function toXrplAmount(
  parsed: ParsedAmount
): string | { value: string; currency: string; issuer: string } | { value: string; mpt_issuance_id: string } {
  switch (parsed.type) {
    case "xrp":
      return parsed.drops;
    case "iou":
      return { value: parsed.value, currency: parsed.currency, issuer: parsed.issuer };
    case "mpt":
      return { value: parsed.value, mpt_issuance_id: parsed.mpt_issuance_id };
  }
}

export function formatAmount(parsed: ParsedAmount): string {
  switch (parsed.type) {
    case "xrp": {
      const dropsN = BigInt(parsed.drops);
      const whole = dropsN / 1_000_000n;
      const remainder = dropsN % 1_000_000n;
      const fracStr = remainder.toString().padStart(6, "0").replace(/0+$/, "") || "0";
      return `${whole}.${fracStr} XRP`;
    }
    case "iou":
      return `${parsed.value} ${parsed.currency} (issued by ${parsed.issuer})`;
    case "mpt":
      return `${parsed.value} MPT:${parsed.mpt_issuance_id.slice(0, 8)}...`;
  }
}
