import fs from "fs";
import { H264toMP4 } from "mp4-typescript";

async function main() {
    let time = Date.now();
    let files = await fs.promises.readdir("V:/");
    console.log(files);
    console.log(`Time to read directory: ${Date.now() - time}ms`);
    return;

    let mp4 = await H264toMP4({
        buffer: fs.readFileSync("./frames_000.nal"),
        width: 640,
        height: 480,
        frameDurationInSeconds: 1 / 30
    });

    console.log(`Frame count: ${mp4.frameCount}, key frame count: ${mp4.keyFrameCount}`);
    fs.writeFileSync("./test.mp4", mp4.buffer);

    // let nals = parseObject(buf, NALList(4, undefined, undefined)).NALs;
    // let rawNals = parseObject(buf, NALListRaw(4)).NALs;

    // console.log(`Found ${nals.length} NALs`);
    // for (let i = 0; i < nals.length; i++) {
    //     let nalBuffer = writeObject(NALCreateRaw(4), rawNals[i])

    //     let nal = nals[i];
    //     let type = nal.nalObject.type;

    //     if (nal.nalObject.type === "slice") {
    //         let header = nal.nalObject.nal.slice_header;
    //         console.log(`${type} (size ${nalBuffer.getLength() - 4}) ${header.sliceTypeStr}, order lsb: ${header.pic_order_cnt_lsb}`);
    //     } else {
    //         console.log(`${type} (size ${nalBuffer.getLength() - 4})`);
    //     }

    //     //let nalBuffer = writeObject(NALCreateRaw(4), rawNals[i]);
    //     //console.log(ParseNalInfo(nalBuffer.DEBUG_getBuffer().slice(4)));
    // }
}

main().catch(console.error).finally(() => process.exit());