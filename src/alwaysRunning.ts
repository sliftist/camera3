import { spawn, ChildProcess } from "child_process";
import child_process from "child_process";
import { promises as fs, watch } from "fs";
import * as os from "os";
import * as path from "path";
import { sort } from "socket-function/src/misc";

const homeDir = os.homedir();
const commandFilePath = homeDir + "/" + process.argv[2];

let currentCommandProcess: ChildProcess | null = null;
let lastCommand = "";
let fileWatcher: any = null;
let commandIsRunning = false; // To track if a command is currently being executed

// Function to run the command
async function runCommand(): Promise<void> {
    try {
        let command = await fs.readFile(commandFilePath, "utf-8");
        if (command.includes("/dev/video0")) {
            let actualVideos = child_process.execSync("ls -v /dev/video* 2>/dev/null").toString();
            let videos = actualVideos.split(/\s+/);
            videos = videos.filter(x => x.startsWith("/dev/video"));
            sort(videos, x => parseInt(x.slice("/dev/video".length)));
            command = command.replace("/dev/video0", videos[0]);
        }
        const [program, ...args] = command.trim().split(/\s+/); // Split the command into the program and arguments

        // If the command has changed, kill the existing process
        if (command !== lastCommand && currentCommandProcess) {
            console.log(`Command changed from ${lastCommand} to ${command}, killing PID ${currentCommandProcess.pid}`);
            currentCommandProcess.kill(); // Kill the process
            lastCommand = command;
        }

        // Only run the command if no other process is running
        if (!commandIsRunning) {
            console.log(`Running command: ${command}`);
            commandIsRunning = true; // Set the flag to indicate that the command is running


            // Use spawn to run the command and capture stdout, stderr
            currentCommandProcess = spawn(program, args, {
                cwd: (
                    commandFilePath.endsWith(".ts") &&
                    homeDir + "/camera3/"
                    || undefined
                )
            });

            currentCommandProcess.stdout?.on("data", (data: Buffer) => {
                process.stdout.write(data); // Log stdout in real-time
            });

            currentCommandProcess.stderr?.on("data", (data: Buffer) => {
                process.stderr.write(data); // Log stderr in real-time
            });

            currentCommandProcess.on("error", (error: Error) => {
                console.error(`Error: ${error.message}`);
                commandIsRunning = false; // Reset the flag when the command finishes
            });

            // Listen for the command's exit event
            currentCommandProcess.on("exit", (code: number | null, signal: string | null) => {
                console.log(`Command exited with code: ${code}, signal: ${signal}`);
                commandIsRunning = false; // Reset the flag when the command finishes

                // Wait for 5 seconds and rerun the command
                setTimeout(runCommand, 5000);
            });
        }
    } catch (err) {
        console.error(`Error reading command file: ${err}`);
    }
}

// Function to watch for changes to the command file
async function watchCommandFile(): Promise<void> {
    console.log(`Watching command file: ${commandFilePath}`);
    if (fileWatcher) {
        fileWatcher.close();
    }

    try {
        fileWatcher = watch(commandFilePath, () => {
            console.log("Command file has changed. Restarting the command...");
            if (currentCommandProcess) {
                currentCommandProcess.kill(); // Kill the process if the file changes
            }
        });

        await runCommand(); // Start running the command initially
    } catch (err) {
        console.error(`Error watching file: ${err}`);
    }
}

// Start watching the file and running the command
watchCommandFile().catch((err) => console.error(`Unexpected error: ${err}`));
