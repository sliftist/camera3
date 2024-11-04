import { cache, lazy } from "socket-function/src/caching";
import { DiskCollectionPromise, DiskCollectionRaw, DiskCollection } from "./storage/DiskCollection";
import { getFileStorage } from "./storage/FileFolderAPI";
import { decodeVideoKey, findVideo, findVideoSync, parseVideoKey } from "./videoHelpers";
import { H264toMP4, IdentifyNal, SplitAnnexBVideo } from "mp4-typescript";
import { observable } from "./misc/mobxTyped";
import { getVideoIndexSynced, recheckFileNow } from "./videoLookup";
import { binarySearchBasic } from "socket-function/src/misc";
import { splitNALs } from "./videoBase";
import { isNode } from "typesafecss";
import { jpegSuffixes } from "./constants";

const sha256 = require("./sha256") as {
    sha256: {
        (input: string): string;
    }
};


let thumbnailCache = new DiskCollectionPromise<1>("thumbnailCache6");
let thumbnails = new DiskCollectionRaw("thumbnails6");

export async function deleteThumbCache() {
    await thumbnailCache.reset();
    await thumbnails.reset();
}

let totalThreads = 0;
let freeThreads = new Set<number>();
async function getThread(): Promise<number> {
    if (freeThreads.size) {
        let thread = freeThreads.values().next().value!;
        freeThreads.delete(thread);
        return thread;
    }
    if (totalThreads > 8) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return getThread();
    }
    return totalThreads++;
}
function freeThread(thread: number) {
    freeThreads.add(thread);
}

let getThumbElement = cache((thread: number) => {
    const videoElement = document.createElement("video");
    videoElement.muted = true;
    videoElement.style.display = "none";
    document.body.insertBefore(videoElement, document.body.firstChild);
    const canvas = document.createElement("canvas");
    return {
        videoElement,
        canvas,
    };
});

type KeyConfig = {
    file: string;
    offset: number;
    maxDimension: number;
    format?: "jpeg" | "png";
    cropToAspectRatio?: number;
    // Retries errors, once (until they refresh again)
    retryErrors?: boolean;
};
function getKey(config: KeyConfig) {
    let { file, maxDimension, offset } = config;
    let values: Record<string, unknown> = {
        file,
        maxDimension,
        offset,
    };
    if (config.format && config.format !== "jpeg") {
        values.format = config.format;
    }
    if (config.cropToAspectRatio) {
        values.cropToAspectRatio = config.cropToAspectRatio;
    }

    return sha256.sha256(JSON.stringify(values)).slice(0, 20);
}

let thumbObservables = new Map<string, {
    value: string;
}>();

export type ThumbMetadata = {
    changes: number;
};
let thumbMetadatas = new Map<string, ThumbMetadata>();

export function getThumbMetadata(imageURL: string) {
    return thumbMetadatas.get(imageURL);
}

export function getThumbnailURL(config: {
    file: string;
    maxDimension: number;
    format?: "jpeg" | "png";
    cropToAspectRatio?: number;
    retryErrors?: boolean;
    // Gets the first frame in the underlying video storage, which might be significantly
    //  offset from the requested time. However, this also allows us to do partial reads.
    fast?: boolean;
}) {
    let offset = 0;
    let keyConfig: KeyConfig = {
        ...config,
        offset,
    };
    let key = getKey(keyConfig);
    let obs = thumbObservables.get(key);
    if (!obs) {
        obs = observable({ value: "loading", });
        thumbObservables.set(key, obs);
        void getThumbnailPromise(keyConfig).then((value) => {
            obs!.value = value || "";
        }, err => {
            obs!.value = err.stack || "";
        });
    }
    return obs.value;
}

let retriesErrors = new Set<string>();

export async function getThumbnailPromise(config: KeyConfig): Promise<string> {
    let { file } = config;
    let storage = await getFileStorage();
    let key = getKey(config);

    let inMemoryCached = thumbObservables.get(key)?.value;
    if (inMemoryCached && inMemoryCached.startsWith("data:")) {
        return inMemoryCached;
    }

    console.log(`Getting thumbnail for ${file}@${config.offset}`);

    const verifyBaseFileExists = lazy(async () => {
        let handle = await storage.folder.getNestedFileHandle(config.file.split("/"));
        if (!handle) {
            void recheckFileNow(file);
        }
    });

    for (let suffix of jpegSuffixes) {
        // Skip if it is too small, unless it is the largest size
        if (suffix.width < config.maxDimension && suffix !== jpegSuffixes.at(-1)) continue;
        let jpegPath = config.file + suffix.suffix;
        let buffer = await storage.folder.readNestedPath(jpegPath.split("/"));
        if (!buffer) {
            await verifyBaseFileExists();
            continue;
        }
        let data = buffer.toString("base64");

        let metadataObj: ThumbMetadata | undefined;
        let metadata = await storage.folder.readNestedPath((jpegPath + ".metadata").split("/"));
        if (metadata) {
            try {
                metadataObj = JSON.parse(metadata.toString());
            } catch { }
        }

        let url = `data:image/jpeg;base64,${data}`;
        if (metadataObj) {
            thumbMetadatas.set(url, metadataObj);
        }
        return url;
    }
    return "file not found";
}

// Old code to actually generate the thumbnail. Now we just generate thumbnails for video
//      with activity ahead of time, on disk.
/*

    if (await thumbnailCache.get(key)) {
        let value = await thumbnails.get(key);
        if (config.retryErrors && !retriesErrors.has(key) && value && !value.toString().startsWith("data:")) {
            value = undefined;
            retriesErrors.add(key);
        }
        if (value) {
            return value.toString();
        }
    }

    let thread = await getThread();
    console.log(`Generating thumbnail for ${config.file}@${config.offset} on thread ${thread}`);
    let free: (() => void)[] = [];
    try {
        let handle = await storage.folder.getNestedFileHandle(file.split("/"));
        if (!handle) {
            void recheckFileNow(file);
            return "file not found";
        }

        let buffer: Buffer | undefined;
        {
            let fileHandle = await handle.getFile();
            let readSize = 160 * 1024;
            while (true) {
                let blob = fileHandle.slice(buffer?.length || 0, readSize);
                let prevBuffer = buffer;
                buffer = Buffer.from(await blob.arrayBuffer());
                if (prevBuffer) {
                    buffer = Buffer.concat([prevBuffer, buffer]);
                }
                let nals = splitNALs(buffer, "ignorePartial");

                if (
                    // We only know if a frame ends when there is another frames, so... we need at least 2 frames
                    //  (AND, the last one will probably be incomplete, so this isn't inefficient)
                    nals.filter(x => IdentifyNal(x) === "frame" || IdentifyNal(x) === "keyframe").length >= 2
                    // And we need an SPS to play it. We COULD just create this ourself, and maybe we should,
                    //  but for now... it's a lot easier to get the SPS from the file (also, we would need
                    //  to store at least the width/height, at which point... we might as well store it
                    //  in the file, at which point... we might as well store an SPS. So... if videos don't
                    //  have this, the solution is probably to add it into those videos, instead of dynamically
                    //  guessing it at runtime)
                    && nals.find(x => IdentifyNal(x) === "sps")
                ) {
                    console.log(`Found enough data to generate thumbnail after ${buffer.length} bytes`);
                    break;
                }
                if (readSize >= fileHandle.size) {
                    return "no keyframe found in video";
                }
                readSize *= 2;
            }
        }


        let info = decodeVideoKey(file);
        let frameDurationInSeconds = info ? (info.endTime - info.startTime) / info.frames / 1000 : 1 / 30;
        let nals = splitNALs(buffer, "ignorePartial");
        // Only include up to the first key frame
        let keyFrameIndex = nals.findIndex(x => IdentifyNal(x) === "keyframe");
        if (keyFrameIndex !== -1) {
            nals = nals.slice(0, keyFrameIndex + 1);
        }
        let { buffer: mp4Buffer, frameCount, keyFrameCount } = await H264toMP4({
            buffer: nals,
            frameDurationInSeconds: frameDurationInSeconds,
            mediaStartTimeSeconds: 0,
        });
        let blob = new Blob([mp4Buffer]);
        let url = URL.createObjectURL(blob);
        const { videoElement, canvas } = getThumbElement(thread);

        videoElement.src = url;
        videoElement.controls = true;
        videoElement.width = 300;
        videoElement.muted = true;

        free.push(() => {
            videoElement.src = "";
            URL.revokeObjectURL(url);
        });

        // Get the total time
        await new Promise((resolve, reject) => {
            videoElement.addEventListener("loadeddata", resolve, { once: true });
            videoElement.addEventListener("error", reject, { once: true });
        });

        videoElement.currentTime = config.offset;
        await new Promise((resolve, reject) => {
            videoElement.addEventListener("seeked", resolve, { once: true });
            videoElement.addEventListener("error", reject, { once: true });
        });

        let width = videoElement.videoWidth;
        let height = videoElement.videoHeight;
        let sx = 0;
        let sy = 0;
        let sw = videoElement.videoWidth;
        let sh = videoElement.videoHeight;
        let scale = config.maxDimension / Math.max(width, height);
        if (config.cropToAspectRatio) {
            const targetAspectRatio = config.cropToAspectRatio || 16 / 9;
            const currentAspectRatio = width / height;

            if (currentAspectRatio > targetAspectRatio) {
                // Video is wider - maintain height, reduce width
                const newWidth = height * targetAspectRatio;
                // Center the crop horizontally
                sx = (width - newWidth) / 2;
                sw = newWidth;
                width = newWidth;
            } else {
                // Video is taller - maintain width, reduce height
                const newHeight = width / targetAspectRatio;
                // Center the crop vertically
                sy = (height - newHeight) / 2;
                sh = newHeight;
                height = newHeight;
            }
        }
        width *= scale;
        height *= scale;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "Failed to create 2d context";
        ctx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, width, height);
        let format = config.format || "jpeg";
        let thumbnail = canvas.toDataURL(`image/${format}`, 0.8);
        if (thumbnail === "data:,") {
            thumbnail = "Failed to create thumbnail, received empty data";
        }

        // // Don't wait to commit, just return it
        void thumbnailCache.set(key, 1);
        console.log(`Generated thumbnail for ${config.file}@${config.offset} on thread ${thread}, size ${thumbnail.length}`);
        void thumbnails.set(key, Buffer.from(thumbnail));

        return thumbnail;

    } catch (e: any) {
        console.error(`Error loading thumbnail`, e);
        return e.stack || "";
    } finally {
        for (let f of free) {
            try {
                f();
            } catch { }
        }
        freeThread(thread);
    }
*/