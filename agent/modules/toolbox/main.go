package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"dagger/toolbox/internal/dagger"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	godiffpatch "github.com/sourcegraph/go-diff-patch"
)

const MaxResponseLength = 30000

// Toolbox coding agent module
type Toolbox struct {
	// +private
	Source *dagger.Directory
	// +private
	WorkspacePath string
}

func New(
	// +defaultPath="/"
	source *dagger.Directory,
) *Toolbox {
	return &Toolbox{
		Source:        source,
		WorkspacePath: "/workspace",
	}
}

func (toolbox *Toolbox) AsModule() *dagger.Module {
	return dag.CurrentModule().Source().AsModule()
}

/*
ReadFile
Reads a file from the project directory.

HOW TO USE THIS TOOL:
  - Always use relative paths from the workspace root
  - Reads the first 2000 lines by default
  - Each line is prefixed with a line number followed by an arrow (→).
    Everything that follows the arrow is the literal content of the line.
  - You can specify an offset and limit to read line regions of a large file
  - If the file contents are empty, you will receive a warning.
  - If multiple files are interesting, you can read them all at once using multiple tool calls.
*/
func (toolbox *Toolbox) ReadFile(
	ctx context.Context,
	// Relative path within the workspace
	filePath string,
	// Line offset to start reading from
	offset *int,
	// Limit the number of lines read
	limit *int,
) (string, error) {
	filePath = toolbox.normalizePath(filePath)

	if limit == nil {
		defaultLimit := 2000
		limit = &defaultLimit
	}

	opts := dagger.FileContentsOpts{
		LimitLines: *limit,
	}
	if offset != nil {
		opts.OffsetLines = *offset
	}

	contents, err := toolbox.Source.File(filePath).Contents(ctx, opts)
	if err != nil {
		return "", err
	}

	if contents == "" {
		return "WARNING: File contents are empty.", nil
	}

	lines := strings.Split(contents, "\n")
	var numberedLines []string

	startLine := 1
	if offset != nil {
		startLine = *offset + 1
	}

	for i, line := range lines {
		lineNo := startLine + i
		numberedLines = append(numberedLines, fmt.Sprintf("%6d→%s", lineNo, line))
	}

	return strings.Join(numberedLines, "\n"), nil
}

/*
EditFile
Edits files by replacing text, creating new files, or deleting content. For moving or renaming files, use the BasicShell tool with the 'mv' command instead. For larger file edits, use the Write tool to overwrite files.

# Before using this tool, use the ReadFile tool to understand the file's contents and context

To make a file edit, provide the following:
1. file_path: The relative path to the file to modify within the project directory
2. old_string: The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)
3. new_string: The edited text to replace the old_string
4. replace_all: Replace all occurrences of old_string (default false)

Special cases:
- To create a new file: provide file_path and new_string, leave old_string empty
- To delete content: provide file_path and old_string, leave new_string empty

The tool will replace ONE occurrence of old_string with new_string in the specified file by default. Set replace_all to true to replace all occurrences.

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. UNIQUENESS: When replace_all is false (default), the old_string MUST uniquely identify the specific instance you want to change. This means:
  - Include AT LEAST 3-5 lines of context BEFORE the change point
  - Include AT LEAST 3-5 lines of context AFTER the change point
  - Include all whitespace, indentation, and surrounding code exactly as it appears in the file

2. SINGLE INSTANCE: When replace_all is false, this tool can only change ONE instance at a time. If you need to change multiple instances:
  - Set replace_all to true to replace all occurrences at once
  - Or make separate calls to this tool for each instance
  - Each call must uniquely identify its specific instance using extensive context

3. VERIFICATION: Before using this tool:
  - Check how many instances of the target text exist in the file
  - If multiple instances exist and replace_all is false, gather enough context to uniquely identify each one
  - Plan separate tool calls for each instance or use replace_all

WARNING: If you do not follow these requirements:
  - The tool will fail if old_string matches multiple locations and replace_all is false
  - The tool will fail if old_string doesn't match exactly (including whitespace)
  - You may change the wrong instance if you don't include enough context

When making edits:

  - Ensure the edit results in idiomatic, correct code

  - Do not leave the code in a broken state

  - Always use relative file paths

Remember: when making multiple file edits in a row to the same file, you should prefer to send all edits in a single message with multiple calls to this tool, rather than multiple messages with a single call each.
*/
func (toolbox *Toolbox) EditFile(
	ctx context.Context,
	// Relative path within the workspace
	filePath string,
	// Unique search string to replace within the file, or non-unique if replaceAll is true
	oldString string,
	// New text content
	newString string,
	// Replace all occurrences
	replaceAll *bool,
) (*dagger.Changeset, error) {
	filePath = toolbox.normalizePath(filePath)

	if replaceAll == nil {
		defaultReplaceAll := false
		replaceAll = &defaultReplaceAll
	}

	before := toolbox.Source.File(filePath)

	after := before.WithReplaced(oldString, newString, dagger.FileWithReplacedOpts{
		All: *replaceAll,
	})

	beforeContents, err := before.Contents(ctx)
	if err != nil {
		return nil, err
	}

	afterContents, err := after.Contents(ctx)
	if err != nil {
		return nil, err
	}

	diff := godiffpatch.GeneratePatch(filePath, beforeContents, afterContents)
	tokens, err := lexers.Get("diff").Tokenise(nil, diff)
	if err != nil {
		return nil, err
	}

	if err := formatters.TTY16.Format(os.Stdout, TTYStyle, tokens); err != nil {
		return nil, err
	}

	return toolbox.Source.WithFile(filePath, after).Changes(toolbox.Source), nil
}

// taken from chroma's TTY formatter
var ttyMap = map[string]string{
	"30m": "#000000", "31m": "#7f0000", "32m": "#007f00", "33m": "#7f7fe0",
	"34m": "#00007f", "35m": "#7f007f", "36m": "#007f7f", "37m": "#e5e5e5",
	"90m": "#555555", "91m": "#ff0000", "92m": "#00ff00", "93m": "#ffff00",
	"94m": "#0000ff", "95m": "#ff00ff", "96m": "#00ffff", "97m": "#ffffff",
}

// TTY style matches to hex codes used by the TTY formatter to map them to
// specific ANSI escape codes.
var TTYStyle = styles.Register(chroma.MustNewStyle("tty", chroma.StyleEntries{
	chroma.Comment:             ttyMap["95m"] + " italic",
	chroma.CommentPreproc:      ttyMap["90m"],
	chroma.KeywordConstant:     ttyMap["33m"],
	chroma.Keyword:             ttyMap["31m"],
	chroma.KeywordDeclaration:  ttyMap["35m"],
	chroma.NameBuiltin:         ttyMap["31m"],
	chroma.NameBuiltinPseudo:   ttyMap["36m"],
	chroma.NameFunction:        ttyMap["34m"],
	chroma.NameNamespace:       ttyMap["34m"],
	chroma.LiteralNumber:       ttyMap["31m"],
	chroma.LiteralString:       ttyMap["32m"],
	chroma.LiteralStringSymbol: ttyMap["33m"],
	chroma.Operator:            ttyMap["31m"],
	chroma.Punctuation:         ttyMap["90m"],
	chroma.Error:               ttyMap["91m"], // bright red for errors
	chroma.GenericDeleted:      ttyMap["91m"], // bright red for deleted content
	chroma.GenericEmph:         "italic",
	chroma.GenericInserted:     ttyMap["92m"], // bright green for inserted content
	chroma.GenericStrong:       "bold",
	chroma.GenericSubheading:   ttyMap["90m"], // dark gray for subheadings
	chroma.KeywordNamespace:    ttyMap["95m"], // bright magenta for namespace keywords
	chroma.Literal:             ttyMap["94m"], // bright blue for literals
	chroma.LiteralDate:         ttyMap["93m"], // bright yellow for dates
	chroma.LiteralStringEscape: ttyMap["96m"], // bright cyan for string escapes
	chroma.Name:                ttyMap["97m"], // bright white for names
	chroma.NameAttribute:       ttyMap["92m"], // bright green for attributes
	chroma.NameClass:           ttyMap["92m"], // bright green for classes
	chroma.NameConstant:        ttyMap["94m"], // bright blue for constants
	chroma.NameDecorator:       ttyMap["92m"], // bright green for decorators
	chroma.NameException:       ttyMap["91m"], // bright red for exceptions
	chroma.NameOther:           ttyMap["92m"], // bright green for other names
	chroma.NameTag:             ttyMap["95m"], // bright magenta for tags
	chroma.Text:                ttyMap["97m"], // bright white for text
}))

/*
File writing tool that creates or updates files in the filesystem, allowing you to save or modify text content.

WHEN TO USE THIS TOOL:
- Use when you need to create a new file
- Helpful for updating existing files with modified content
- Perfect for saving code, configurations, or text data

HOW TO USE:
- Provide the path to the file you want to write
- Include the content to be written to the file
- The tool will create any necessary parent directories

FEATURES:
- Can create new files or overwrite existing ones
- Creates parent directories automatically if they don't exist
- Checks if the file has been modified since last read for safety
- Avoids unnecessary writes when content hasn't changed

LIMITATIONS:
- You should read a file before writing to it to avoid conflicts
- Cannot append to files (rewrites the entire file)

TIPS:
- Use the View tool first to examine existing files before modifying them
- Use the BasicShell tool to verify the correct location when creating new files
- Combine with Glob and Grep tools to find and modify multiple files
*/
func (toolbox *Toolbox) Write(
	// Relative path within the workspace
	filePath string,
	// Complete file content to write
	contents string,
) *dagger.Changeset {
	filePath = toolbox.normalizePath(filePath)
	return toolbox.Source.WithNewFile(filePath, contents).Changes(toolbox.Source)
}

// Glob
// Fast file pattern matching tool that finds files by name and pattern, returning matching paths sorted by modification time (newest first).
//
// WHEN TO USE THIS TOOL:
// - Use when you need to find files by name patterns or extensions
// - Great for finding specific file types across a directory structure
// - Useful for discovering files that match certain naming conventions
//
// HOW TO USE:
// - Provide a glob pattern to match against file paths
// - Optionally specify a starting directory (defaults to current working directory)
// - Results are sorted with most recently modified files first
//
// GLOB PATTERN SYNTAX:
// - '*' matches any sequence of non-separator characters
// - '**' matches any sequence of characters, including separators
// - '?' matches any single non-separator character
// - '[...]' matches any character in the brackets
// - '[!...]' matches any character not in the brackets
//
// COMMON PATTERN EXAMPLES:
// - '*.js' - Find all JavaScript files in the current directory
// - '**/*.js' - Find all JavaScript files in any subdirectory
// - 'src/**/*.{ts,tsx}' - Find all TypeScript files in the src directory
// - '*.{html,css,js}' - Find all HTML, CSS, and JS files
//
// LIMITATIONS:
// - Results are limited to 100 files (newest first)
// - Does not search file contents (use Grep tool for that)
// - Hidden files (starting with '.') are skipped
//
// TIPS:
// - Patterns should use forward slashes (/) for cross-platform compatibility
// - For the most useful results, combine with the Grep tool: first find files with Glob, then search their contents with Grep
// - When doing iterative exploration that may require multiple rounds of searching, consider using the Task tool instead
// - Always check if results are truncated and refine your search pattern if needed
func (toolbox *Toolbox) Glob(
	ctx context.Context,
	// Relative glob pattern to find within the workspace
	pattern string,
) error {
	result, err := toolbox.Source.Glob(ctx, pattern)
	if err != nil {
		return err
	}

	if len(result) == 0 {
		fmt.Println("No files found.")
		return nil
	}

	var filtered []string
	for _, path := range result {
		parts := strings.Split(path, "/")
		hasDotFile := false
		for _, part := range parts {
			if strings.HasPrefix(part, ".") {
				hasDotFile = true
				break
			}
		}
		if !hasDotFile {
			filtered = append(filtered, path)
		}
	}

	for _, path := range filtered {
		fmt.Println(path)
	}

	return nil
}

/*
Grep
Fast content search tool that finds files containing specific text or patterns, returning matching file paths sorted by modification time (newest first).

WHEN TO USE THIS TOOL:
- Use when you need to find files containing specific text or patterns
- Great for searching code bases for function names, variable declarations, or error messages
- Useful for finding all files that use a particular API or pattern

HOW TO USE:
- Provide a regex pattern to search for within file contents
- Set literal_text=true if you want to search for the exact text with special characters (recommended for non-regex users)
- Optionally specify starting paths (defaults to current working directory)
- Optionally provide a glob patterns to filter which files to search
- Use the ReadLogs tool to narrow down a large search result, analogous to piping grep to grep, head, or tail

REGEX PATTERN SYNTAX (when literal_text=false):
- Supports standard regular expression syntax
- 'function' searches for the literal text "function"
- 'log\..*Error' finds text starting with "log." and ending with "Error"
- 'import\s+.*\s+from' finds import statements in JavaScript/TypeScript

COMMON INCLUDE PATTERN EXAMPLES:
- '*.js' - Only search JavaScript files
- '*.{ts,tsx}' - Only search TypeScript files
- '*.go' - Only search Go files

LIMITATIONS:
- Performance depends on the number of files being searched
- Very large binary files may be skipped
- Hidden files (starting with '.') are skipped

IGNORE FILE SUPPORT:
- Respects .gitignore patterns to skip ignored files and directories
- Both ignore files are automatically detected in the search root directory

CROSS-PLATFORM NOTES:
- Uses ripgrep (rg) command internally
- File paths are normalized automatically for cross-platform compatibility

TIPS:
- For faster, more targeted searches, first use Glob to find relevant files, then use Grep
- When doing iterative exploration that may require multiple rounds of searching, consider using the Task tool instead
- Always check if results are truncated and refine your search pattern if needed, or use ReadLogs to filter the result
- Use literal_text=true when searching for exact text containing special characters like dots, parentheses, etc.
*/
func (toolbox *Toolbox) Grep(
	ctx context.Context,
	// Regular expression pattern to grep for
	pattern string,
	// Treat pattern as literal text instead of a regular expression
	literalText *bool,
	// Relative paths within the workspace to limit the search
	paths []string,
	// Relative path globs within the workspace to limit the search
	glob []string,
	// Allow the pattern to span multiple lines
	multiline *bool,
	// Show the matching content
	content *bool,
	// Case-insensitive search
	insensitive *bool,
	// Limit the number of matches
	limit *int,
) (string, error) {
	for i, filePath := range paths {
		paths[i] = toolbox.normalizePath(filePath)
	}

	opts := dagger.DirectorySearchOpts{}

	if literalText != nil {
		opts.Literal = *literalText
	}
	if paths != nil {
		opts.Paths = paths
	}
	if glob != nil {
		opts.Globs = glob
	}
	if multiline != nil {
		opts.Multiline = *multiline
		opts.Dotall = *multiline
	}
	if content != nil {
		opts.FilesOnly = !*content
	}
	if insensitive != nil {
		opts.Insensitive = *insensitive
	}
	if limit != nil {
		opts.Limit = *limit
	} else {
		opts.Limit = 1000
	}

	matches, err := toolbox.Source.Search(ctx, pattern, opts)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%toolbox matches found", len(matches)), nil
}

/*
Task
Launch a new agent that has access to the same tools and environment.

When you are searching for a keyword or file and are not confident that you will find the right match on the first try, use the Task tool to perform the search for ou.

EXAMPLES:
  - If you are searching for a keyword like "config" or "logger", or for questions like "which file does X?", the Task tool is strongly recommended
  - If you want to read a specific file path, use the View or GlobTool tool instead of the Task tool, to find the match more quickly
  - If you are searching for a specific class definition like "class Foo", use the GlobTool tool instead, to find the match more quickly

USAGE NOTES:
  - Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
  - When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, u should send a text message back to the user with a concise summary of the result.
  - Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of s final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what formation the agent should return back to you in its final and only message to you.
  - The agent's outputs should generally be trusted
  - IMPORTANT: The agent runs in a copy-on-write sandboxed environment. Any writes made by the agent will not be visible to the user, but will be available to the agent's next invocation.
*/
func (toolbox *Toolbox) Task(
	ctx context.Context,
	// A brief description of the task to show to the user
	description string,
	// The prompt for the sub-agent
	prompt string,
) (string, error) {
	systemPrompt, err := dag.CurrentModule().Source().File("prompts/task_system_prompt.md").Contents(ctx)
	if err != nil {
		return "", err
	}

	reminderPrompt, err := toolbox.reminderPrompt(ctx, toolbox.Source)
	if err != nil {
		return "", err
	}

	return dag.LLM().
		WithEnv(dag.CurrentEnv().WithoutOutputs()).
		WithBlockedFunction("Toolbox", "task").
		WithoutDefaultSystemPrompt().
		WithSystemPrompt(systemPrompt).
		WithSystemPrompt(reminderPrompt).
		WithPrompt(prompt).
		LastReply(ctx)
}

func (toolbox *Toolbox) reminderPrompt(ctx context.Context, source *dagger.Directory) (string, error) {
	segments := []string{
		`
# System Reminder

- Do what has been asked; nothing more, nothing less.
- NEVER create files unless they're absolutely necessary for achieving your goal.
- ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files.
- Only create documentation files if explicitly requested by the User.
`,
	}

	entries, err := source.Entries(ctx)
	if err != nil {
		return strings.Join(segments, "\n\n"), nil
	}

	contextFiles := []string{"DOUG.md", "AGENT.md", "CLAUDE.md"}
	for _, file := range contextFiles {
		for _, entry := range entries {
			if entry == file {
				contents, err := source.File(file).Contents(ctx)
				if err != nil {
					continue
				}

				segments = append(segments, fmt.Sprintf(`
# Project-Specific Context

Make sure to follow the instructions in the context below:

<project-context>
%s
</project-context>

These instructions OVERRIDE any default behavior.
`, contents))
				goto found
			}
		}
	}
found:

	return strings.Join(segments, "\n\n"), nil
}

// FIXME: MCP services and tools in general strongly recommend using absolute
// paths. but in Dagger, MCP services run in their own sandbox, so for any hope
// of sanity the user should really configure the same mount point across all of
// them, like /workspace.
//
// but, even so, Toolbox works with relative paths, so we'll just clunkily strip
// the prefix when it comes up.
func (toolbox *Toolbox) normalizePath(filePath string) string {
	return strings.TrimPrefix(filePath, toolbox.WorkspacePath)
}
