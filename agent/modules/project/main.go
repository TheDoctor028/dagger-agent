package main

import (
	"context"
	"dagger/project/internal/dagger"
	"strings"
)

// ProjectStatus represents the lifecycle state of a project.
type ProjectStatus string

const (
	// ProjectStatusPlanning is the initial state when the project is being defined.
	ProjectStatusPlanning ProjectStatus = "planning"
	// ProjectStatusInProgress means the project is actively being worked on.
	ProjectStatusInProgress ProjectStatus = "in-progress"
	// ProjectStatusReviewRequired means the work is done and awaiting review.
	ProjectStatusReviewRequired ProjectStatus = "review-required"
	// ProjectStatusDone means the project has been completed and reviewed.
	ProjectStatusDone ProjectStatus = "done"
)

// Project is an entity that holds workspaces and an ordered list of tasks
// needed to achieve the project's goal as described by its description.
type Project struct {
	// Description defines the goal and purpose of this project.
	Description string

	// Status is the current lifecycle state of the project.
	Status ProjectStatus

	// UniqueID is used for isolated cache storage.
	// Derived from the description if not provided.
	// +optional
	UniqueID string

	Workspaces []string

	Tasks [][]string
}

// New creates a new Project with the given description.
// The project starts in the Planning state.
func New(
	// The project's goal or description — defines what this project is trying to achieve.
	description string,
	// Optional unique ID for this project's isolated storage.
	// If not provided, it will be derived from the description.
	// +optional
	uniqueID string,
) *Project {
	if uniqueID == "" {
		slug := strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				return r
			}
			if r >= 'A' && r <= 'Z' {
				return r + 32
			}
			return '-'
		}, description)
		slug = strings.Trim(slug, "-")
		if len(slug) > 40 {
			slug = slug[:40]
		}
		uniqueID = slug
	}
	return &Project{
		Description: description,
		Status:      ProjectStatusPlanning,
		UniqueID:    uniqueID,
	}
}

// SetStatus updates the lifecycle state of the project.
// Valid values: "planning", "in-progress", "review-required", "done".
func (p *Project) SetStatus(
	// The new project status.
	status ProjectStatus,
) *Project {
	p.Status = status
	return p
}

func (p *Project) WithWorkspace(name string, dir *dagger.Directory) *Project {
	return p
}

func src() *dagger.Directory {
	return dag.CurrentModule().Source()
}

func manager(ctx context.Context) *dagger.LLM {
	env := dag.Env().
		WithCurrentModule().
		WithStringInput("project-description", "", "").
		WithStringInput("workspaces", "", "")

	sysPrompt, err := dag.CurrentModule().Source().File("prompts/project-manager.md").Contents(ctx)
	if err != nil {
		panic(err)
	}

	return dag.LLM().
		WithEnv(env).
		WithBlockedFunction("Project", "WithWorkspace").
		WithSystemPrompt(sysPrompt)
}

func Kickoff(ctx context.Context) string {
	manager(ctx).
		WithPromptFile(src().File("prompts/kickoff.md"))

	return ""
}
