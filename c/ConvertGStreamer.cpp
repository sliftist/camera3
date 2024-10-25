#include <gst/gst.h>
#include <iostream>
#include <vector>

class MJPEGtoI420ConverterGStreamer {
public:
    MJPEGtoI420ConverterGStreamer(int width, int height);
    ~MJPEGtoI420ConverterGStreamer();
    std::vector<uint8_t> convert_frame(const std::string &mjpeg_file);

private:
    GstElement *pipeline;
    GMainLoop *loop;
};

// Constructor: Initialize GStreamer
MJPEGtoI420ConverterGStreamer::MJPEGtoI420ConverterGStreamer(int width, int height) {
    gst_init(nullptr, nullptr);
    loop = g_main_loop_new(nullptr, FALSE);

    // Create GStreamer pipeline
    std::string pipeline_str = "filesrc location=" + std::string(mjpeg_file) +
                               " ! jpegdec ! videoconvert ! video/x-raw,format=I420,width=" +
                               std::to_string(width) + ",height=" + std::to_string(height) +
                               " ! fakesink";
    pipeline = gst_parse_launch(pipeline_str.c_str(), nullptr);
    if (!pipeline) {
        throw std::runtime_error("Failed to create GStreamer pipeline");
    }
}

// Destructor: Free GStreamer resources
MJPEGtoI420ConverterGStreamer::~MJPEGtoI420ConverterGStreamer() {
    if (pipeline) {
        gst_object_unref(GST_OBJECT(pipeline));
    }
    if (loop) {
        g_main_loop_unref(loop);
    }
}

// Convert an MJPEG frame to I420
std::vector<uint8_t> MJPEGtoI420ConverterGStreamer::convert_frame(const std::string &mjpeg_file) {
    // Start playing the pipeline
    gst_element_set_state(pipeline, GST_STATE_PLAYING);
    
    // Wait until processing is done
    g_main_loop_run(loop);

    // Extract the output frame (not implemented in this minimal example)
    std::vector<uint8_t> i420_frame;
    return i420_frame;
}