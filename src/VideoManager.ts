import { MaybePromise } from "socket-function/src/types";
import { observable } from "./misc/mobxTyped";
import { nextId, PromiseObj, sort, throttleFunction, timeInHour } from "socket-function/src/misc";
import { delay, runInSerial } from "socket-function/src/batching";
import { H264toMP4 } from "mp4-typescript";
import { decodeVideoKey, parseVideoKey, VideoFileObj } from "./videoHelpers";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";
import { adjustRateURL, getSelectedTimeRange, getSpeed, getVideoRate, loopTimeRangeURL } from "./urlParams";
import { getVideoIndexSynced, recheckFileNow } from "./videoLookup";
import { setPending } from "./storage/PendingManager";
import { splitNALs } from "./videoBase";

export type VideoInfo = {
    file: string;

    time: number;
    frames: number;
    keyFrames: number;
    size: number;

    // Maybe not the real durations, but it's our best guess
    duration: number;

    error?: string;
};

// Unfortunately, we don't have a lot of precision in MP4s. I'd have to check, but I think
//      some of the timestamps are 32 bit, and if we use a large denominator of 90000 (which we do,
//      to allow changing frame rates, and easy calculation of the denominator), this only gives
//      us a few hours (13). We use a smaller number, just to be safe.
//  - Start time isn't 0, because we want to be able to seek backwards without reloading
//      the source buffer every seek!
const INTERNAL_START_TIME = timeInHour * 3;
const INTERNAL_PLAYBACK_LENGTH = timeInHour * 6;

let videoManager: VideoManager | undefined;
export function getVideoManager() {
    return videoManager;
}

function formatHourMinuteSecond(time: number) {
    let hours = Math.floor(time / timeInHour);
    time -= hours * timeInHour;
    let minutes = Math.floor(time / timeInHour);
    time -= minutes * timeInHour;
    let seconds = time / 1000;
    let p = (x: number, digits = 0) => {
        let str = x.toFixed(digits).toString();
        if (x < 10) {
            str = "0" + str;
        }
        return str;
    };
    return `${p(hours)}:${p(minutes)}:${p(seconds, 1)}`;
}


// NOTE: When we first receive video we have to decide upon an epoch time. We should
//  put this a week or so in the past, as if we try to seek before it, we have to reset
//  the SourceBuffer.
//  - This necessarily messes up the native trackbar, but... we're planning on seeking over
//      at least weeks of data, so the native trackbar is already dead, and will need to
//      be written ourselves.
export class VideoManager {
    private loadedVideos = new Map<string, VideoInfo>();

    private sourceBufferView?: {
        viewStartTime: number;
        viewEndTime: number;
    };
    private sourceBuffer: SourceBuffer | undefined;

    public state = observable({
        targetTime: 0,
        targetTimeThrottled: 0,
        videoWantsToPlay: false,

        isVideoActuallyPlaying: false,

        loadedFrames: 0,
        loadedBytes: 0,
        loadedFiles: 0,
    });

    constructor(private config: {
        element: HTMLVideoElement;

        // We buffer a different amount if we are paused
        playingBufferTime: number;
        pausedBufferTime: number;

        findVideo(time: number): Promise<string | undefined>;
        findNextVideo(time: number): Promise<string | undefined>;
        getVideoStartTime(file: string): number;
        getVideoBuffer(file: string): Promise<Buffer | undefined>;
    }) {
        videoManager = this;
        let video = this.config.element;
        this.addHotkeys();

        let events = ["play", "pause", "ended", "seeking", "seeked", "waiting", "timeupdate", "playing", "canplay", "canplaythrough", "error"];

        for (let event of events) {
            video.addEventListener(event, () => {
                this.syncUnderlyingVideoElement({ event });
            });
        }
        setInterval(() => {
            // HACK: Periodically sync, in case something changes and we don't get an event
            this.syncUnderlyingVideoElement({ event: "interval" });
        }, 1000);
    }

    private isVideoPlaying() {
        let video = this.config.element;
        return video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2;
    }

    private updateTargetTimeThrottled = throttleFunction(1000, () => {
        this.state.targetTimeThrottled = this.state.targetTime;
    });

    private seekSeqNum = 0;
    private loadSeqNum = 0;

    public syncUnderlyingVideoElement(config: {
        seekToTime?: number;
        event?: string;

        loadSeqNum?: number;
    }) {
        if (config.seekToTime) {
            this.seekSeqNum++;
            let seekTime = config.seekToTime;
            let selectedRange = getSelectedTimeRange();
            if (selectedRange && seekTime > selectedRange.end) {
                seekTime = selectedRange.end;
            }
            if (selectedRange && seekTime < selectedRange.start) {
                seekTime = selectedRange.start;
            }
            this.state.targetTime = seekTime;
        }

        let element = this.config.element;

        this.state.isVideoActuallyPlaying = this.isVideoPlaying();

        let time = this.state.targetTime;
        let view = this.sourceBufferView;
        if (!view || !(view.viewStartTime < time && time < view.viewEndTime)) {
            let viewStartTime = time - INTERNAL_START_TIME * getSpeed();
            let viewEndTime = viewStartTime + INTERNAL_PLAYBACK_LENGTH * getSpeed();
            view = this.sourceBufferView = { viewStartTime, viewEndTime, };

            // Get the source buffer immediately, as we're going to need it shortly
            void this.getSourceBuffer(time);
        }

        let loadSeqNum = config.loadSeqNum;
        let loadedVideo = this.getCurrentVideoExact();
        if (loadedVideo) {
            loadSeqNum = this.seekSeqNum;
        }
        if (loadSeqNum && loadSeqNum > this.loadSeqNum && loadSeqNum >= this.seekSeqNum) {
            // Just loaded data, seek to it, as they couldn't have seeked to it before

            this.loadSeqNum = loadSeqNum;
            let time = this.state.targetTime;

            let internalTime = (time - view.viewStartTime) / getSpeed() / 1000;
            // 3 decimal points, so we can handle up to a 999FPS source (2 is 99, which is too small)
            if (internalTime.toFixed(3) !== element.currentTime.toFixed(3)) {
                console.log(`Seek (from ${config.event}) VideoElement.currentTime = ${formatDateTime(time)} (${element.currentTime} to ${internalTime})`);
                element.currentTime = internalTime;
            }
        } else if (this.seekSeqNum === this.loadSeqNum) {
            // Regular playing, update time in state to match video progression
            let frac = element.currentTime * 1000 / INTERNAL_PLAYBACK_LENGTH;
            time = (1 - frac) * view.viewStartTime + frac * view.viewEndTime;
            this.state.targetTime = time;
        }

        let selectedRange = getSelectedTimeRange();
        if (selectedRange && !loopTimeRangeURL.value && this.state.targetTime > selectedRange.end) {
            console.warn("Pausing video because we are beyond end of selected range");
            this.pause();
            this.syncUnderlyingVideoElement({ seekToTime: selectedRange.end });
            return;
        }


        void this.updateTargetTimeThrottled();


        if (this.state.videoWantsToPlay && element.paused) {
            console.log("VideoElement.play()");
            void element.play();
        }
        if (!this.state.videoWantsToPlay && !element.paused) {
            console.log("VideoElement.pause()");
            void element.pause();
        }

        void this.bufferVideo();


        // Jump video gaps
        if (this.getPlayState() === "Buffering") {
            void ((async () => {
                let time = this.state.targetTime;
                // HACK: Try to peak beyond the current time. Too short, and you can't view pause on the
                //  last few frames of video after the video dies (ex, if your power went out). Too long,
                //  and any issues with currentTime stopping early (ex, if we are off by a frame in our
                //  time estimate), and the gap jumping won't work.
                let video = await this.config.findVideo(time + 0.2 * 1000 * getSpeed() * getVideoRate());
                let nextVideo = await this.config.findNextVideo(time);
                // If the state changed abort.
                if (this.state.targetTime !== time) return;
                if (this.getPlayState() !== "Buffering") return;
                if (video) {
                    // Surely we are just in the process of loading the video, so don't do anything
                    return;
                }
                if (selectedRange && nextVideo && decodeVideoKey(nextVideo).startTime > selectedRange.end) {
                    if (loopTimeRangeURL.value) {
                        console.warn("Looping video");
                        this.syncUnderlyingVideoElement({ seekToTime: selectedRange.start });
                    } else {
                        console.warn("Pausing video at end of selected range");
                        this.pause();
                        this.syncUnderlyingVideoElement({ seekToTime: selectedRange.end });
                    }
                    return;
                }

                if (nextVideo) {
                    // We found a gap, so skip it
                    let obj = decodeVideoKey(nextVideo);
                    console.warn(`Skipping gap (${config.event}) from ${formatDateTime(this.state.targetTime)} to ${formatDateTime(obj.startTime)}`);
                    this.syncUnderlyingVideoElement({ seekToTime: obj.startTime });
                } else {
                    // We hit the end, so wait
                    console.warn(`End of video at ${formatDateTime(this.state.targetTime)}, waiting 5 seconds and trying again.`);
                    setTimeout(() => {
                        this.syncUnderlyingVideoElement({});
                    }, 5000);
                }
            })());
        }
    }

    public getCurrentVideoExact() {
        let videos = this.getLoadedVideos();
        return videos.find(x => x.time <= this.state.targetTime && this.state.targetTime < x.time + x.duration);
    }
    public getCurrentVideo() {
        let videos = this.getLoadedVideos();
        let video = videos.find(x => x.time <= this.state.targetTime && this.state.targetTime < x.time + x.duration);
        if (!video) {
            // And if not that, then the first video after
            video = videos.find(x => x.time > this.state.targetTime);
        }
        if (!video) {
            let reversed = videos.slice().reverse();
            // If we can't find at the time, find the first video before
            video = reversed.find(x => x.time < this.state.targetTime);
        }
        return video;
    }

    private bufferVideo = throttleFunction(0, async (): Promise<void> => {
        const getCurrentBufferDuration = () => (
            this.state.videoWantsToPlay && !this.isVideoPlaying() && 0.1
            || !this.isVideoPlaying() && this.config.pausedBufferTime
            || this.config.playingBufferTime
        );
        let targetTime = this.state.targetTime;
        let seekSeqNum = this.seekSeqNum;

        let sourceBuffer = await this.getSourceBuffer(targetTime);

        let timeToBuffer = getCurrentBufferDuration() * getVideoRate();

        let video = await this.config.findVideo(targetTime);
        if (!video) {
            let nextVideo = await this.config.findNextVideo(targetTime);
            if (nextVideo) {
                video = nextVideo;
                let nextTime = parseVideoKey(nextVideo).startTime;
                // console.warn(`No video found at ${formatDateTime(targetTime)} (${targetTime}), but found next video at ${formatDateTime(nextTime)} (${nextTime}), jumping to next time`);
                targetTime = nextTime;
                if (this.state.videoWantsToPlay) {
                    // If playing keep the targetTime up to date?
                    this.state.targetTime = nextTime;
                }
            } else {
                console.warn(`No video found at ${formatDateTime(targetTime)}, waiting 5 seconds and trying again.`);
                // Minimum wait, to prevent infinite loop in bufferVideo
                await delay(100);
                setTimeout(this.bufferVideo, 5000);
                return;
            }
        }
        const view = this.sourceBufferView;
        if (!view) throw new Error("No source buffer view in bufferVideo. bufferVideo should only be called from setTargetTime, so this should be IMPOSSIBLE.");

        let curTime = targetTime;
        while (view === this.sourceBufferView) {
            let info = decodeVideoKey(video);
            if (info.startTime > curTime) {
                curTime = info.startTime;
            }
            let selectedRange = getSelectedTimeRange();
            if (selectedRange && info.startTime > selectedRange.end) {
                // We reached the end of the range, so no need to buffer anymore
                break;
            }

            let needsToLoad = !this.loadedVideos.has(video);
            let videoObj = await this.loadVideo({ file: video, view, sourceBuffer, seekSeqNum });
            let addedDuration = Math.min(videoObj.duration, info.endTime - curTime) / getSpeed();
            timeToBuffer -= addedDuration;
            if (timeToBuffer < 0) break;

            // If we loaded, break, and trigger sync again. That way we can be interrupted by seeking.
            //  Because we only do this if we need to load, the loop will still loop through
            //  previously loaded video (instantly) and then get back here.
            if (needsToLoad) {
                this.syncUnderlyingVideoElement({});
                break;
            }

            let middleTime = (info.startTime + info.endTime) / 2;
            let nextVideo = await this.config.findNextVideo(middleTime);
            if (!nextVideo) {
                console.warn(`Reached end of videos at ${formatDateTime(curTime)}, waiting 5 seconds and trying again.`);
                await delay(100);
                setTimeout(this.bufferVideo, 5000);
                return;
            }
            video = nextVideo;
        }
    });
    private async loadVideo(config: {
        file: string;
        view: { viewStartTime: number; viewEndTime: number; };
        sourceBuffer: SourceBuffer;
        seekSeqNum: number;
    }) {
        let videoObj = this.loadedVideos.get(config.file);
        if (videoObj) return videoObj;
        let { file, view, sourceBuffer } = config;

        let info = decodeVideoKey(file);

        videoObj = {
            file: file,
            time: info.startTime,
            frames: 0,
            keyFrames: 0,
            duration: 0,
            size: 0,
        };
        try {
            let startLoadTime = Date.now();
            let buffer = await this.config.getVideoBuffer(file);
            if (!buffer) throw new Error("Video buffer is missing");

            let curStart = info.startTime;
            let curEnd = info.endTime;
            // Try to avoid gaps where possible
            let nextVideo = await this.config.findNextVideo(curStart);
            if (nextVideo) {
                let nextObj = parseVideoKey(nextVideo);
                // Gaps are really bad, so it's better to just slow down the frame rate (which
                //  increasing the duration does implicitly) than to have a gap.
                // ALTHOUGH, gaps also stretch the video, making seeking play video at the wrong
                //  time, which is really bad too!
                let maxGapEnd = curEnd + 100 * getSpeed();
                if (nextObj.startTime < maxGapEnd) {
                    curEnd = nextObj.startTime;
                }
            }

            let duration = curEnd - curStart;
            let frameDuration = duration / info.frames;
            let speed = getSpeed();
            if (speed !== 1) {
                frameDuration /= speed;
            }
            let internalTime = (curStart - view.viewStartTime) / getSpeed() / 1000;
            let { buffer: mp4Buffer, frameCount, keyFrameCount } = await H264toMP4({
                buffer: splitNALs(buffer),
                frameDurationInSeconds: frameDuration / 1000,
                mediaStartTimeSeconds: internalTime,
            });

            videoObj.frames = frameCount;
            videoObj.keyFrames = keyFrameCount;
            videoObj.duration = duration;
            videoObj.size = buffer.byteLength;

            this.state.loadedFrames += frameCount;
            this.state.loadedBytes += buffer.byteLength;
            this.state.loadedFiles++;
            await sourceBuffer.appendBuffer(mp4Buffer);
            await new Promise(r => sourceBuffer.addEventListener("updateend", r, { once: true }));

            this.syncUnderlyingVideoElement({
                loadSeqNum: config.seekSeqNum
            });

            if (info && info.frames !== frameCount) {
                console.warn(`Expected ${info.frames} frames, but got ${frameCount} frames`);
            }

            let loadTime = Date.now() - startLoadTime;
            console.log(`Loaded video (${formatNumber(buffer.length)}) in ${formatTime(loadTime)} | ${formatDateTime(info.startTime)} to ${formatDateTime(info.endTime)} (internal time ${formatHourMinuteSecond(internalTime * 1000)})`, file);

        } catch (e: any) {
            void recheckFileNow(file);
            videoObj.error = e.stack;
            // Set the duration to 0, so we can skip it and load the next video instead
            // NOTE: Not setting to 0, so we can see the error on the trackbar (for now)
            //videoObj.duration = 0;
            console.error("Error loading video", file, e);
        }

        if (view === this.sourceBufferView) {
            this.loadedVideos.set(file, videoObj);
        }
        return videoObj;
    }


    // Gets a usable source buffer for this time. This means a source buffer where this time
    //  1) Won't be negative, and 2) Won't be beyond MAX_PLAYABLE_TIME. If the current
    //  source buffer can't do this, we create a new source buffer.
    private getSourceBuffer = runInSerial(async (time: number): Promise<SourceBuffer> => {
        let view = this.sourceBufferView;
        if (this.sourceBuffer && view && view.viewStartTime <= time && time < view.viewEndTime) {
            return this.sourceBuffer;
        }
        if (this.sourceBuffer) {
            if (view) {
                console.warn(`Reseting source buffer, as time ${formatDateTime(time)} is outside of ${formatDateTime(view.viewStartTime)} to ${formatDateTime(view.viewEndTime)}`);
            }
            console.warn(`Clearing ${this.loadedVideos.size} videos that were loaded in old source buffer`);
        }

        let video = this.config.element;
        var push = new MediaSource();
        video.src = URL.createObjectURL(push);
        this.loadedVideos.clear();
        this.state.loadedFrames = 0;
        this.state.loadedBytes = 0;
        this.state.loadedFiles = 0;

        let newSourceBuffer = await new Promise<SourceBuffer>(r => {
            push.addEventListener("sourceopen", () => {
                // NOTE: The string is from the avc1 box. Always avc1, and then the numbers I BELIEVE
                //  are AVCProfileIndication, profile_compatibility, and AVCLevelIndication. We store them in the
                //  mp4 box, but they come from the NALs.
                //  - But it seems to work fine even if it is wrong
                r(push.addSourceBuffer("video/mp4; codecs=\"avc1.64001E\""));
            });
        });
        view = this.sourceBufferView;
        if (view && view.viewStartTime <= time && time < view.viewEndTime) {
            this.sourceBuffer = newSourceBuffer;
            // Poke it, so we don't get stuck, as resetting the source buffer view might break
            //  previous loading attempts.
            this.syncUnderlyingVideoElement({});
            return newSourceBuffer;
        } else {
            throw new Error(`Cancelling source buffer load. Source buffer time is out of date, caller shouldn't load any data. Tried to load for ${formatDateTime(time)}`);
        }
    });



    private addHotkeys() {
        let videoElement = this.config.element;
        const frameDelta = (delta: number) => {
            if (!videoElement) return;


            let timeOffset = delta * (1 / 30) * 1000 * getSpeed();

            let curTime = this.state.targetTime;
            // Find overlapping video
            let matching = this.getCurrentVideoExact();
            if (!matching) {
                let videos = getVideoIndexSynced().flatVideos;
                let file: VideoFileObj | undefined;
                if (delta > 0) {
                    // And if not that, then the first video after
                    file = videos.find(x => x.startTime > this.state.targetTime);
                } else {
                    let reversed = videos.slice().reverse();
                    // If we can't find at the time, find the first video before
                    file = reversed.find(x => x.startTime < this.state.targetTime);
                }
                if (file) {
                    this.syncUnderlyingVideoElement({
                        seekToTime: delta > 0 ? file.startTime : file.endTime + timeOffset
                    });
                    return;
                }
            }


            if (matching) {
                let frameTime = matching.duration / matching.frames;
                let curFrameOffset = (curTime - matching.time) / frameTime;
                let fraction = Math.abs(curFrameOffset % 1);
                delta += 0.5 - fraction;
                timeOffset = delta * frameTime;
            } else {
                console.warn(`No video found at ${formatDateTime(curTime)}, guessing frame time`);
            }
            this.syncUnderlyingVideoElement({
                seekToTime: this.state.targetTime + timeOffset
            });
        };

        const seekVideo = (seconds: number) => {
            if (!videoElement) return;
            this.syncUnderlyingVideoElement({
                seekToTime: this.state.targetTime + seconds * 1000 * getSpeed()
            });
        };

        const hotkeyHandlers: Record<string, () => void> = {
            "ArrowUp": () => {
                adjustRateURL.value = (+adjustRateURL.value || 1) * 2 + "";
            },
            "ArrowDown": () => {
                adjustRateURL.value = (+adjustRateURL.value || 1) * 0.5 + "";
            },
            "m": () => {
                if (!videoElement) return;
                videoElement.muted = !videoElement.muted;
            },
            "ArrowLeft": () => seekVideo(-5),
            "ArrowRight": () => seekVideo(5),
            "j": () => seekVideo(-5),
            "l": () => seekVideo(5),
            ",": () => frameDelta(-1),
            ".": () => frameDelta(1),
            " ": () => {
                this.togglePlay();
            },
            "Enter": () => {
                this.togglePlay();
            },
            "k": () => {
                this.togglePlay();
            },
            "f": () => {
                void videoElement.requestFullscreen();
            },
            "Ctrl+r": () => {
                location.reload();
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            // Ignore if it is for an input, text area, etc
            const ignore = (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                e.target instanceof HTMLSelectElement
            );
            if (ignore) return;

            let key = e.key;
            if (e.ctrlKey) key = "Ctrl+" + key;
            if (e.shiftKey) key = "Shift+" + key;

            const handler = hotkeyHandlers[key];
            if (handler) {
                e.preventDefault();
                e.stopPropagation();
                handler();
            }
        };

        // There's no reason to focus the video element, except to use hotkeys, but... we support
        //  that anyways. Otherwise, focusing the element just breaks things.
        videoElement.addEventListener("focus", () => {
            videoElement.blur();
        });
        videoElement.addEventListener("click", () => {
            this.togglePlay();
        });

        // Add the event listener
        document.addEventListener("keydown", onKeyDown);

        // Return cleanup function
        return () => {
            document.removeEventListener("keydown", onKeyDown);
        };
    }



    public seekToTime(time: number) {
        this.syncUnderlyingVideoElement({ seekToTime: time });
    }


    public getLoadedVideos() {
        // Access state, so we rerun when videos change
        this.state.loadedBytes;
        let videos = Array.from(this.loadedVideos.values());
        sort(videos, x => x.time);
        return videos;
    }

    public getPlayState() {
        if (this.state.isVideoActuallyPlaying) return "Playing" as const;
        if (this.state.videoWantsToPlay) return "Buffering" as const;
        return "Paused" as const;
    }

    public togglePlay() {
        if (this.state.videoWantsToPlay) {
            this.pause();
        } else {
            this.play();
        }
    }
    public play() {
        this.state.videoWantsToPlay = true;
        void this.config.element.play();
        this.syncUnderlyingVideoElement({});
    }
    public pause() {
        this.state.videoWantsToPlay = false;
        void this.config.element.pause();
        this.syncUnderlyingVideoElement({});
    }
}