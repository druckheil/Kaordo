package upload

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

type mediaInfo struct {
	Kind     string `json:"kind"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Size     int64  `json:"size"`
}

func (server *Server) displayPath(id string) string {
	return filepath.Join(server.config.Directory, id+".display")
}
func (server *Server) readyPath(id string) string {
	return filepath.Join(server.config.Directory, id+".ready.json")
}
func (server *Server) errorPath(id string) string {
	return filepath.Join(server.config.Directory, id+".error")
}

func (server *Server) readReady(id string) (mediaInfo, error) {
	data, err := os.ReadFile(server.readyPath(id))
	if err != nil {
		return mediaInfo{}, err
	}
	var item mediaInfo
	if err := json.Unmarshal(data, &item); err != nil {
		return mediaInfo{}, err
	}
	if item.Size < 1 || item.Size > maxUploadSize || item.Width < 1 || item.Width > 8192 ||
		item.Height < 1 || item.Height > 8192 {
		return mediaInfo{}, errors.New("invalid processed media metadata")
	}
	return item, nil
}

func (server *Server) process(id string) error {
	if !validUploadID(id) {
		return errors.New("invalid upload ID")
	}
	if _, err := server.readReady(id); err == nil {
		return nil
	}
	info, err := server.ownerOf(context.Background(), id)
	if err != nil {
		return err
	}
	if info.Size < 1 || info.Size > maxUploadSize || info.Offset != info.Size {
		return errors.New("upload has not finished")
	}
	source := filepath.Join(server.config.Directory, id)
	var item mediaInfo
	var output string
	switch info.MetaData["filetype"] {
	case "image/jpeg", "image/png":
		item, output, err = server.processImage(source, id, info.MetaData["filetype"])
	case "video/mp4", "video/webm", "video/quicktime":
		item, output, err = server.processVideo(source, id)
	default:
		err = errors.New("unsupported media type")
	}
	if err != nil {
		return err
	}
	defer os.Remove(output)
	if err := os.Rename(output, server.displayPath(id)); err != nil {
		return err
	}
	data, err := json.Marshal(item)
	if err != nil {
		return err
	}
	ready, err := os.CreateTemp(server.config.Directory, id+".ready-*")
	if err != nil {
		return err
	}
	defer os.Remove(ready.Name())
	if _, err := ready.Write(data); err != nil {
		ready.Close()
		return err
	}
	if err := ready.Close(); err != nil {
		return err
	}
	if err := os.Rename(ready.Name(), server.readyPath(id)); err != nil {
		return err
	}
	_ = os.Remove(server.errorPath(id))
	return nil
}

func (server *Server) processImage(source, id, declaredType string) (mediaInfo, string, error) {
	file, err := os.Open(source)
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer file.Close()
	config, format, err := image.DecodeConfig(file)
	if err != nil || (format != "jpeg" && format != "png") ||
		(format == "jpeg" && declaredType != "image/jpeg") ||
		(format == "png" && declaredType != "image/png") {
		return mediaInfo{}, "", errors.New("image format does not match its declared type")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 ||
		int64(config.Width)*int64(config.Height) > 16_000_000 {
		return mediaInfo{}, "", errors.New("image dimensions exceed the limit")
	}
	if _, err := file.Seek(0, 0); err != nil {
		return mediaInfo{}, "", err
	}
	picture, _, err := image.Decode(file)
	if err != nil {
		return mediaInfo{}, "", err
	}
	output, err := os.CreateTemp(server.config.Directory, id+".image-*")
	if err != nil {
		return mediaInfo{}, "", err
	}
	defer output.Close()
	defer func() {
		if err != nil {
			_ = os.Remove(output.Name())
		}
	}()
	if format == "jpeg" {
		err = jpeg.Encode(output, picture, &jpeg.Options{Quality: 85})
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(output, picture)
	}
	if err != nil {
		return mediaInfo{}, "", err
	}
	if err = output.Close(); err != nil {
		return mediaInfo{}, "", err
	}
	stat, err := os.Stat(output.Name())
	if err != nil || stat.Size() < 1 || stat.Size() > 25*1024*1024 {
		_ = os.Remove(output.Name())
		return mediaInfo{}, "", errors.New("processed image exceeds its size limit")
	}
	mimeType := "image/png"
	if format == "jpeg" {
		mimeType = "image/jpeg"
	}
	return mediaInfo{Kind: "image", MimeType: mimeType, Width: config.Width, Height: config.Height, Size: stat.Size()}, output.Name(), nil
}

func (server *Server) processVideo(source, id string) (mediaInfo, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height:format=duration", "-of", "json", source)
	report, err := probe.Output()
	if err != nil {
		return mediaInfo{}, "", fmt.Errorf("ffprobe: %w", err)
	}
	var details struct {
		Streams []struct{ Width, Height int } `json:"streams"`
		Format  struct{ Duration string }     `json:"format"`
	}
	if err := json.Unmarshal(report, &details); err != nil || len(details.Streams) != 1 {
		return mediaInfo{}, "", errors.New("video stream is unavailable")
	}
	duration, err := strconv.ParseFloat(details.Format.Duration, 64)
	if err != nil || duration <= 0 || duration > 120 ||
		details.Streams[0].Width < 1 || details.Streams[0].Height < 1 ||
		details.Streams[0].Width > 3840 || details.Streams[0].Height > 2160 {
		return mediaInfo{}, "", errors.New("video exceeds the duration or dimension limit")
	}
	temp, err := os.CreateTemp(server.config.Directory, id+".video-*.mp4")
	if err != nil {
		return mediaInfo{}, "", err
	}
	output := temp.Name()
	temp.Close()
	defer func() {
		if err != nil {
			_ = os.Remove(output)
		}
	}()
	transcode := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
		"-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
		"-t", "120", "-f", "mp4", output)
	if err = transcode.Run(); err != nil {
		return mediaInfo{}, "", fmt.Errorf("ffmpeg: %w", err)
	}
	if err = os.Chmod(output, 0600); err != nil {
		return mediaInfo{}, "", err
	}
	processedProbe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height", "-of", "json", output)
	processedReport, err := processedProbe.Output()
	if err != nil {
		return mediaInfo{}, "", fmt.Errorf("ffprobe processed video: %w", err)
	}
	var processed struct {
		Streams []struct{ Width, Height int } `json:"streams"`
	}
	if err := json.Unmarshal(processedReport, &processed); err != nil || len(processed.Streams) != 1 ||
		processed.Streams[0].Width < 1 || processed.Streams[0].Height < 1 {
		return mediaInfo{}, "", errors.New("processed video dimensions are unavailable")
	}
	stat, err := os.Stat(output)
	if err != nil || stat.Size() < 1 || stat.Size() > maxUploadSize {
		_ = os.Remove(output)
		return mediaInfo{}, "", errors.New("processed video exceeds its size limit")
	}
	return mediaInfo{Kind: "video", MimeType: "video/mp4",
		Width: processed.Streams[0].Width, Height: processed.Streams[0].Height, Size: stat.Size()}, output, nil
}
