import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { promptPassword, promptPasswordWithConfirmation } from "./prompt";

type MockStdin = EventEmitter & {
  isTTY: boolean;
  setRawMode: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setEncoding: ReturnType<typeof vi.fn>;
};

function createMockStdin(): MockStdin {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    setEncoding: vi.fn(),
  }) as MockStdin;
}

describe("promptPassword", () => {
  let mockStdin: MockStdin;
  let originalStdin: NodeJS.ReadStream;

  beforeEach(() => {
    mockStdin = createMockStdin();
    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    vi.restoreAllMocks();
  });

  it("returns correct password when characters + Enter are simulated via data event", async () => {
    const promise = promptPassword();
    mockStdin.emit("data", "abc\r");
    const result = await promise;
    expect(result).toBe("abc");
  });

  it("backspace removes last character", async () => {
    const promise = promptPassword();
    mockStdin.emit("data", "abc");
    mockStdin.emit("data", "\u007f"); // DEL / backspace
    mockStdin.emit("data", "\r");
    const result = await promise;
    expect(result).toBe("ab");
  });
});

describe("promptPasswordWithConfirmation", () => {
  let mockStdin: MockStdin;
  let originalStdin: NodeJS.ReadStream;

  beforeEach(() => {
    mockStdin = createMockStdin();
    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    vi.restoreAllMocks();
  });

  it("resolves when both entries match", async () => {
    setTimeout(() => {
      mockStdin.emit("data", "abc\r");
      setTimeout(() => {
        mockStdin.emit("data", "abc\r");
      }, 0);
    }, 0);

    const result = await promptPasswordWithConfirmation();
    expect(result).toBe("abc");
  });

  it("calls process.exit(1) when entries differ", async () => {
    const exitImpl = (_code?: string | number | null): never => {
      throw new Error(`EXIT:${_code}`);
    };
    const exitMock = vi.spyOn(process, "exit").mockImplementation(exitImpl);

    setTimeout(() => {
      mockStdin.emit("data", "abc\r");
      setTimeout(() => {
        mockStdin.emit("data", "xyz\r");
      }, 0);
    }, 0);

    await expect(promptPasswordWithConfirmation()).rejects.toThrow("EXIT:1");
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
