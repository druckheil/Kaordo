package upload

// Stages generic and device-encrypted attachments without decoding or changing their bytes
import (
	"crypto/rand"
	"errors"
	"io"
	"os"
)

func (server *Server) processFile(id, filename string) (mediaInfo, string, error) {
	input, err := server.root.Open(id)
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer func() { _ = input.Close() }() // read-only source

	stat, err := input.Stat()
	if err != nil || stat.Size() < 1 || stat.Size() > maxUploadSize {
		return mediaInfo{}, "", errors.New("file exceeds its size limit")
	}

	output := id + ".file-" + rand.Text()
	if err := server.linkOrCopy(id, output, input); err != nil {
		return mediaInfo{}, "", err
	}
	return mediaInfo{
		Kind:     "file",
		MimeType: "application/octet-stream",
		Filename: filename,
		Size:     stat.Size(),
	}, output, nil
}

// linkOrCopy shares the upload's bytes with its display artifact when the filesystem allows it
func (server *Server) linkOrCopy(source, destination string, input io.Reader) error {
	if err := server.root.Link(source, destination); err == nil {
		return nil
	}

	output, err := server.root.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if err := errors.Join(copyErr, closeErr); err != nil {
		_ = server.root.Remove(destination)
		return err
	}
	return nil
}
