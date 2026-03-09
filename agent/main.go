package main

import (
	"context"
	"dagger/agent/internal/dagger"
)

type Agent struct {
	// WorkDir is the working directory for the agent
	WorkDir *dagger.Directory

	// +private
	BaseEnv *dagger.Env

	// +private
	GitWorkDir *dagger.GitRepository

	// +private
	Tasks string

	// base the LLM agent that handles the job.
	base *dagger.LLM
}

func New(
	// workDir is the working directory for the agent
	// +defaultPath="/"
	workDir *dagger.Directory,
) *Agent {
	// gitWorkDir := workDir.AsGit()

	return &Agent{
		WorkDir:    workDir,
		BaseEnv:    dag.Env().WithMainModule(dag.Toolbox().AsModule()),
		GitWorkDir: nil,
		base:       nil,
	}
}

func (agent *Agent) Task(task string) *Agent {
	agent.Tasks = task
	return agent
}

func (agent *Agent) Work(ctx context.Context) (string, error) {
	env := agent.base.WithPrompt(agent.Tasks).Loop().Env()
	agent.BaseEnv = env // Update the env to the new one
	res, err := env.Output("result").AsString(ctx)
	_, err = agent.WorkDir.Sync(ctx)

	return res, err
}

func (agent *Agent) Agens() *dagger.LLM {
	// FIXME: Using deprecated function due thw WithMainModule is not working as expected
	return dag.LLM().WithEnv(agent.BaseEnv)
}

// WithModel Swap out the LLM model
func (agent *Agent) WithModel(model string) *Agent {
	agent.base.WithModel(model)
	return agent
}

/*
ReadFiles Reads a file from the project directory.

HOW TO USE THIS TOOL:
  - Always use relative paths from the workspace root
  - Reads the first 2000 lines by default
  - Each line is prefixed with a line number followed by an arrow (→).
    Everything that follows the arrow is the literal content of the line.
  - You can specify an offset and limit to read line regions of a large file
  - If the file contents are empty, you will receive a warning.
  - If multiple files are interesting, you can read them all at once using multiple tool calls.
*/
func (agent Agent) ReadFiles() []string {
	return nil
}
