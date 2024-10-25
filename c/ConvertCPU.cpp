#include <iostream>
#include <vector>
#include <jpeglib.h>
#include <stdexcept>

class MJPEGtoI420Converter {
public:
    MJPEGtoI420Converter();
    ~MJPEGtoI420Converter();

    // Converts MJPEG buffer to I420 (YUV420) format
    std::vector<uint8_t> convert_frame(const std::vector<uint8_t>& mjpeg_buffer, int width, int height);

private:
    void jpeg_to_i420(j_decompress_ptr cinfo, uint8_t* yuv_buffer);
};

MJPEGtoI420Converter::MJPEGtoI420Converter() {
    // Constructor (can initialize libjpeg settings if needed)
}

MJPEGtoI420Converter::~MJPEGtoI420Converter() {
    // Destructor (clean up if necessary)
}

// Convert MJPEG buffer to I420
std::vector<uint8_t> MJPEGtoI420Converter::convert_frame(const std::vector<uint8_t>& mjpeg_buffer, int width, int height) {
    // Prepare the JPEG decompression object
    struct jpeg_decompress_struct cinfo;
    struct jpeg_error_mgr jerr;
    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_decompress(&cinfo);

    // Specify data source (MJPEG buffer)
    jpeg_mem_src(&cinfo, mjpeg_buffer.data(), mjpeg_buffer.size());

    // Read header to get image info
    if (jpeg_read_header(&cinfo, TRUE) != 1) {
        jpeg_destroy_decompress(&cinfo);
        throw std::runtime_error("Failed to read MJPEG header");
    }

    // Start decompression
    jpeg_start_decompress(&cinfo);

    // Ensure dimensions match
    if (cinfo.output_width != width || cinfo.output_height != height) {
        jpeg_destroy_decompress(&cinfo);
        throw std::runtime_error("MJPEG dimensions do not match expected size");
    }

    // Allocate space for the I420 buffer
    std::vector<uint8_t> i420_buffer(width * height * 3 / 2);  // YUV420: Y + (U/2 + V/2)

    // Convert the JPEG to I420 format
    jpeg_to_i420(&cinfo, i420_buffer.data());

    // Finish decompression
    jpeg_finish_decompress(&cinfo);
    jpeg_destroy_decompress(&cinfo);

    return i420_buffer;
}

// Helper function to convert JPEG to I420 format
void MJPEGtoI420Converter::jpeg_to_i420(j_decompress_ptr cinfo, uint8_t* yuv_buffer) {
    int width = cinfo->output_width;
    int height = cinfo->output_height;

    uint8_t* y_plane = yuv_buffer;                         // Y plane (full resolution)
    uint8_t* u_plane = yuv_buffer + width * height;        // U plane (half resolution)
    uint8_t* v_plane = u_plane + (width * height) / 4;     // V plane (half resolution)

    // Allocate a buffer to hold one scanline of the image
    JSAMPARRAY buffer = (*cinfo->mem->alloc_sarray)((j_common_ptr)cinfo, JPOOL_IMAGE, width * cinfo->output_components, 1);

    for (int y = 0; y < height; ++y) {
        jpeg_read_scanlines(cinfo, buffer, 1);

        for (int x = 0; x < width; ++x) {
            uint8_t r = buffer[0][x * 3];      // Red
            uint8_t g = buffer[0][x * 3 + 1];  // Green
            uint8_t b = buffer[0][x * 3 + 2];  // Blue

            // Convert RGB to YUV (BT.601 standard)
            uint8_t y_value = (0.299 * r + 0.587 * g + 0.114 * b);
            uint8_t u_value = (-0.169 * r - 0.331 * g + 0.500 * b) + 128;
            uint8_t v_value = (0.500 * r - 0.419 * g - 0.081 * b) + 128;

            // Assign Y value (luminance)
            y_plane[y * width + x] = y_value;

            // Assign U and V values for every other pixel (subsampling 4:2:0)
            if (y % 2 == 0 && x % 2 == 0) {
                u_plane[(y / 2) * (width / 2) + (x / 2)] = u_value;
                v_plane[(y / 2) * (width / 2) + (x / 2)] = v_value;
            }
        }
    }
}
