import { delay, runInfinitePoll } from "socket-function/src/batching";
import fs from "fs";
import { sort } from "socket-function/src/misc";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";

import { decodeVideoKey } from "./videoHelpers";
import { videoFolder } from "./frameEmitHelpers";
import { MAX_DISK_USAGE } from "./constants";
import { recursiveIterate, safeUnlink, safeReadDir } from "./readHelpers";




async function limitFiles() {
    console.log(`Starting file limit at ${new Date().toISOString()}`);

    let speedFolders = await fs.promises.readdir(videoFolder);
    speedFolders = speedFolders.filter(x => x.endsWith("x") && !isNaN(+x.slice(0, -1)));
    sort(speedFolders, x => -x.slice(0, -1));

    let deletedFiles = 0;
    let deletedBytes = 0;

    let time = Date.now();
    let sizePerSpeed = MAX_DISK_USAGE / speedFolders.length;
    let remainingSpeedFolders = speedFolders.length;
    for (let speedFolder of speedFolders) {
        console.log(`${formatNumber(sizePerSpeed)}B per speed folder at ${speedFolder}`);
        remainingSpeedFolders--;
        let allFiles: { path: string; size: number; startTime: number; }[] = [];
        for await (let file of recursiveIterate(videoFolder + speedFolder + "/")) {
            let obj = decodeVideoKey(file.path);
            if (!obj.startTime) continue;
            allFiles.push({ path: file.path, size: file.size, startTime: obj.startTime });

            // NOTE: If we run into any issues with lagging the disk, we could add a delay here to slow down iteration
        }
        sort(allFiles, x => x.startTime);

        let totalSize = allFiles.reduce((acc, x) => acc + x.size, 0);
        let excessSize = totalSize - sizePerSpeed;
        let filesToRemove: string[] = [];
        while (excessSize > 0) {
            let file = allFiles.pop();
            if (!file) break;
            excessSize -= file.size;
            deletedFiles++;
            deletedBytes += file.size;
            filesToRemove.push(file.path);
        }
        let folderToCheck = new Set<string>();
        for (let file of filesToRemove) {
            await safeUnlink(file);
            let dir = file.split("/").slice(0, -1).join("/") + "/";
            while (dir.length > videoFolder.length) {
                folderToCheck.add(dir);
                dir = dir.split("/").slice(0, -1).join("/") + "/";
            }
        }
        // Remove empty folders, as they lag reading by quite a bit
        for (let folder of folderToCheck) {
            let files = await safeReadDir(folder);
            if (files.length === 0) {
                await safeUnlink(folder);
            }
        }

        if (excessSize < 0) {
            sizePerSpeed += -excessSize / remainingSpeedFolders;
        }
        console.log(`Finished ${speedFolder}, ${formatNumber(totalSize)}B, ${formatNumber(excessSize)}B excess`);
        console.log();
    }

    let totalTime = Date.now() - time;
    if (deletedFiles > 0) {
        console.log(" ");
        console.log(`Limited files in ${formatTime(totalTime)}, deleted ${deletedFiles} files, ${formatNumber(deletedBytes)}B`);
        console.log(" ");
    }

    console.log(`Finished file limit at ${new Date().toISOString()}`);
    console.log();
    console.log();
}

async function main() {
    runInfinitePoll(1000, limitFiles);
}
main().catch(e => console.error(e));