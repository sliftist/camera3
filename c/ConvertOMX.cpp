#include <vector>
#include <IL/OMX_Core.h>
#include <IL/OMX_Component.h>
#include <iostream>
#include <cstring>

class MJPEGtoI420ConverterOMX {
public:
    MJPEGtoI420ConverterOMX(int width, int height);
    ~MJPEGtoI420ConverterOMX();

    std::vector<uint8_t> convert_frame(const std::vector<uint8_t>& mjpeg_buffer);

private:
    OMX_HANDLETYPE decoder;
    OMX_BUFFERHEADERTYPE *input_buffer;
    OMX_BUFFERHEADERTYPE *output_buffer;
    int width;
    int height;

    void init_omx();
    void cleanup_omx();
    void configure_decoder();
    void feed_input_buffer(const std::vector<uint8_t>& mjpeg_buffer);
    std::vector<uint8_t> retrieve_output_buffer();
};

// Constructor: Initialize OpenMAX IL (OMX) and configure the decoder
MJPEGtoI420ConverterOMX::MJPEGtoI420ConverterOMX(int width, int height)
    : width(width), height(height), decoder(nullptr), input_buffer(nullptr), output_buffer(nullptr) {
    init_omx();
    configure_decoder();
}

// Destructor: Clean up OMX resources
MJPEGtoI420ConverterOMX::~MJPEGtoI420ConverterOMX() {
    cleanup_omx();
}

// Initialize OMX
void MJPEGtoI420ConverterOMX::init_omx() {
    // Initialize OMX core
    OMX_Init();

    // Get the decoder component
    OMX_ERRORTYPE err = OMX_GetHandle(&decoder, (OMX_STRING)"OMX.broadcom.image_decode", nullptr, nullptr);
    if (err != OMX_ErrorNone) {
        std::cerr << "Failed to get handle for OMX.broadcom.image_decode" << std::endl;
        throw std::runtime_error("Failed to initialize OMX decoder");
    }
}

// Clean up OMX resources
void MJPEGtoI420ConverterOMX::cleanup_omx() {
    if (decoder) {
        OMX_FreeHandle(decoder);
    }
    OMX_Deinit();
}

// Configure the decoder for MJPEG to I420 conversion
void MJPEGtoI420ConverterOMX::configure_decoder() {
    // Configure the input port (JPEG format)
    OMX_PARAM_PORTDEFINITIONTYPE input_port_def;
    OMX_INIT_STRUCTURE(input_port_def);
    input_port_def.nPortIndex = 320; // Input port index for OMX.broadcom.image_decode
    OMX_GetParameter(decoder, OMX_IndexParamPortDefinition, &input_port_def);
    input_port_def.format.image.eCompressionFormat = OMX_IMAGE_CodingJPEG;
    input_port_def.format.image.nFrameWidth = width;
    input_port_def.format.image.nFrameHeight = height;
    OMX_SetParameter(decoder, OMX_IndexParamPortDefinition, &input_port_def);

    // Configure the output port (I420 format)
    OMX_PARAM_PORTDEFINITIONTYPE output_port_def;
    OMX_INIT_STRUCTURE(output_port_def);
    output_port_def.nPortIndex = 321; // Output port index for OMX.broadcom.image_decode
    OMX_GetParameter(decoder, OMX_IndexParamPortDefinition, &output_port_def);
    output_port_def.format.image.eColorFormat = OMX_COLOR_FormatYUV420PackedPlanar;
    output_port_def.format.image.nFrameWidth = width;
    output_port_def.format.image.nFrameHeight = height;
    OMX_SetParameter(decoder, OMX_IndexParamPortDefinition, &output_port_def);

    // Enable ports
    OMX_SendCommand(decoder, OMX_CommandPortEnable, 320, nullptr);
    OMX_SendCommand(decoder, OMX_CommandPortEnable, 321, nullptr);

    // Allocate input and output buffers
    OMX_AllocateBuffer(decoder, &input_buffer, 320, nullptr, input_port_def.nBufferSize);
    OMX_AllocateBuffer(decoder, &output_buffer, 321, nullptr, output_port_def.nBufferSize);
}

// Feed the MJPEG buffer to the decoder's input port
void MJPEGtoI420ConverterOMX::feed_input_buffer(const std::vector<uint8_t>& mjpeg_buffer) {
    // Copy the MJPEG buffer data to the input buffer
    std::memcpy(input_buffer->pBuffer, mjpeg_buffer.data(), mjpeg_buffer.size());
    input_buffer->nFilledLen = mjpeg_buffer.size();

    // Send the buffer to the input port
    OMX_EmptyThisBuffer(decoder, input_buffer);
}

// Retrieve the I420 frame from the output buffer
std::vector<uint8_t> MJPEGtoI420ConverterOMX::retrieve_output_buffer() {
    // Wait for the buffer to be filled with the decoded data
    OMX_FillThisBuffer(decoder, output_buffer);

    // Copy the output buffer data to a vector
    std::vector<uint8_t> i420_frame(output_buffer->nFilledLen);
    std::memcpy(i420_frame.data(), output_buffer->pBuffer, output_buffer->nFilledLen);

    return i420_frame;
}

// Convert MJPEG to I420 using OMX
std::vector<uint8_t> MJPEGtoI420ConverterOMX::convert_frame(const std::vector<uint8_t>& mjpeg_buffer) {
    feed_input_buffer(mjpeg_buffer);
    return retrieve_output_buffer();
}
