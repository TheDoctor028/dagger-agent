package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

type WorkspaceState string

const (
	StateToReview       WorkspaceState = "TO_REVIEW"
	StateAccepted       WorkspaceState = "ACCEPTED"
	StateRequireChanges WorkspaceState = "REQUIRE_CHANGES"
	StateDeclined       WorkspaceState = "DECLINED"
)

type WorkspaceMetadata struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	RepoPath string `json:"repo_path"`
	Base     string `json:"base"`
	Head     string `json:"head"`
}

type State struct {
	Status WorkspaceState `json:"status"`
	Reason string         `json:"reason,omitempty"`
}

type Comment struct {
	ID        string    `json:"id"`
	File      string    `json:"file"`
	Line      int       `json:"line"`
	Text      string    `json:"text"`
	Timestamp time.Time `json:"timestamp"`
}

type Workspace struct {
	Metadata WorkspaceMetadata `json:"metadata"`
	State    State             `json:"state"`
	Comments []Comment         `json:"comments"`
}

type Manager struct {
	DataDir string
}

func NewManager(dataDir string) *Manager {
	return &Manager{DataDir: dataDir}
}

type WorkspaceListItem struct {
	Metadata WorkspaceMetadata `json:"metadata"`
	State    State             `json:"state"`
}

func (m *Manager) ListWorkspaces() ([]WorkspaceListItem, error) {
	workspaceDir := filepath.Join(m.DataDir, "workspaces")
	entries, err := os.ReadDir(workspaceDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []WorkspaceListItem{}, nil
		}
		return nil, err
	}

	var workspaces []WorkspaceListItem
	for _, entry := range entries {
		if entry.IsDir() {
			ws, err := m.GetWorkspace(entry.Name())
			if err != nil {
				continue
			}
			workspaces = append(workspaces, WorkspaceListItem{
				Metadata: ws.Metadata,
				State:    ws.State,
			})
		}
	}
	return workspaces, nil
}

func (m *Manager) DeleteWorkspace(id string) error {
	wsDir := filepath.Join(m.DataDir, "workspaces", id)
	return os.RemoveAll(wsDir)
}

func (m *Manager) CreateWorkspace(name, repoPath, base, head string) (*WorkspaceMetadata, error) {
	id := uuid.New().String()
	wsDir := filepath.Join(m.DataDir, "workspaces", id)
	if err := os.MkdirAll(wsDir, 0755); err != nil {
		return nil, err
	}

	meta := WorkspaceMetadata{
		ID:       id,
		Name:     name,
		RepoPath: repoPath,
		Base:     base,
		Head:     head,
	}

	metaData, _ := json.MarshalIndent(meta, "", "  ")
	if err := os.WriteFile(filepath.Join(wsDir, "metadata.json"), metaData, 0644); err != nil {
		return nil, err
	}

	state := State{Status: StateToReview}
	stateData, _ := json.MarshalIndent(state, "", "  ")
	if err := os.WriteFile(filepath.Join(wsDir, "state.json"), stateData, 0644); err != nil {
		return nil, err
	}

	// Initialize empty comments
	if err := os.WriteFile(filepath.Join(wsDir, "comments.json"), []byte("[]"), 0644); err != nil {
		return nil, err
	}

	return &meta, nil
}

func (m *Manager) GetWorkspace(id string) (*Workspace, error) {
	wsDir := filepath.Join(m.DataDir, "workspaces", id)

	metaData, err := os.ReadFile(filepath.Join(wsDir, "metadata.json"))
	if err != nil {
		return nil, err
	}
	var meta WorkspaceMetadata
	json.Unmarshal(metaData, &meta)

	stateData, err := os.ReadFile(filepath.Join(wsDir, "state.json"))
	if err != nil {
		return nil, err
	}
	var state State
	json.Unmarshal(stateData, &state)

	commentsData, err := os.ReadFile(filepath.Join(wsDir, "comments.json"))
	if err != nil {
		return nil, err
	}
	var comments []Comment
	json.Unmarshal(commentsData, &comments)

	return &Workspace{
		Metadata: meta,
		State:    state,
		Comments: comments,
	}, nil
}

func (m *Manager) UpdateState(id string, status WorkspaceState, reason string) error {
	wsDir := filepath.Join(m.DataDir, "workspaces", id)
	state := State{Status: status, Reason: reason}
	stateData, _ := json.MarshalIndent(state, "", "  ")
	return os.WriteFile(filepath.Join(wsDir, "state.json"), stateData, 0644)
}

func (m *Manager) AddComment(id string, file string, line int, text string) error {
	wsDir := filepath.Join(m.DataDir, "workspaces", id)
	commentsPath := filepath.Join(wsDir, "comments.json")

	data, err := os.ReadFile(commentsPath)
	if err != nil {
		return err
	}
	var comments []Comment
	json.Unmarshal(data, &comments)

	comment := Comment{
		ID:        uuid.New().String(),
		File:      file,
		Line:      line,
		Text:      text,
		Timestamp: time.Now(),
	}
	comments = append(comments, comment)

	newData, _ := json.MarshalIndent(comments, "", "  ")
	return os.WriteFile(commentsPath, newData, 0644)
}
