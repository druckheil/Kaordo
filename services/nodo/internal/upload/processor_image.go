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

func (server *Server) processImage(source, id, declaredType string) (mediaInfo, string, error) {
	input, err := os.Open(source)
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer func() { _ = input.Close() }() // read-only source

	picture, config, format, err := decodeImage(input, declaredType)
	if err != nil {
		return mediaInfo{}, "", err
	}

	output, err := os.CreateTemp(server.config.Directory, id+".image-*")
	if err != nil {
		return mediaInfo{}, "", err
	}
	path := output.Name()
	keepOutput := false
	defer func() {
		_ = output.Close()
		if !keepOutput {
			_ = os.Remove(path)
		}
	}()

	if err := encodeImage(output, picture, format); err != nil {
		return mediaInfo{}, "", err
	}
	if err := output.Close(); err != nil {
		return mediaInfo{}, "", err
	}

	item, err := imageMetadata(path, config, format)
	if err != nil {
		return mediaInfo{}, "", err
	}
	keepOutput = true
	return item, path, nil
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

func imageMetadata(path string, config image.Config, format string) (mediaInfo, error) {
	stat, err := os.Stat(path)
	if err != nil || stat.Size() < 1 || stat.Size() > 25*1024*1024 {
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
		Size:     stat.Size(),
	}, nil
}
