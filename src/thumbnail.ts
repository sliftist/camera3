import { cache } from "socket-function/src/caching";
import { DiskCollectionPromise, DiskCollectionRaw, DiskCollection } from "./storage/DiskCollection";
import { getFileStorage } from "./storage/FileFolderAPI";
import { decodeVideoKey, getVideoTimeline } from "./videoHelpers";
import { H264toMP4 } from "mp4-typescript";
import { observable } from "./misc/mobxTyped";



const sha256 = require("./sha256") as {
    sha256: {
        (input: string): string;
    }
};

let thumbnailCache = new DiskCollectionPromise<1>("thumbnailCache6");
let thumbnails = new DiskCollectionRaw("thumbnails6");

let totalThreads = 0;
let freeThreads = new Set<number>();
function getThread() {
    if (freeThreads.size) {
        let thread = freeThreads.values().next().value!;
        freeThreads.delete(thread);
        return thread;
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

export function getThumbnailURL(config: {
    time: number;
    maxDimension: number;
    format?: "jpeg" | "png";
    cropToAspectRatio?: number;
    retryErrors?: boolean;
}) {
    let videos = getVideoTimeline();
    // Find the video this is part of
    let video = videos.find(x => x.time <= config.time && x.endTime >= config.time);
    if (!video) return "no matching video";
    let offset = config.time - video.time;

    let keyConfig: KeyConfig = {
        ...config,
        file: video.file,
        offset,
    };
    let key = getKey(keyConfig);
    let obs = thumbObservables.get(key);
    if (!obs) {
        obs = observable({ value: "", });
        thumbObservables.set(key, obs);
        void getThumbnailPromise(keyConfig).then((value) => {
            obs!.value = value || "";
        });
    }
    return obs.value;
}

let retriesErrors = new Set<string>();

export async function getThumbnailPromise(config: KeyConfig) {
    let { file } = config;
    let storage = await getFileStorage();
    let key = getKey(config);

    // if (await thumbnailCache.get(key)) {
    //     let value = await thumbnails.get(key);
    //     if (config.retryErrors && !retriesErrors.has(key) && value && !value.toString().startsWith("data:")) {
    //         value = undefined;
    //         retriesErrors.add(key);
    //     }
    //     if (value) {
    //         return value.toString();
    //     }
    // }

    let thread = getThread();
    console.log(`Generating thumbnail for ${config.file}@${config.offset} on thread ${thread}`);
    let free: (() => void)[] = [];
    try {
        let buffer = await storage.get(file);
        if (!buffer) return undefined;
        let info = decodeVideoKey(file);
        let frameDurationInSeconds = info ? (info.endTime - info.time) / info.frames / 1000 : 1 / 30;
        let { buffer: mp4Buffer, frameCount, keyFrameCount } = await H264toMP4({
            buffer,
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
        if (!ctx) return undefined;
        ctx.drawImage(videoElement, sx, sy, sw, sh, 0, 0, width, height);
        let format = config.format || "jpeg";
        let thumbnail = canvas.toDataURL(`image/${format}`, 0.8);
        if (thumbnail === "data:,") {
            thumbnail = "Failed to create thumbnail, received empty data";
        }

        // // Don't wait to commit, just return it
        // void thumbnailCache.set(key, 1);
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
}