package main

import (
	"context"
	"fmt"

	"dagger/inspector/internal/dagger"
)

// agentFiles is the ordered list of well-known agent instruction file names.
var agentFiles = []string{
	"AGENTS.md",
	"AGENT.md",
	"WARP.md",
	"CLAUDE.md",
	"CURSOR.md",
	"DOUG.md",
	"COPILOT.md",
	"GEMINI.md",
}

type Workbench struct {

	// Src
	// +private
	Src *dagger.Directory
}

func New(
	// src
	src *dagger.Directory,
) *Workbench {
	return &Workbench{
		Src: src,
	}
}

// Inspect checks for a well-known agent instruction file (AGENTS.md, WARP.md, etc.)
// in the root of the source directory. If one is found its content is returned.
// Otherwise an inspector agent analyses the workspace and produces an AGENTS.md document.
// When ai is true, the AI inspection is always performed regardless of existing files.
func (w *Workbench) Inspect(
	ctx context.Context,
	// Force the AI inspection even if a well-known agent file already exists.
	// +optional
	ai bool,
) (string, error) {
	var result string

	for _, f := range agentFiles {
		content, err := w.Src.File(f).Contents(ctx)
		if err == nil {
			result = content
			break
		}
	}

	if result == "" || ai {
		// No agent file found — spin up an inspector agent.
		inspectorPrompt, err := dag.CurrentModule().Source().
			File("prompts/inspector.md").Contents(ctx)
		if err != nil {
			return "", err
		}

		env := dag.Env().
			WithModule(dag.Toolbox().AsModule()).
			WithWorkspace(w.Src).
			WithStringInput("existing-description", result, "The existing AGENTS.md file's content.").
			WithStringOutput("agents-md", "The generated AGENTS.md file's content.")

		agent := dag.LLM().
			WithEnv(env).
			WithSystemPrompt(inspectorPrompt).
			WithPrompt(
				"Inspect this workspace and produce the required output.",
			).Loop()

		result, err = agent.Env().Output("agents-md").AsString(ctx)

		if err != nil {
			return "", err
		}
	}

	// Append README.md content if it exists.
	readme, err := w.Src.File("README.md").Contents(ctx)
	if err == nil {
		result = fmt.Sprintf(
			"%s\n\n# README.md\n\n%s",
			result, readme,
		)
	}

	return result, nil
}
