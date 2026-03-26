package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"diff-city/internal/config"
	"diff-city/internal/git"
	"diff-city/internal/workspace"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Server struct {
	WorkspaceManager *workspace.Manager
	GitService       *git.Service
}

func main() {
	cfg := config.Load()

	dataDir := "./data"
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatal(err)
	}

	s := &Server{
		WorkspaceManager: workspace.NewManager(dataDir),
		GitService:       git.NewService(),
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	if cfg.CORSAllowedOrigin != "" {
		r.Use(corsMiddleware(cfg.CORSAllowedOrigin))
	}

	r.Get("/api/workspaces", s.listWorkspaces)
	r.Post("/api/workspaces", s.createWorkspace)
	r.Get("/api/workspaces/{id}", s.getWorkspace)
	r.Delete("/api/workspaces/{id}", s.deleteWorkspace)
	r.Get("/api/workspaces/{id}/diff", s.getWorkspaceDiff)
	r.Post("/api/workspaces/{id}/state", s.updateWorkspaceState)
	r.Post("/api/workspaces/{id}/comments", s.addComment)
	r.Delete("/api/workspaces/{id}/comments/{commentId}", s.deleteComment)

	// Serve frontend (built React SPA)
	workDir, _ := os.Getwd()
	distDir := filepath.Join(workDir, "web/diff-review-hub/dist")
	r.Handle("/*", spaHandler(distDir))

	log.Println("Starting server on :8080")
	if err := http.ListenAndServe(":8080", r); err != nil {
		log.Fatal(err)
	}
}

// corsMiddleware adds CORS headers for the given allowed origin.
func corsMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// spaHandler serves static files from dir and falls back to index.html for
// any path that does not correspond to a file on disk (SPA client-side routing).
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		_, err := os.Stat(path)
		if os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := s.WorkspaceManager.ListWorkspaces()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, ws)
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		RepoPath string `json:"repo_path"`
		Base     string `json:"base"`
		Head     string `json:"head"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.RepoPath == "" || req.Base == "" || req.Head == "" {
		http.Error(w, "name, repo_path, base, and head are required", http.StatusBadRequest)
		return
	}

	if err := s.GitService.ValidateWorkspaceRefs(req.RepoPath, req.Base, req.Head); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	meta, err := s.WorkspaceManager.CreateWorkspace(req.Name, req.RepoPath, req.Base, req.Head)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, meta)
}

func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ws, err := s.WorkspaceManager.GetWorkspace(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, ws)
}

func (s *Server) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.WorkspaceManager.DeleteWorkspace(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getWorkspaceDiff(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ws, err := s.WorkspaceManager.GetWorkspace(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	diff, err := s.GitService.GetDiff(ws.Metadata.RepoPath, ws.Metadata.Base, ws.Metadata.Head)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(diff))
}

func (s *Server) updateWorkspaceState(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Status workspace.WorkspaceState `json:"status"`
		Reason string                   `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.WorkspaceManager.UpdateState(id, req.Status, req.Reason); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) addComment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		File string `json:"file"`
		Line int    `json:"line"`
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.WorkspaceManager.AddComment(id, req.File, req.Line, req.Text); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteComment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	commentId := chi.URLParam(r, "commentId")
	if err := s.WorkspaceManager.DeleteComment(id, commentId); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
