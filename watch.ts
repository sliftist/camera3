import { throttleFunction } from "socket-function/src/misc";
import fs from "fs";
import { execSync } from "child_process";
import * as ws from "ws";
import { BUILD_PORT } from "./ports";

async function main() {
    const server = new ws.Server({ port: BUILD_PORT });
    console.log(`WebSocket server started on port ${BUILD_PORT}`);

    server.on("connection", (socket) => {
        console.log("Client connected");
        socket.on("close", () => console.log("Client disconnected"));
    });

    await build(server);
    let rebuild = throttleFunction(50, () => build(server));
    watchDir(__dirname, rebuild);
}

let lastBuild = 0;
async function build(server: ws.Server) {
    let now = Date.now();
    if (now - lastBuild < 1000) return;
    lastBuild = now;
    try {
        console.log("Starting build...");
        execSync("yarn build", { stdio: "inherit" });
        console.log("Build completed successfully.");
        notifyClients(server, "Build completed successfully");
    } catch (error) {
        console.error("Build failed:", error);
        notifyClients(server, "Build failed");
    }
}

function watchDir(dir: string, callback: () => void) {
    fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename || shouldIgnoreFile(filename)) return;
        console.log(`File ${filename} changed`);
        callback();
    });
}

function shouldIgnoreFile(filename: string): boolean {
    const ignoredPaths = ["extension", ".git", "node_modules", "build"];
    return ignoredPaths.some(path => filename.includes(path));
}

function notifyClients(server: ws.Server, message: string) {
    server.clients.forEach((client) => {
        if (client.readyState === ws.OPEN) {
            client.send(message);
        }
    });
}

main().catch(console.error);