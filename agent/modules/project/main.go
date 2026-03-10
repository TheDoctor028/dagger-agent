package main

import (
	"context"
	"dagger/project/internal/dagger"
	"fmt"
	"math/rand"
)

const (
	cacheKey  = "global-projects-registry"
	mountPath = "/projects"
)

// Project manages a global registry of projects stored on the Dagger engine cache.
// Each project is a named directory containing a context.md file.
type Project struct{}

// New creates a new Project registry instance
func New() *Project {
	return &Project{}
}

func (p *Project) cache() *dagger.CacheVolume {
	return dag.CacheVolume(cacheKey)
}

func (p *Project) base() *dagger.Container {
	return dag.Container().
		From("alpine:3.16").
		WithMountedCache(mountPath, p.cache()).
		WithWorkdir(mountPath)
}

// Add adds or updates a project with the given name and markdown context content
func (p *Project) Add(
	ctx context.Context,
	// name is the unique project name (used as directory name)
	name string,
	// content is the markdown content for the project's context.md file
	content string,
) (string, error) {
	contextFile := dag.File("context.md", content)

	_, err := p.base().
		WithMountedFile("/tmp/context.md", contextFile).
		WithExec([]string{
			"sh", "-c",
			"mkdir -p /projects/" + name + " && cp /tmp/context.md /projects/" + name + "/context.md",
		}).
		Sync(ctx)
	if err != nil {
		return "", err
	}

	return "Project '" + name + "' added.", nil
}

// List returns all active project names stored in the registry (excludes soft-deleted)
func (p *Project) List(ctx context.Context) (string, error) {
	return p.base().
		WithEnvVariable("CACHE_RAND", string(rune(rand.Int()))).
		WithExec([]string{
			"sh", "-c",
			`result=$(ls -1 /projects 2>/dev/null | grep -v '\.deleted$'); ` +
				`[ -z "$result" ] && echo "No projects found." || echo "$result"`,
		}).
		Stdout(ctx)
}

// Context returns the context.md content for the given project
func (p *Project) Context(
	ctx context.Context,
	// name is the project name
	name string,
) (string, error) {
	return p.base().
		WithExec([]string{"cat", "/projects/" + name + "/context.md"}).
		Stdout(ctx)
}

// Delete soft-deletes a project by renaming its directory to <name>.deleted.
//
// To confirm, pass the project name again via --confirm.
// This is a soft delete only — the data is kept under <name>.deleted.
// To permanently remove it, use the interactive mode: dagger call interactive
func (p *Project) Delete(
	ctx context.Context,
	// name is the project to soft-delete
	name string,
	// confirm must match name exactly to proceed (guard against accidental deletion)
	confirm string,
) (string, error) {
	if confirm != name {
		return "", fmt.Errorf(
			"confirmation mismatch: expected %q, got %q — pass --confirm %s to proceed",
			name, confirm, name,
		)
	}

	_, err := p.base().
		WithExec([]string{
			"sh", "-c",
			"mv /projects/" + name + " /projects/" + name + ".deleted",
		}).Stdout(ctx)
	if err != nil {
		return "", fmt.Errorf("could not soft-delete project %q: %w", name, err)
	}

	return "Project '" + name + "' soft-deleted (renamed to '" + name + ".deleted').\n" +
		"To permanently delete it, run: dagger call interactive", nil
}

// Interactive opens an interactive terminal with the global projects cache mounted at /projects
func (p *Project) Interactive() *dagger.Container {
	return p.base().Terminal()
}
