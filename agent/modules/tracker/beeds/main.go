// Beeds is a Dagger module that implements the Ticketer interface using
// the Beads distributed issue tracker (https://github.com/steveyegge/beads).
// It provides persistent, structured memory for coding agents with dependency-aware
// task tracking backed by a git-versioned database.
package main

import (
	"context"
	"dagger/beeds/internal/dagger"
	"fmt"
	"strings"
)

// Beeds implements the Ticketer interface using the Beads CLI tool.
// It stores data in a Dagger cache volume for persistence across runs.
type Beeds struct {
	// UniqueID is a unique identifier for this Beeds instance,
	// used to create an isolated cache volume
	// +optional
	UniqueID string
}

// container returns a base container with beads CLI installed and initialized
func (m *Beeds) container(ctx context.Context) *dagger.Container {
	uniqueID := m.UniqueID
	if uniqueID == "" {
		uniqueID = "default"
	}

	projectPath := "/beeds"

	// Create cache volume name based on unique ID
	cacheVolumeName := fmt.Sprintf("beeds-data-%s", uniqueID)

	// Build container with beads CLI and cache volume
	return dag.Container().
		From("golang:1.23-alpine").
		WithExec([]string{"apk", "add", "--no-cache", "git", "bash", "curl"}).
		// Install beads CLI
		WithExec([]string{"sh", "-c",
			"curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash"}).
		// Mount cache volume for persistent storage
		WithMountedCache(projectPath, dag.CacheVolume(cacheVolumeName)).
		WithWorkdir(projectPath).
		// Initialize beads if not already initialized
		WithExec([]string{"sh", "-c", "bd init || true"}).
		// Configure git (required for beads)
		WithExec([]string{"git", "config", "--global", "user.email", "agent@dagger.io"}).
		WithExec([]string{"git", "config", "--global", "user.name", "Dagger Agent"})
}

// Create creates a new ticket with the given title and body.
// Returns the ticket ID on success.
func (m *Beeds) Create(
	ctx context.Context,
	// The title or summary of the ticket
	title string,
	// The body or description of the ticket
	body string,
) (string, error) {
	container := m.container(ctx)

	// Create ticket using bd CLI with description
	output, err := container.
		WithExec([]string{"bd", "create", title, "-d", body, "--json"}).
		Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create ticket: %w", err)
	}

	return strings.TrimSpace(output), nil
}

// Get retrieves the details of a ticket by its ID.
// Returns a human-readable formatted summary of the ticket.
func (m *Beeds) Get(
	ctx context.Context,
	// The ticket ID (e.g., 'bd-a1b2')
	id string,
) (string, error) {
	container := m.container(ctx)

	// Get ticket details using bd show
	output, err := container.
		WithExec([]string{"bd", "show", id, "--json"}).
		Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get ticket %s: %w", id, err)
	}

	return strings.TrimSpace(output), nil
}

// List lists tickets from the backend.
// Returns a formatted summary of tickets, one per line.
func (m *Beeds) List(ctx context.Context) (string, error) {
	container := m.container(ctx)

	// List all tasks using bd ready (shows tasks with no open blockers)
	output, err := container.
		WithExec([]string{"bd", "ready", "--json"}).
		Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to list tickets: %w", err)
	}

	return strings.TrimSpace(output), nil
}

// AddComment adds a comment to an existing ticket.
// In Beads, this updates the description or adds a note.
func (m *Beeds) AddComment(
	ctx context.Context,
	// The ticket ID to comment on
	id string,
	// The comment body
	body string,
) (string, error) {
	container := m.container(ctx)

	// Add comment by updating the ticket with additional notes
	output, err := container.
		WithExec([]string{"bd", "update", id, "--note", body}).
		Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to add comment to ticket %s: %w", id, err)
	}

	return fmt.Sprintf("Comment added to %s: %s", id, strings.TrimSpace(output)), nil
}

// Close closes or resolves an existing ticket.
// Returns a confirmation message.
func (m *Beeds) Close(
	ctx context.Context,
	// The ticket ID to close
	id string,
) (string, error) {
	container := m.container(ctx)

	// Close ticket by setting status to done
	output, err := container.
		WithExec([]string{"bd", "update", id, "--status", "done"}).
		Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to close ticket %s: %w", id, err)
	}

	return fmt.Sprintf("Ticket %s closed: %s", id, strings.TrimSpace(output)), nil
}
