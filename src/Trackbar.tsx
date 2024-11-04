import preact from "preact";
import { observer } from "./misc/observer";
import { VideoManager } from "./VideoManager";
import { URLParamStr } from "./misc/URLParam";
import { css } from "typesafecss";
import { last, sort, timeInDay, timeInHour, timeInMinute, timeInSecond } from "socket-function/src/misc";
import { formatDate, formatDateTime, formatTime } from "socket-function/src/formatting/format";
import { observable } from "./misc/mobxTyped";
import { getVideoIndexSynced } from "./videoLookup";
import { getSelectedTimeRange, getSpeed, setSelectedTimeRange } from "./urlParams";
import { formatFullIncrement, formatSingleIncrement, getNextIncrement, getPrevIncrement, getStartOfIncrement, incrementMedianSize, incrementSubs, IncrementType, incrementUps, VideoGrid2 } from "./VideoGrid2";
import { speedGroups } from "./constants";
import { getThumbnailURL } from "./thumbnail";
import { findVideoSync, getThumbnailRange } from "./videoHelpers";
import { Icon } from "./icons";

let playingColor = "hsl(120, 50%, 50%)";
let bufferedColor = "hsl(260, 50%, 50%)";
let pausedColor = "hsl(120, 40%, 20%)";

let timeOverride = observable({
    value: 0
});

@observer
export class Trackbar extends preact.Component<{
    videoManager: VideoManager;
}> {
    lastThumbnailForSize = "";

    render() {
        const IMAGE_WIDTH = 200;
        let increment: IncrementType = "second";
        {
            let idealImagePlayTime = timeInSecond * 20;
            let speed = getSpeed();
            let idealRealTime = idealImagePlayTime * speed;
            for (let key of Object.keys(incrementSubs)) {
                let time = incrementMedianSize(key as IncrementType);
                if (time > idealRealTime) {
                    increment = key as IncrementType;
                    break;
                }
            }
            if (increment === "second") {
                increment = "decade";
            }
        }
        const TIME_PER_PIXEL = incrementMedianSize(increment) / IMAGE_WIDTH;

        let nextIncrement = incrementUps[increment];


        let videoManager = this.props.videoManager;
        videoManager.state.targetTimeThrottled;

        let centerTime = videoManager.state.targetTime;

        let pixelWidth = window.innerWidth;

        const TRACKBAR_RANGE = pixelWidth * TIME_PER_PIXEL;
        let startTime = centerTime - TRACKBAR_RANGE / 2;
        let endTime = startTime + TRACKBAR_RANGE;


        let segments: {
            start: number;
            end: number;
        }[] = [];
        let time = getPrevIncrement(startTime, increment);
        while (time < endTime && segments.length < 240) {
            let nextTime = getNextIncrement(time, increment);
            segments.push({
                start: time,
                end: nextTime,
            });
            time = nextTime;
        }

        let videoSegments = getVideoIndexSynced().ranges;
        videoSegments = videoSegments.filter(x => x.startTime < endTime && x.endTime > startTime);

        let playState = videoManager.getPlayState();

        let playHue = (
            playState === "Playing" && 120
            || playState === "Paused" && 80
            || 220
        );

        return [
            <VideoGrid2 videoManager={videoManager} defaultIncrement={nextIncrement} />,
            <div
                className={
                    css.fillWidth.flexShrink0
                        .relative
                    + css.hsl(
                        playHue,
                        10,
                        50
                    )
                }
            >
                {videoSegments.map(segment =>
                    <div
                        className={
                            css.absolute
                                .left(`${(segment.startTime - startTime) / TRACKBAR_RANGE * 100}%`)
                                // Minimum of 1px, otherwise small segments become invisible, and if all segments are small...
                                //  nothing renders.
                                .width(`calc(max(1px, ${segment.duration / TRACKBAR_RANGE * 100}%))`)
                                .fillHeight
                                .opacity(0.8)
                                .hsl(playHue, 50, 50)
                            //+ (segment.buffered ? css.hsl(120, 50, 50) : css.hsl(120, 0, 50))
                        }
                    />
                )}
                <div className={css.fillWidth.hbox(10).center.relative.pad2(4).zIndex(2).pointerEvents("none")}>
                    <FormatTime time={centerTime} increment={increment} />
                </div>
                <div className={css.fillWidth.relative.pointerEvents("none")}>
                    {segments.map((segment) =>
                        (() => {
                            let url = getThumbnailRange(IMAGE_WIDTH, segment);
                            if (!url.startsWith("data:")) {
                                url = "";
                            }
                            return <div
                                className={
                                    css.absolute.left(`${(segment.start - startTime) / TRACKBAR_RANGE * 100}%`)
                                        .width(`${(segment.end - segment.start) / TRACKBAR_RANGE * 100}%`)
                                        .minHeight("100%")
                                    //.borderLeft("5px solid hsla(0, 0%, 0%, 0.5)")
                                }
                            >
                                {!!url && <img src={url} className={
                                    css.objectFit("contain")
                                        .fillBoth
                                } />}
                                <span className={
                                    css.absolute.pos(0, 0).fillBoth.center
                                        .fontSize(18).boldStyle
                                }>
                                    <div className={css.background("hsla(0, 0%, 0%, 0.65)").pad2(4, 2).zIndex(3)}>
                                        {formatSingleIncrement(segment.start, increment)}
                                    </div>
                                </span>
                            </div>;
                        })()
                    )}
                    {(() => {
                        // Invisible placeholder to give us the correct height
                        let startIncrement = getStartOfIncrement(startTime, increment);
                        let endOfIncrement = getNextIncrement(endTime, increment);
                        let url = getThumbnailRange(IMAGE_WIDTH, { start: startIncrement, end: endOfIncrement });
                        if (!url.startsWith("data:")) {
                            url = this.lastThumbnailForSize;
                        } else {
                            this.lastThumbnailForSize = url;
                        }
                        return <img src={url} className={css.minHeight(100).objectFit("contain").opacity(0).pointerEvents("none")} />;
                    })()}
                </div>
                {(() => {
                    let loadedVideos = videoManager.getLoadedVideos();
                    sort(loadedVideos, x => x.time);
                    // Only videos in the current range
                    loadedVideos = loadedVideos.filter(x => x.time + x.duration > startTime && x.time < endTime);

                    // NOTE: This will never become a performance problem, because by the time we have 10K videos,
                    //  we'll also have 10GB of video loaded, at which point the browser will have crashed 6K videos ago...
                    let ranges: { start: number; end: number; error?: string }[] = [];
                    let maxGap = 1000 * getSpeed();
                    for (let video of loadedVideos) {
                        let lastRange = ranges[ranges.length - 1];
                        if (
                            lastRange
                            && !!lastRange.error === !!video.error
                            && lastRange.end + maxGap > video.time
                        ) {
                            lastRange.end = video.time + video.duration;
                        } else {
                            let start = video.time;
                            let end = video.time + video.duration;
                            ranges.push({ start, end, error: video.error });
                        }
                    }
                    return ranges.map(segment =>
                        <div
                            className={
                                css.absolute
                                    .left(`${(segment.start - startTime) / TRACKBAR_RANGE * 100}%`)
                                    .width(`${(segment.end - segment.start) / TRACKBAR_RANGE * 100}%`)
                                    .fillHeight
                                    .top(0)
                                    .opacity(0.5)
                                    .hsl(segment.error ? -5 : 260, 70, 50)
                            }
                        />
                    );
                })()}
                {(() => {
                    let selectedRange = getSelectedTimeRange();
                    if (!selectedRange) return undefined;
                    return (
                        <div
                            className={
                                css.absolute
                                    .left(`calc(${(selectedRange.start - startTime) / TRACKBAR_RANGE * 100}% - 2px)`)
                                    .width(`calc(${(selectedRange.end - selectedRange.start) / TRACKBAR_RANGE * 100}% + 4px)`)
                                    .fillHeight
                                    .top(-2)
                                    .height(4)
                                    .hsl(210, 70, 50)
                            }
                        />
                    );
                })()}
                <ClickIndicator
                    startTime={startTime}
                    endTime={endTime}
                    time={centerTime}

                    background={videoManager.state.videoWantsToPlay && playingColor || pausedColor}
                    videoManager={videoManager}

                    onClick={async e => {
                        let rect = e.currentTarget!.getBoundingClientRect();
                        let x = e.clientX - rect.left;
                        let frac = x / rect.width;
                        console.log({ x, frac });
                        let time = startTime + frac * TRACKBAR_RANGE;
                        setSelectedTimeRange(undefined);
                        videoManager.seekToTime(time);
                    }}
                />
            </div>
        ];
    }
}

@observer
class FormatTime extends preact.Component<{
    time: number;
    increment: IncrementType;
}> {
    render() {
        let centerTime = timeOverride.value || this.props.time;
        return <span>
            {/* {formatFullIncrement(centerTime, this.props.increment, "long")} ({formatTime(Date.now() - centerTime)} AGO) */}
            {formatDateTime(centerTime)} ({formatTime(Date.now() - centerTime)} AGO)
        </span>;
    }
}

@observer
class ClickIndicator extends preact.Component<{
    time: number;
    startTime: number;
    endTime: number;

    background: string;
    videoManager: VideoManager;

    onClick: (e: preact.JSX.TargetedMouseEvent<HTMLDivElement>) => void;
}> {
    synced = observable({
        mouseFraction: 0,
    });
    render() {
        let { startTime, endTime, videoManager } = this.props;
        let centerTime = timeOverride.value || this.props.time;
        let range = endTime - startTime;
        return (
            <div
                className={css.fillBoth.absolute.pos(0, 0).pointer}
                onMouseMove={e => {
                    let rect = e.currentTarget.getBoundingClientRect();
                    let x = e.clientX - rect.left;
                    this.synced.mouseFraction = x / rect.width;
                    timeOverride.value = startTime + this.synced.mouseFraction * (endTime - startTime);
                }}
                onMouseLeave={e => {
                    this.synced.mouseFraction = 0;
                    timeOverride.value = 0;
                }}
                onClick={this.props.onClick}
            >
                <div
                    className={
                        css.absolute
                            .left(`${(centerTime - startTime) / range * 100}%`)
                            .top(0)
                            .width(3).offsetx("-50%")
                            .fillHeight
                            .zIndex(1)
                            .background(this.props.background)
                            .pointerEvents("none")
                        + css.background(
                            videoManager.state.isVideoActuallyPlaying && playingColor
                            || videoManager.state.videoWantsToPlay && bufferedColor
                            || pausedColor
                        )
                    }
                />
            </div>
        );
    }
}