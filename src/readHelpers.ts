import { delay, runInfinitePoll } from "socket-function/src/batching";
import fs from "fs";
import { sort } from "socket-function/src/misc";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";

import { decodeVideoKey } from "./videoHelpers";
import { getDirMaximumChangeTime, videoFolder } from "./frameEmitHelpers";
import { MAX_DISK_USAGE } from "./constants";

// IMPORTANT! We delay during many of these functions. Without these delays (on FAT at least),
//  I found the disk would get overwhelmed, writes would be delayed by minutes, and eventually dropped.

export async function safeReadDir(folder: string) {
    // Wait, so we don't overwhelm the file system (especially FAT, which breaks
    //  other writes if we overwhelm it)
    await delay(10);
    try {
        return await fs.promises.readdir(folder);
    } catch (e) {
        console.error("Error reading directory, skipping", folder, e);
        return [];
    }
}
export async function safeStat(file: string) {
    try {
        return await fs.promises.stat(file);
    } catch (e) {
        console.error("Error stating file, skipping", file, e);
        return undefined;
    }
}

export async function* recursiveIterate(folder: string, minTime?: number): AsyncGenerator<{
    path: string;
    size: number;
    paths: string[];
}> {
    if (minTime) {
        let maxChangeTime = getDirMaximumChangeTime(folder);
        if (maxChangeTime < minTime) return;
    }
    let files = await safeReadDir(folder);
    // Always iterate in order
    // HACK: "s" => " ", so that "segment" comes before any numbers, so sorting order is correct.
    sort(files, x => x.replaceAll("s", " "));
    let parsedFiles: { fullPath: string, size: number }[] = [];
    let parsedDirs: { fullPath: string, size: number }[] = [];
    for (let file of files) {
        let fullPath = folder + file;
        let stat = await safeStat(fullPath);
        if (!stat) continue;
        if (stat.isDirectory()) {
            parsedDirs.push({ fullPath: fullPath + "/", size: stat.size, });
        } else {
            parsedFiles.push({ fullPath, size: stat.size, });
        }
    }

    let flatPaths = parsedFiles.map(x => x.fullPath);
    for (let { fullPath, size } of parsedFiles) {
        yield { path: fullPath, size, paths: flatPaths };
    }
    for (let { fullPath, size } of parsedDirs) {
        yield* recursiveIterate(fullPath, minTime);
    }
}
export async function safeUnlink(file: string) {
    await delay(10);
    try {
        if (file.endsWith("/")) {
            await fs.promises.rmdir(file);
        } else {
            return await fs.promises.unlink(file);
        }
    } catch (e: any) {
        console.error("Error unlinking file, skipping", file, e);
        if (e.code === "EISDIR") {
            await fs.promises.rmdir(file);
        }
    }
}
