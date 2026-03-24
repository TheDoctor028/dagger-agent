package main

import (
	"context"
	"dagger/agent/internal/dagger"
)

// Agent
// The main agent definition
type Agent struct {
	// WorkDir is the working directory for the agent
	WorkDir *dagger.Directory

	// BseEnv is the base environment for the agent
	BaseEnv *dagger.Env

	// GitWorkDir is the git repository for the agent
	// +private
	GitWorkDir *dagger.GitRepository

	// Tasks is the tasks for the agent
	// +private
	Tasks string

	// Base the LLM agent that handles the job.
	Base *dagger.LLM
}

func New(
	// workDir is the working directory for the agent
	// +defaultPath="/"
	workDir *dagger.Directory,
) *Agent {
	// FIXME: Using deprecated function due thw WithMainModule is not working as expected
	env := dag.Env().WithModule(dag.Toolbox().AsModule()).WithWorkspace(workDir)

	return &Agent{
		WorkDir:    workDir,
		BaseEnv:    env,
		GitWorkDir: nil,
		Base:       dag.LLM().WithEnv(env),
	}
}

func (agent *Agent) Task(task string) *Agent {
	agent.Tasks = task
	return agent
}

func (agent *Agent) Work(ctx context.Context) (string, error) {
	env := agent.Base.WithPrompt(agent.Tasks).Loop().Env()
	agent.BaseEnv = env // Update the env to the new one
	res, err := env.Output("result").AsString(ctx)
	_, err = agent.WorkDir.Sync(ctx)

	return res, err
}

// WithModel Swap out the LLM model
func (agent *Agent) WithModel(model string) *Agent {
	agent.Base = agent.Base.WithModel(model)
	return agent
}
