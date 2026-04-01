import { describe, it, expect } from "vitest";
import { runCLI } from "../../helpers/cli";

// Static dummy values — these tests exit before any network call
const DUMMY_SEED = "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

describe("mptoken issuance create validation", () => {
  it("unknown flag name exits 1 with error", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--flags", "can-transfer,badname",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown flag");
  });

  it("--transfer-fee without can-transfer in flags exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--transfer-fee", "100",
      "--flags", "can-lock",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("can-transfer");
  });

  it("--transfer-fee without any flags exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--transfer-fee", "100",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("can-transfer");
  });

  it("--metadata and --metadata-hex together exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--metadata", "hello",
      "--metadata-hex", "68656c6c6f",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--metadata and --metadata-file together exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--metadata", "hello",
      "--metadata-file", "/tmp/some-file.bin",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--metadata-hex and --metadata-file together exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--metadata-hex", "68656c6c6f",
      "--metadata-file", "/tmp/some-file.bin",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("--metadata-file with non-existent path exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
      "--metadata-file", "/nonexistent/path/to/file.bin",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not exist");
  });

  it("missing key material exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "create",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });
});

describe("mptoken issuance set validation", () => {
  it("neither --lock nor --unlock exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "set",
      "DEADBEEF00000000000000000000000000000000000000000000000000000000",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("both --lock and --unlock exits 1", () => {
    const result = runCLI([
      "mptoken", "issuance", "set",
      "DEADBEEF00000000000000000000000000000000000000000000000000000000",
      "--lock",
      "--unlock",
      "--seed", DUMMY_SEED,
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mutually exclusive");
  });
});
