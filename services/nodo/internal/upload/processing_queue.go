package upload

// Processes completed uploads and resumes pending media jobs after restart
import (
	"io/fs"
	"log"
	"strings"
)

func (server *Server) startBackgroundTasks() {
	for range 2 {
		server.workers.Go(server.processQueue)
	}
	server.workers.Go(server.enqueueCompletedUploads)
	server.resumeCompleted()
	if server.config.KernoURL != "" {
		server.workers.Go(server.cleanupLoop)
	}
}

func (server *Server) enqueueCompletedUploads() {
	for {
		select {
		case <-server.ctx.Done():
			return
		case event, ok := <-server.tus.CompleteUploads:
			if !ok || !server.enqueue(event.Upload.ID) {
				return
			}
		}
	}
}

func (server *Server) enqueue(id string) bool {
	select {
	case <-server.ctx.Done():
		return false
	case server.jobs <- id:
		return true
	}
}

func (server *Server) processQueue() {
	for {
		select {
		case <-server.ctx.Done():
			return
		case id := <-server.jobs:
			if err := server.process(server.ctx, id); err != nil && server.ctx.Err() == nil {
				log.Printf("Nodo could not process upload %s: %v", id, err)
				_ = server.root.WriteFile(errorName(id), []byte("processing failed\n"), 0600)
			}
		}
	}
}

func (server *Server) resumeCompleted() {
	entries, err := fs.ReadDir(server.root.FS(), ".")
	if err != nil {
		log.Printf("Nodo could not scan uploads: %v", err)
		return
	}
	server.workers.Go(func() { server.enqueueUnprocessed(entries) })
}

func (server *Server) enqueueUnprocessed(entries []fs.DirEntry) {
	for _, entry := range entries {
		if server.ctx.Err() != nil {
			return
		}
		if !strings.HasSuffix(entry.Name(), ".info") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".info")
		if server.needsProcessing(id) && !server.enqueue(id) {
			return
		}
	}
}

func (server *Server) needsProcessing(id string) bool {
	info, err := server.ownerOf(server.ctx, id)
	if err != nil || info.Offset != info.Size || info.Size <= 0 {
		return false
	}
	_, err = server.readReady(id)
	return err != nil
}
