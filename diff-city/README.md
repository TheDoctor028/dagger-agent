# Diff City 🏙️

Diff City is a lightweight, self-hosted tool for reviewing local Git diffs. It's designed for developers who want a quick way to review changes across branches or commits in a local repository, with support for line-specific and general comments.

## ✨ Features

- **Local Repository Support:** Review any git-managed project on your machine.
- **Side-by-Side Diffing:** Clear, readable diffs powered by `diff2html`.
- **Line Comments:** Click the `+` on any line number to add specific feedback.
- **General Comments:** Post overall feedback for the entire review.
- **Status Management:** Track reviews as `Accepted`, `Require Changes`, or `Declined`.
- **Dark Mode:** Full dark mode support for late-night reviews.
- **Persistence:** All your workspaces and comments are saved locally as JSON.

## 🚀 Getting Started

### Prerequisites

- [Go](https://go.dev/dl/) installed on your machine.
- [Git](https://git-scm.com/) installed and available in your PATH.

### Installation

1. Clone or download this repository.
2. Open your terminal in the project directory.

### Running the Server

Run the following command to start the server:

```bash
go run main.go
```

The server will start on `http://localhost:8080`.

## 📖 How to Use

1. **Create a Workspace:**
   - Click "New Workspace".
   - Give it a **Name**.
   - Provide the **Absolute Path** to your local git repository.
   - Specify the **Base** (e.g., `main` or a commit hash) and **Head** (your feature branch).

2. **Review the Diff:**
   - Use the sidebar to switch between different workspaces.
   - Scroll through the diff and toggle the theme as needed.

3. **Leave Feedback:**
   - Hover over a line number and click the `+` button to add a **Line Comment**.
   - Use the bottom section to add **General Comments**.

4. **Complete the Review:**
   - Use the buttons at the top right to `Accept`, `Decline`, or `Require Changes`.

## 📂 Data Storage

All workspace metadata, states, and comments are stored in the `./data/workspaces` directory. Each workspace has its own folder containing JSON files, making it easy to backup or inspect.

## 🛠️ Built With

- **Backend:** Go, go-chi
- **Frontend:** HTML/JS, Tailwind CSS
- **Library:** diff2html
