#include "H264Encoder.h"
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <vector>
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <mmal.h>
#include <mmal_logging.h>
#include <mmal_util.h>
#include <mmal_util_params.h>
#include <mmal_parameters_video.h>
#include <bcm_host.h>
#include <jpeglib.h>

class H264Encoder {
public:
    H264Encoder(int width, int height, int fps, int bitrate);
    ~H264Encoder();
    void add_jpeg_frame(const std::vector<uint8_t>& jpeg_data);
    std::vector<uint8_t> get_next_nal();

private:
    int video_width;    // Frame width
    int video_height;   // Frame height
    int video_fps;      // Frames per second
    int video_bitrate;  // Bitrate in bps

    MMAL_COMPONENT_T *encoder;
    MMAL_POOL_T *output_pool;
    MMAL_PORT_T *input_port;
    MMAL_PORT_T *output_port;

    std::queue<std::vector<uint8_t>> nal_queue; // Queue for encoded NAL units
    std::mutex queue_mutex;
    std::condition_variable queue_cv;

    std::thread encoding_thread;
    bool stop_encoding;
    void process_encoding();

    void jpeg_to_raw(const std::vector<uint8_t>& jpeg_data, uint8_t* raw_buffer);
    static void encoder_buffer_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer);
};

// Constructor: Initialize MMAL and the encoder
H264Encoder::H264Encoder(int width, int height, int fps, int bitrate)
    : video_width(width), video_height(height), video_fps(fps), video_bitrate(bitrate),
      encoder(nullptr), output_pool(nullptr), stop_encoding(false) {

    bcm_host_init();

    MMAL_STATUS_T status = mmal_component_create("vc.ril.video_encode", &encoder);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to create encoder component");
    }

    // Enable the encoder component control port
    status = mmal_port_enable(encoder->control, nullptr);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to enable encoder control port");
    }

    input_port = encoder->input[0];
    output_port = encoder->output[0];

    // Configure the encoder input port (I420 raw frames)
    MMAL_ES_FORMAT_T *input_format = input_port->format;
    input_format->type = MMAL_ES_TYPE_VIDEO;
    input_format->encoding = MMAL_ENCODING_I420;
    input_format->es->video.width = VCOS_ALIGN_UP(video_width, 32);
    input_format->es->video.height = VCOS_ALIGN_UP(video_height, 16);
    input_format->es->video.crop.width = video_width;
    input_format->es->video.crop.height = video_height;
    input_format->es->video.frame_rate.num = video_fps;
    input_format->es->video.frame_rate.den = 1;

    status = mmal_port_format_commit(input_port);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to commit input port format");
    }

    // Configure the encoder output port (H.264 encoded video)
    MMAL_ES_FORMAT_T *output_format = output_port->format;
    output_format->type = MMAL_ES_TYPE_VIDEO;
    output_format->encoding = MMAL_ENCODING_H264;
    output_format->bitrate = video_bitrate;
    output_format->es->video.width = video_width;
    output_format->es->video.height = video_height;
    output_format->es->video.frame_rate.num = video_fps;
    output_format->es->video.frame_rate.den = 1;

    status = mmal_port_format_commit(output_port);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to commit output port format");
    }

    // Set H.264 profile and level
    MMAL_PARAMETER_VIDEO_PROFILE_T param = {{MMAL_PARAMETER_PROFILE, sizeof(param)}, MMAL_VIDEO_PROFILE_H264_HIGH, MMAL_VIDEO_LEVEL_H264_4};
    status = mmal_port_parameter_set(output_port, &param.hdr);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to set H.264 profile");
    }

    // Enable output port
    output_pool = mmal_port_pool_create(output_port, output_port->buffer_num, output_port->buffer_size);
    output_port->userdata = (struct MMAL_PORT_USERDATA_T *)this;

    status = mmal_port_enable(output_port, encoder_buffer_callback);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to enable output port");
    }

    // Enable encoder component
    status = mmal_component_enable(encoder);
    if (status != MMAL_SUCCESS) {
        throw std::runtime_error("Failed to enable encoder component");
    }

    // Start the encoding thread
    encoding_thread = std::thread(&H264Encoder::process_encoding, this);
}

// Destructor: Clean up MMAL resources
H264Encoder::~H264Encoder() {
    stop_encoding = true;
    if (encoding_thread.joinable()) {
        encoding_thread.join();
    }

    mmal_port_disable(output_port);
    mmal_component_disable(encoder);
    mmal_component_destroy(encoder);
}

// Add a JPEG frame for encoding
void H264Encoder::add_jpeg_frame(const std::vector<uint8_t>& jpeg_data) {
    uint8_t raw_buffer[video_width * video_height * 3 / 2]; // I420 raw buffer
    jpeg_to_raw(jpeg_data, raw_buffer);

    // Feed the raw buffer to the encoder's input port
    MMAL_BUFFER_HEADER_T *buffer = mmal_queue_get(input_port->buffer_pool->queue);
    if (buffer) {
        mmal_buffer_header_mem_lock(buffer);
        memcpy(buffer->data, raw_buffer, buffer->alloc_size);
        buffer->length = buffer->alloc_size;
        mmal_buffer_header_mem_unlock(buffer);

        MMAL_STATUS_T status = mmal_port_send_buffer(input_port, buffer);
        if (status != MMAL_SUCCESS) {
            throw std::runtime_error("Failed to send buffer to input port");
        }
    }
}

// Get the next available NAL unit
std::vector<uint8_t> H264Encoder::get_next_nal() {
    std::unique_lock<std::mutex> lock(queue_mutex);
    queue_cv.wait(lock, [this]() { return !nal_queue.empty(); });

    std::vector<uint8_t> nal = nal_queue.front();
    nal_queue.pop();
    return nal;
}

// JPEG to raw I420 conversion
void H264Encoder::jpeg_to_raw(const std::vector<uint8_t>& jpeg_data, uint8_t* raw_buffer) {
    struct jpeg_decompress_struct cinfo;
    struct jpeg_error_mgr jerr;
    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_decompress(&cinfo);

    jpeg_mem_src(&cinfo, jpeg_data.data(), jpeg_data.size());
    jpeg_read_header(&cinfo, TRUE);
    jpeg_start_decompress(&cinfo);

    // Ensure the dimensions match
    if (cinfo.output_width != video_width || cinfo.output_height != video_height) {
        throw std::runtime_error("JPEG dimensions do not match the expected size");
    }

    // Convert JPEG to I420
    while (cinfo.output_scanline < cinfo.output_height) {
        uint8_t* row_ptr = raw_buffer + cinfo.output_scanline * cinfo.output_width * 3 / 2;
        jpeg_read_scanlines(&cinfo, &row_ptr, 1);
    }

    jpeg_finish_decompress(&cinfo);
    jpeg_destroy_decompress(&cinfo);
}

// Background thread to process encoding
void H264Encoder::process_encoding() {
    while (!stop_encoding) {
        // Send empty buffers to output port
        for (int i = 0; i < output_pool->headers_num; i++) {
            MMAL_BUFFER_HEADER_T *buffer = mmal_queue_get(output_pool->queue);
            if (buffer) {
                MMAL_STATUS_T status = mmal_port_send_buffer(output_port, buffer);
                if (status != MMAL_SUCCESS) {
                    std::cerr << "Failed to send buffer to output port" << std::endl;
                }
            }
        }
    }
}

// Encoder buffer callback
void H264Encoder::encoder_buffer_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer) {
    H264Encoder *encoder = (H264Encoder *)port->userdata;

    mmal_buffer_header_mem_lock(buffer);
    std::vector<uint8_t> nal(buffer->data, buffer->data + buffer->length);
    mmal_buffer_header_mem_unlock(buffer);

    // Add NAL to the queue
    std::lock_guard<std::mutex> lock(encoder->queue_mutex);
    encoder->nal_queue.push(nal);
    encoder->queue_cv.notify_one();

    mmal_buffer_header_release(buffer);
}
