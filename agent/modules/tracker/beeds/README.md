# Beeds - Ticketer Implementation

This module implements the Ticketer interface using [Beads](https://github.com/steveyegge/beads), a distributed, 
git-backed graph issue tracker designed for AI agents.

## Features

- **Persistent Storage**: Uses Dagger cache volumes to persist Beads data across runs
- **Isolated Instances**: Each instance can have a unique ID for isolated ticket tracking
- **Git-backed**: All tickets are versioned using git underneath
- **Agent-Optimized**: JSON output and dependency tracking built for AI workflows

## Usage

### Basic Example

```bash
# Create a ticket
dagger call create --title "Fix authentication bug" --body "Users unable to login with OAuth"

# List ready tickets (tasks with no blockers)
dagger call list

# Get ticket details
dagger call get --id "bd-a1b2"

# Add a comment/note to a ticket
dagger call add-comment --id "bd-a1b2" --body "Working on OAuth provider config"

# Close a ticket
dagger call close --id "bd-a1b2"
```

### With Custom Instance ID

Use a unique ID to create isolated ticket storage:

```bash
# Create instance with custom ID
dagger call --unique-id "my-project" create --title "Setup CI/CD" --body "Configure GitHub Actions"

# List tickets for that instance
dagger call --unique-id "my-project" list
```

### As a Tracker Backend

This module can be used as a backend for the Tracker module:

```bash
# Use beeds as the backend for tracker
dagger -m ../tracker call --backend beeds:with-unique-id --unique-id "agent-tasks" create \
  --title "Implement feature X" \
  --body "Add new functionality for..."
```

## Configuration

### UniqueID (optional)
A unique identifier for this Beeds instance. Each unique ID gets its own cache volume for isolated storage.
- Default: `"default"`
- Example: `"project-alpha"`, `"agent-memory"`, `"sprint-23"`

### ProjectPath (optional)
The path inside the container where the Beads repository will be initialized.
- Default: `"/workspace"`

## Implementation Details

- **Base Image**: `golang:1.23-alpine`
- **Beads Installation**: Installed via official install script
- **Cache Volume**: Named `beeds-data-{uniqueID}` for persistence
- **Git Config**: Automatically configured with default agent credentials

## Beads CLI Commands Used

- `bd create` - Create new tickets
- `bd show` - Get ticket details
- `bd ready` - List ready tasks
- `bd update` - Update tickets (for comments and closing)

## Notes

- All operations return JSON output for easy parsing
- The Beads database is stored in a Dagger cache volume and persists across runs
- Each unique ID creates a completely isolated ticket database
- Git is automatically initialized and configured for Beads operation
