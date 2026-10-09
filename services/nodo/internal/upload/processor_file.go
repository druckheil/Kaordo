package upload

// Stages generic attachments without decoding or changing their bytes
import (
	"errors"
	"io"
	"os"
)

func (server *Server) processFile(source, id, filename string) (mediaInfo, string, error) {
	input, err := os.Open(source)
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer func() { _ = input.Close() }() // read-only source

	stat, err := input.Stat()
	if err != nil || stat.Size() < 1 || stat.Size() > maxUploadSize {
		return mediaInfo{}, "", errors.New("file exceeds its size limit")
	}

	output, err := stagedFilePath(server.config.Directory, id+".file-*")
	if err != nil {
		return mediaInfo{}, "", err
	}
	if err := linkOrCopy(source, output, input); err != nil {
		return mediaInfo{}, "", err
	}
	return mediaInfo{
		Kind:     "file",
		MimeType: "application/octet-stream",
		Filename: filename,
		Size:     stat.Size(),
	}, output, nil
}

func stagedFilePath(directory, pattern string) (string, error) {
	file, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return "", err
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	if err := os.Remove(path); err != nil {
		return "", err
	}
	return path, nil
}

func linkOrCopy(source, destination string, input io.Reader) error {
	if err := os.Link(source, destination); err == nil {
		return nil
	}

	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		return closeErr
	}
	return nil
}
