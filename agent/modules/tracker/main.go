// Tracker is a ticketing module that provides a unified interface for managing
// tickets across different backends. The Ticketer interface allows cross-module
// composition with any compatible backend.
package main

import (
	"context"
)

// Tracker provides ticket management operations backed by a configurable
// ticketing system via the Backend field.
type Tracker struct {
	// Backend is the backend that actually stores the tickets
	Backend Ticketer
}

// Ticketer defines the interface that all ticketing backends must implement.
// Any Dagger object that provides these methods can be used as a ticketing
// provider. This enables pipelines and agents to work with tickets in a
// backend-agnostic way.
type Ticketer interface {
	DaggerObject

	// Create creates a new ticket with the given title and body.
	// Returns the ticket URL or identifier on success.
	Create(ctx context.Context,
		title string,
		body string,
	) (string, error)

	// Get retrieves the details of a ticket by its ID or number.
	// Returns a human-readable formatted summary of the ticket.
	Get(ctx context.Context,
		id string,
	) (string, error)

	// List lists tickets from the backend.
	// Returns a formatted summary of tickets, one per line.
	List(ctx context.Context) (string, error)

	// AddComment adds a comment to an existing ticket.
	// Returns a confirmation message or the comment URL.
	AddComment(ctx context.Context,
		id string,
		body string,
	) (string, error)

	// Close closes or resolves an existing ticket.
	// Returns a confirmation message.
	Close(ctx context.Context,
		id string,
	) (string, error)
}

/*
Create creates a new ticket in the configured backend.
Returns the ticket URL or identifier on success.
*/
func (m *Tracker) Create(
	ctx context.Context,
	// The title or summary of the ticket
	title string,
	// The body or description of the ticket
	body string,
) (string, error) {
	return m.Backend.Create(ctx, title, body)
}

/*
Get retrieves ticket details from the configured backend.
Returns a formatted summary including title, status, body, and metadata.
*/
func (m *Tracker) Get(
	ctx context.Context,
	// The ticket ID or number (e.g. '42' for GitHub, 'PROJ-42' for Jira)
	id string,
) (string, error) {
	return m.Backend.Get(ctx, id)
}

/*
List lists tickets from the configured backend.
Returns a formatted summary of tickets, one per line.
*/
func (m *Tracker) List(
	ctx context.Context,
) (string, error) {
	return m.Backend.List(ctx)
}

/*
AddComment adds a comment to a ticket in the configured backend.
Returns a confirmation message or comment URL.
*/
func (m *Tracker) AddComment(
	ctx context.Context,
	// The ticket ID or number to comment on
	id string,
	// The comment body in plain text or markdown
	body string,
) (string, error) {
	return m.Backend.AddComment(ctx, id, body)
}

/*
Close closes or resolves a ticket in the configured backend.
Returns a confirmation message.
*/
func (m *Tracker) Close(
	ctx context.Context,
	// The ticket ID or number to close
	id string,
) (string, error) {
	return m.Backend.Close(ctx, id)
}
