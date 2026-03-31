import { describe, expect, it } from "vitest";
import { parseAmount, toXrplAmount, formatAmount } from "./amount";

describe("parseAmount", () => {
  it("parses XRP decimal: 1.5 → drops 1500000", () => {
    const result = parseAmount("1.5");
    expect(result).toEqual({ type: "xrp", drops: "1500000" });
  });

  it("parses XRP drops suffix: 1500000drops", () => {
    const result = parseAmount("1500000drops");
    expect(result).toEqual({ type: "xrp", drops: "1500000" });
  });

  it("parses XRP drops suffix with space: 1500000 drops", () => {
    const result = parseAmount("1500000 drops");
    expect(result).toEqual({ type: "xrp", drops: "1500000" });
  });

  it("parses IOU with 3-char currency", () => {
    const result = parseAmount("10/USD/rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh");
    expect(result).toEqual({
      type: "iou",
      value: "10",
      currency: "USD",
      issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    });
  });

  it("parses IOU with 40-char hex currency", () => {
    const hexCurrency = "0158415500000000C1F76FF6ECB0BAC600000000";
    const result = parseAmount(`5/${hexCurrency}/rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`);
    expect(result).toEqual({
      type: "iou",
      value: "5",
      currency: hexCurrency,
      issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    });
  });

  it("parses MPT with 48-char hex", () => {
    const mptId = "000000012FB5E4D16D4FEF78D4C3B1F9AE5C3B7D1234ABCD";
    const result = parseAmount(`100/${mptId}`);
    expect(result).toEqual({ type: "mpt", value: "100", mpt_issuance_id: mptId });
  });

  it("throws on invalid input: empty string", () => {
    expect(() => parseAmount("")).toThrow(/invalid amount/);
  });

  it("throws on invalid input: non-numeric XRP", () => {
    expect(() => parseAmount("abc")).toThrow(/invalid amount/);
  });

  it("throws on invalid input: bad IOU format", () => {
    expect(() => parseAmount("10/USD")).toThrow(/invalid amount/);
  });

  it("throws on invalid input: issuer not starting with r", () => {
    expect(() => parseAmount("10/USD/xInvalidIssuer")).toThrow(/invalid amount/);
  });

  it("throws on invalid drops suffix", () => {
    expect(() => parseAmount("abc drops")).toThrow(/invalid amount/);
  });
});

describe("toXrplAmount", () => {
  it("returns drops string for XRP", () => {
    const result = toXrplAmount({ type: "xrp", drops: "1500000" });
    expect(result).toBe("1500000");
  });

  it("returns IOU object", () => {
    const result = toXrplAmount({
      type: "iou",
      value: "10",
      currency: "USD",
      issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    });
    expect(result).toEqual({ value: "10", currency: "USD", issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" });
  });

  it("returns MPT object", () => {
    const mptId = "000000012FB5E4D16D4FEF78D4C3B1F9AE5C3B7D1234ABCD";
    const result = toXrplAmount({ type: "mpt", value: "100", mpt_issuance_id: mptId });
    expect(result).toEqual({ value: "100", mpt_issuance_id: mptId });
  });
});

describe("formatAmount", () => {
  it("formats XRP drops as human-readable", () => {
    const result = formatAmount({ type: "xrp", drops: "1500000" });
    expect(result).toBe("1.5 XRP");
  });

  it("formats IOU", () => {
    const result = formatAmount({
      type: "iou",
      value: "10",
      currency: "USD",
      issuer: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    });
    expect(result).toBe("10 USD (issued by rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh)");
  });

  it("formats MPT with first 8 chars", () => {
    const mptId = "000000012FB5E4D16D4FEF78D4C3B1F9AE5C3B7D1234ABCD";
    const result = formatAmount({ type: "mpt", value: "100", mpt_issuance_id: mptId });
    expect(result).toBe(`100 MPT:${mptId.slice(0, 8)}...`);
  });
});
