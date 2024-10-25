#include <iostream>
#include <vector>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/videodev2.h>
#include <cerrno>
#include <cstring>
#include <cstdlib>
#include <sys/mman.h>

class USBCamera {
public:
    USBCamera(const std::string& device, int width, int height, int fps, int pixel_format);
    ~USBCamera();

    void start();  // Start capturing frames
    std::vector<uint8_t> get_frame();  // Retrieve the latest frame

private:
    std::string device;    // Path to the video device (e.g., /dev/video0)
    int width;             // Frame width
    int height;            // Frame height
    int fps;               // Frames per second
    int fd;                // File descriptor for the camera device
    void** buffer_start;   // Array of pointers for the memory-mapped buffers
    int buffer_count;      // Number of requested buffers
    int pixel_format;

    void init_device();   // Initialize the V4L2 device
    void close_device();  // Close the device
};

// Constructor
USBCamera::USBCamera(const std::string& device, int width, int height, int fps, int pixel_format)
    : device(device), width(width), height(height), fps(fps), pixel_format(pixel_format), fd(-1), buffer_start(nullptr), buffer_count(0) {
    init_device();
}

// Destructor
USBCamera::~USBCamera() {
    close_device();
}


// **Diagnostic Check: Ensure the device supports video capture**
void check_device_capabilities(int fd) {
    struct v4l2_capability cap;
    if (ioctl(fd, VIDIOC_QUERYCAP, &cap) == -1) {
        throw std::runtime_error("Failed to query device capabilities: " + std::string(strerror(errno)));
    }

    if (!(cap.capabilities & V4L2_CAP_VIDEO_CAPTURE)) {
        throw std::runtime_error("Device does not support video capture");
    }

    std::cout << "Device capabilities: " << cap.driver << " (" << cap.card << ")" << std::endl;

    // Optional: Check current format
    struct v4l2_format fmt;
    memset(&fmt, 0, sizeof(fmt));
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(fd, VIDIOC_G_FMT, &fmt) == -1) {
        throw std::runtime_error("Failed to get current video format: " + std::string(strerror(errno)));
    }

    std::cout << "Current format: " << fmt.fmt.pix.width << "x" << fmt.fmt.pix.height << " - Pixel format: " << fmt.fmt.pix.pixelformat << std::endl;
}


// Function to print available frame rates for each resolution
void print_frame_rates(int fd, __u32 pixelformat, __u32 width, __u32 height) {
    struct v4l2_frmivalenum frame_interval;
    memset(&frame_interval, 0, sizeof(frame_interval));
    frame_interval.pixel_format = pixelformat;
    frame_interval.width = width;
    frame_interval.height = height;

    std::cout << "    Supported frame rates for " << width << "x" << height << ":" << std::endl;
    while (ioctl(fd, VIDIOC_ENUM_FRAMEINTERVALS, &frame_interval) == 0) {
        if (frame_interval.type == V4L2_FRMIVAL_TYPE_DISCRETE) {
            std::cout << "      " << frame_interval.discrete.denominator << "/" << frame_interval.discrete.numerator << " fps" << std::endl;
        }
        frame_interval.index++;
    }
}

// Function to print available resolutions for each format
void print_resolutions(int fd, __u32 pixelformat) {
    struct v4l2_frmsizeenum frame_size;
    memset(&frame_size, 0, sizeof(frame_size));
    frame_size.pixel_format = pixelformat;

    std::cout << "  Supported resolutions:" << std::endl;
    while (ioctl(fd, VIDIOC_ENUM_FRAMESIZES, &frame_size) == 0) {
        if (frame_size.type == V4L2_FRMSIZE_TYPE_DISCRETE) {
            std::cout << "    " << frame_size.discrete.width << "x" << frame_size.discrete.height << std::endl;
            // Now print the frame rates for this resolution
            print_frame_rates(fd, pixelformat, frame_size.discrete.width, frame_size.discrete.height);
        }
        frame_size.index++;
    }
}

// Function to print available formats, resolutions, and frame rates
void print_available_formats(int fd) {
    struct v4l2_fmtdesc fmt_desc;
    memset(&fmt_desc, 0, sizeof(fmt_desc));
    fmt_desc.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;

    std::cout << "Available formats:" << std::endl;
    while (ioctl(fd, VIDIOC_ENUM_FMT, &fmt_desc) == 0) {
        std::cout << "  " << fmt_desc.description << " (" << fmt_desc.pixelformat << ")" << std::endl;
        // For each format, print the supported resolutions
        print_resolutions(fd, fmt_desc.pixelformat);
        fmt_desc.index++;
    }
}

// Start capturing frames
void USBCamera::start() {
    // No need for a capture thread; just set the device to streaming mode.
    enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(fd, VIDIOC_STREAMON, &type) == -1) {
        throw std::runtime_error("Failed to start video capture: " + std::string(strerror(errno)));
    }
    // print_available_formats(fd);
    // check_device_capabilities(fd);
}

// Retrieve the latest frame
std::vector<uint8_t> USBCamera::get_frame() {
    struct v4l2_buffer buf;
    memset(&buf, 0, sizeof(buf));
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;

    // Dequeue a buffer (blocks until a frame is available)
    if (ioctl(fd, VIDIOC_DQBUF, &buf) == -1) {
        throw std::runtime_error("Failed to dequeue buffer: " + std::string(strerror(errno)));
    }
    
    // Use the memory-mapped buffer pointer instead of buf.m.userptr
    std::vector<uint8_t> frame_data(buf.bytesused);
    memcpy(frame_data.data(), buffer_start[buf.index], buf.bytesused);  // Use buffer_start[buf.index]

    // Requeue the buffer so it can be used again
    if (ioctl(fd, VIDIOC_QBUF, &buf) == -1) {
        throw std::runtime_error("Failed to queue buffer: " + std::string(strerror(errno)));
    }
    
    return frame_data;  // Return the captured frame data
}


// Initialize the V4L2 device
void USBCamera::init_device() {
    // Open the video device
    fd = open(device.c_str(), O_RDWR);
    if (fd == -1) {
        throw std::runtime_error("Failed to open video device: " + std::string(strerror(errno)));
    }

    // Set the format for the camera (MJPEG format)
    struct v4l2_format fmt;
    memset(&fmt, 0, sizeof(fmt));
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = width;
    fmt.fmt.pix.height = height;
    fmt.fmt.pix.pixelformat = pixel_format;  // Use MJPEG format
    fmt.fmt.pix.field = V4L2_FIELD_NONE;

    if (ioctl(fd, VIDIOC_S_FMT, &fmt) == -1) {
        throw std::runtime_error("Failed to set video format: " + std::string(strerror(errno)));
    }

    // Request 4 buffers for memory mapping
    struct v4l2_requestbuffers req;
    memset(&req, 0, sizeof(req));
    req.count = 4;  // Request 4 buffers
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;

    if (ioctl(fd, VIDIOC_REQBUFS, &req) == -1) {
        throw std::runtime_error("Failed to request buffers: " + std::string(strerror(errno)));
    }

    buffer_count = req.count;
    buffer_start = new void*[buffer_count];  // Store pointers for each buffer

    // Queue the buffers for memory mapping (initial queue)
    for (int i = 0; i < req.count; i++) {
        struct v4l2_buffer buf;
        memset(&buf, 0, sizeof(buf));
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = i;

        if (ioctl(fd, VIDIOC_QUERYBUF, &buf) == -1) {
            throw std::runtime_error("Failed to query buffer: " + std::string(strerror(errno)));
        }

        // Memory-map the buffers
        buffer_start[i] = mmap(NULL, buf.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, buf.m.offset);
        if (buffer_start[i] == MAP_FAILED) {
            throw std::runtime_error("Failed to mmap buffer: " + std::string(strerror(errno)));
        }

        // Queue the buffer
        if (ioctl(fd, VIDIOC_QBUF, &buf) == -1) {
            throw std::runtime_error("Failed to queue buffer: " + std::string(strerror(errno)));
        }
    }
}

// Close the device
void USBCamera::close_device() {
    if (fd != -1) {
        for (int i = 0; i < buffer_count; i++) {
            if (buffer_start[i]) {
                munmap(buffer_start[i], sizeof(buffer_start[i]));
            }
        }
        delete[] buffer_start;
        close(fd);
    }
}
