"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSecret = resolveSecret;
exports.promptPassword = promptPassword;
exports.promptPasswordWithConfirmation = promptPasswordWithConfirmation;
const readline_1 = require("readline");
/**
 * Resolve a sensitive value from (in priority order):
 *   1. The CLI flag value (if provided — warns user it's insecure)
 *   2. An environment variable (safe — doesn't appear in ps output)
 *   3. An interactive masked prompt (TTY only)
 *
 * @param flagValue  Value from the CLI flag (undefined if not passed)
 * @param envVar     Name of the environment variable to check (e.g. "WALLET_PASSWORD")
 * @param promptText Prompt text for interactive mode
 */
async function resolveSecret(flagValue, envVar, promptText) {
    if (flagValue !== undefined) {
        process.stderr.write(`Warning: passing ${promptText.toLowerCase().replace(": ", "")} via flag is insecure. Use $${envVar} env var instead.\n`);
        return flagValue;
    }
    const envValue = process.env[envVar];
    if (envValue !== undefined && envValue !== "") {
        return envValue;
    }
    return promptPassword(promptText);
}
async function promptPassword(prompt = "Password: ") {
    if (process.stdin.isTTY) {
        return new Promise((resolve) => {
            let buffer = "";
            process.stderr.write(prompt);
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding("utf-8");
            const onData = (chunk) => {
                for (const char of chunk) {
                    if (char === "\u0003") {
                        // Ctrl+C
                        process.stderr.write("\n");
                        process.exit(1);
                    }
                    else if (char === "\r" || char === "\n") {
                        // Enter
                        process.stdin.removeListener("data", onData);
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                        process.stderr.write("\n");
                        resolve(buffer);
                        return;
                    }
                    else if (char === "\u007f" || char === "\b") {
                        // Backspace
                        if (buffer.length > 0) {
                            buffer = buffer.slice(0, -1);
                            process.stderr.write("\b \b");
                        }
                    }
                    else if (char >= " ") {
                        // Printable character
                        buffer += char;
                        process.stderr.write("*");
                    }
                }
            };
            process.stdin.on("data", onData);
        });
    }
    else {
        return new Promise((resolve) => {
            const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stderr });
            rl.question(prompt, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }
}
async function promptPasswordWithConfirmation(prompt = "Password: ", confirmPrompt = "Confirm password: ") {
    const password = await promptPassword(prompt);
    const confirm = await promptPassword(confirmPrompt);
    if (password !== confirm) {
        process.stderr.write("Error: passwords do not match\n");
        process.exit(1);
    }
    return password;
}
