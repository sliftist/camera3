import preact from "preact";
import { observer } from "./misc/observer";
import { VideoManager } from "./VideoManager";
import { URLParamStr } from "./misc/URLParam";
import { css } from "typesafecss";
import { sort, timeInDay, timeInHour } from "socket-function/src/misc";
import { formatDate } from "socket-function/src/formatting/format";
import { observable } from "./misc/mobxTyped";
import { getVideoIndexSynced } from "./videoLookup";

// NOTE: We intentionally don't allow using a larger time range of the trackbar.
//  It is much better to use the thumbnail grid to navigate rather than scrubbing
//  a large period (the thumbnail grid is literally doing the same thing, except
//  it's MUCH faster, and lets you see multiple previews at once).
const TRACKBAR_RANGE = timeInDay;

let playingColor = "hsl(120, 50%, 50%)";
let bufferedColor = "hsl(260, 50%, 50%)";
let pausedColor = "hsl(120, 40%, 20%)";

@observer
export class Trackbar extends preact.Component<{
    videoManager: VideoManager;
}> {
    render() {
        let videoManager = this.props.videoManager;
        videoManager.state.curPlayingTimeThrottled;

        let centerTime = videoManager.state.curPlayingTimeThrottled;

        let startTime = centerTime - TRACKBAR_RANGE / 2;
        let endTime = startTime + TRACKBAR_RANGE;

        let smallSegments: {
            start: number;
            end: number;
        }[] = [];
        function roundDownToNearestHour(time: number) {
            // Eh... I guess this works. Gonna suck for people with weird timezones, at which point... we'll
            //  have to actually fix it (and until then, it's really annoying to test, because we'd have to change our
            //  system timezone, etc, etc).
            return Math.floor(time / timeInHour) * timeInHour;
        }
        for (let t = startTime; t < endTime + timeInHour; t += timeInHour) {
            let start = roundDownToNearestHour(t);
            smallSegments.push({
                start,
                end: start + timeInHour,
            });
        }
        // Ex, 9pm, etc
        function formatHour(time: number) {
            let date = new Date(time);
            return date.toLocaleString(undefined, {
                hour: "numeric",
                hour12: true,
            });
        }
        // 9:00:00 PM
        function formatHourFull(time: number) {
            let date = new Date(time);
            return date.toLocaleString(undefined, {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            });
        }

        let majorSegments: {
            start: number;
            end: number;
            day: number;
        }[] = [];
        function roundTo6Hours(time: number) {
            const d = new Date(time);
            d.setHours(Math.floor(d.getHours() / 6) * 6);
            return +d;
        }
        for (let t = startTime; t < endTime + timeInHour * 6; t += timeInHour * 6) {
            let start = roundTo6Hours(t);
            majorSegments.push({
                start,
                end: start + timeInHour * 6,
                day: new Date(start).getDate(),
            });
        }
        function formatDateNice(time: number) {
            let date = new Date(time);
            let year = date.getFullYear();
            let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()];
            let day = date.getDate();
            let dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
            return `${year} ${month} ${day} (${dayOfWeek})`;
        }
        let videoSegments = getVideoIndexSynced().ranges;


        let playState = videoManager.getPlayState();

        return (
            <div
                className={
                    css.fillWidth.flexShrink0
                        .relative
                    + css.hsl(
                        playState === "Playing" && 120
                        || playState === "Paused" && 30
                        || 220
                        ,
                        50,
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
                                .hsl(120, 0, 50)
                            //+ (segment.buffered ? css.hsl(120, 50, 50) : css.hsl(120, 0, 50))
                        }
                    />
                )}
                <div className={css.fillWidth.hbox(10).center.relative}>
                    {formatHourFull(centerTime)}
                    <div
                        className={
                            css.height(60).top("100%").width(3).offsetx("-50%")
                                .zIndex(1)
                                .absolute
                                .left(`${(centerTime - startTime) / TRACKBAR_RANGE * 100}%`)
                            + css.background(
                                videoManager.state.isPlaying && playingColor
                                || videoManager.state.wantsToPlay && bufferedColor
                                || pausedColor
                            )
                        }
                    />
                </div>
                <div className={css.fillWidth.height(20).relative}>
                    {smallSegments.map(segment =>
                        <div className={
                            css.absolute
                                .left(`${(segment.start - startTime) / TRACKBAR_RANGE * 100}%`)
                                .fillHeight
                                .center
                                .borderLeft("1px solid hsl(0, 0%, 80%)")
                        }>
                            <div className={
                                css.absolute.left(0).top("200%").height("100%").width(1).offsetx("-50%").background("white")
                                    .opacity(0.5)
                            } />
                            <div className={css.paddingLeft(4)}>{formatHour(segment.start)}</div>
                        </div>
                    )}
                </div>
                <div className={css.fillWidth.height(24).relative}>
                    {majorSegments.map((segment) =>
                        <div className={
                            css.absolute
                                .left(`${(segment.start - startTime) / TRACKBAR_RANGE * 100}%`)
                                .width(`${(segment.end - segment.start) / TRACKBAR_RANGE * 100}%`)
                                .fillHeight
                            + (new Date(segment.start).getHours() === 0 && css.borderLeft("1px solid hsl(0, 0%, 0%)"))
                        }>
                            <div
                                className={
                                    css.absolute
                                        .fillBoth
                                        .hsla(50, 0, segment.day % 2 === 0 ? 7 : 20, 0.75)
                                        .center
                                }
                            >
                                {formatDateNice(segment.start)}
                            </div>
                        </div>
                    )}
                </div>
                <ClickIndicator
                    color={videoManager.state.wantsToPlay && playingColor || pausedColor}
                    onClick={async e => {
                        let play = videoManager.state.wantsToPlay;
                        let rect = e.currentTarget.parentElement!.getBoundingClientRect();
                        let x = e.clientX - rect.left;
                        let frac = x / rect.width;
                        console.log({ x, frac });
                        let time = startTime + frac * TRACKBAR_RANGE;
                        if (videoManager.state.wantsToPlay) {
                            await videoManager.playVideoTime(time);
                        } else {
                            await videoManager.seekToTime(time);
                        }
                    }}
                />
            </div>
        );
    }
}

@observer
class ClickIndicator extends preact.Component<{
    color: string;
    onClick: (e: preact.JSX.TargetedMouseEvent<HTMLDivElement>) => void;
}> {
    synced = observable({
        mouseFraction: 0,
    });
    render() {
        return (
            <div
                className={css.fillBoth.absolute.pos(0, 0).pointer}
                onMouseMove={e => {
                    let rect = e.currentTarget.getBoundingClientRect();
                    let x = e.clientX - rect.left;
                    this.synced.mouseFraction = x / rect.width;
                }}
                onMouseLeave={e => {
                    this.synced.mouseFraction = 0;
                }}
            >
                {this.synced.mouseFraction && <div
                    className={
                        css.absolute
                            .left(`${this.synced.mouseFraction * 100}%`)
                            .width(3)
                            .fillHeight
                            .zIndex(1)
                            .background(this.props.color)
                    }
                    onClick={this.props.onClick}
                /> || undefined}
            </div>
        );
    }
}