import { MaybePromise } from "socket-function/src/types";
import { observable } from "./misc/mobxTyped";
import { PromiseObj, sort, throttleFunction } from "socket-function/src/misc";
import { runInSerial } from "socket-function/src/batching";
import { H264toMP4 } from "mp4-typescript";
import { decodeVideoKey } from "./videoHelpers";

export type VideoInfo = {
    file: string;

    time: number;
    frames: number;
    keyFrames: number;

    // Maybe not the real durations, but it's our best guess
    duration: number;
};

// Unfortunately, we don't have a lot of precision in MP4s. I'd have to check, but I think
//      some of the timestamps are 32 bit, and if we use a large denominator of 90000 (which we do,
//      to allow changing frame rates, and easy calculation of the denominator), this only gives
//      us a few hours (13). We use a smaller number, just to be safe.
const MAX_PLAYABLE_TIME = 1000 * 60 * 60 * 3;

// NOTE: When we first receive video we have to decide upon an epoch time. We should
//  put this a week or so in the past, as if we try to seek before it, we have to reset
//  the SourceBuffer.
//  - This necessarily messes up the native trackbar, but... we're planning on seeking over
//      at least weeks of data, so the native trackbar is already dead, and will need to
//      be written ourselves.
export class VideoManager {
    private videoInfos = new Map<string, MaybePromise<VideoInfo>>();
    public baseTime = 0;
    private sourceBuffer: SourceBuffer | undefined;
    // The video's playing based on the video player increasing the currentTime. Only happens
    //  once it plays the first frame. Otherwise we assume we are controlling playback
    //  (via seeking, etc).
    private inAutoPlayback = false;

    public state = observable({
        wantsToPlay: false,
        isPlaying: false,

        curPlayingTime: 0,
        // Throttled, so it doesn't render so often
        //  BUT, you should still put it in a component to reduce the amount of extra
        //      re-rendering.
        curPlayingTimeThrottled: 0,

        // Buffered in the future, not the past
        curBufferedTime: 0,

        loadedFrames: 0,
        loadedBytes: 0,
        loadedFiles: 0,

        segmentsLoading: 0,
    });

    constructor(private config: {
        element: HTMLVideoElement;

        // We buffer a different amount if we are paused
        playingBufferTime: number;
        pausedBufferTime: number;

        findVideo(time: number): Promise<string>;
        findNextVideo(file: string): Promise<string | undefined>;
        getVideoStartTime(file: string): number;
        getVideoBuffer(file: string): Promise<Buffer | undefined>;
    }) {
        let video = this.config.element;

        const updatePlayStates = () => {
            let isVideoPlaying = this.isVideoPlaying();
            let videoWantsToPlay = this.doesVideoWantToPlay();

            if (this.state.isPlaying !== isVideoPlaying) {
                this.state.isPlaying = isVideoPlaying;
            }
            if (this.state.wantsToPlay !== videoWantsToPlay) {
                this.state.wantsToPlay = videoWantsToPlay;
            }

            this.state.curPlayingTime = this.getCurrentPlayTime();
            void this.updatePlayTimeThrottled();
        };

        let events = ["play", "pause", "ended", "seeking", "seeked", "waiting", "timeupdate", "playing", "canplay", "canplaythrough", "error"];
        for (let event of events) {
            video.addEventListener(event, () => {
                //console.log("Video event", event);
                updatePlayStates();
            });
        }

        let didSeekedCount = 0;
        let jumpGap = throttleFunction(1000, async () => {
            if (this.inAutoPlayback) {
                console.warn("Trying to jump gap in video");
                await this.seekToNext();
            }
        });
        video.addEventListener("seeked", () => didSeekedCount++);
        video.addEventListener("waiting", () => {
            if (!this.doesVideoWantToPlay()) return;
            let startCount = didSeekedCount;
            setTimeout(() => {
                if (didSeekedCount > startCount) return;
                void jumpGap();
            }, 200);
        });
        video.addEventListener("timeupdate", () => this.onTimeUpdate());
        video.addEventListener("timeupdate", () => {
            this.inAutoPlayback = true;
        });
        video.addEventListener("seeking", () => this.onSeekingVideo(this.getCurrentPlayTime()));
    }

    /** Returns the real time (ex, new Date() works on it) of the current playing position */
    private getCurrentPlayTime(): number {
        return this.baseTime + this.config.element.currentTime * 1000;
    }
    private async getVideos() {
        let videos: VideoInfo[] = [];
        for (let [file, info] of this.videoInfos) {
            if (info instanceof Promise) {
                videos.push(await info);
            } else {
                videos.push(info);
            }
        }
        return videos;
    }

    private isVideoPlaying() {
        let video = this.config.element;
        return video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2;
    }
    private doesVideoWantToPlay() {
        return !this.config.element.paused;
    }

    private onSeekingVideo = throttleFunction(500, async (time: number) => {
        let video = await this.config.findVideo(time);
        await this.loadVideo(video);
    });

    // Time of video, not time in the future (so if their are jumps, we skip them, and keep loading more)
    private async bufferVideoByTime(duration: number) {
        let curTime = this.getCurrentPlayTime();
        let videos = await this.getVideos();
        sort(videos, x => -x.time);
        let current = videos.find(x => x.time <= curTime)?.file || await this.config.findVideo(curTime);

        let loaded: VideoInfo[] = [];

        while (duration > 0) {
            let next = await this.config.findNextVideo(current);
            if (!next) {
                break;
            }
            let videoInfo = await this.loadVideo(next);
            loaded.push(videoInfo);
            duration -= videoInfo.duration;
        }
        return loaded;
    }

    private retrySeekToNext = throttleFunction(5000, async () => {
        if (this.isVideoPlaying()) return;
        await this.seekToNext();
    });

    private async seekToNext() {
        let nexts = await this.bufferVideoByTime(1);
        let next = nexts[0];
        if (!next) {
            await this.retrySeekToNext();
            return;
        }
        let time = this.config.getVideoStartTime(next.file);
        console.log(`Seeking to ${time} from ${this.getCurrentPlayTime()}`);
        await this.seekToTime(time);
    }
    private async onTimeUpdate() {
        let bufferTime = this.state.wantsToPlay ? this.config.playingBufferTime : this.config.pausedBufferTime;
        await this.bufferVideoByTime(bufferTime);

        let newBufferedTime = 0;
        for (let video of this.videoInfos.values()) {
            if (video instanceof Promise) continue;
            if (video.time <= this.state.curPlayingTime) continue;
            // NOTE: If the users seeks around a lot this will get artificially high, because we count way future
            //  times that aren't going to play next. BUT, this is easier, and still useful. AND it handles gaps,
            //  which otherwise, is a lot harder to handle (we have to track when videos are connected via
            //  getNext, and even then, we might be wrong, due to seeking, etc, etc).
            newBufferedTime += video.duration;
        }
        this.state.curBufferedTime = newBufferedTime;
    }
    private updatePlayTimeThrottled = throttleFunction(1000, () => {
        this.state.curPlayingTimeThrottled = this.state.curPlayingTime;
    });
    // Gets a usable source buffer for this time. This means a source buffer where this time
    //  1) Won't be negative, and 2) Won't be beyond MAX_PLAYABLE_TIME. If the current
    //  source buffer can't do this, we create a new source buffer.
    private getSourceBuffer = runInSerial(async (time: number): Promise<SourceBuffer> => {
        if (this.sourceBuffer && time > this.baseTime && time < this.baseTime + MAX_PLAYABLE_TIME) {
            return this.sourceBuffer;
        }
        if (this.sourceBuffer) {
            console.log(`Reseting source buffer, as time ${time} is outside of ${this.baseTime} to ${this.baseTime + MAX_PLAYABLE_TIME}`);
            console.log(`Clearing ${this.videoInfos.size} videos that were loaded in old source buffer`);
        }

        let video = this.config.element;
        var push = new MediaSource();
        video.src = URL.createObjectURL(push);
        this.videoInfos.clear();
        this.baseTime = time - Math.floor(MAX_PLAYABLE_TIME / 2);
        this.state.loadedFrames = 0;
        this.state.loadedBytes = 0;
        this.state.loadedFiles = 0;

        this.sourceBuffer = await new Promise<SourceBuffer>(r => {
            push.addEventListener("sourceopen", () => {
                // NOTE: The string is from the avc1 box. Always avc1, and then the numbers I BELIEVE
                //  are AVCProfileIndication, profile_compatibility, and AVCLevelIndication. We store them in the
                //  mp4 box, but they come from the NALs.
                //  - But it seems to work fine even if it is wrong
                r(push.addSourceBuffer("video/mp4; codecs=\"avc1.64001E\""));
            });
        });

        return this.sourceBuffer;
    });

    private async loadVideo(file: string): Promise<VideoInfo> {
        // Get the source buffer immediately, as accessing it can clear videoInfos!
        let startTime = this.config.getVideoStartTime(file);
        let sourceBuffer = await this.getSourceBuffer(startTime);
        let cached = this.videoInfos.get(file);
        if (!cached) {
            console.log("Loading video", file);
            let promise = (async (): Promise<VideoInfo> => {
                let buffer = await this.config.getVideoBuffer(file);
                if (!buffer) {
                    console.error("No buffer for video, skipping", file);
                    return {
                        file,
                        time: startTime,
                        frames: 0,
                        keyFrames: 0,
                        duration: 0,
                    };
                }
                try {
                    let info = decodeVideoKey(file);
                    let frameDurationInSeconds = info ? (info.endTime - info.time) / info.frames / 1000 : 1 / 30;
                    let { buffer: mp4Buffer, frameCount, keyFrameCount } = await H264toMP4({
                        buffer,
                        frameDurationInSeconds: frameDurationInSeconds,
                        mediaStartTimeSeconds: (startTime - this.baseTime) / 1000,
                    });

                    this.state.loadedFrames += frameCount;
                    this.state.loadedBytes += buffer.byteLength;
                    this.state.loadedFiles++;
                    sourceBuffer.appendBuffer(mp4Buffer);

                    let p = new PromiseObj();
                    sourceBuffer.addEventListener("updateend", p.resolve as any);
                    await p.promise;
                    sourceBuffer.removeEventListener("updateend", p.resolve as any);
                    let duration = info ? info.endTime - info.time : 0;

                    console.log("Loaded video", file, startTime, "duration", duration);

                    return {
                        file,
                        time: startTime,
                        frames: frameCount,
                        keyFrames: keyFrameCount,
                        duration: duration,
                    };
                } catch (e) {
                    console.error("Error loading video, assuming it is 0 length", file, e);
                    // Delete it after a bit, so we can retry
                    setTimeout(() => {
                        this.videoInfos.delete(file);
                    }, 5000);

                    return {
                        file,
                        time: startTime,
                        frames: 0,
                        keyFrames: 0,
                        duration: 0,
                    };
                }
            })();
            this.state.segmentsLoading++;
            void promise.finally(() => this.state.segmentsLoading--);
            void promise.then(x => {
                if (this.videoInfos.get(file) === promise) {
                    this.videoInfos.set(file, x);
                }
            });
            cached = promise;
            this.videoInfos.set(file, cached);
        }
        return cached;
    }

    private seekSeqNum = 0;
    /** NOTE: Automatically plays the next video after this one finishes, using findNextVideo
     *      to find the next one (there's really no reason to use VideoManager if you don't
     *      want to keep playing videos).
     */
    public async seekToTime(time: number): Promise<void> {
        let videoElem = this.config.element;
        this.seekSeqNum++;
        let curSeqNum = this.seekSeqNum;
        // Seek right away, for responsiveness
        videoElem.currentTime = (time - this.baseTime) / 1000;
        this.inAutoPlayback = false;
        this.state.curPlayingTime = this.state.curPlayingTimeThrottled = this.getCurrentPlayTime();

        // Load the video now, so playVideo can wait until we load to play
        let video = await this.config.findVideo(time);
        await this.loadVideo(video);

        if (curSeqNum === this.seekSeqNum) {
            videoElem.currentTime = (time - this.baseTime) / 1000;
            this.inAutoPlayback = false;
            // On user action update immediately, so it feels more responsive
            this.state.curPlayingTime = this.state.curPlayingTimeThrottled = this.getCurrentPlayTime();
        }
    }

    public async playVideoTime(time: number) {
        console.log("Playing video time", time);
        await this.config.element.pause();
        await this.seekToTime(time);
        this.inAutoPlayback = false;
        await this.config.element.play();
    }

    public getLoadedVideos() {
        // Accept state, so we rerun when videos change
        this.state.loadedBytes;
        let videos: VideoInfo[] = [];
        for (let [file, info] of this.videoInfos) {
            if (info instanceof Promise) continue;
            videos.push(info);
        }
        return videos;
    }
}