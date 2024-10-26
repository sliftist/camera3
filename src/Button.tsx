import preact from "preact";
import { observer } from "./misc/observer";
import { css } from "typesafecss";

@observer
export class Button extends preact.Component<{
    onClick?: () => void;
    hue?: number;
    saturation?: number;
    lightness?: number;
    fontSize?: number;
    invertHover?: boolean;
}> {
    render() {
        let hue = this.props.hue ?? 220;
        let saturation = 67 + (this.props.saturation ?? 0);
        let lightness = 40 + (this.props.lightness ?? 0);
        let fontSize = this.props.fontSize ?? 12;

        let padding = (
            fontSize < 12 && css.pad2(4, 2)
            || fontSize < 18 && css.pad2(6, 2)
            || css.pad2(8, 2)
        );

        return (
            <div
                className={css
                    .hsl(hue, saturation, lightness)
                    //.border(`${borderSize}px solid transparent`, "soft")
                    // .borderTopColor(`hsl(${hue}, ${saturation * 1.6}%, ${lightness * 3}%)`)
                    // .borderLeftColor(`hsl(${hue}, ${saturation * 1.6}%, ${lightness * 3}%)`)
                    // .borderRightColor(`hsl(${hue}, ${saturation * 0.8}%, ${lightness * 1.3}%)`)
                    // .borderBottomColor(`hsl(${hue}, ${saturation * 0.7}%, ${lightness * 1.3}%)`)
                    // .borderRightColor(`hsl(${hue}, ${saturation * 0.8}%, ${lightness * 1.6}%)`)
                    // .borderBottomColor(`hsl(${hue}, ${saturation * 0.8}%, ${lightness * 1.6}%)`)
                    .fontSize(fontSize)
                    .relative
                    .pointer
                    .transition("all 0.2s")
                    + padding
                    + " trigger-hover "
                    + (!this.props.invertHover && css.background(`hsl(${hue}, ${saturation + 30}%, ${lightness - 10}%)`, "hover", "important"))
                    + (this.props.invertHover && css.background(`hsl(${hue}, ${saturation}%, ${lightness + 30}%)`, "hover", "important"))
                }
                onClick={e => {
                    // Prevent default, to prevent selection
                    e.preventDefault();
                    this.props.onClick?.();
                }}
            >
                <div className={
                    css.absolute
                        .fillBoth
                        .pos(3, 2)
                        .zIndex(-1)
                        .left(0, "hover", "important")
                        .top(0, "hover", "important")
                        .hsl(hue, saturation * 0.8, Math.min(90, lightness * 1.6))
                } />
                {this.props.children}
            </div>
        );
    }
}