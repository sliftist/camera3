#include <libcamera/libcamera.h>
#include <iostream>
#include <vector>
#include <memory>

class MJPEGtoI420ConverterLibcamera {
public:
    MJPEGtoI420ConverterLibcamera(int width, int height);
    ~MJPEGtoI420ConverterLibcamera();

    std::vector<uint8_t> convert_frame(const std::vector<uint8_t>& mjpeg_buffer);

private:
    std::shared_ptr<libcamera::CameraManager> camera_manager;
    std::shared_ptr<libcamera::Camera> camera;
    std::unique_ptr<libcamera::CameraConfiguration> camera_config;
    int width;
    int height;

    void init_camera();
    void cleanup_camera();
};

// Constructor: Initialize libcamera
MJPEGtoI420ConverterLibcamera::MJPEGtoI420ConverterLibcamera(int width, int height)
    : width(width), height(height) {
    init_camera();
}

// Destructor: Clean up libcamera resources
MJPEGtoI420ConverterLibcamera::~MJPEGtoI420ConverterLibcamera() {
    cleanup_camera();
}

void MJPEGtoI420ConverterLibcamera::init_camera() {
    camera_manager = std::make_shared<libcamera::CameraManager>();
    camera_manager->start();

    // Open the first available camera
    if (camera_manager->cameras().empty()) {
        throw std::runtime_error("No cameras found");
    }
    camera = camera_manager->get(camera_manager->cameras()[0]->id());

    if (!camera) {
        throw std::runtime_error("Failed to open camera");
    }

    // **Acquire the camera** before configuration
    if (camera->acquire()) {
        throw std::runtime_error("Failed to acquire camera");
    }

    // Configure the camera (e.g., set the resolution)
    camera_config = camera->generateConfiguration({libcamera::StreamRole::VideoRecording});
    libcamera::StreamConfiguration &config = camera_config->at(0);

    config.size.width = width;
    config.size.height = height;
    config.pixelFormat = libcamera::formats::MJPEG;

    // Apply the configuration
    if (camera->configure(camera_config.get()) != 0) {
        throw std::runtime_error("Failed to configure camera");
    }

    // Start the camera
    camera->start();
}


// Convert MJPEG frame buffer to I420 (dummy implementation for now)
std::vector<uint8_t> MJPEGtoI420ConverterLibcamera::convert_frame(const std::vector<uint8_t>& mjpeg_buffer) {
    // You would implement MJPEG to I420 conversion logic here, likely using libjpeg or libcamera for the actual conversion
    std::vector<uint8_t> i420_frame(width * height * 3 / 2);  // Placeholder for I420 frame size
    // Actual conversion from MJPEG to I420 should happen here

    // For now, return an empty frame until the conversion logic is added
    return i420_frame;
}

// Clean up the camera resources
void MJPEGtoI420ConverterLibcamera::cleanup_camera() {
    if (camera) {
        camera->stop();
        camera.reset();
    }
    if (camera_manager) {
        camera_manager->stop();
        camera_manager.reset();
    }
}
