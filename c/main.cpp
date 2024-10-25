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

#include "CameraFrameCapture.cpp"
//#include "ConvertCPU.cpp"
#include "ConvertMMAL.cpp"
//#include "H264Encoder.cpp"
//#include "ConvertLibCamera.cpp"
//#include "ConvertOMX.cpp"
//#include "ConvertGStreamer.cpp"

// https://github.com/6by9/mmal_encode_example/blob/master/example_basic_1.c
// https://github.com/raspberrypi/raspiraw/blob/master/raspiraw.c

int main() {
    try {
        int width = 1920;
        int height = 1080;
        int fps = 30;

        width = 1280;
        height = 960;
        fps = 5;

        USBCamera camera("/dev/video0", width, height, fps, V4L2_PIX_FMT_MJPEG);
        //USBCamera camera("/dev/video0", width, height, 5, V4L2_PIX_FMT_YUYV);

        //MJPEGtoI420Converter converter;
        MJPEGtoI420ConverterMMAL converter(width, height);
         
        std::cout << "Camera opened successfully" << std::endl;
        camera.start();

        // std::vector<uint8_t> get_frame();  // Retrieve the latest frame
        // 

        auto last_time = std::chrono::high_resolution_clock::now();

        while (true) {
            std::vector<uint8_t> frame = camera.get_frame();  // Get the latest frame
            
            auto current_time = std::chrono::high_resolution_clock::now();
            double elapsed_seconds = std::chrono::duration<double>(current_time - last_time).count();
            last_time = current_time;

            std::cout << "Captured frame of size: " << frame.size() << " bytes " << (elapsed_seconds * 1000) << " ms" << std::endl;

            {
                auto start = std::chrono::high_resolution_clock::now();
                auto converted = converter.convert_frame(frame);
                std::cout << "Converted frame of size: " << converted.size() << " bytes" << std::endl;
                auto end = std::chrono::high_resolution_clock::now();
                std::cout << "Conversion time: " << std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count() << " ms" << std::endl;
            }

        }
    } catch (const std::exception &ex) {
        std::cerr << "Error: " << ex.what() << std::endl;
        return 1;
    }

    return 0;
}
