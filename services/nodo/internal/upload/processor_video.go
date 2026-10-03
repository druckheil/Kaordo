package upload

// Probes, validates, transcodes, and measures uploaded video files
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"strconv"
	"time"
)

const (
	maxVideoDurationSeconds = 120
	maxVideoInputWidth      = 3840
	maxVideoInputHeight     = 2160
	videoProcessingTimeout  = 5 * time.Minute
)

type videoProbeReport struct {
	Streams []videoStream `json:"streams"`
	Format  videoFormat   `json:"format"`
}

type videoStream struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type videoFormat struct {
	Duration string `json:"duration"`
}

func (server *Server) processVideo(parent context.Context, source, id string) (mediaInfo, string, error) {
	ctx, cancel := context.WithTimeout(parent, videoProcessingTimeout)
	defer cancel()

	original, err := probeUploadedVideo(ctx, source)
	if err != nil {
		return mediaInfo{}, "", err
	}
	if err := validateUploadedVideo(original); err != nil {
		return mediaInfo{}, "", err
	}

	output, err := createVideoOutput(server.config.Directory, id)
	if err != nil {
		return mediaInfo{}, "", err
	}
	keepOutput := false
	defer func() {
		if !keepOutput {
			_ = os.Remove(output)
		}
	}()

	if err := transcodeVideo(ctx, source, output); err != nil {
		return mediaInfo{}, "", err
	}
	if err := os.Chmod(output, 0600); err != nil {
		return mediaInfo{}, "", err
	}

	dimensions, err := probeProcessedVideo(ctx, output)
	if err != nil {
		return mediaInfo{}, "", err
	}
	stat, err := os.Stat(output)
	if err != nil || stat.Size() < 1 || stat.Size() > maxUploadSize {
		return mediaInfo{}, "", errors.New("processed video exceeds its size limit")
	}

	item := mediaInfo{
		Kind:     "video",
		MimeType: "video/mp4",
		Width:    dimensions.Width,
		Height:   dimensions.Height,
		Size:     stat.Size(),
	}
	keepOutput = true
	return item, output, nil
}

func probeUploadedVideo(ctx context.Context, source string) (videoProbeReport, error) {
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height:format=duration", "-of", "json", source)
	reportBytes, err := probe.Output()
	if err != nil {
		return videoProbeReport{}, fmt.Errorf("ffprobe: %w", err)
	}

	var report videoProbeReport
	if err := json.Unmarshal(reportBytes, &report); err != nil || len(report.Streams) != 1 {
		return videoProbeReport{}, errors.New("video stream is unavailable")
	}
	return report, nil
}

func validateUploadedVideo(report videoProbeReport) error {
	if len(report.Streams) != 1 {
		return errors.New("video stream is unavailable")
	}
	duration, err := strconv.ParseFloat(report.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > maxVideoDurationSeconds {
		return errors.New("video exceeds the duration or dimension limit")
	}
	stream := report.Streams[0]
	if stream.Width < 1 || stream.Height < 1 ||
		stream.Width > maxVideoInputWidth || stream.Height > maxVideoInputHeight {
		return errors.New("video exceeds the duration or dimension limit")
	}
	return nil
}

func createVideoOutput(directory, id string) (string, error) {
	temp, err := os.CreateTemp(directory, id+".video-*.mp4")
	if err != nil {
		return "", err
	}
	path := temp.Name()
	if err := temp.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func transcodeVideo(ctx context.Context, source, output string) error {
	transcode := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
		"-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
		"-t", "120", "-f", "mp4", output)
	if err := transcode.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w", err)
	}
	return nil
}

func probeProcessedVideo(ctx context.Context, path string) (videoStream, error) {
	probe := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height", "-of", "json", path)
	reportBytes, err := probe.Output()
	if err != nil {
		return videoStream{}, fmt.Errorf("ffprobe processed video: %w", err)
	}

	var report videoProbeReport
	if err := json.Unmarshal(reportBytes, &report); err != nil || len(report.Streams) != 1 ||
		report.Streams[0].Width < 1 || report.Streams[0].Height < 1 {
		return videoStream{}, errors.New("processed video dimensions are unavailable")
	}
	return report.Streams[0], nil
}
