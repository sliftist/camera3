import preact from "preact";
import { observer } from "./misc/observer";
import { observable } from "./misc/mobxTyped";
import { URLParamStr } from "./misc/URLParam";
import { decodeVideoKey, estimateFPS, findNextVideo, findVideo, findVideoSync, getVideoStartTime } from "./videoHelpers";
import { FileStorageSynced } from "./storage/DiskCollection";
import { PromiseObj, throttleFunction, timeInMinute } from "socket-function/src/misc";
import { css } from "typesafecss";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";
import { VideoManager } from "./VideoManager";
import { Trackbar } from "./Trackbar";
import { VideoGrid } from "./VideoGrid";
import { Button } from "./Button";
import { getFileStorage } from "./storage/FileFolderAPI";
import { getSpeed, getVideoRate } from "./urlParams";

let playTimeURL = new URLParamStr("t");
const updatePlayTime = throttleFunction(5000, (time: number) => {
    playTimeURL.value = Math.floor(time / 1000) * 1000 + "";
});
let playingURL = new URLParamStr("p");


@observer
export class VideoPlayer extends preact.Component {
    videoManager: VideoManager | undefined;
    video: HTMLVideoElement | null = null;
    onVideoElement = async (newVideo: HTMLVideoElement) => {
        this.video = newVideo;
        async function getVideoBuffer(file: string): Promise<Buffer | undefined> {
            let storage = await getFileStorage();
            let handle = await storage.folder.getNestedFileHandle(file.split("/"));
            if (!handle) return undefined;
            let fileHandle = await handle.getFile();
            return Buffer.from(await fileHandle.arrayBuffer());
        }

        let video = this.videoManager = new VideoManager({
            element: newVideo,

            playingBufferTime: 30 * 1000,
            pausedBufferTime: 7 * 1000,

            findVideo,
            findNextVideo,
            getVideoStartTime,
            getVideoBuffer,
        });
        video.seekToTime(+playTimeURL.value || Date.now());
        this.forceUpdate();

        // if (playingURL.value) {
        //     await video.playVideoTime(+playTimeURL.value || 0);
        // } else {
        //     await video.seekToTime(+playTimeURL.value || 0);
        // }
    };

    render() {
        let state = this.videoManager?.state;
        state && void updatePlayTime(state.targetTimeThrottled);
        if (!!state?.videoWantsToPlay !== !!playingURL.value) {
            if (state?.videoWantsToPlay) {
                playingURL.value = "1";
            } else {
                playingURL.value = "";
            }
        }
        let rate = getVideoRate();
        if (this.video && this.video.playbackRate !== rate) {
            this.video.playbackRate = rate;
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
                {this.videoManager && <VideoHeader manager={this.videoManager} />}
                <div className={css.fillBoth.minHeight(200).relative.flexShrink(100000) + " VideoPlayer-video"}>
                    <video
                        className={css.fillBoth.minHeight(200).pointer}
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
                        <div>
                            Loaded {formatNumber(state.loadedFiles)} / {formatNumber(FileStorageSynced.getKeys().length)} files /// {formatNumber(state.loadedFrames)} frames /// {formatNumber(state.loadedBytes)}B
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
                                let videoObj = this.videoManager?.getCurrentVideo();
                                if (!videoObj) return undefined;
                                let playbackDuration = (videoObj.duration) / getSpeed() / getVideoRate();
                                let curFPS = videoObj.frames / playbackDuration * 1000;
                                let curBitRate = videoObj.size / playbackDuration * 1000;
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
        let isLive = Date.now() - manager.state.targetTimeThrottled < timeInMinute * 2;
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
                    value={formatDateTimeForInput(manager.state.targetTimeThrottled)}
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