package upload

// Validates image inputs, decodes them, and writes normalized display images
import (
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"os"

	_ "golang.org/x/image/webp" // registers the WebP decoder used by decodeImage
)

func (server *Server) processImage(id, declaredType string) (mediaInfo, string, error) {
	input, err := server.root.Open(id)
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer func() { _ = input.Close() }() // read-only source

	picture, config, format, err := decodeImage(input, declaredType)
	if err != nil {
		return mediaInfo{}, "", err
	}

	output, name, err := createTemp(server.root, id+".image-")
	if err != nil {
		return mediaInfo{}, "", err
	}
	keepOutput := false
	defer func() {
		_ = output.Close()
		if !keepOutput {
			_ = server.root.Remove(name)
		}
	}()

	if err := encodeImage(output, picture, format); err != nil {
		return mediaInfo{}, "", err
	}
	stat, err := output.Stat()
	if err != nil {
		return mediaInfo{}, "", err
	}
	if err := output.Close(); err != nil {
		return mediaInfo{}, "", err
	}

	item, err := imageMetadata(stat.Size(), config, format)
	if err != nil {
		return mediaInfo{}, "", err
	}
	keepOutput = true
	return item, name, nil
}

func decodeImage(input *os.File, declaredType string) (image.Image, image.Config, string, error) {
	config, format, err := image.DecodeConfig(input)
	if err != nil || !supportedImageFormat(format) || !supportedImageType(declaredType) {
		return nil, image.Config{}, "", errors.New("image format does not match its declared type")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 ||
		int64(config.Width)*int64(config.Height) > 16_000_000 {
		return nil, image.Config{}, "", errors.New("image dimensions exceed the limit")
	}
	if _, err := input.Seek(0, 0); err != nil {
		return nil, image.Config{}, "", err
	}

	picture, _, err := image.Decode(input)
	if err != nil {
		return nil, image.Config{}, "", err
	}
	return picture, config, format, nil
}

func supportedImageFormat(format string) bool {
	switch format {
	case "jpeg", "png", "webp":
		return true
	default:
		return false
	}
}

func supportedImageType(mimeType string) bool {
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func encodeImage(output *os.File, picture image.Image, sourceFormat string) error {
	if sourceFormat == "jpeg" {
		return jpeg.Encode(output, picture, &jpeg.Options{Quality: 85})
	}
	return (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(output, picture)
}

func imageMetadata(size int64, config image.Config, format string) (mediaInfo, error) {
	if size < 1 || size > 25*1024*1024 {
		return mediaInfo{}, errors.New("processed image exceeds its size limit")
	}

	mimeType := "image/png"
	if format == "jpeg" {
		mimeType = "image/jpeg"
	}
	return mediaInfo{
		Kind:     "image",
		MimeType: mimeType,
		Width:    config.Width,
		Height:   config.Height,
		Size:     size,
	}, nil
}
