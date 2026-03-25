package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"

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

	r.Get("/api/workspaces", s.listWorkspaces)
	r.Post("/api/workspaces", s.createWorkspace)
	r.Get("/api/workspaces/{id}", s.getWorkspace)
	r.Delete("/api/workspaces/{id}", s.deleteWorkspace)
	r.Get("/api/workspaces/{id}/diff", s.getWorkspaceDiff)
	r.Post("/api/workspaces/{id}/state", s.updateWorkspaceState)
	r.Post("/api/workspaces/{id}/comments", s.addComment)

	// Serve frontend
	workDir, _ := os.Getwd()
	filesDir := http.Dir(filepath.Join(workDir, "web"))
	r.Handle("/*", http.StripPrefix("/", http.FileServer(filesDir)))

	log.Println("Starting server on :8080")
	http.ListenAndServe(":8080", r)
}

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	ws, err := s.WorkspaceManager.ListWorkspaces()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(ws)
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

	meta, err := s.WorkspaceManager.CreateWorkspace(req.Name, req.RepoPath, req.Base, req.Head)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(meta)
}

func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ws, err := s.WorkspaceManager.GetWorkspace(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(ws)
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
