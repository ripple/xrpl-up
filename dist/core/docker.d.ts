export declare const CONTAINER_NAME = "xrpl-up-local";
export declare const DEFAULT_IMAGE = "xrpllabsofficial/xrpld:3.3.0";
export declare const LOCAL_WS_PORT = 6006;
export declare const LOCAL_WS_URL = "ws://localhost:6006";
/** Throws if Docker daemon is not running or not installed. */
export declare function checkDockerAvailable(): void;
/** Returns true if the xrpl-up-local container is currently running. */
export declare function isContainerRunning(): boolean;
/** Force-removes the container if it exists (stopped or running). */
export declare function removeContainerIfExists(): void;
/**
 * Pull the image (if needed), start a detached rippled container,
 * wait until the WebSocket port is accepting connections, and return
 * the local WebSocket URL.
 */
export declare function startRippled(image?: string): Promise<string>;
/** Stop and remove the rippled container. */
export declare function stopRippled(): void;
//# sourceMappingURL=docker.d.ts.map