import preact from "preact";
import { observer } from "./misc/observer";
import { observable } from "./misc/mobxTyped";
import { URLParamStr } from "./misc/URLParam";
import { estimateFPS, findNextVideo, findVideo, getVideoStartTime } from "./videoHelpers";
import { FileStorageSynced } from "./storage/DiskCollection";
import { H264toMP4 } from "mp4-typescript";
import { PromiseObj, throttleFunction } from "socket-function/src/misc";
import { css } from "typesafecss";
import { formatNumber, formatTime } from "socket-function/src/formatting/format";
import { VideoManager } from "./VideoManager";
import { addVideoHotkeys } from "./videoHotkeys";
import { Trackbar } from "./Trackbar";
import { VideoGrid } from "./VideoGrid";

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

        if (playingURL.value) {
            await video.playVideoTime(+playTimeURL.value || 0);
        } else {
            await video.seekToTime(+playTimeURL.value || 0);
        }
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
            <div className={css.fillBoth.vbox0.relative + " trigger-hover"}>
                {this.videoManager && <VideoGrid videoManager={this.videoManager} />}
                <div className={css.fillBoth.minHeight(0).relative}>
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
                        css.vbox(4).absolute.top(0).right(0)
                            .display("none")
                            .display("flex", "hover")
                            .hsla(0, 0, 10, 0.8).pad2(10, 4)
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
                </div>
                {this.videoManager && <Trackbar videoManager={this.videoManager} />}
            </div>
        );
    }
}