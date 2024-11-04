export function joinNALs(nals: Buffer[]) {
    function bigEndianUint32(value: number) {
        let buf = Buffer.alloc(4);
        buf.writeUInt32BE(value);
        return buf;
    }
    return Buffer.concat(nals.flatMap(nal => [bigEndianUint32(nal.length), nal]));
}
export function splitNALs(buffer: Buffer, ignorePartial?: "ignorePartial"): Buffer[] {
    let outputBuffers: Buffer[] = [];
    let i = 0;
    while (i < buffer.length) {
        let length = buffer.readUInt32BE(i);
        i += 4;
        if (i + length > buffer.length) {
            if (ignorePartial) break;
            let errorMessage = `NAL length is too long, buffer is corrupted. ${i} + ${length} = ${i + length} > ${buffer.length}`;
            console.error(errorMessage);
            break;
        }
        outputBuffers.push(buffer.slice(i, i + length));
        i += length;
    }
    return outputBuffers;
}