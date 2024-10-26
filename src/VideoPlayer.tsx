import preact from "preact";
import { observer } from "./misc/observer";
import { observable } from "./misc/mobxTyped";
import { URLParamStr } from "./misc/URLParam";
import { decodeVideoKey, estimateFPS, findNextVideo, findVideo, findVideoSync, getLiveVideos, getVideoStartTime } from "./videoHelpers";
import { FileStorageSynced } from "./storage/DiskCollection";
import { H264toMP4 } from "mp4-typescript";
import { PromiseObj, throttleFunction, timeInMinute } from "socket-function/src/misc";
import { css } from "typesafecss";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";
import { VideoManager } from "./VideoManager";
import { addVideoHotkeys } from "./videoHotkeys";
import { Trackbar } from "./Trackbar";
import { VideoGrid } from "./VideoGrid";
import { Button } from "./Button";

let playTimeURL = new URLParamStr("t");
const updatePlayTime = throttleFunction(5000, (time: number) => {
    playTimeURL.value = Math.floor(time / 1000) * 1000 + "";
});
let playingURL = new URLParamStr("p");

let playVideoBase = (file: string) => { };
export function playVideo(file: string) {
    playVideoBase(file);
}

@observer
export class VideoPlayer extends preact.Component {
    videoManager: VideoManager | undefined;
    onVideoElement = async (newVideo: HTMLVideoElement) => {
        async function getVideoBuffer(file: string): Promise<Buffer | undefined> {
            return await FileStorageSynced.getAsync().getPromise(file);
        }
        addVideoHotkeys(newVideo);

        let video = this.videoManager = new VideoManager({
            element: newVideo,

            playingBufferTime: 30 * 1000,
            pausedBufferTime: 7 * 1000,

            findVideo,
            findNextVideo,
            getVideoStartTime,
            getVideoBuffer,
        });
        playVideoBase = async (file: string) => {
            await video.playVideoTime(getVideoStartTime(file));
        };
        // HACK: Set the current time without seeking, so we don't have to load the video.
        //  In practice loading the video MIGHT be fine, but... when developing it's really
        //  annoying, as we reload A LOT.
        video.state.curPlayingTime = video.state.curPlayingTimeThrottled = +playTimeURL.value || Date.now();

        // if (playingURL.value) {
        //     await video.playVideoTime(+playTimeURL.value || 0);
        // } else {
        //     await video.seekToTime(+playTimeURL.value || 0);
        // }
    };

    render() {
        let state = this.videoManager?.state;
        state && void updatePlayTime(state.curPlayingTime);
        if (!!state?.wantsToPlay !== !!playingURL.value) {
            if (state?.wantsToPlay) {
                playingURL.value = "1";
            } else {
                playingURL.value = "";
            }
        }
        return (
            <div className={css.fillBoth.vbox0.relative + " VideoPlayer"}>
                <style>
                    {`
                        .VideoPlayer-video:hover .VideoPlayer-info {
                            display: flex!important;
                        }
                    `}
                </style>
                {this.videoManager && <VideoGrid videoManager={this.videoManager} />}
                {this.videoManager && <VideoHeader manager={this.videoManager} />}
                <div className={css.fillBoth.minHeight(0).relative + " VideoPlayer-video"}>
                    <video
                        className={css.fillBoth.minHeight(0).pointer}
                        ref={newVideo => {
                            if (!newVideo) return;
                            if (this.videoManager) return;
                            console.log(`Mount video element`);
                            void this.onVideoElement(newVideo);
                        }}
                    />
                    {state && <div className={
                        css.vbox(4).absolute.top0.left0
                            .display("none")
                            .hsla(0, 0, 10, 0.8).pad2(10, 4)
                        + " VideoPlayer-info"
                    }>
                        {
                            state.segmentsLoading > 0 &&
                            <div className={
                                css.hslcolor(-5, 50, 50)
                            }>
                                Loading {formatNumber(state.segmentsLoading)} files
                            </div>
                        }
                        <div>
                            Loaded {formatNumber(state.loadedFiles)} / {formatNumber(FileStorageSynced.getKeys().length)} files /// {formatTime(state.curBufferedTime)} /// {formatNumber(state.loadedFrames)} frames /// {formatNumber(state.loadedBytes)}B
                        </div>
                    </div>}
                    {state && <div className={
                        css.vbox(4).absolute.top0.right0
                            .display("none")
                            .hsla(0, 0, 10, 0.8).pad2(10, 4)
                        + " VideoPlayer-info"
                    }>
                        <div>
                            {(() => {
                                let curVideo = findVideoSync(state?.curPlayingTimeThrottled || 0);
                                let videoObj = decodeVideoKey(curVideo);
                                if (!videoObj) return undefined;
                                let curFPS = videoObj.frames / (videoObj.endTime - videoObj.time) * 1000;
                                let loadedVideos = this.videoManager?.getLoadedVideos();
                                let loadedVideo = loadedVideos?.find(x => x.file === curVideo);
                                let curBitRate = loadedVideo && (loadedVideo.size / loadedVideo.duration * 1000);
                                return (
                                    <div>
                                        {curFPS.toFixed(2)} FPS /// {formatNumber(curBitRate)}B/s
                                    </div>
                                );
                            })()}
                        </div>
                    </div>}
                </div>
                {this.videoManager && <Trackbar videoManager={this.videoManager} />}
            </div>
        );
    }
}

@observer
export class VideoHeader extends preact.Component<{
    manager: VideoManager;
}> {
    render() {
        let manager = this.props.manager;
        let isLive = Date.now() - manager.state.curPlayingTimeThrottled < timeInMinute * 2;
        let playState = manager.getPlayState();
        return (
            <div className={css.fillWidth.hbox(10).center.marginBottom(10)}>
                <Button
                    hue={
                        playState === "Playing" && 120
                        || playState === "Paused" && 30
                        || 220
                    }
                    onClick={() => manager.togglePlay()}
                >
                    {playState}
                </Button>
                <input
                    value={formatDateTimeForInput(manager.state.curPlayingTimeThrottled)}
                    type="datetime-local"
                    onChange={e => {
                        let date = new Date(e.currentTarget.value);
                        void manager.seekToTime(date.getTime());
                    }}
                />
                <Button
                    saturation={!isLive ? -30 : 0}
                    onClick={() => {
                        void manager.seekToTime(Date.now());
                    }}
                >
                    Seek to Live
                </Button>
            </div>
        );
    }
}

function formatDateTimeForInput(value: number) {
    value -= new Date(value).getTimezoneOffset() * 60 * 1000;
    return new Date(value).toISOString().slice(0, -1);
}