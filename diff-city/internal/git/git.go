package git

import (
	"bytes"
	"os/exec"
	"strings"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) GetDiff(repoPath, base, head string) (string, error) {
	cmd := exec.Command("git", "diff", base, head)
	cmd.Dir = repoPath
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return out.String(), nil
}

func (s *Service) ListBranches(repoPath string) ([]string, error) {
	cmd := exec.Command("git", "branch", "-a", "--format=%(refname:short)")
	cmd.Dir = repoPath
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	branches := strings.Split(strings.TrimSpace(out.String()), "\n")
	return branches, nil
}
