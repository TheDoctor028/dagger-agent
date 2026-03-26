package config

import (
	"log"

	env "github.com/Netflix/go-env"
	"github.com/joho/godotenv"
)

type Config struct {
	CORSAllowedOrigin string `env:"CORS_ALLOWED_ORIGIN"`
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, reading config from environment")
	}

	cfg := &Config{}
	if _, err := env.UnmarshalFromEnviron(cfg); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	return cfg
}
