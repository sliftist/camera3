import preact from "preact";
import { observer } from "./misc/observer";
import { css } from "typesafecss";
import { URLParamStr } from "./misc/URLParam";
import { PendingDisplay, setPending } from "./storage/PendingManager";
import { sort } from "socket-function/src/misc";
import { VideoPlayer } from "./VideoPlayer";
import { deleteActivityCache, findVideo, getVideoStartTime, parseVideoKey } from "./videoHelpers";
import { resetStorageLocation } from "./storage/FileFolderAPI";
import { deleteVideoCache, forceRecheckAllNow, getAvailableSpeeds, getLastScannedInfo, getVideoIndexSynced } from "./videoLookup";
import { adjustRateURL, getSpeed, setSpeed } from "./urlParams";
import { Button } from "./Button";
import { deleteThumbCache } from "./thumbnail";
import { formatDateTime, formatNumber, formatTime } from "socket-function/src/formatting/format";
import { observable } from "./misc/mobxTyped";

export const pageURL = new URLParamStr("page");

@observer
export class Page extends preact.Component {
    synced = observable({
        reloading: false,
    });
    async componentDidMount() {
        window.addEventListener("keydown", this.onKeyDown);
    }

    onKeyDown = (e: KeyboardEvent) => {
        // Ignore if it is for an input, text area, etc
        let ignore = (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        );
        if (ignore) return;

        console.log("Checking hotkey", e.key, e);
        let key = e.key;
        if (e.ctrlKey) key = "Ctrl+" + key;
        if (e.shiftKey) key = "Shift+" + key;
        let hotkeyDataAttribute = `[data-hotkey="${key}"]`;
        let el = document.querySelector<HTMLElement>(hotkeyDataAttribute);
        if (el) {
            e.stopPropagation();
            e.preventDefault();
            console.log("Found hotkey", e.key, el);
            el.click();
        }
    };

    video: HTMLVideoElement | null = null;
    curVideoSeconds = 0;
    sourceBuffer: SourceBuffer | null = null;
    render() {
        let scannedObj = getLastScannedInfo();
        return (
            <div className={css.size("100vw", "100vh").overflowHidden.vbox0}>
                <div className={
                    css.hbox(10)
                        .fillWidth
                }>
                    <div className={
                        css.hbox(10).alignItems("center")
                            .whiteSpace("nowrap")
                            .overflowHidden
                            .textOverflow("ellipsis")
                    }>
                        <PendingDisplay />
                        <Button
                            hue={-5}
                            onClick={async () => {
                                setPending("Reset Cache", "working");
                                try {
                                    await deleteVideoCache();
                                    await deleteThumbCache();
                                    await deleteActivityCache();
                                    window.location.reload();
                                } catch (e: any) {
                                    setPending("Reset Cache", "error " + e.message);
                                    console.error("Failed to reset cache", e);
                                }
                            }}
                        >
                            Delete Cache
                        </Button>
                    </div>
                    <div className={css.marginAuto.minWidth(100)} />
                    <div className={css.hbox(20).justifyContent("end").flexShrink0}>
                        {scannedObj &&
                            <span>
                                Full scanned in {formatTime(scannedObj.duration)}, {formatTime(Date.now() - scannedObj.time)} ago (at {formatDateTime(scannedObj.time)})
                            </span>
                        }
                        <IndexInfo />
                        <label className={css.hbox(4)}>
                            <span>Adjust Rate</span>
                            <Button onClick={() => adjustRateURL.value = +adjustRateURL.value * 0.5 + ""}>
                                0.5x
                            </Button>
                            <input
                                className={css.width(50)}
                                value={adjustRateURL.value || 1}
                                type="number"
                                step={0.1}
                                onChange={e => adjustRateURL.value = e.currentTarget.value}
                            />
                            <Button onClick={() => adjustRateURL.value = +adjustRateURL.value * 2 + ""}>
                                2x
                            </Button>
                        </label>
                        <Button onClick={async () => {
                            this.synced.reloading = true;
                            await forceRecheckAllNow();
                            this.synced.reloading = false;
                        }}>
                            {this.synced.reloading ? "Checking disk..." : `Recheck ${formatNumber(getVideoIndexSynced().ranges.map(x => x.videos.length).reduce((a, b) => a + b, 0))} Files`}
                        </Button>
                        <div className={css.hbox(5)}>
                            <b>Time per Second</b>
                            {getAvailableSpeeds().map(speed => (
                                <Button
                                    hue={320}
                                    saturation={speed === getSpeed() ? 0 : -50}
                                    data-hotkey={speed}
                                    onClick={() => setSpeed(speed)}
                                >
                                    {speed === 1 ? "Real Time" : formatTime(speed * 1000)}
                                    {speed === getSpeed() && ` ${formatNumber(getVideoIndexSynced().totalSize)}B` || ""}
                                </Button>
                            ))}
                        </div>
                        <Button hue={320} onClick={() => resetStorageLocation()}>
                            Change Video Folder
                        </Button>
                    </div>
                </div>
                <div className={css.fillBoth.minHeight(0)}>
                    <VideoPlayer />
                </div>
            </div>
        );
    }
}


@observer
class IndexInfo extends preact.Component {
    render() {
        let index = getVideoIndexSynced();
        let totalSize = index.ranges.map(x => x.size).reduce((a, b) => a + b, 0);
        let duration = index.ranges.map(x => x.duration).reduce((a, b) => a + b, 0);
        let count = index.ranges.map(x => x.videos.length).reduce((a, b) => a + b, 0);
        return (
            <span className={css.hbox(6)}>
                <span>{formatNumber(totalSize)}B</span>
                {"///"}
                <span>{formatTime(duration)}</span>
                {"///"}
                <span>{formatNumber(count)} files</span>
            </span>
        );
    }
}