#include <iostream>
#include <vector>
#include <mmal.h>
#include <mmal_logging.h>
#include <mmal_util.h>
#include <mmal_util_params.h>
#include <mmal_parameters_video.h>
#include <bcm_host.h>


#define CHECK_STATUS(status, msg) \
    if (status != MMAL_SUCCESS) { \
        throw std::runtime_error(std::string(msg) + ": " + mmal_status_to_string(status)); \
    }

class MJPEGtoI420ConverterMMAL {
public:
    MJPEGtoI420ConverterMMAL(int width, int height);
    ~MJPEGtoI420ConverterMMAL();

    // Convert MJPEG frame buffer to I420
    std::vector<uint8_t> convert_frame(const std::vector<uint8_t>& mjpeg_buffer);

private:
    MMAL_COMPONENT_T *decoder;
    MMAL_POOL_T *input_pool;
    MMAL_POOL_T *output_pool;
    MMAL_QUEUE_T *queue;
    int width;
    int height;

    void init_mmal();
    void cleanup_mmal();
    static void input_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer);
    static void output_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer);
    static void control_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer);  // Event callback for the control port
};

MJPEGtoI420ConverterMMAL::MJPEGtoI420ConverterMMAL(int width, int height)
    : width(width), height(height), decoder(nullptr), input_pool(nullptr), output_pool(nullptr), queue(nullptr) {
    bcm_host_init();
    init_mmal();
}

MJPEGtoI420ConverterMMAL::~MJPEGtoI420ConverterMMAL() {
    cleanup_mmal();
}

void MJPEGtoI420ConverterMMAL::init_mmal() {
    MMAL_STATUS_T status;

    // Create MJPEG decoder component
    status = mmal_component_create("vc.ril.image_decode", &decoder);
    CHECK_STATUS(status, "Failed to create MJPEG decoder component");

    // Register the control port event callback
    decoder->control->userdata = (struct MMAL_PORT_USERDATA_T *)this;
    status = mmal_port_enable(decoder->control, control_callback);
    CHECK_STATUS(status, "Failed to enable control port");

    // mmal_port_parameter_set_boolean(decoder->output[0], MMAL_PARAMETER_ZERO_COPY, MMAL_TRUE);
    //status = mmal_port_parameter_set_boolean(decoder->output[0], MMAL_PARAMETER_ZERO_COPY, MMAL_TRUE);
    //CHECK_STATUS(status, "Failed to set immutable input");

    // Do we have to set camera control?
    /*
        MMAL_PARAMETER_CAMERA_CONFIG_T cam_config = {{MMAL_PARAMETER_CAMERA_CONFIG,sizeof(cam_config)},
        .max_stills_w =      width,
        .max_stills_h =      height,
        .stills_yuv422 =     0,
        .one_shot_stills =   0,
        .max_preview_video_w = width,
        .max_preview_video_h = height,
        .num_preview_video_frames = 3,
        .stills_capture_circular_buffer_height = 0,
        .fast_preview_resume = 0,
        .use_stc_timestamp = MMAL_PARAM_TIMESTAMP_MODE_RESET_STC
        };

      mmal_port_parameter_set(camera->control, &cam_config.hdr);
    */

    MMAL_PORT_T *input_port = decoder->input[0];
    MMAL_PORT_T *output_port = decoder->output[0];

    // Configure input port for MJPEG
    MMAL_ES_FORMAT_T *input_format = input_port->format;
    // input_format->type = MMAL_ES_TYPE_VIDEO;
    // I assume MJPEG allows you to writes parts of JPEGs and it will figure it out. BUT,
    //  for single JPEGs, it seems to block (maybe it is waiting for another image?)
    // input_format->encoding = MMAL_ENCODING_MJPEG;
    input_format->type = MMAL_ES_TYPE_VIDEO;
    input_format->encoding = MMAL_ENCODING_JPEG;
    input_format->es->video.width = 0;
    input_format->es->video.height = 0;
    // input_format->es->video.crop.width = 0;
    // input_format->es->video.crop.height = 0;
    input_format->es->video.frame_rate.num = 0;
    input_format->es->video.frame_rate.den = 1;
    input_format->es->video.par.num = 1;
    input_format->es->video.par.den = 1;

    status = mmal_port_format_commit(input_port);
    CHECK_STATUS(status, "Failed to configure input port");

    // Configure output port for I420 (YUV420)
    MMAL_ES_FORMAT_T *output_format = output_port->format;
    output_format->encoding = MMAL_ENCODING_I420;
    output_format->es->video.width = width;
    output_format->es->video.height = height;

    // If we don't set the crop the first thing we get is a MMAL_EVENT_FORMAT_CHANGED
    output_format->es->video.crop.width = width;
    output_format->es->video.crop.height = height;

    // if(output_port->format != output_port->priv->core->format_ptr_copy) {
    //     std::cout << "output_port->format != output_port->priv->core->format_ptr_copy" << std::endl;
    // }
    std::cout << "output_port->format->es->video.width: " << output_port->format->es->video.width << std::endl;
    std::cout << "output_port->format->es->video.height: " << output_port->format->es->video.height << std::endl;
    //std::cout << "private width: " << output_port->priv->core->format_ptr_copy->es->video.width << std::endl;

    status = mmal_port_format_commit(output_port);
    CHECK_STATUS(status, "Failed to configure output port");

    std::cout << "output_port->format->encoding: " << output_port->format->encoding << std::endl;
    std::cout << "bitrate: " << output_port->format->bitrate << std::endl;
    
    std::cout << "output_port->format->es->video.width: " << output_port->format->es->video.width << std::endl;
    std::cout << "output_port->format->es->video.height: " << output_port->format->es->video.height << std::endl;
    std::cout << "output_port->format->es->video.crop.width: " << output_port->format->es->video.crop.width << std::endl;
    std::cout << "output_port->format->es->video.crop.height: " << output_port->format->es->video.crop.height << std::endl;
    std::cout << "output_port->format->es->video.crop.x: " << output_port->format->es->video.crop.x << std::endl;
    std::cout << "output_port->format->es->video.crop.y: " << output_port->format->es->video.crop.y << std::endl;

    // Configure buffer numbers and sizes
    input_port->buffer_num = input_port->buffer_num_recommended;
    // NOTE: The recommended buffer sizes seem to be too small for MJPEG, and result in errors.
    input_port->buffer_size = 1920 * 1080 * 4;
    output_port->buffer_num = 3;
    output_port->buffer_size = 1920 * 1080 * 4;
    std::cout << "input_port->buffer_num: " << input_port->buffer_num << std::endl;
    std::cout << "input_port->buffer_size: " << input_port->buffer_size << std::endl;
    std::cout << "output_port->buffer_num: " << output_port->buffer_num << std::endl;
    std::cout << "output_port->buffer_size: " << output_port->buffer_size << std::endl;

    // Create input and output buffer pools
    input_pool = mmal_port_pool_create(input_port, input_port->buffer_num, input_port->buffer_size);
    if (!input_pool) throw std::runtime_error("Failed to create input buffer pool");

    output_pool = mmal_port_pool_create(output_port, output_port->buffer_num, output_port->buffer_size);
    if (!output_pool) throw std::runtime_error("Failed to create output buffer pool");

    // Create a queue for decoded frames
    queue = mmal_queue_create();
    if (!queue) throw std::runtime_error("Failed to create queue");

    // Store queue in user data for callback access
    input_port->userdata = (struct MMAL_PORT_USERDATA_T *)this;
    output_port->userdata = (struct MMAL_PORT_USERDATA_T *)this;

    // Enable input and output ports with their respective callbacks
    status = mmal_port_enable(input_port, input_callback);
    CHECK_STATUS(status, "Failed to enable input port");

    status = mmal_port_enable(output_port, output_callback);
    CHECK_STATUS(status, "Failed to enable output port");

    // Pre-fill output port with buffers from the output pool
    MMAL_BUFFER_HEADER_T *output_buffer;
    while ((output_buffer = mmal_queue_get(output_pool->queue)) != nullptr) {
        status = mmal_port_send_buffer(output_port, output_buffer);
        CHECK_STATUS(status, "Failed to pre-fill output buffer pool");
    }

    // Enable the MJPEG decoder component
    status = mmal_component_enable(decoder);
    CHECK_STATUS(status, "Failed to enable decoder component");
}

void MJPEGtoI420ConverterMMAL::cleanup_mmal() {
    if (output_pool) mmal_port_pool_destroy(decoder->output[0], output_pool);
    if (input_pool) mmal_port_pool_destroy(decoder->input[0], input_pool);
    if (queue) mmal_queue_destroy(queue);
    if (decoder) {
        mmal_component_disable(decoder);
        mmal_component_destroy(decoder);
    }
}

// Control port callback function for handling events
void MJPEGtoI420ConverterMMAL::control_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer) {
    if (buffer->cmd == MMAL_EVENT_ERROR) {
        // Extract and log the specific error code from the buffer's data
        MMAL_STATUS_T error_status = *(MMAL_STATUS_T *)buffer->data;
        std::cerr << "MMAL Error Event Received. Error code: " 
                  << mmal_status_to_string(error_status) << " (" << error_status << ")" << std::endl;
    }
    mmal_buffer_header_release(buffer);
}


// Input buffer callback function
void MJPEGtoI420ConverterMMAL::input_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer) {
    if(buffer->cmd) {
        std::cout << "input_callback cmd" << std::endl;
    }
    if (buffer->cmd == MMAL_EVENT_ERROR) {
        // Extract and log the specific error code from the buffer's data
        MMAL_STATUS_T error_status = *(MMAL_STATUS_T *)buffer->data;
        std::cerr << "MMAL Error Event Received. Error code: " 
                  << mmal_status_to_string(error_status) << " (" << error_status << ")" << std::endl;
    }
    std::cout << "input_callback " << buffer->length << std::endl;

    mmal_buffer_header_release(buffer);
}

// Output buffer callback function
void MJPEGtoI420ConverterMMAL::output_callback(MMAL_PORT_T *port, MMAL_BUFFER_HEADER_T *buffer) {
    if (buffer->cmd == MMAL_EVENT_ERROR) {
        // Extract and log the specific error code from the buffer's data
        MMAL_STATUS_T error_status = *(MMAL_STATUS_T *)buffer->data;
        std::cerr << "MMAL Error Event Received. Error code: " 
                  << mmal_status_to_string(error_status) << " (" << error_status << ")" << std::endl;
    }

    std::cout << "output_callback " << buffer->length << std::endl;
    // // Log bytes
    // for (int i = 0; i < buffer->length; i++) {
    //     auto val = (int)buffer->data[i];
    //     // If it's a char, log it
    //     if (val >= 32 && val <= 126) {
    //         std::cout << (char)val;
    //     } else {
    //         std::cout << val << " ";
    //     }
    // }
    // std::cout << std::endl;

    mmal_buffer_header_release(buffer);
    MMAL_QUEUE_T *queue = ((MJPEGtoI420ConverterMMAL *)port->userdata)->queue;
    mmal_queue_put(queue, buffer);
}

// Convert MJPEG to I420 using MMAL hardware acceleration
std::vector<uint8_t> MJPEGtoI420ConverterMMAL::convert_frame(const std::vector<uint8_t>& mjpeg_buffer) {
    MMAL_STATUS_T status;

    MMAL_PORT_T *input_port = decoder->input[0];
    MMAL_PORT_T *output_port = decoder->output[0];

    // Get input buffer from input pool
    MMAL_BUFFER_HEADER_T *input_buffer = mmal_queue_get(input_pool->queue);
    if (!input_buffer) throw std::runtime_error("Failed to get input buffer from pool");

    // Copy MJPEG data to input buffer
    mmal_buffer_header_mem_lock(input_buffer);
    memcpy(input_buffer->data, mjpeg_buffer.data(), mjpeg_buffer.size());
    std::cout << "mjpeg_buffer.size(): " << mjpeg_buffer.size() << std::endl;

    input_buffer->length = mjpeg_buffer.size();
    input_buffer->offset = 0;
    input_buffer->flags = 0;
    input_buffer->pts = input_buffer->dts = MMAL_TIME_UNKNOWN;

    std::cout << "input_buffer->length: " << input_buffer->length << std::endl;
    // Send buffer to input port
    status = mmal_port_send_buffer(input_port, input_buffer);
    CHECK_STATUS(status, "Failed to send buffer to input port");
    std::cout << "sent buffer to input port" << std::endl;


    // Wait for output buffer from the output port
    MMAL_BUFFER_HEADER_T *output_buffer = mmal_queue_wait(queue);
    if (!output_buffer) throw std::runtime_error("Failed to retrieve output buffer");
    std::cout << "output_buffer->length == " << output_buffer->length << std::endl;
    std::cout << "extra buffers " << mmal_queue_length(queue) << std::endl;

    if (output_buffer->cmd) {
        std::cout << "output_buffer->cmd == " << std::endl;
        if (output_buffer->cmd == MMAL_EVENT_FORMAT_CHANGED) {
            std::cout << "output_buffer->cmd == MMAL_EVENT_FORMAT_CHANGED" << std::endl;
            MMAL_EVENT_FORMAT_CHANGED_T *event = mmal_event_format_changed_get(output_buffer);
            if(event) {
                auto newformat = event->format;
                std::cout << "newformat->es->video.width: " << newformat->es->video.width << std::endl;
            }
        }
    }
    

    // Copy decoded I420 data from output buffer
    std::vector<uint8_t> i420_frame(output_buffer->length);
    mmal_buffer_header_mem_lock(output_buffer);
    memcpy(i420_frame.data(), output_buffer->data, output_buffer->length);
    mmal_buffer_header_mem_unlock(output_buffer);

    // Release the output buffer back to the pool
    mmal_buffer_header_release(output_buffer);

    return i420_frame;
}
