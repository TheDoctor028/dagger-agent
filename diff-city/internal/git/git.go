package git

import (
	"bytes"
	"fmt"
	"os"
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

// ValidateWorkspaceRefs checks that repoPath is a git repository and that both
// base and head refs resolve to valid objects.
func (s *Service) ValidateWorkspaceRefs(repoPath, base, head string) error {
	if _, err := os.Stat(repoPath); os.IsNotExist(err) {
		return fmt.Errorf("repository path does not exist: %s", repoPath)
	}

	// Verify it is a git repo.
	check := exec.Command("git", "rev-parse", "--git-dir")
	check.Dir = repoPath
	if err := check.Run(); err != nil {
		return fmt.Errorf("%s is not a valid git repository", repoPath)
	}

	// Verify base ref.
	checkBase := exec.Command("git", "rev-parse", "--verify", base)
	checkBase.Dir = repoPath
	if err := checkBase.Run(); err != nil {
		return fmt.Errorf("base ref %q does not exist in the repository", base)
	}

	// Verify head ref.
	checkHead := exec.Command("git", "rev-parse", "--verify", head)
	checkHead.Dir = repoPath
	if err := checkHead.Run(); err != nil {
		return fmt.Errorf("head ref %q does not exist in the repository", head)
	}

	return nil
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
